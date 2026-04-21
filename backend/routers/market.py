import asyncio

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from backend.services.market_data import market_manager

router = APIRouter(prefix="/market", tags=["market"])


@router.get("/futures")
async def get_futures():
    return market_manager.get_futures()


@router.get("/crypto")
async def get_crypto():
    return market_manager.get_crypto()


@router.websocket("/stream")
async def market_stream(ws: WebSocket):
    await ws.accept()
    queue = market_manager.subscribe()
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
        market_manager.unsubscribe(queue)
