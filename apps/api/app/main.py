from __future__ import annotations

import logging
import time

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import ai, fx, health, holdings, market, news, portfolio, recommendations, rulebook

# ── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("lnz.api")

app = FastAPI(
    title="LNZ Portfolio Analytics API",
    description=(
        "Deterministic portfolio analytics and decision-support API. "
        "Provides metrics, regime classification, and rule-based recommendations. "
        "**Not financial advice. For informational purposes only.**"
    ),
    version="0.2.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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
app.include_router(portfolio.router, prefix=API_PREFIX)
app.include_router(recommendations.router, prefix=API_PREFIX)
app.include_router(market.router, prefix=API_PREFIX)
app.include_router(news.router, prefix=API_PREFIX)
app.include_router(rulebook.router, prefix=API_PREFIX)
app.include_router(holdings.router, prefix=API_PREFIX)
app.include_router(fx.router, prefix=API_PREFIX)
app.include_router(ai.router, prefix=API_PREFIX)


@app.get("/", include_in_schema=False)
def root() -> dict:
    return {"message": "LNZ API — see /docs", "disclaimer": "Not financial advice."}
