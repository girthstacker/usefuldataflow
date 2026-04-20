import asyncio
import logging
from datetime import datetime

from sqlalchemy import select

logger = logging.getLogger(__name__)


class AlertManager:
    """
    Singleton that evaluates alerts on price polls and flow events,
    then fan-outs triggers to subscribed WebSocket queues.
    """

    def __init__(self) -> None:
        self._queues: list[asyncio.Queue] = []
        self._poll_task: asyncio.Task | None = None
        self._running = False

    # ── subscriptions ──────────────────────────────────────────────────────────

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=100)
        self._queues.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        try:
            self._queues.remove(q)
        except ValueError:
            pass

    # ── lifecycle ──────────────────────────────────────────────────────────────

    async def start_price_polling(self) -> None:
        if self._running:
            return
        self._running = True
        self._poll_task = asyncio.create_task(self._price_loop(), name="alert-price-poll")
        logger.info("AlertManager price polling started")

    async def stop(self) -> None:
        self._running = False
        if self._poll_task:
            self._poll_task.cancel()
            try:
                await self._poll_task
            except asyncio.CancelledError:
                pass

    # ── evaluation ─────────────────────────────────────────────────────────────

    async def evaluate_price(self, symbol: str, last: float | None, iv: float | None = None) -> None:
        if last is None:
            return
        from backend.models.db import SessionLocal, Alert, AlertCondition
        try:
            async with SessionLocal() as db:
                rows = (
                    await db.execute(
                        select(Alert).where(
                            Alert.symbol == symbol,
                            Alert.active == True,
                            Alert.triggered == False,
                        )
                    )
                ).scalars().all()

                for alert in rows:
                    triggered = False
                    if alert.condition == AlertCondition.ABOVE and last >= alert.threshold:
                        triggered = True
                    elif alert.condition == AlertCondition.BELOW and last <= alert.threshold:
                        triggered = True
                    elif alert.condition == AlertCondition.IV_ABOVE and iv is not None and iv >= alert.threshold:
                        triggered = True

                    if triggered:
                        alert.triggered = True
                        alert.triggered_at = datetime.utcnow()
                        await db.commit()
                        await self._broadcast_trigger(alert, last)
        except Exception as exc:
            logger.warning("evaluate_price error: %s", exc)

    async def evaluate_flow(self, event: dict) -> None:
        symbol = event.get("symbol", "")
        score = event.get("flow_score", 0)
        iv = event.get("implied_volatility")
        last = event.get("price")

        from backend.models.db import SessionLocal, Alert, AlertCondition
        try:
            async with SessionLocal() as db:
                rows = (
                    await db.execute(
                        select(Alert).where(
                            Alert.symbol == symbol,
                            Alert.active == True,
                            Alert.triggered == False,
                        )
                    )
                ).scalars().all()

                for alert in rows:
                    triggered = False
                    if alert.condition == AlertCondition.FLOW_SCORE_ABOVE and score >= alert.threshold:
                        triggered = True
                    elif alert.condition == AlertCondition.IV_ABOVE and iv is not None and iv >= alert.threshold:
                        triggered = True

                    if triggered:
                        alert.triggered = True
                        alert.triggered_at = datetime.utcnow()
                        await db.commit()
                        await self._broadcast_trigger(alert, score if alert.condition == AlertCondition.FLOW_SCORE_ABOVE else iv)
        except Exception as exc:
            logger.warning("evaluate_flow error: %s", exc)

    # ── internal ───────────────────────────────────────────────────────────────

    async def _broadcast_trigger(self, alert, value) -> None:
        msg = {
            "type": "trigger",
            "id": alert.id,
            "symbol": alert.symbol,
            "condition": alert.condition,
            "threshold": alert.threshold,
            "value": value,
            "message": alert.message,
            "triggered_at": datetime.utcnow().isoformat(),
        }
        dead = []
        for q in self._queues:
            try:
                q.put_nowait(msg)
            except asyncio.QueueFull:
                dead.append(q)
        for q in dead:
            self.unsubscribe(q)

    async def _price_loop(self) -> None:
        from backend.models.db import SessionLocal, Alert
        from backend.routers.quotes import _poly_prev_close

        while self._running:
            try:
                async with SessionLocal() as db:
                    symbols = list(set(
                        (await db.execute(
                            select(Alert.symbol).where(Alert.active == True, Alert.triggered == False)
                        )).scalars().all()
                    ))

                for sym in symbols:
                    q = await _poly_prev_close(sym)
                    if q:
                        await self.evaluate_price(sym, q.get("last"), None)

            except Exception as exc:
                logger.warning("alert price loop error: %s", exc)

            await asyncio.sleep(30)


alert_manager = AlertManager()
