from __future__ import annotations

import datetime as dt
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
OBSERVER_FREE_PIPELINE_WINDOW_MINUTES = 15


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


def _issuer_candidates() -> list[str]:
    base = (settings.CLERK_ISSUER or "").strip().rstrip("/")
    if not base:
        return []
    candidates = [base]
    if ".clerk.accounts.dev" in base:
        candidates.append(base.replace(".clerk.accounts.dev", ".accounts.dev"))
    elif ".accounts.dev" in base:
        candidates.append(base.replace(".accounts.dev", ".clerk.accounts.dev"))

    seen: set[str] = set()
    unique: list[str] = []
    for issuer in candidates:
        if issuer and issuer not in seen:
            seen.add(issuer)
            unique.append(issuer)
    return unique


async def verify_clerk_token(token: str) -> dict[str, Any]:
    if not isinstance(token, str):
        raise HTTPException(status_code=401, detail="Invalid token type.")
    token = token.strip()
    if token.lower().startswith("bearer "):
        token = token[7:].strip()
    if token.count(".") != 2:
        raise HTTPException(status_code=401, detail="Invalid token format.")

    jwks = await _get_clerk_jwks()
    issuers = _issuer_candidates()
    if not jwks or not issuers:
        raise HTTPException(status_code=503, detail="Auth not configured on server.")
    try:
        header = jwt.get_unverified_header(token)
    except (JWTError, ValueError, TypeError) as exc:
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

    last_error: JWTError | None = None
    for issuer in issuers:
        try:
            claims = jwt.decode(
                token,
                signing_key,
                algorithms=["RS256"],
                options={"verify_aud": False},
                issuer=issuer,
            )
            return claims
        except JWTError as exc:
            last_error = exc

    # Fallback decode without issuer verification so we can validate accepted
    # issuer variants manually and produce a clearer diagnostic log line.
    try:
        claims = jwt.decode(
            token,
            signing_key,
            algorithms=["RS256"],
            options={"verify_aud": False, "verify_iss": False},
        )
    except JWTError as exc:
        raise HTTPException(status_code=401, detail=f"Invalid token: {exc}") from exc

    iss = str(claims.get("iss") or "").rstrip("/")
    if iss in issuers:
        return claims

    detail = f"Invalid token issuer: {iss or 'missing'}"
    if last_error is not None:
        detail = f"{detail}; decode_error={last_error}"
    raise HTTPException(status_code=401, detail=detail)


async def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    auth_header = request.headers.get("Authorization", "")
    token: str | None = None
    if auth_header.startswith("Bearer "):
        token = auth_header.removeprefix("Bearer ").strip()
    else:
        # Fallback for environments where browser auth is cookie-backed but
        # client token injection is delayed/flaky (common during Clerk warmup).
        # Prefer explicit Clerk JWT cookies first.
        candidate_tokens = [
            request.cookies.get("__clerk_db_jwt"),
            request.cookies.get("__session"),
            request.cookies.get("__clerk_session"),
        ]
        token = next((t for t in candidate_tokens if isinstance(t, str) and t.count(".") == 2), None)
        if token:
            logger.info(
                "Using Clerk session cookie token fallback: method=%s path=%s",
                request.method,
                request.url.path,
            )
        else:
            logger.warning(
                "Missing auth token: method=%s path=%s has_cookie=%s cookie_names=%s",
                request.method,
                request.url.path,
                bool(request.headers.get("cookie")),
                ",".join(sorted(request.cookies.keys())),
            )
            raise HTTPException(status_code=401, detail="Missing Authorization header.")

    try:
        claims = await verify_clerk_token(token)
    except HTTPException as exc:
        logger.warning(
            "Token verification failed: path=%s detail=%s",
            request.url.path,
            exc.detail,
        )
        raise
    except Exception as exc:  # pragma: no cover - defensive guard against 500s
        logger.exception(
            "Unexpected token verification error: path=%s err=%s",
            request.url.path,
            exc,
        )
        raise HTTPException(status_code=401, detail="Invalid token.")
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


def observer_free_ai_pipeline_remaining(user: User) -> int:
    if user.tier != "observer":
        return 0
    return 0 if user.observer_free_ai_pipeline_used else 1


def observer_free_ai_pipeline_window_active(user: User) -> bool:
    if user.tier != "observer":
        return False
    ends_at = user.observer_free_ai_pipeline_window_ends_at
    if not ends_at:
        return False
    now = dt.datetime.now(dt.timezone.utc)
    return ends_at > now


def _grant_observer_pipeline_window(user: User, db: Session) -> None:
    now = dt.datetime.now(dt.timezone.utc)
    user.observer_free_ai_pipeline_used = True
    user.observer_free_ai_pipeline_window_ends_at = now + dt.timedelta(
        minutes=OBSERVER_FREE_PIPELINE_WINDOW_MINUTES
    )
    db.commit()
    db.refresh(user)
    logger.info(
        "Observer free AI pipeline consumed: clerk_id=%s window_ends_at=%s",
        user.clerk_id,
        user.observer_free_ai_pipeline_window_ends_at.isoformat()
        if user.observer_free_ai_pipeline_window_ends_at
        else None,
    )


def require_ai_pipeline_access(
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> User:
    """
    Allows:
    - analyst/command users (full access), and
    - observer users for exactly one pipeline run, with a short grace window
      to complete dashboard/news/assistant pipeline requests + retries.
    """
    if user.tier in {"analyst", "command"}:
        return user

    if user.tier != "observer":
        raise HTTPException(status_code=403, detail="Invalid tier for AI pipeline access.")

    window_active = observer_free_ai_pipeline_window_active(user)
    if window_active:
        return user

    header = request.headers.get("x-lnz-ai-pipeline", "").strip().lower()
    is_pipeline_request = header in {"1", "true", "yes"}
    if is_pipeline_request and not user.observer_free_ai_pipeline_used:
        _grant_observer_pipeline_window(user, db)
        return user

    raise HTTPException(
        status_code=403,
        detail=(
            "Observer tier includes one free AI pipeline run via Start AI Pipeline. "
            "Upgrade to Analyst for unlimited AI."
        ),
    )


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
