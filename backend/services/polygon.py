import asyncio
import json
import logging
import re
from datetime import date, datetime, timedelta
from typing import Any, Callable, Awaitable

import websockets
from polygon import RESTClient

from backend.config import settings

logger = logging.getLogger(__name__)

# ─── symbol helpers ────────────────────────────────────────────────────────────

_OPTION_RE = re.compile(r"^O:([A-Z]{1,6})(\d{6})([CP])(\d{8})$")


def parse_option_symbol(sym: str) -> dict | None:
    """Parse 'O:AAPL230616C00150000' → {symbol, expiry, option_type, strike}."""
    m = _OPTION_RE.match(sym)
    if not m:
        return None
    ticker, exp_str, opt_type, strike_raw = m.groups()
    try:
        expiry = datetime.strptime(exp_str, "%y%m%d").date().isoformat()
    except ValueError:
        return None
    return {
        "symbol": ticker,
        "expiry": expiry,
        "option_type": "call" if opt_type == "C" else "put",
        "strike": int(strike_raw) / 1000,
    }


def _client() -> RESTClient:
    return RESTClient(api_key=settings.POLYGON_API_KEY)


# ─── REST ──────────────────────────────────────────────────────────────────────

async def get_chain(
    ticker: str,
    expiry_gte: str | None = None,
    expiry_lte: str | None = None,
    contract_type: str | None = None,
    limit: int = 250,
) -> list[dict]:
    """
    Snapshot options chain for a ticker with Greeks, IV, OI, bid/ask.
    Returns a flat list; frontend groups by expiry/strike.
    """
    today = date.today()
    gte = expiry_gte or today.isoformat()
    lte = expiry_lte or (today + timedelta(days=60)).isoformat()

    params: dict[str, Any] = {
        "expiration_date.gte": gte,
        "expiration_date.lte": lte,
        "limit": limit,
        "order": "asc",
        "sort": "expiration_date",
    }
    if contract_type:
        params["contract_type"] = contract_type

    results: list[dict] = []
    try:
        for snap in _client().list_snapshot_options_chain(ticker.upper(), params=params):
            d = snap.details
            g = snap.greeks
            q = snap.last_quote
            tr = snap.last_trade
            day = snap.day
            ua = snap.underlying_asset
            results.append(
                {
                    "ticker": d.ticker if d else None,
                    "symbol": ticker.upper(),
                    "contract_type": d.contract_type if d else None,
                    "strike": float(d.strike_price) if d and d.strike_price is not None else None,
                    "expiry": str(d.expiration_date) if d and d.expiration_date else None,
                    "bid": float(q.bid) if q and q.bid is not None else None,
                    "ask": float(q.ask) if q and q.ask is not None else None,
                    "mid": float(q.midpoint) if q and q.midpoint is not None else None,
                    "last": float(tr.price) if tr and tr.price is not None else None,
                    "volume": int(day.volume) if day and day.volume else 0,
                    "open_interest": int(snap.open_interest) if snap.open_interest else 0,
                    "iv": float(snap.implied_volatility) if snap.implied_volatility else None,
                    "delta": float(g.delta) if g and g.delta is not None else None,
                    "gamma": float(g.gamma) if g and g.gamma is not None else None,
                    "theta": float(g.theta) if g and g.theta is not None else None,
                    "vega": float(g.vega) if g and g.vega is not None else None,
                    "underlying_price": float(ua.price) if ua and ua.price else None,
                    "in_the_money": (
                        (d.contract_type == "call" and ua and d and ua.price > d.strike_price)
                        or (d.contract_type == "put" and ua and d and ua.price < d.strike_price)
                    ) if (d and ua and ua.price and d.strike_price) else False,
                }
            )
    except Exception as exc:
        logger.error("get_chain(%s): %s", ticker, exc)
    return results


