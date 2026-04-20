import asyncio
import json
import logging
from typing import AsyncIterator, Callable

import schwab
from schwab import auth, client as schwab_client

from backend.config import settings

logger = logging.getLogger(__name__)

_client: schwab_client.AsyncClient | None = None


def get_client() -> schwab_client.AsyncClient:
    if _client is None:
        raise RuntimeError("Schwab client not initialized. Call init_client() first.")
    return _client


async def init_client() -> schwab_client.AsyncClient:
    global _client
    try:
        _client = auth.client_from_token_file(
            settings.SCHWAB_TOKEN_PATH,
            settings.SCHWAB_CLIENT_ID,
            settings.SCHWAB_CLIENT_SECRET,
        )
        logger.info("Schwab client initialized from token file.")
    except FileNotFoundError:
        logger.warning(
            "No Schwab token file found. Run the OAuth flow to authenticate:\n"
            "  python -m backend.services.schwab_auth"
        )
    return _client


async def get_quote(symbol: str) -> dict:
    c = get_client()
    resp = await c.get_quote(symbol)
    resp.raise_for_status()
    return resp.json()


async def get_quotes(symbols: list[str]) -> dict:
    c = get_client()
    resp = await c.get_quotes(symbols)
    resp.raise_for_status()
    return resp.json()


async def get_option_chain(
    symbol: str,
    strike_count: int = 10,
    include_underlying_quote: bool = True,
) -> dict:
    c = get_client()
    resp = await c.get_option_chain(
        symbol,
        strike_count=strike_count,
        include_underlying_quote=include_underlying_quote,
        option_type=schwab_client.Client.Options.OptionType.ALL,
    )
    resp.raise_for_status()
    return resp.json()


async def get_account_positions() -> list[dict]:
    c = get_client()
    resp = await c.get_accounts(fields=[schwab_client.Client.Account.Fields.POSITIONS])
    resp.raise_for_status()
    accounts = resp.json()
    positions = []
    for account in accounts:
        positions.extend(
            account.get("securitiesAccount", {}).get("positions", [])
        )
    return positions


class SchwabStreamer:
    """Thin wrapper around schwab-py's streaming client."""

    def __init__(self, on_quote: Callable[[dict], None] | None = None):
        self._on_quote = on_quote
        self._stream_client = None

    async def start(self, symbols: list[str]) -> None:
        c = get_client()
        self._stream_client = await c.create_streaming_session()

        await self._stream_client.login()

        async def handler(msg: dict) -> None:
            if self._on_quote:
                self._on_quote(msg)

        await self._stream_client.add_level_one_equity_handler(handler)
        await self._stream_client.level_one_equity_subs(symbols)
        await self._stream_client.handle_message()

    async def stop(self) -> None:
        if self._stream_client:
            await self._stream_client.logout()
