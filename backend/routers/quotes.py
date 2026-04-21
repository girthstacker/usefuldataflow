import asyncio
import logging

from fastapi import APIRouter, HTTPException, Query
from polygon import RESTClient

from backend.config import settings
from backend.services import schwab

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/quotes", tags=["quotes"])


# ─── Polygon (run in executor — sync client) ───────────────────────────────────

def _poly() -> RESTClient:
    return RESTClient(api_key=settings.POLYGON_API_KEY)


def _poly_fetch_sync(symbols: list[str]) -> dict[str, dict]:
    results = {}
    client = _poly()
    for sym in symbols:
        try:
            rows = list(client.get_previous_close_agg(sym))
            if not rows:
                continue
            a = rows[0]
            results[sym] = {
                "symbol": sym,
                "last":       getattr(a, "close",  None),
                "bid":        None,
                "ask":        None,
                "change":     None,
                "change_pct": None,
                "volume":     getattr(a, "volume", None),
                "source":     "polygon_prev_close",
            }
        except Exception as exc:
            logger.warning("Polygon prev-close %s: %s", sym, exc)
    return results


async def _poly_snapshots(symbols: list[str]) -> dict[str, dict]:
    loop = asyncio.get_event_loop()
    try:
        return await asyncio.wait_for(
            loop.run_in_executor(None, _poly_fetch_sync, symbols),
            timeout=10.0,
        )
    except Exception as exc:
        logger.warning("Polygon snapshots: %s", exc)
        return {}


# ─── yfinance fallback ─────────────────────────────────────────────────────────

def _yf_fetch_sync(symbols: list[str]) -> dict[str, dict]:
    try:
        import yfinance as yf
    except ImportError:
        return {}
    results = {}
    try:
        tickers = yf.Tickers(" ".join(symbols))
        for sym in symbols:
            try:
                fi = tickers.tickers[sym].fast_info
                last = getattr(fi, "last_price",      None)
                prev = getattr(fi, "previous_close",  None)
                change = (last - prev)           if last and prev else None
                pct    = (change / prev * 100)   if change and prev else None
                results[sym] = {
                    "symbol":     sym,
                    "last":       round(last,   4) if last   else None,
                    "bid":        None,
                    "ask":        None,
                    "change":     round(change, 4) if change else None,
                    "change_pct": round(pct,    3) if pct    else None,
                    "volume":     getattr(fi, "three_month_average_volume", None),
                    "source":     "yfinance",
                }
            except Exception as exc:
                logger.debug("yfinance %s: %s", sym, exc)
    except Exception as exc:
        logger.warning("yfinance batch: %s", exc)
    return results


async def _yf_snapshots(symbols: list[str]) -> dict[str, dict]:
    loop = asyncio.get_event_loop()
    try:
        return await asyncio.wait_for(
            loop.run_in_executor(None, _yf_fetch_sync, symbols),
            timeout=15.0,
        )
    except Exception as exc:
        logger.warning("yfinance snapshots: %s", exc)
        return {}


# ─── endpoints ─────────────────────────────────────────────────────────────────

@router.get("/{symbol}")
async def get_quote(symbol: str):
    sym = symbol.upper()
    try:
        return await schwab.get_quote(sym)
    except Exception:
        pass
    result = await _poly_snapshots([sym])
    if sym in result:
        return result[sym]
    result = await _yf_snapshots([sym])
    if sym in result:
        return result[sym]
    raise HTTPException(status_code=502, detail="Quote unavailable")


@router.get("")
async def get_quotes(symbols: str = Query(..., description="Comma-separated tickers")):
    syms = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    if not syms:
        raise HTTPException(status_code=400, detail="No symbols provided")
    try:
        return await schwab.get_quotes(syms)
    except Exception:
        pass
    result = await _poly_snapshots(syms)
    if result:
        return result
    return await _yf_snapshots(syms)


def _yf_bars_sync(symbol: str, multiplier: int, timespan: str, from_: str | None, limit: int) -> list[dict]:
    import yfinance as yf

    interval_map = {
        ("1",  "minute"): "1m",  ("2",  "minute"): "2m",  ("5",  "minute"): "5m",
        ("15", "minute"): "15m", ("30", "minute"): "30m", ("60", "minute"): "60m",
        ("90", "minute"): "90m", ("1",  "hour"):   "1h",  ("1",  "day"):    "1d",
    }
    period_map = {
        "1m": "1d", "2m": "5d", "5m": "5d", "15m": "5d",
        "30m": "5d", "60m": "1mo", "90m": "1mo", "1h": "1mo", "1d": "3mo",
    }
    interval = interval_map.get((str(multiplier), timespan), "30m")
    ticker = yf.Ticker(symbol)
    try:
        hist = ticker.history(start=from_, interval=interval) if from_ else None
        if hist is None or hist.empty:
            hist = ticker.history(period=period_map.get(interval, "5d"), interval=interval)
    except Exception:
        try:
            hist = ticker.history(period=period_map.get(interval, "5d"), interval=interval)
        except Exception as exc:
            logger.warning("yfinance bars %s: %s", symbol, exc)
            return []

    bars = []
    for ts, row in hist.iterrows():
        try:
            bars.append({
                "t": int(ts.timestamp() * 1000),
                "o": round(float(row["Open"]),  4),
                "h": round(float(row["High"]),  4),
                "l": round(float(row["Low"]),   4),
                "c": round(float(row["Close"]), 4),
                "v": int(row["Volume"]),
            })
        except Exception:
            continue
    return bars[-limit:]


@router.get("/{symbol}/bars")
async def get_bars(
    symbol: str,
    multiplier: int = 1,
    timespan: str = "minute",
    from_: str | None = Query(None, alias="from"),
    to: str | None = None,
    limit: int = 120,
):
    loop = asyncio.get_event_loop()
    try:
        return await asyncio.wait_for(
            loop.run_in_executor(None, _yf_bars_sync, symbol.upper(), multiplier, timespan, from_, limit),
            timeout=15.0,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))
