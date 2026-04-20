import logging
from functools import lru_cache

import robin_stocks.robinhood as rh

from backend.config import settings

logger = logging.getLogger(__name__)

_logged_in = False


def ensure_login() -> None:
    global _logged_in
    if not _logged_in:
        rh.login(
            username=settings.ROBINHOOD_USERNAME,
            password=settings.ROBINHOOD_PASSWORD,
            mfa_code=settings.ROBINHOOD_MFA_CODE or None,
            store_session=True,
        )
        _logged_in = True
        logger.info("Robinhood login successful.")


def logout() -> None:
    global _logged_in
    rh.logout()
    _logged_in = False


def get_positions() -> list[dict]:
    ensure_login()
    raw = rh.get_open_stock_positions()
    positions = []
    for pos in raw:
        instrument = rh.get_instrument_by_url(pos["instrument"])
        positions.append(
            {
                "symbol": instrument.get("symbol", ""),
                "quantity": float(pos.get("quantity", 0)),
                "avg_cost": float(pos.get("average_buy_price", 0)),
                "source": "robinhood",
            }
        )
    return positions


def get_option_positions() -> list[dict]:
    ensure_login()
    raw = rh.get_open_option_positions()
    positions = []
    for pos in raw:
        chain = rh.get_option_instrument_data_by_id(pos.get("option_id", ""))
        positions.append(
            {
                "symbol": pos.get("chain_symbol", ""),
                "quantity": float(pos.get("quantity", 0)),
                "avg_cost": float(pos.get("average_price", 0)),
                "option_type": chain.get("type", ""),
                "strike": float(chain.get("strike_price", 0)),
                "expiry": chain.get("expiration_date", ""),
                "source": "robinhood",
            }
        )
    return positions


def get_quote(symbol: str) -> dict:
    ensure_login()
    data = rh.get_latest_price(symbol, includeExtendedHours=True)
    return {"symbol": symbol, "price": float(data[0]) if data else None}


def get_portfolio() -> dict:
    ensure_login()
    return rh.load_portfolio_profile() or {}