async def get_contract_aggs(
    contract_ticker: str,
    multiplier: int = 1,
    timespan: str = "minute",
    from_: str | None = None,
    to: str | None = None,
    limit: int = 120,
) -> list[dict]:
    today = date.today()
    from_date = from_ or (today - timedelta(days=1)).isoformat()
    to_date = to or today.isoformat()
    bars: list[dict] = []
    for agg in _client().list_aggs(
        contract_ticker, multiplier, timespan, from_date, to_date, limit=limit
    ):
        bars.append(
            {
                "t": agg.timestamp,
                "o": agg.open,
                "h": agg.high,
                "l": agg.low,
                "c": agg.close,
                "v": agg.volume,
                "vw": agg.vwap,
            }
        )
    return bars


async def get_equity_snapshot(ticker: str) -> dict | None:
    try:
        snaps = list(_client().get_snapshot_all("stocks", tickers=[ticker.upper()]))
        if not snaps:
            return None
        s = snaps[0]
        return {
            "symbol": ticker.upper(),
            "last_price": float(s.last_trade.price) if s.last_trade and s.last_trade.price else None,
            "bid": float(s.last_quote.bid) if s.last_quote and s.last_quote.bid else None,
            "ask": float(s.last_quote.ask) if s.last_quote and s.last_quote.ask else None,
            "change": float(s.todays_change) if getattr(s, "todays_change", None) else None,
            "change_pct": float(s.todays_change_percent) if getattr(s, "todays_change_percent", None) else None,
            "volume": int(s.day.volume) if s.day and s.day.volume else None,
        }
    except Exception as exc:
        logger.warning("get_equity_snapshot(%s): %s", ticker, exc)
        return None


# ─── WebSocket stream manager ──────────────────────────────────────────────────

