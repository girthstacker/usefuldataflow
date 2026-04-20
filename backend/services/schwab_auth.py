"""
Schwab OAuth PKCE helper.

Run once to obtain a token file that the server uses:
    python -m backend.services.schwab_auth

Or call get_token_status() from the auth router to check token health.
"""
import json
import logging
import os
import sys
from datetime import datetime

logger = logging.getLogger(__name__)


def get_token_status() -> dict:
    """
    Read the token file and return its status without importing schwab-py.
    This avoids a hard dependency at import time when credentials are missing.
    """
    from backend.config import settings

    path = settings.SCHWAB_TOKEN_PATH
    if not os.path.exists(path):
        return {"linked": False, "reason": "token file not found"}

    try:
        with open(path) as f:
            data = json.load(f)
    except Exception as exc:
        return {"linked": False, "reason": f"could not read token file: {exc}"}

    token = data.get("token", data)
    expires_at = token.get("expires_at")
    refresh_token = token.get("refresh_token")

    now = datetime.utcnow().timestamp()
    if expires_at and expires_at < now:
        if refresh_token:
            return {
                "linked": True,
                "access_valid": False,
                "refresh_valid": True,
                "expires_at": datetime.utcfromtimestamp(expires_at).isoformat(),
                "reason": "access token expired — will refresh on next request",
            }
        return {
            "linked": True,
            "access_valid": False,
            "refresh_valid": False,
            "reason": "both tokens expired — re-run OAuth flow",
        }

    return {
        "linked": True,
        "access_valid": True,
        "refresh_valid": bool(refresh_token),
        "expires_at": datetime.utcfromtimestamp(expires_at).isoformat() if expires_at else None,
    }


def run_oauth_flow() -> None:
    """
    Interactive one-time OAuth flow.  Saves tokens to SCHWAB_TOKEN_PATH.
    Requires SCHWAB_CLIENT_ID and SCHWAB_CLIENT_SECRET in .env / environment.
    """
    from backend.config import settings
    from schwab import auth

    if not settings.SCHWAB_CLIENT_ID or not settings.SCHWAB_CLIENT_SECRET:
        print(
            "\n[ERROR] SCHWAB_CLIENT_ID and SCHWAB_CLIENT_SECRET must be set in .env "
            "before running the OAuth flow.\n"
        )
        sys.exit(1)

    print("\n── Schwab OAuth PKCE Flow ──────────────────────────────────────────")
    print(f"  Client ID   : {settings.SCHWAB_CLIENT_ID[:8]}…")
    print(f"  Redirect URI: {settings.SCHWAB_REDIRECT_URI}")
    print(f"  Token path  : {settings.SCHWAB_TOKEN_PATH}")
    print("────────────────────────────────────────────────────────────────────")
    print("\nA browser window will open.  Log in, authorise the app, then paste")
    print("the full redirect URL below when prompted.\n")

    try:
        _client = auth.client_from_manual_flow(
            api_key=settings.SCHWAB_CLIENT_ID,
            app_secret=settings.SCHWAB_CLIENT_SECRET,
            callback_url=settings.SCHWAB_REDIRECT_URI,
            token_path=settings.SCHWAB_TOKEN_PATH,
        )
        print(f"\n[OK] Token saved to {settings.SCHWAB_TOKEN_PATH}")
        print("     Restart the backend server — it will load automatically.\n")
    except Exception as exc:
        print(f"\n[ERROR] OAuth flow failed: {exc}\n")
        sys.exit(1)


if __name__ == "__main__":
    logging.basicConfig(level=logging.WARNING)
    run_oauth_flow()
