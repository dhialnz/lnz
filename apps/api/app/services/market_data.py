"""
Market data service — selects and delegates to the configured provider.
"""

from __future__ import annotations

from app.config import settings
from app.providers.market.base import MarketDataProvider
from app.providers.market.mock import MockMarketDataProvider
from app.providers.market.http import HttpMarketDataProvider


def get_provider() -> MarketDataProvider:
    key = settings.MARKET_DATA_PROVIDER.lower()
    if key == "http":
        return HttpMarketDataProvider(
            base_url=settings.MARKET_DATA_BASE_URL,
            api_key=settings.MARKET_DATA_API_KEY,
        )
    # Default: mock
    return MockMarketDataProvider()


async def fetch_snapshot() -> dict:
    provider = get_provider()
    return await provider.get_snapshot()
