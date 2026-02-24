"""
Yahoo Finance quote + history fetcher for individual tickers.
Uses the v8 chart endpoint (same as existing SPY fetches) — no auth required.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import math
from typing import Any

import httpx

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; LNZ/1.0; +http://localhost)",
    "Accept": "application/json",
}
_TIMEOUT = 10.0
_CAD_USD_TICKER = "CAD=X"


async def _fetch_ticker_data_once(
    ticker: str, client: httpx.AsyncClient
) -> dict[str, Any] | None:
    """
    Fetch 30 days of daily closes + current quote for a single ticker candidate.
    Returns None on any fetch/parse failure.
    """
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?interval=1d&range=1mo"
    try:
        resp = await client.get(url)
        resp.raise_for_status()
        payload = resp.json()
    except Exception:
        return None

    try:
        result = payload["chart"]["result"][0]
        meta = result["meta"]
        timestamps = result.get("timestamp", [])
        closes = result["indicators"]["quote"][0].get("close", [])
    except (KeyError, IndexError, TypeError):
        return None

    current_price = meta.get("regularMarketPrice")
    prev_close = meta.get("previousClose") or meta.get("chartPreviousClose")
    name = meta.get("longName") or meta.get("shortName") or ticker
    quote_currency = (meta.get("currency") or "USD").upper()

    if current_price is None:
        return None

    day_change: float | None = None
    day_change_pct: float | None = None
    if prev_close and prev_close != 0:
        day_change = current_price - prev_close
        day_change_pct = day_change / prev_close

    history: list[dict] = []
    for ts, close in zip(timestamps, closes):
        if close is None or (isinstance(close, float) and not math.isfinite(close)):
            continue
        d = dt.datetime.fromtimestamp(ts, tz=dt.timezone.utc).date()
        history.append({"date": str(d), "close": float(close)})

    return {
        "current_price": float(current_price),
        "prev_close": float(prev_close) if prev_close is not None else None,
        "day_change": day_change,
        "day_change_pct": day_change_pct,
        "quote_currency": quote_currency,
        "name": name,
        "history": history,
        "resolved_ticker": ticker,
    }


def _ticker_candidates(ticker: str) -> list[str]:
    """
    Try the original ticker first, then common exchange suffixes for symbols like VFV -> VFV.TO.
    """
    t = ticker.strip().upper()
    candidates = [t]
    if "." not in t and t.isalpha() and 1 <= len(t) <= 6:
        candidates.extend([f"{t}.TO", f"{t}.V", f"{t}.NE"])
    return candidates


async def fetch_ticker_data(ticker: str) -> dict[str, Any] | None:
    """
    Fetch 30 days of daily closes + current quote for a single ticker.

    Returns a dict with keys:
        current_price, prev_close, day_change, day_change_pct,
        name, history: [{date: str, close: float}]
    Returns None on any error (invalid ticker, network failure, etc.).
    """
    async with httpx.AsyncClient(headers=_HEADERS, timeout=_TIMEOUT) as client:
        for candidate in _ticker_candidates(ticker):
            data = await _fetch_ticker_data_once(candidate, client)
            if data is not None:
                return data
    return None


async def fetch_all_tickers(tickers: list[str]) -> dict[str, dict | None]:
    """
    Fetch quote data for multiple tickers in parallel.
    Returns dict keyed by ticker; value is None on failure.
    """
    results = await asyncio.gather(*[fetch_ticker_data(t) for t in tickers])
    return dict(zip(tickers, results))


async def fetch_usd_per_cad() -> float | None:
    """
    Return USD per 1 CAD from Yahoo's CAD=X ticker.
    """
    data = await fetch_ticker_data(_CAD_USD_TICKER)
    if not data:
        return None
    px = data.get("current_price")
    try:
        value = float(px)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(value) or value <= 0:
        return None
    # Yahoo CAD=X typically returns CAD per USD (~1.3+). Convert to USD per CAD.
    if value > 1:
        return 1.0 / value
    return value
