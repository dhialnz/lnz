from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import health, portfolio, recommendations, market, news, rulebook

app = FastAPI(
    title="LNZ Portfolio Analytics API",
    description=(
        "Deterministic portfolio analytics and decision-support API. "
        "Provides metrics, regime classification, and rule-based recommendations. "
        "**Not financial advice.**"
    ),
    version="0.1.0",
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

API_PREFIX = "/api/v1"

app.include_router(health.router, prefix=API_PREFIX)
app.include_router(portfolio.router, prefix=API_PREFIX)
app.include_router(recommendations.router, prefix=API_PREFIX)
app.include_router(market.router, prefix=API_PREFIX)
app.include_router(news.router, prefix=API_PREFIX)
app.include_router(rulebook.router, prefix=API_PREFIX)


@app.get("/", include_in_schema=False)
def root():
    return {"message": "LNZ API — see /docs"}
