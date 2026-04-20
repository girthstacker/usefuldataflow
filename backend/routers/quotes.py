import asyncio
import logging

from fastapi import APIRouter, HTTPException, Query
from polygon import RESTClient

from backend.config import settings
from backend.services import schwab

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/quotes", tags=["quotes"])


# ─── Polygon equity snapshot (fallback when Schwab not authed) ─────────────────

def _poly() -> RESTClient:
    return RESTClient(api_key=settings.POLYGON_API_KEY)


async def _poly_prev_close(symbol: str) -> dict | None:
    """Previous-close agg — available on Polygon free tier."""
    try:
        results = list(_poly().get_previous_close_agg(symbol.upper()))
        if not results:
            return None
        a = results[0]
        return {
            "symbol": symbol.upper(),
            "last": getattr(a, "close", None),
            "bid":  None,
            "ask":  None,
            "change":     None,
            "change_pct": None,
            "volume": getattr(a, "volume", None),
            "source": "polygon_prev_close",
        }
    except Exception as exc:
        logger.warning("Polygon prev-close %s: %s", symbol, exc)
        return None


async def _poly_snapshots(symbols: list[str]) -> dict[str, dict]:
    import asyncio
    tasks = [_poly_prev_close(s) for s in symbols]
    results = await asyncio.gather(*tasks)
    return {r["symbol"]: r for r in results if r}


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
    return await _poly_snapshots(syms)


@router.get("/{symbol}/bars")
async def get_bars(
    symbol: str,
    multiplier: int = 1,
    timespan: str = "minute",
    from_: str | None = Query(None, alias="from"),
    to: str | None = None,
    limit: int = 120,
):
    from backend.services.polygon import get_contract_aggs
    try:
        return await get_contract_aggs(
            symbol.upper(), multiplier=multiplier, timespan=timespan,
            from_=from_, to=to, limit=limit,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))
