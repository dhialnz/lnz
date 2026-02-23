"""Mock news provider — deterministic sample events for dev/test."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from app.providers.news.base import NewsProvider

_MOCK_EVENTS = [
    {
        "headline": "Fed holds rates steady; signals one cut in 2025",
        "source": "MockFeed",
        "url": None,
        "entities": ["SPY", "TLT", "macro"],
        "event_type": "macro",
        "sentiment_score": 0.1,
        "volatility_score": 0.4,
        "confidence": 0.9,
        "raw_payload": {},
    },
    {
        "headline": "VIX spikes above 20 on geopolitical tensions",
        "source": "MockFeed",
        "url": None,
        "entities": ["VIX", "SPY", "geopolitical"],
        "event_type": "geopolitical",
        "sentiment_score": -0.6,
        "volatility_score": 0.8,
        "confidence": 0.85,
        "raw_payload": {},
    },
    {
        "headline": "Q1 earnings season shows broad S&P 500 beat",
        "source": "MockFeed",
        "url": None,
        "entities": ["SPY", "XLK", "earnings"],
        "event_type": "earnings",
        "sentiment_score": 0.5,
        "volatility_score": 0.3,
        "confidence": 0.80,
        "raw_payload": {},
    },
    {
        "headline": "10-year Treasury yield climbs to 4.5%, pressuring growth stocks",
        "source": "MockFeed",
        "url": None,
        "entities": ["TLT", "XLK", "macro", "rates"],
        "event_type": "macro",
        "sentiment_score": -0.3,
        "volatility_score": 0.5,
        "confidence": 0.75,
        "raw_payload": {},
    },
    {
        "headline": "Energy sector outperforms on supply cut announcements",
        "source": "MockFeed",
        "url": None,
        "entities": ["XLE", "BTC", "commodities"],
        "event_type": "sector",
        "sentiment_score": 0.4,
        "volatility_score": 0.35,
        "confidence": 0.70,
        "raw_payload": {},
    },
]


class MockNewsProvider(NewsProvider):
    async def get_news(self, entities: Optional[list[str]] = None) -> list[dict]:
        now = datetime.now(tz=timezone.utc).isoformat()
        results = []
        for ev in _MOCK_EVENTS:
            if entities:
                if not any(e in ev["entities"] for e in entities):
                    continue
            item = dict(ev)
            item["captured_at"] = now
            item["raw_payload"] = {"_provider": "mock", "captured_at": now}
            results.append(item)
        return results
