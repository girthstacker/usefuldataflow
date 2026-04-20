import asyncio
import json
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.db import Alert, AlertCondition, get_db
from backend.services.alert_manager import alert_manager

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/alerts", tags=["alerts"])


class AlertCreate(BaseModel):
    symbol: str
    condition: AlertCondition
    threshold: float
    message: str | None = None


class AlertUpdate(BaseModel):
    active: bool | None = None
    threshold: float | None = None
    message: str | None = None


def _serialize(a: Alert) -> dict:
    return {
        "id": a.id,
        "symbol": a.symbol,
        "condition": a.condition,
        "threshold": a.threshold,
        "message": a.message,
        "active": a.active,
        "triggered": a.triggered,
        "triggered_at": a.triggered_at.isoformat() if a.triggered_at else None,
        "created_at": a.created_at.isoformat() if a.created_at else None,
    }


@router.get("")
async def list_alerts(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Alert).order_by(Alert.created_at.desc()))
    return [_serialize(a) for a in result.scalars()]


@router.post("", status_code=201)
async def create_alert(body: AlertCreate, db: AsyncSession = Depends(get_db)):
    alert = Alert(
        symbol=body.symbol.strip().upper(),
        condition=body.condition,
        threshold=body.threshold,
        message=body.message,
    )
    db.add(alert)
    await db.commit()
    await db.refresh(alert)
    return _serialize(alert)


@router.patch("/{alert_id}")
async def update_alert(alert_id: int, body: AlertUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Alert).where(Alert.id == alert_id))
    alert = result.scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found.")
    if body.active is not None:
        alert.active = body.active
        if body.active:
            alert.triggered = False
            alert.triggered_at = None
    if body.threshold is not None:
        alert.threshold = body.threshold
    if body.message is not None:
        alert.message = body.message
    await db.commit()
    return _serialize(alert)


@router.delete("/{alert_id}")
async def delete_alert(alert_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Alert).where(Alert.id == alert_id))
    alert = result.scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found.")
    await db.delete(alert)
    await db.commit()
    return {"deleted": alert_id}


@router.websocket("/ws")
async def alerts_ws(websocket: WebSocket):
    await websocket.accept()
    q = alert_manager.subscribe()

    async def pinger():
        while True:
            await asyncio.sleep(30)
            try:
                await websocket.send_text(json.dumps({"type": "ping"}))
            except Exception:
                break

    ping_task = asyncio.create_task(pinger())
    try:
        while True:
            try:
                msg = await asyncio.wait_for(q.get(), timeout=1.0)
                await websocket.send_text(json.dumps(msg))
            except asyncio.TimeoutError:
                pass
            except WebSocketDisconnect:
                break
    except WebSocketDisconnect:
        pass
    finally:
        ping_task.cancel()
        alert_manager.unsubscribe(q)
