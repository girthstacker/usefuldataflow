import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, date
from typing import Callable, Awaitable

logger = logging.getLogger(__name__)

# ─── scoring thresholds ────────────────────────────────────────────────────────

PREMIUM_BLOCK   = 1_000_000   # $1M+ = block trade
PREMIUM_UNUSUAL =   500_000
PREMIUM_NOTABLE =   100_000
PREMIUM_SMALL   =    25_000

VOL_OI_EXTREME  = 5.0
VOL_OI_HIGH     = 2.0
VOL_OI_NOTABLE  = 1.0

MIN_FLOW_SCORE  = 3


# ─── data model ────────────────────────────────────────────────────────────────

@dataclass
class OptionTrade:
    symbol: str
    option_type: str        # "call" | "put"
    strike: float
    expiry: str             # "YYYY-MM-DD"
    price: float
    size: int
    open_interest: int  = 0
    volume: int         = 0   # running daily volume for this contract
    implied_volatility: float = 0.0
    delta: float        = 0.0
    underlying_price: float   = 0.0
    is_sweep: bool      = False
    detected_at: datetime = field(default_factory=datetime.utcnow)

    @property
    def premium(self) -> float:
        return self.price * self.size * 100

    @property
    def days_to_expiry(self) -> int:
        try:
            return (date.fromisoformat(self.expiry) - date.today()).days
        except ValueError:
            return 9999

    @property
    def moneyness(self) -> float:
        """
        > 0 means OTM (call above spot, put below spot).
        Expressed as a fraction of spot price.
        """
        if not self.underlying_price:
            return 0.0
        if self.option_type == "call":
            return (self.strike - self.underlying_price) / self.underlying_price
        return (self.underlying_price - self.strike) / self.underlying_price


@dataclass
class FlowResult:
    trade: OptionTrade
    score: int
    flags: list[str]
    is_unusual: bool


# ─── scoring ───────────────────────────────────────────────────────────────────

def score_trade(trade: OptionTrade) -> FlowResult:
    score = 0
    flags: list[str] = []

    # 1. Premium size — most reliable signal
    p = trade.premium
    if p >= PREMIUM_BLOCK:
        score += 5
        flags.append("block_1m+")
    elif p >= PREMIUM_UNUSUAL:
        score += 4
        flags.append("premium_500k+")
    elif p >= PREMIUM_NOTABLE:
        score += 2
        flags.append("premium_100k+")
    elif p >= PREMIUM_SMALL:
        score += 1
        flags.append("premium_25k+")
    else:
        score -= 1  # tiny trades are noise

    # 2. Sweep vs block — sweep = aggressive, crosses multiple exchanges
    if trade.is_sweep:
        score += 2
        flags.append("sweep")
    elif p >= PREMIUM_UNUSUAL:
        # Large non-sweep = block; still meaningful
        score += 1
        flags.append("block")

    # 3. Volume / OI ratio — vol accumulating beyond open interest is unusual
    if trade.open_interest > 0 and trade.volume > 0:
        vol_oi = trade.volume / trade.open_interest
        if vol_oi >= VOL_OI_EXTREME:
            score += 3
            flags.append(f"vol_oi_{vol_oi:.1f}x")
        elif vol_oi >= VOL_OI_HIGH:
            score += 2
            flags.append(f"vol_oi_{vol_oi:.1f}x")
        elif vol_oi >= VOL_OI_NOTABLE:
            score += 1
            flags.append(f"vol_oi_{vol_oi:.1f}x")

    # 4. Moneyness — OTM buys carry more conviction
    m = trade.moneyness
    if 0 < m <= 0.03:
        score += 1
        flags.append("near_otm")
    elif 0.03 < m <= 0.10:
        score += 2
        flags.append("otm")
    elif m > 0.10:
        score += 1
        flags.append("far_otm")
    elif m < -0.10:
        # Deep ITM — sometimes used to hide size
        flags.append("deep_itm")

    # 5. DTE — short-dated = directional urgency
    dte = trade.days_to_expiry
    if 0 < dte <= 2:
        score += 3
        flags.append(f"dte_{dte}d")
    elif dte <= 7:
        score += 2
        flags.append(f"dte_{dte}d")
    elif dte <= 30:
        score += 1
        flags.append(f"dte_{dte}d")

    # 6. Elevated IV — can indicate informed positioning before a move
    if trade.implied_volatility >= 0.80:
        score += 2
        flags.append(f"iv_{trade.implied_volatility:.0%}")
    elif trade.implied_volatility >= 0.50:
        score += 1
        flags.append(f"iv_{trade.implied_volatility:.0%}")

    return FlowResult(
        trade=trade,
        score=score,
        flags=flags,
        is_unusual=(score >= MIN_FLOW_SCORE),
    )


