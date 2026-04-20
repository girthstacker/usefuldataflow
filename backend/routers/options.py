import asyncio
import json
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from datetime import datetime, timedelta

from sqlalchemy import case, func, select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.db import OptionsFlow, get_db
from backend.services import schwab
from backend.services.polygon import flow_manager, get_chain as poly_chain

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/options", tags=["options"])


# ─── REST: options chain ────────────────────────────────────────────────────────

@router.get("/chain/{ticker}")
async def get_chain(
    ticker: str,
    source: str = Query("polygon", pattern="^(schwab|polygon)$"),
    expiry_gte: str | None = None,
    expiry_lte: str | None = None,
    contract_type: str | None = Query(None, pattern="^(call|put)$"),
    limit: int = Query(250, le=1000),
):
    """
    Returns a flat list of option contract snapshots with Greeks, IV, OI, bid/ask.
    source=polygon uses Polygon.io snapshot (live, no auth needed).
    source=schwab uses Schwab streaming chain (requires OAuth token).
    """
    sym = ticker.upper()
    try:
        if source == "schwab":
            return await schwab.get_option_chain(sym)
        return await poly_chain(
            sym,
            expiry_gte=expiry_gte,
            expiry_lte=expiry_lte,
            contract_type=contract_type,
            limit=limit,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))


# ─── REST: flow feed ───────────────────────────────────────────────────────────

@router.get("/flow")
async def get_flow(
    symbol: str | None = Query(None, description="Filter by underlying ticker"),
    option_type: str | None = Query(None, pattern="^(call|put)$"),
    min_score: int = Query(3, ge=0),
    min_premium: float = Query(0, ge=0),
    sweep_only: bool = False,
    limit: int = Query(50, le=500),
    db: AsyncSession = Depends(get_db),
):
    """Recent unusual flow from DB, newest first."""
    q = (
        select(OptionsFlow)
        .where(OptionsFlow.flow_score >= min_score)
        .where(OptionsFlow.premium >= min_premium)
    )
    if symbol:
        q = q.where(OptionsFlow.symbol == symbol.upper())
    if option_type:
        q = q.where(OptionsFlow.option_type == option_type)
    if sweep_only:
        q = q.where(OptionsFlow.is_sweep == True)  # noqa: E712

    q = q.order_by(desc(OptionsFlow.detected_at)).limit(limit)
    rows = (await db.execute(q)).scalars().all()

    return [_flow_row(f) for f in rows]


