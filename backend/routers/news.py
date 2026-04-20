import asyncio
import json
import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.db import NewsItem, get_db
from backend.services.news_feed import news_manager

router = APIRouter(prefix="/news", tags=["news"])
logger = logging.getLogger(__name__)


def _serialize(item: NewsItem) -> dict:
    return {
        "id":          item.id,
        "title":       item.title,
        "source":      item.source,
        "source_type": item.source_type,
        "url":         item.url,
        "tickers":     json.loads(item.tickers or "[]"),
        "score":       item.score,
        "ai_summary":  item.ai_summary,
        "tags":        json.loads(item.tags or "[]"),
        "published_at": item.published_at.isoformat() if item.published_at else None,
        "created_at":  item.created_at.isoformat() if item.created_at else None,
    }


@router.get("")
async def get_news(
    ticker: Optional[str] = Query(None),
    type:   Optional[str] = Query(None, pattern="^(news|social|sec)$"),
    limit:  int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    q = select(NewsItem).order_by(desc(NewsItem.published_at)).limit(limit)
    if ticker:
        q = q.where(NewsItem.tickers.contains(ticker.upper()))
    if type:
        q = q.where(NewsItem.source_type == type)
    rows = (await db.execute(q)).scalars().all()
    return [_serialize(r) for r in rows]


@router.websocket("/stream")
async def news_stream(ws: WebSocket):
    await ws.accept()
    queue = news_manager.subscribe()
    ping_task: asyncio.Task | None = None

    async def _ping():
        while True:
            await asyncio.sleep(30)
            try:
                await ws.send_json({"type": "ping"})
            except Exception:
                break

    try:
        ping_task = asyncio.create_task(_ping())
        while True:
            item = await queue.get()
            await ws.send_json(item)
    except (WebSocketDisconnect, Exception):
        pass
    finally:
        if ping_task:
            ping_task.cancel()
        news_manager.unsubscribe(queue)
