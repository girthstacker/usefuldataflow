"""
Market data service — futures via yfinance (polled every 30s) and crypto via Binance WebSocket (real-time).
"""
import asyncio
import json
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

FUTURES = [
    {"symbol": "ES=F",  "name": "S&P 500",  "display": "/ES"},
    {"symbol": "NQ=F",  "name": "Nasdaq",   "display": "/NQ"},
    {"symbol": "YM=F",  "name": "Dow",      "display": "/YM"},
    {"symbol": "RTY=F", "name": "Russell",  "display": "/RTY"},
    {"symbol": "CL=F",  "name": "Crude Oil","display": "/CL"},
    {"symbol": "GC=F",  "name": "Gold",     "display": "/GC"},
    {"symbol": "SI=F",  "name": "Silver",   "display": "/SI"},
    {"symbol": "ZN=F",  "name": "10Y Note", "display": "/ZN"},
]

CRYPTO_PAIRS = ["btcusdt", "ethusdt", "solusdt", "bnbusdt", "xrpusdt"]

BINANCE_WS = "wss://stream.binance.us:9443/stream?streams=" + "/".join(
    f"{p}@ticker" for p in CRYPTO_PAIRS
)


class MarketDataManager:
    def __init__(self) -> None:
        self._queues: list[asyncio.Queue] = []
        self._futures_cache: dict[str, dict] = {}
        self._crypto_cache: dict[str, dict] = {}
        self._running = False
        self._tasks: list[asyncio.Task] = []

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._tasks = [
            asyncio.create_task(self._poll_futures_loop(), name="futures-poll"),
            asyncio.create_task(self._crypto_stream_loop(), name="crypto-ws"),
        ]
        logger.info("MarketDataManager started")

    async def stop(self) -> None:
        self._running = False
        for t in self._tasks:
            t.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)

    # ── pub/sub ────────────────────────────────────────────────────────────────

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=200)
        self._queues.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        try:
            self._queues.remove(q)
        except ValueError:
            pass

    def get_futures(self) -> list[dict]:
        order = [f["symbol"] for f in FUTURES]
        return [self._futures_cache[s] for s in order if s in self._futures_cache]

    def get_crypto(self) -> list[dict]:
        return list(self._crypto_cache.values())

    async def _broadcast(self, msg: dict) -> None:
        dead = []
        for q in self._queues:
            try:
                q.put_nowait(msg)
            except asyncio.QueueFull:
                dead.append(q)
        for q in dead:
            self.unsubscribe(q)

    # ── futures ────────────────────────────────────────────────────────────────

    async def _poll_futures_loop(self) -> None:
        await self._fetch_futures()
        while self._running:
            await asyncio.sleep(30)
            await self._fetch_futures()

    async def _fetch_futures(self) -> None:
        try:
            import yfinance as yf
        except ImportError:
            logger.warning("yfinance not installed — pip install yfinance")
            return

        symbols = [f["symbol"] for f in FUTURES]
        meta = {f["symbol"]: f for f in FUTURES}

        def _fetch():
            results = {}
            try:
                tickers = yf.Tickers(" ".join(symbols))
                for sym, fut in meta.items():
                    try:
                        fi = tickers.tickers[sym].fast_info
                        last = getattr(fi, "last_price", None)
                        prev = getattr(fi, "previous_close", None)
                        change = (last - prev) if last and prev else None
                        pct = (change / prev * 100) if change and prev else None
                        results[sym] = {
                            "symbol":     sym,
                            "display":    fut["display"],
                            "name":       fut["name"],
                            "last":       round(last, 2) if last else None,
                            "change":     round(change, 2) if change else None,
                            "change_pct": round(pct, 3) if pct else None,
                            "source":     "yfinance",
                            "asset_type": "futures",
                            "updated_at": datetime.utcnow().isoformat(),
                        }
                    except Exception as exc:
                        logger.debug("yfinance %s: %s", sym, exc)
            except Exception as exc:
                logger.warning("yfinance batch fetch: %s", exc)
            return results

        try:
            loop = asyncio.get_event_loop()
            results = await asyncio.wait_for(loop.run_in_executor(None, _fetch), timeout=25.0)
            self._futures_cache.update(results)
            for item in results.values():
                await self._broadcast(item)
            logger.debug("Futures polled: %d symbols", len(results))
        except asyncio.TimeoutError:
            logger.warning("Futures poll timed out")
        except Exception as exc:
            logger.warning("Futures poll error: %s", exc)

    # ── crypto ─────────────────────────────────────────────────────────────────

    async def _crypto_stream_loop(self) -> None:
        while self._running:
            try:
                await self._run_binance_ws()
            except Exception as exc:
                logger.warning("Binance WS error: %s — reconnecting in 5s", exc)
                await asyncio.sleep(5)

    async def _run_binance_ws(self) -> None:
        import websockets
        async with websockets.connect(BINANCE_WS, ping_interval=20) as ws:
            logger.info("Binance WebSocket connected")
            async for raw in ws:
                if not self._running:
                    return
                try:
                    data = json.loads(raw)
                    t = data.get("data", {})
                    pair = t.get("s", "")
                    if not pair.endswith("USDT"):
                        continue
                    base = pair[:-4]
                    last = float(t.get("c", 0) or 0)
                    open24 = float(t.get("o", 0) or 0)
                    change = last - open24
                    pct = (change / open24 * 100) if open24 else None
                    item = {
                        "symbol":     f"{base}-USD",
                        "display":    base,
                        "name":       base,
                        "last":       round(last, 4),
                        "change":     round(change, 4),
                        "change_pct": round(pct, 3) if pct else None,
                        "volume_24h": float(t.get("q", 0) or 0),
                        "source":     "binance",
                        "asset_type": "crypto",
                        "updated_at": datetime.utcnow().isoformat(),
                    }
                    self._crypto_cache[f"{base}-USD"] = item
                    await self._broadcast(item)
                except Exception:
                    pass


market_manager = MarketDataManager()