@router.get("/flow/stats")
async def get_flow_stats(
    hours: int = Query(24, ge=1, le=168),
    min_score: int = Query(3, ge=0),
    db: AsyncSession = Depends(get_db),
):
    """Aggregate statistics: symbol leaderboard, hourly buckets, top trades."""
    cutoff = datetime.utcnow() - timedelta(hours=hours)
    base = [OptionsFlow.detected_at >= cutoff, OptionsFlow.flow_score >= min_score]

    # summary
    s = (await db.execute(
        select(
            func.sum(OptionsFlow.premium).label("tp"),
            func.count().label("tc"),
            func.sum(case((OptionsFlow.option_type == "call", 1), else_=0)).label("calls"),
            func.sum(case((OptionsFlow.option_type == "put",  1), else_=0)).label("puts"),
            func.sum(case((OptionsFlow.is_sweep == True, 1), else_=0)).label("sweeps"),  # noqa: E712
            func.avg(OptionsFlow.flow_score).label("avg_score"),
        ).where(*base)
    )).one()

    tc = int(s.tc or 0)
    calls_n  = int(s.calls  or 0)
    puts_n   = int(s.puts   or 0)
    sweeps_n = int(s.sweeps or 0)

    summary = {
        "total_premium": float(s.tp or 0),
        "total_count":   tc,
        "call_count":    calls_n,
        "put_count":     puts_n,
        "sweep_count":   sweeps_n,
        "call_pct":  round(calls_n  / tc * 100, 1) if tc else 0,
        "put_pct":   round(puts_n   / tc * 100, 1) if tc else 0,
        "sweep_pct": round(sweeps_n / tc * 100, 1) if tc else 0,
        "avg_score": round(float(s.avg_score or 0), 1),
    }

    # symbol leaderboard
    sym_rows = (await db.execute(
        select(
            OptionsFlow.symbol,
            func.sum(OptionsFlow.premium).label("tp"),
            func.count().label("cnt"),
            func.sum(case((OptionsFlow.option_type == "call", 1), else_=0)).label("calls"),
            func.sum(case((OptionsFlow.option_type == "put",  1), else_=0)).label("puts"),
            func.sum(case((OptionsFlow.is_sweep == True, 1), else_=0)).label("sweeps"),  # noqa: E712
            func.avg(OptionsFlow.flow_score).label("avg_score"),
            func.max(OptionsFlow.premium).label("max_single"),
        )
        .where(*base)
        .group_by(OptionsFlow.symbol)
        .order_by(func.sum(OptionsFlow.premium).desc())
        .limit(15)
    )).all()

    symbol_totals = [
        {
            "symbol":        r.symbol,
            "total_premium": float(r.tp or 0),
            "count":         int(r.cnt or 0),
            "calls":         int(r.calls or 0),
            "puts":          int(r.puts or 0),
            "sweeps":        int(r.sweeps or 0),
            "avg_score":     round(float(r.avg_score or 0), 1),
            "max_single":    float(r.max_single or 0),
            "call_pct":      round(int(r.calls or 0) / max(int(r.cnt or 1), 1) * 100),
        }
        for r in sym_rows
    ]

    # hourly buckets (UTC hour — note market hours ≈ 13–20 UTC / ET+4)
    hour_rows = (await db.execute(
        select(
            func.strftime("%H", OptionsFlow.detected_at).label("hour"),
            func.sum(OptionsFlow.premium).label("premium"),
            func.count().label("count"),
            func.sum(case((OptionsFlow.is_sweep == True, 1), else_=0)).label("sweeps"),  # noqa: E712
        )
        .where(*base)
        .group_by(func.strftime("%H", OptionsFlow.detected_at))
        .order_by(func.strftime("%H", OptionsFlow.detected_at))
    )).all()

    hourly = [
        {
            "hour":    r.hour,
            "premium": float(r.premium or 0),
            "count":   int(r.count or 0),
            "sweeps":  int(r.sweeps or 0),
        }
        for r in hour_rows
    ]

    # top 5 trades by single-trade premium
    top_rows = (await db.execute(
        select(OptionsFlow)
        .where(*base)
        .order_by(OptionsFlow.premium.desc())
        .limit(5)
    )).scalars().all()

    return {
        "hours":         hours,
        "min_score":     min_score,
        "summary":       summary,
        "symbol_totals": symbol_totals,
        "hourly":        hourly,
        "top_trades":    [_flow_row(f) for f in top_rows],
    }


@router.get("/flow/{ticker}")
async def get_flow_for_ticker(
    ticker: str,
    min_score: int = 1,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
):
    return await get_flow(symbol=ticker, min_score=min_score, limit=limit, db=db)


def _flow_row(f: OptionsFlow) -> dict:
    return {
        "id": f.id,
        "symbol": f.symbol,
        "option_type": f.option_type,
        "strike": f.strike,
        "expiry": f.expiry,
        "premium": f.premium,
        "size": f.size,
        "price": f.price,
        "open_interest": f.open_interest,
        "volume": f.volume,
        "implied_volatility": f.implied_volatility,
        "delta": f.delta,
        "is_sweep": f.is_sweep,
        "flow_score": f.flow_score,
        "flags": f.flags,
        "detected_at": f.detected_at.isoformat() if f.detected_at else None,
    }


# ─── WebSocket: real-time flow stream ──────────────────────────────────────────

@router.websocket("/flow/stream")
async def flow_stream(websocket: WebSocket):
    """
    Pushes scored OptionsFlow events to the client as they're detected.
    Each message is a JSON object matching the /options/flow row shape.
    """
    await websocket.accept()
    q = flow_manager.subscribe_client()
    try:
        while True:
            try:
                event = await asyncio.wait_for(q.get(), timeout=30)
                await websocket.send_json(event)
            except asyncio.TimeoutError:
                # keepalive ping
                await websocket.send_json({"type": "ping"})
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.debug("flow_stream client dropped: %s", exc)
    finally:
        flow_manager.unsubscribe_client(q)


# ─── stream management ─────────────────────────────────────────────────────────

class WatchRequest(BaseModel):
    symbols: list[str]


@router.post("/stream/watch")
async def watch_symbols(body: WatchRequest):
    """Add underlying tickers to the live Polygon flow stream."""
    syms = [s.strip().upper() for s in body.symbols if s.strip()]
    if not syms:
        raise HTTPException(status_code=400, detail="No symbols provided.")
    flow_manager.add_symbols(syms)
    return {"watching": flow_manager.watched_symbols}


@router.get("/stream/status")
async def stream_status():
    return {
        "running": flow_manager.is_running,
        "watching": flow_manager.watched_symbols,
    }
