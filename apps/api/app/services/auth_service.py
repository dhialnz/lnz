from __future__ import annotations

import logging
import time
import uuid
from typing import Any

import httpx
from fastapi import Depends, HTTPException, Request
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models.user import User
from app.services.portfolio_scope import ensure_active_portfolio

logger = logging.getLogger("lnz.auth")

# System placeholder UUID — all legacy data is assigned to this before the
# first real admin signs up and claims it via the Clerk webhook.
SYSTEM_UUID = uuid.UUID("00000000-0000-0000-0000-000000000001")

_jwks_cache: dict[str, Any] = {}
_jwks_fetched_at: float = 0.0
_JWKS_TTL = 3600.0  # 1 hour


async def _get_clerk_jwks() -> dict[str, Any]:
    global _jwks_cache, _jwks_fetched_at
    now = time.monotonic()
    if _jwks_cache and (now - _jwks_fetched_at) < _JWKS_TTL:
        return _jwks_cache
    if not settings.CLERK_JWKS_URL:
        return {}
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(settings.CLERK_JWKS_URL)
        resp.raise_for_status()
        data = resp.json()
    _jwks_cache = data
    _jwks_fetched_at = now
    return data


def _select_signing_key(jwks: dict[str, Any], kid: str | None) -> dict[str, Any] | None:
    keys = jwks.get("keys")
    if not isinstance(keys, list):
        return None
    if kid:
        for key in keys:
            if isinstance(key, dict) and key.get("kid") == kid:
                return key
    for key in keys:
        if isinstance(key, dict):
            return key
    return None


async def verify_clerk_token(token: str) -> dict[str, Any]:
    jwks = await _get_clerk_jwks()
    if not jwks or not settings.CLERK_ISSUER:
        raise HTTPException(status_code=503, detail="Auth not configured on server.")
    try:
        header = jwt.get_unverified_header(token)
    except JWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid token header.") from exc

    kid = header.get("kid")
    signing_key = _select_signing_key(jwks, kid)

    # One refresh retry when Clerk rotates keys and cache is stale.
    if signing_key is None:
        global _jwks_fetched_at
        _jwks_fetched_at = 0.0
        jwks = await _get_clerk_jwks()
        signing_key = _select_signing_key(jwks, kid)
    if signing_key is None:
        raise HTTPException(status_code=401, detail="Signing key not found for token.")

    try:
        claims = jwt.decode(
            token,
            signing_key,
            algorithms=["RS256"],
            options={"verify_aud": False},
            issuer=settings.CLERK_ISSUER,
        )
    except JWTError as exc:
        raise HTTPException(status_code=401, detail=f"Invalid token: {exc}") from exc
    return claims


async def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Authorization header.")
    token = auth_header.removeprefix("Bearer ").strip()
    claims = await verify_clerk_token(token)
    clerk_id: str = claims.get("sub", "")
    if not clerk_id:
        raise HTTPException(status_code=401, detail="Token missing sub claim.")
    user = db.query(User).filter(User.clerk_id == clerk_id).first()
    if user is None:
        raise HTTPException(
            status_code=401,
            detail="User not registered. Sign up and wait for account creation.",
        )
    ensure_active_portfolio(db, user)
    return user


def require_analyst(user: User = Depends(get_current_user)) -> User:
    """Dependency: requires analyst or command tier. Observers get 403."""
    if user.tier == "observer":
        raise HTTPException(
            status_code=403,
            detail="AI access requires the Analyst tier or above. Upgrade your plan.",
        )
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    """Dependency: requires is_admin=True."""
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required.")
    return user


def require_command(user: User = Depends(get_current_user)) -> User:
    """Dependency: requires command tier."""
    if user.tier != "command":
        raise HTTPException(
            status_code=403,
            detail="This feature requires the Command tier.",
        )
    return user
