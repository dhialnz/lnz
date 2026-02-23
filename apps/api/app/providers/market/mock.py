"""
Mock market data provider — deterministic fake data for dev/test.
"""

from __future__ import annotations

from datetime import datetime, timezone

from app.providers.market.base import MarketDataProvider


class MockMarketDataProvider(MarketDataProvider):
    async def get_snapshot(self) -> dict:
        return {
            "spy": 523.45,
            "vix": 14.72,
            "t2y": 4.82,
            "t10y": 4.31,
            "dxy": 104.3,
            "btc": 67_420.0,
            "sectors": {
                "XLK": 220.10,
                "XLF": 41.85,
                "XLE": 88.60,
                "XLV": 141.20,
                "XLI": 123.75,
                "XLY": 190.40,
                "XLP": 78.90,
                "XLU": 67.55,
                "XLRE": 40.20,
                "XLB": 90.10,
                "XLC": 86.30,
            },
            "fetched_at": datetime.now(tz=timezone.utc).isoformat(),
            "_provider": "mock",
        }
