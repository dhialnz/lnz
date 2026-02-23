"""
Generic HTTP market data adapter.
Configured entirely via environment variables — no vendor-specific assumptions baked in.

To adapt for a real provider:
  1. Set MARKET_DATA_BASE_URL and MARKET_DATA_API_KEY in .env
  2. Override _parse_response() to map your provider's JSON shape to the standard snapshot dict.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

import httpx

from app.providers.market.base import MarketDataProvider

logger = logging.getLogger(__name__)

TIMEOUT = 10.0  # seconds


class HttpMarketDataProvider(MarketDataProvider):
    def __init__(self, base_url: str, api_key: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key

    async def get_snapshot(self) -> dict:
        if not self.base_url:
            raise RuntimeError(
                "MARKET_DATA_BASE_URL is not configured. "
                "Set it in .env or switch to MARKET_DATA_PROVIDER=mock."
            )

        url = f"{self.base_url}/snapshot"
        headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}

        try:
            async with httpx.AsyncClient(timeout=TIMEOUT) as client:
                resp = client.get(url, headers=headers)
                resp.raise_for_status()
                raw = resp.json()
        except httpx.HTTPStatusError as exc:
            logger.error("Market data HTTP error: %s", exc)
            raise RuntimeError(f"Market data provider returned {exc.response.status_code}") from exc
        except Exception as exc:
            logger.error("Market data fetch failed: %s", exc)
            raise RuntimeError(f"Market data fetch failed: {exc}") from exc

        return self._parse_response(raw)

    def _parse_response(self, raw: dict) -> dict:
        """
        Map provider-specific JSON to the standard snapshot shape.
        Override this method for your provider's actual response structure.
        """
        return {
            "spy": raw.get("spy") or raw.get("SPY"),
            "vix": raw.get("vix") or raw.get("VIX"),
            "t2y": raw.get("t2y") or raw.get("US2Y"),
            "t10y": raw.get("t10y") or raw.get("US10Y"),
            "dxy": raw.get("dxy") or raw.get("DXY"),
            "btc": raw.get("btc") or raw.get("BTC"),
            "sectors": raw.get("sectors", {}),
            "fetched_at": datetime.now(tz=timezone.utc).isoformat(),
            "_provider": "http",
        }