class FlowStreamManager:
    """
    Connects to wss://socket.polygon.io/options, authenticates, subscribes
    to option trade events for tracked underlyings, scores each trade through
    flow_detector, persists unusual flow to DB, and fans out to frontend WS clients.
    """

    WS_URI = "wss://socket.polygon.io/options"
    OI_REFRESH_SECS = 60

    def __init__(self) -> None:
        self._subscribed: set[str] = set()
        # per-contract caches refreshed every OI_REFRESH_SECS
        self._oi_cache: dict[str, int] = {}
        self._iv_cache: dict[str, float] = {}
        self._underlying_price: dict[str, float] = {}
        # running daily volume per contract (reset on restart)
        self._vol_cache: dict[str, int] = {}
        # connected frontend websocket queues
        self._queues: set[asyncio.Queue] = set()
        self._ws_task: asyncio.Task | None = None
        self._oi_task: asyncio.Task | None = None
        self._running = False

    # ── public ─────────────────────────────────────────────────────────────────

    async def start(self, symbols: list[str]) -> None:
        for s in symbols:
            self._subscribed.add(s.upper())
        self._running = True
        # seed OI cache before WS connects so first trades can score vol/OI
        for ticker in list(self._subscribed):
            try:
                await self._refresh_snapshot(ticker)
            except Exception:
                pass
        self._ws_task = asyncio.create_task(self._ws_loop(), name="polygon_ws")
        self._oi_task = asyncio.create_task(self._oi_loop(), name="polygon_oi")
        logger.info("FlowStreamManager started: %s", sorted(self._subscribed))

    async def stop(self) -> None:
        self._running = False
        for t in (self._ws_task, self._oi_task):
            if t:
                t.cancel()

    def add_symbols(self, symbols: list[str]) -> None:
        new = {s.upper() for s in symbols} - self._subscribed
        self._subscribed.update(new)
        # snapshot refresh for new symbols happens in the next OI loop tick

    def subscribe_client(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=500)
        self._queues.add(q)
        return q

    def unsubscribe_client(self, q: asyncio.Queue) -> None:
        self._queues.discard(q)

    @property
    def is_running(self) -> bool:
        return self._running and bool(self._ws_task and not self._ws_task.done())

    @property
    def watched_symbols(self) -> list[str]:
        return sorted(self._subscribed)

    # ── WebSocket loop ──────────────────────────────────────────────────────────

    async def _ws_loop(self) -> None:
        backoff = 1
        while self._running:
            try:
                await self._connect()
                backoff = 1
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.warning("Polygon WS disconnected: %s — retry in %ds", exc, backoff)
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 60)

    async def _connect(self) -> None:
        async with websockets.connect(
            self.WS_URI,
            ping_interval=20,
            ping_timeout=10,
            open_timeout=15,
        ) as ws:
            # 1. connected acknowledgement
            await ws.recv()

            # 2. authenticate
            await ws.send(json.dumps({"action": "auth", "params": settings.POLYGON_API_KEY}))
            auth_resp = json.loads(await ws.recv())
            if not any(m.get("status") == "auth_success" for m in auth_resp):
                raise RuntimeError(f"Polygon WS auth failed: {auth_resp}")
            logger.info("Polygon WS authenticated")

            # 3. subscribe — T.O:SPY* matches every SPY option trade event
            if self._subscribed:
                subs = ",".join(f"T.O:{s}*" for s in sorted(self._subscribed))
                await ws.send(json.dumps({"action": "subscribe", "params": subs}))
                logger.info("Subscribed to: %s", subs)

            # 4. stream
            async for raw in ws:
                for ev in json.loads(raw):
                    if ev.get("ev") == "T":
                        asyncio.create_task(self._on_trade(ev))

    # ── trade handler ───────────────────────────────────────────────────────────

    async def _on_trade(self, ev: dict) -> None:
        from backend.services.flow_detector import detect_and_store

        sym: str = ev.get("sym", "")
        parsed = parse_option_symbol(sym)
        if not parsed:
            return

        size = int(ev.get("s", 0))
        if size == 0:
            return

        # accumulate running daily volume per contract
        self._vol_cache[sym] = self._vol_cache.get(sym, 0) + size

        # Polygon condition 14 = IntermarketSweep (aggressive cross-exchange order)
        is_sweep = 14 in (ev.get("c") or [])

        raw = {
            **parsed,
            "price": float(ev.get("p", 0)),
            "size": size,
            "open_interest": self._oi_cache.get(sym, 0),
            "volume": self._vol_cache[sym],
            "implied_volatility": self._iv_cache.get(sym, 0.0),
            "delta": 0.0,
            "underlying_price": self._underlying_price.get(parsed["symbol"], 0.0),
            "is_sweep": is_sweep,
        }

        await detect_and_store(raw, self._broadcast)

    async def _broadcast(self, event: dict) -> None:
        dead: set[asyncio.Queue] = set()
        for q in list(self._queues):
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                dead.add(q)
        self._queues -= dead

    # ── OI / IV / price refresh ─────────────────────────────────────────────────

    async def _oi_loop(self) -> None:
        while self._running:
            for ticker in list(self._subscribed):
                try:
                    await self._refresh_snapshot(ticker)
                except asyncio.CancelledError:
                    return
                except Exception as exc:
                    logger.debug("OI refresh %s: %s", ticker, exc)
                await asyncio.sleep(0)  # yield between tickers
            await asyncio.sleep(self.OI_REFRESH_SECS)

    async def _refresh_snapshot(self, ticker: str) -> None:
        today = date.today()
        params: dict[str, Any] = {
            "expiration_date.gte": today.isoformat(),
            "expiration_date.lte": (today + timedelta(days=90)).isoformat(),
            "limit": 500,
        }
        count = 0
        for snap in _client().list_snapshot_options_chain(ticker, params=params):
            d = snap.details
            if not d or not d.ticker:
                continue
            if snap.open_interest is not None:
                self._oi_cache[d.ticker] = int(snap.open_interest)
            if snap.implied_volatility is not None:
                self._iv_cache[d.ticker] = float(snap.implied_volatility)
            if snap.underlying_asset and snap.underlying_asset.price:
                self._underlying_price[ticker] = float(snap.underlying_asset.price)
            count += 1
        logger.debug("Refreshed %d contracts for %s", count, ticker)


flow_manager = FlowStreamManager()
