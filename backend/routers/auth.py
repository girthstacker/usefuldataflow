import logging

from fastapi import APIRouter

from backend.services.schwab_auth import get_token_status

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/status")
async def auth_status():
    """Return auth status for all connected brokers."""
    schwab = get_token_status()
    return {
        "schwab": schwab,
        "robinhood": {"linked": False, "reason": "not configured"},
    }
