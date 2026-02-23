"""
Generic HTTP news adapter.
Configure via NEWS_BASE_URL and NEWS_API_KEY environment variables.
Override _parse_item() to map your provider's response format.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

import httpx

from app.providers.news.base import NewsProvider

logger = logging.getLogger(__name__)
TIMEOUT = 10.0


class HttpNewsProvider(NewsProvider):
    def __init__(self, base_url: str, api_key: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key

    async def get_news(self, entities: Optional[list[str]] = None) -> list[dict]:
        if not self.base_url:
            raise RuntimeError(
                "NEWS_BASE_URL is not configured. "
                "Set it in .env or switch to NEWS_PROVIDER=mock."
            )

        params: dict = {}
        if entities:
            params["q"] = ",".join(entities)

        headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}
        url = f"{self.base_url}/news"

        try:
            async with httpx.AsyncClient(timeout=TIMEOUT) as client:
                resp = client.get(url, params=params, headers=headers)
                resp.raise_for_status()
                raw = resp.json()
        except httpx.HTTPStatusError as exc:
            logger.error("News HTTP error: %s", exc)
            raise RuntimeError(f"News provider returned {exc.response.status_code}") from exc
        except Exception as exc:
            logger.error("News fetch failed: %s", exc)
            raise RuntimeError(f"News fetch failed: {exc}") from exc

        items = raw if isinstance(raw, list) else raw.get("articles", raw.get("items", []))
        return [self._parse_item(i) for i in items]

    def _parse_item(self, raw: dict) -> dict:
        """
        Map provider-specific article dict to the standard news item shape.
        Override this method for your provider's actual response structure.
        """
        return {
            "headline": raw.get("title") or raw.get("headline", ""),
            "source": raw.get("source", {}).get("name", "") if isinstance(raw.get("source"), dict) else raw.get("source", ""),
            "url": raw.get("url"),
            "entities": raw.get("entities", []) or raw.get("tickers", []),
            "event_type": raw.get("event_type") or raw.get("category", "general"),
            "sentiment_score": raw.get("sentiment") or raw.get("sentiment_score"),
            "volatility_score": raw.get("volatility_score"),
            "confidence": raw.get("confidence"),
            "raw_payload": raw,
        }