def detect_flow(raw: dict) -> FlowResult | None:
    """Score a raw trade dict. Returns None on parse error."""
    try:
        trade = OptionTrade(
            symbol=raw["symbol"],
            option_type=raw.get("option_type", "call").lower(),
            strike=float(raw.get("strike", 0)),
            expiry=raw.get("expiry", ""),
            price=float(raw.get("price", 0)),
            size=int(raw.get("size", 0)),
            open_interest=int(raw.get("open_interest", 0)),
            volume=int(raw.get("volume", 0)),
            implied_volatility=float(raw.get("implied_volatility", 0)),
            delta=float(raw.get("delta", 0)),
            underlying_price=float(raw.get("underlying_price", 0)),
            is_sweep=bool(raw.get("is_sweep", False)),
        )
        return score_trade(trade)
    except (KeyError, TypeError, ValueError) as exc:
        logger.warning("detect_flow parse error: %s — %s", exc, raw)
        return None


def to_db_dict(result: FlowResult) -> dict:
    t = result.trade
    return {
        "symbol": t.symbol,
        "option_type": t.option_type,
        "strike": t.strike,
        "expiry": t.expiry,
        "premium": t.premium,
        "size": t.size,
        "price": t.price,
        "open_interest": t.open_interest,
        "volume": t.volume,
        "implied_volatility": t.implied_volatility,
        "delta": t.delta,
        "is_sweep": t.is_sweep,
        "flow_score": result.score,
        "flags": json.dumps(result.flags),
        "detected_at": t.detected_at,
    }


# ─── async persist + broadcast ─────────────────────────────────────────────────

BroadcastFn = Callable[[dict], Awaitable[None]]


async def detect_and_store(
    raw: dict,
    broadcast: BroadcastFn | None = None,
) -> FlowResult | None:
    """
    Score a raw trade, write unusual flows to DB, and optionally broadcast
    to connected WebSocket clients. Returns None if below threshold.
    """
    result = detect_flow(raw)
    if result is None or not result.is_unusual:
        return None

    from backend.models.db import SessionLocal, OptionsFlow

    db_row = to_db_dict(result)
    flow_id: int | None = None

    try:
        async with SessionLocal() as db:
            flow = OptionsFlow(**db_row)
            db.add(flow)
            await db.commit()
            await db.refresh(flow)
            flow_id = flow.id
    except Exception as exc:
        logger.error("Failed to persist flow: %s", exc)
        return result

    if broadcast and flow_id is not None:
        t = result.trade
        event = {
            "id": flow_id,
            "symbol": t.symbol,
            "option_type": t.option_type,
            "strike": t.strike,
            "expiry": t.expiry,
            "premium": t.premium,
            "size": t.size,
            "price": t.price,
            "open_interest": t.open_interest,
            "volume": t.volume,
            "implied_volatility": t.implied_volatility,
            "delta": t.delta,
            "is_sweep": t.is_sweep,
            "flow_score": result.score,
            "flags": json.dumps(result.flags),
            "detected_at": t.detected_at.isoformat(),
        }
        await broadcast(event)

        try:
            from backend.services.alert_manager import alert_manager
            await alert_manager.evaluate_flow(event)
        except Exception as exc:
            logger.warning("alert evaluate_flow error: %s", exc)

    return result
