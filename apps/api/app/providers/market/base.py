"""
Abstract base for market data providers.
Implement this interface to add a new market data source.

Expected snapshot payload shape:
{
    "spy":    float,   # SPY price
    "vix":    float,   # CBOE VIX
    "t2y":    float,   # 2-year Treasury yield (%)
    "t10y":   float,   # 10-year Treasury yield (%)
    "dxy":    float,   # US Dollar Index
    "btc":    float,   # BTC/USD spot (optional)
    "sectors": {       # Sector ETF prices
        "XLK": float,
        "XLF": float,
        "XLE": float,
        "XLV": float,
        "XLI": float,
        "XLY": float,
        "XLP": float,
        "XLU": float,
        "XLRE": float,
        "XLB": float,
        "XLC": float,
    },
    "fetched_at": str  # ISO-8601 timestamp
}
"""

from __future__ import annotations

from abc import ABC, abstractmethod


class MarketDataProvider(ABC):
    @abstractmethod
    async def get_snapshot(self) -> dict:
        """
        Fetch the latest macro snapshot.
        Must return a dict matching the shape documented above.
        Raise an exception on irrecoverable errors.
        """
        ...
