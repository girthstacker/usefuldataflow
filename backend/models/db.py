from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Float, Boolean, DateTime, Enum, Text, ForeignKey
)
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase, relationship
import enum

from backend.config import settings


engine = create_async_engine(settings.DATABASE_URL, echo=False)
SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class OptionType(str, enum.Enum):
    CALL = "call"
    PUT = "put"


class AlertCondition(str, enum.Enum):
    ABOVE = "above"
    BELOW = "below"
    PERCENT_CHANGE = "percent_change"
    IV_ABOVE = "iv_above"
    FLOW_SCORE_ABOVE = "flow_score_above"


class WatchlistItem(Base):
    __tablename__ = "watchlist"

    id = Column(Integer, primary_key=True)
    symbol = Column(String(10), unique=True, nullable=False, index=True)
    added_at = Column(DateTime, default=datetime.utcnow)


class Position(Base):
    __tablename__ = "positions"

    id = Column(Integer, primary_key=True)
    symbol = Column(String(10), nullable=False, index=True)
    quantity = Column(Float, nullable=False)
    avg_cost = Column(Float, nullable=False)
    option_type = Column(Enum(OptionType), nullable=True)
    strike = Column(Float, nullable=True)
    expiry = Column(String(10), nullable=True)
    source = Column(String(20), default="schwab")
    opened_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class OptionsFlow(Base):
    __tablename__ = "options_flow"

    id = Column(Integer, primary_key=True)
    symbol = Column(String(10), nullable=False, index=True)
    option_type = Column(Enum(OptionType), nullable=False)
    strike = Column(Float, nullable=False)
    expiry = Column(String(10), nullable=False)
    premium = Column(Float, nullable=False)
    size = Column(Integer, nullable=False)
    price = Column(Float, nullable=False)
    open_interest = Column(Integer, nullable=True)
    volume = Column(Integer, nullable=True)
    implied_volatility = Column(Float, nullable=True)
    delta = Column(Float, nullable=True)
    is_sweep = Column(Boolean, default=False)
    flow_score = Column(Integer, default=0)
    flags = Column(Text, default="")
    detected_at = Column(DateTime, default=datetime.utcnow, index=True)


class Alert(Base):
    __tablename__ = "alerts"

    id = Column(Integer, primary_key=True)
    symbol = Column(String(10), nullable=False, index=True)
    condition = Column(Enum(AlertCondition), nullable=False)
    threshold = Column(Float, nullable=False)
    message = Column(String(255), nullable=True)
    active = Column(Boolean, default=True)
    triggered = Column(Boolean, default=False)
    triggered_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class NewsItem(Base):
    __tablename__ = "news_items"

    id          = Column(Integer, primary_key=True)
    title       = Column(String(500), nullable=False)
    source      = Column(String(100), nullable=False)
    source_type = Column(String(20), nullable=False)          # news | social | sec
    url         = Column(String(1000), nullable=False, unique=True, index=True)
    tickers     = Column(Text, default="[]")                  # JSON list
    score       = Column(Integer, default=5)
    ai_summary  = Column(String(400), nullable=True)
    tags        = Column(Text, default="[]")                  # JSON list
    published_at = Column(DateTime, nullable=True, index=True)
    created_at  = Column(DateTime, default=datetime.utcnow, index=True)


async def get_db():
    async with SessionLocal() as session:
        yield session


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
