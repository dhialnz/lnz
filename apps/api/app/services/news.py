"""
News service — selects and delegates to the configured provider.
"""

from __future__ import annotations

from app.config import settings
from app.providers.news.base import NewsProvider
from app.providers.news.mock import MockNewsProvider
from app.providers.news.http import HttpNewsProvider


def get_provider() -> NewsProvider:
    key = settings.NEWS_PROVIDER.lower()
    if key == "http":
        return HttpNewsProvider(
            base_url=settings.NEWS_BASE_URL,
            api_key=settings.NEWS_API_KEY,
        )
    return MockNewsProvider()


async def fetch_news(entities: list[str] | None = None) -> list[dict]:
    provider = get_provider()
    return await provider.get_news(entities=entities)
