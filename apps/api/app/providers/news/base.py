"""
Abstract base for news providers.

Each news item dict must have the shape:
{
    "headline":        str,
    "source":          str,
    "url":             str | None,
    "entities":        list[str],     # tickers, sectors, macro themes
    "event_type":      str,           # e.g. "earnings", "macro", "geopolitical"
    "sentiment_score": float | None,  # −1 (bearish) … +1 (bullish)
    "volatility_score":float | None,  # 0 … 1 expected impact on vol
    "confidence":      float | None,  # 0 … 1 model confidence
    "raw_payload":     dict,          # original provider response for audit
}
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Optional


class NewsProvider(ABC):
    @abstractmethod
    async def get_news(self, entities: Optional[list[str]] = None) -> list[dict]:
        """
        Fetch recent news events.
        If `entities` is provided, filter to items mentioning those tickers/sectors.
        """
        ...
