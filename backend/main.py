import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from backend.config import settings
from backend.models.db import WatchlistItem, init_db
from backend.services import schwab
from backend.services.polygon import flow_manager
from backend.services.alert_manager import alert_manager
from backend.services.news_feed import news_manager
from backend.routers import alerts, auth, news, options, positions, quotes

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DEFAULT_STREAM_SYMBOLS = ["SPY", "QQQ", "AAPL", "TSLA", "NVDA", "AMZN", "MSFT", "META"]


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await schwab.init_client()

    # seed stream with defaults + anything already in the DB watchlist
    from backend.models.db import SessionLocal
    async with SessionLocal() as db:
        rows = (await db.execute(select(WatchlistItem.symbol))).scalars().all()

    stream_symbols = list({*DEFAULT_STREAM_SYMBOLS, *rows})
    await flow_manager.start(stream_symbols)
    logger.info("Flow stream watching %d symbols", len(stream_symbols))
    await alert_manager.start_price_polling()
    await news_manager.start(stream_symbols)

    yield

    await news_manager.stop()
    await alert_manager.stop()
    await flow_manager.stop()


app = FastAPI(title="Claude Flow", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(quotes.router)
app.include_router(positions.router)
app.include_router(options.router)
app.include_router(alerts.router)
app.include_router(news.router)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "flow_stream": flow_manager.is_running,
        "watching": flow_manager.watched_symbols,
    }
