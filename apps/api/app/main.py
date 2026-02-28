from __future__ import annotations

import logging
import time
from collections import defaultdict
from threading import Lock

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.routers import (
    ai,
    auth,
    fx,
    health,
    holdings,
    market,
    news,
    portfolio,
    portfolios,
    recommendations,
    reports,
    rulebook,
)

# ── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("lnz.api")

app = FastAPI(
    title="Alphenzi Portfolio Intelligence API",
    description=(
        "Deterministic portfolio analytics and decision-support API. "
        "Provides metrics, regime classification, and rule-based recommendations. "
        "**Not financial advice. For informational purposes only.**"
    ),
    version="0.2.0",
    docs_url=None if settings.HIDE_DOCS else "/docs",
    redoc_url=None if settings.HIDE_DOCS else "/redoc",
)

# ── In-memory AI rate limiter ─────────────────────────────────────────────────

_AI_RATE_PATHS = {
    "/api/v1/ai/chat",
    "/api/v1/ai/portfolio-insights",
    "/api/v1/ai/dashboard-recommendations",
    "/api/v1/ai/news-summary",
}
_ai_call_log: dict[str, list[float]] = defaultdict(list)
_ai_lock = Lock()


def _get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
    if forwarded:
        return forwarded
    real_ip = request.headers.get("X-Real-IP", "").strip()
    if real_ip:
        return real_ip
    return request.client.host if request.client else "unknown"

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def authenticate(request: Request, call_next) -> Response:  # type: ignore[type-arg]
    """Optional single-user API key gate. Only active when LNZ_API_KEY is set."""
    key = settings.LNZ_API_KEY
    if key and not request.url.path.endswith("/health"):
        auth_header = request.headers.get("Authorization", "").strip()
        has_clerk_bearer = bool(
            settings.CLERK_ISSUER
            and auth_header.startswith("Bearer ")
            and request.headers.get("X-API-Key", "").strip() == ""
        )
        # Multi-user auth uses Clerk Bearer JWTs; let route dependencies verify them.
        if not has_clerk_bearer:
            provided = (
                request.headers.get("X-API-Key", "").strip()
                or auth_header.removeprefix("Bearer ").strip()
            )
            if provided != key:
                return JSONResponse(
                    status_code=401,
                    content={"detail": "Unauthorized. Provide a valid X-API-Key header."},
                )
    return await call_next(request)


@app.middleware("http")
async def rate_limit_ai(request: Request, call_next) -> Response:  # type: ignore[type-arg]
    """Lightweight per-IP rate limit on AI generation endpoints."""
    limit = settings.AI_RATE_LIMIT_PER_MINUTE
    if limit > 0 and request.url.path in _AI_RATE_PATHS and request.method == "POST":
        ip = _get_client_ip(request)
        now = time.monotonic()
        with _ai_lock:
            calls = [t for t in _ai_call_log[ip] if now - t < 60.0]
            if len(calls) >= limit:
                return JSONResponse(
                    status_code=429,
                    content={"detail": f"Rate limit: max {limit} AI requests per minute."},
                    headers={"Retry-After": "60"},
                )
            calls.append(now)
            _ai_call_log[ip] = calls
    return await call_next(request)


@app.middleware("http")
async def log_requests(request: Request, call_next) -> Response:  # type: ignore[type-arg]
    start = time.monotonic()
    response: Response = await call_next(request)
    elapsed_ms = (time.monotonic() - start) * 1000
    # Avoid logging noisy health-check probes at INFO level.
    level = logging.DEBUG if request.url.path.endswith("/health") else logging.INFO
    logger.log(
        level,
        "%s %s → %d (%.0f ms)",
        request.method,
        request.url.path,
        response.status_code,
        elapsed_ms,
    )
    return response


API_PREFIX = "/api/v1"

app.include_router(health.router, prefix=API_PREFIX)
app.include_router(auth.router, prefix=API_PREFIX)
app.include_router(portfolio.router, prefix=API_PREFIX)
app.include_router(recommendations.router, prefix=API_PREFIX)
app.include_router(market.router, prefix=API_PREFIX)
app.include_router(news.router, prefix=API_PREFIX)
app.include_router(rulebook.router, prefix=API_PREFIX)
app.include_router(holdings.router, prefix=API_PREFIX)
app.include_router(fx.router, prefix=API_PREFIX)
app.include_router(ai.router, prefix=API_PREFIX)
app.include_router(portfolios.router, prefix=API_PREFIX)
app.include_router(reports.router, prefix=API_PREFIX)


@app.get("/", include_in_schema=False)
def root() -> dict:
    return {"message": "Alphenzi API — see /docs", "disclaimer": "Not financial advice."}
