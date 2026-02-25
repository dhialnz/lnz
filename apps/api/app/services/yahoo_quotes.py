"""
Yahoo Finance quote + history fetcher for individual tickers.
Uses the v8 chart endpoint (same as existing SPY fetches) — no auth required.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import logging
import math
from typing import Any

import httpx

logger = logging.getLogger("lnz.yahoo_quotes")

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "application/json",
}
_TIMEOUT = 12.0
_CAD_USD_TICKER = "CAD=X"


async def _fetch_ticker_data_once(
    ticker: str, client: httpx.AsyncClient, history_range: str = "1mo"
) -> dict[str, Any] | None:
    """
    Fetch 30 days of daily closes + current quote for a single ticker candidate.
    Returns None on any fetch/parse failure.
    """
    url = (
        f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
        f"?interval=1d&range={history_range}"
    )
    try:
        resp = await client.get(url)
        resp.raise_for_status()
        payload = resp.json()
    except httpx.TimeoutException:
        logger.warning("Yahoo chart timeout: ticker=%s", ticker)
        return None
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            logger.debug("Yahoo chart 404: ticker=%s", ticker)
        else:
            logger.warning("Yahoo chart HTTP error: ticker=%s status=%d", ticker, exc.response.status_code)
        return None
    except Exception as exc:
        logger.error("Yahoo chart unexpected error: ticker=%s error=%s", ticker, exc)
        return None

    try:
        result = payload["chart"]["result"][0]
        meta = result["meta"]
        timestamps = result.get("timestamp", [])
        closes = result["indicators"]["quote"][0].get("close", [])
    except (KeyError, IndexError, TypeError):
        return None

    current_price = meta.get("regularMarketPrice")
    name = meta.get("longName") or meta.get("shortName") or ticker
    quote_currency = (meta.get("currency") or "USD").upper()

    if current_price is None:
        return None

    history: list[dict] = []
    for ts, close in zip(timestamps, closes):
        if close is None or (isinstance(close, float) and not math.isfinite(close)):
            continue
        d = dt.datetime.fromtimestamp(ts, tz=dt.timezone.utc).date()
        history.append({"date": str(d), "close": float(close)})

    # Yahoo chartPreviousClose can be stale/incorrect for some symbols.
    # Prefer deriving the previous close from the actual daily history.
    inferred_prev_close: float | None = None
    if len(history) >= 2:
        inferred_prev_close = float(history[-2]["close"])

    meta_prev_close = (
        meta.get("regularMarketPreviousClose")
        or meta.get("previousClose")
        or meta.get("chartPreviousClose")
    )
    prev_close = inferred_prev_close if inferred_prev_close is not None else meta_prev_close

    day_change: float | None = None
    day_change_pct: float | None = None
    if prev_close and prev_close != 0:
        day_change = float(current_price) - float(prev_close)
        day_change_pct = day_change / float(prev_close)

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


def _extract_raw_value(value: Any) -> float | None:
    """
    Parse Yahoo quoteSummary leaf nodes:
      - numeric (int/float)
      - dict like {"raw": 12.3, "fmt": "..."}
    """
    if isinstance(value, (int, float)):
        f = float(value)
        return f if math.isfinite(f) else None
    if isinstance(value, dict):
        raw = value.get("raw")
        if isinstance(raw, (int, float)):
            f = float(raw)
            return f if math.isfinite(f) else None
    return None


def _compute_technical_snapshot(history: list[dict[str, Any]], current_price: float) -> dict[str, float | None]:
    closes = [float(p["close"]) for p in history if isinstance(p.get("close"), (int, float))]
    if not closes:
        return {
            "ma20": None,
            "ma20_gap_pct": None,
            "momentum_20d_pct": None,
            "rsi14": None,
        }

    def _avg(values: list[float]) -> float | None:
        if not values:
            return None
        return sum(values) / len(values)

    ma20 = _avg(closes[-20:])
    ma20_gap_pct = ((current_price / ma20) - 1.0) if ma20 and ma20 != 0 else None
    momentum_20d_pct = ((current_price / closes[-21]) - 1.0) if len(closes) >= 21 and closes[-21] != 0 else None

    rsi14: float | None = None
    if len(closes) >= 15:
        gains = 0.0
        losses = 0.0
        for idx in range(len(closes) - 14, len(closes)):
            diff = closes[idx] - closes[idx - 1]
            if diff > 0:
                gains += diff
            elif diff < 0:
                losses += abs(diff)
        avg_gain = gains / 14.0
        avg_loss = losses / 14.0
        if avg_loss == 0:
            rsi14 = 100.0
        else:
            rs = avg_gain / avg_loss
            rsi14 = 100.0 - (100.0 / (1.0 + rs))

    return {
        "ma20": ma20,
        "ma20_gap_pct": ma20_gap_pct,
        "momentum_20d_pct": momentum_20d_pct,
        "rsi14": rsi14,
    }


async def _fetch_quote_summary_once(
    ticker: str, client: httpx.AsyncClient
) -> dict[str, float | None] | None:
    modules = "summaryDetail,defaultKeyStatistics,financialData"
    url = f"https://query1.finance.yahoo.com/v10/finance/quoteSummary/{ticker}?modules={modules}"
    try:
        resp = await client.get(url)
        resp.raise_for_status()
        payload = resp.json()
    except httpx.TimeoutException:
        logger.warning("Yahoo quoteSummary timeout: ticker=%s", ticker)
        return None
    except httpx.HTTPStatusError as exc:
        logger.debug("Yahoo quoteSummary HTTP error: ticker=%s status=%d", ticker, exc.response.status_code)
        return None
    except Exception as exc:
        logger.error("Yahoo quoteSummary unexpected error: ticker=%s error=%s", ticker, exc)
        return None

    try:
        result = payload["quoteSummary"]["result"][0]
    except (KeyError, IndexError, TypeError):
        return None

    summary_detail = result.get("summaryDetail") or {}
    default_stats = result.get("defaultKeyStatistics") or {}
    financial_data = result.get("financialData") or {}

    trailing_pe = _extract_raw_value(summary_detail.get("trailingPE")) or _extract_raw_value(default_stats.get("trailingPE"))
    forward_pe = _extract_raw_value(summary_detail.get("forwardPE")) or _extract_raw_value(default_stats.get("forwardPE"))
    price_to_book = _extract_raw_value(default_stats.get("priceToBook"))
    market_cap = _extract_raw_value(summary_detail.get("marketCap")) or _extract_raw_value(default_stats.get("marketCap"))
    beta = _extract_raw_value(default_stats.get("beta")) or _extract_raw_value(summary_detail.get("beta"))
    dividend_yield = _extract_raw_value(summary_detail.get("dividendYield"))
    profit_margin = _extract_raw_value(default_stats.get("profitMargins")) or _extract_raw_value(financial_data.get("profitMargins"))

    return {
        "trailing_pe": trailing_pe,
        "forward_pe": forward_pe,
        "price_to_book": price_to_book,
        "market_cap": market_cap,
        "beta": beta,
        "dividend_yield": dividend_yield,
        "profit_margin": profit_margin,
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


async def fetch_ticker_data(
    ticker: str, history_range: str = "1mo"
) -> dict[str, Any] | None:
    """
    Fetch 30 days of daily closes + current quote for a single ticker.

    Returns a dict with keys:
        current_price, prev_close, day_change, day_change_pct,
        name, history: [{date: str, close: float}]
    Returns None on any error (invalid ticker, network failure, etc.).
    """
    async with httpx.AsyncClient(headers=_HEADERS, timeout=_TIMEOUT) as client:
        for candidate in _ticker_candidates(ticker):
            data = await _fetch_ticker_data_once(
                candidate,
                client,
                history_range=history_range,
            )
            if data is not None:
                return data
    return None


async def fetch_ticker_research(ticker: str) -> dict[str, Any] | None:
    """
    Fetch quote + technical + fundamental snapshot for a ticker.
    Returns None if ticker cannot be validated from Yahoo chart endpoint.
    """
    async with httpx.AsyncClient(headers=_HEADERS, timeout=_TIMEOUT) as client:
        for candidate in _ticker_candidates(ticker):
            quote = await _fetch_ticker_data_once(
                candidate,
                client,
                history_range="1mo",
            )
            if quote is None:
                continue
            fundamentals = await _fetch_quote_summary_once(candidate, client) or {}
            technical = _compute_technical_snapshot(quote.get("history") or [], quote["current_price"])
            return {
                "ticker": ticker.strip().upper(),
                "resolved_ticker": quote.get("resolved_ticker") or candidate,
                "quote": quote,
                "technical": technical,
                "fundamental": fundamentals,
            }
    return None


async def fetch_all_tickers(
    tickers: list[str], history_range: str = "1mo"
) -> dict[str, dict | None]:
    """
    Fetch quote data for multiple tickers in parallel.
    Returns dict keyed by ticker; value is None on failure.
    """
    results = await asyncio.gather(
        *[fetch_ticker_data(t, history_range=history_range) for t in tickers]
    )
    return dict(zip(tickers, results))


async def fetch_batch_research(tickers: list[str]) -> dict[str, dict[str, Any] | None]:
    unique = []
    seen = set()
    for t in tickers:
        u = (t or "").strip().upper()
        if not u or u in seen:
            continue
        seen.add(u)
        unique.append(u)
    results = await asyncio.gather(*[fetch_ticker_research(t) for t in unique])
    return dict(zip(unique, results))


async def fetch_usd_per_cad() -> float | None:
    """
    Return USD per 1 CAD from Yahoo's CAD=X ticker.
    """
    data = await fetch_ticker_data(_CAD_USD_TICKER, history_range="5d")
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


async def search_tickers(query: str, limit: int = 8) -> list[dict[str, str | None]]:
    q = (query or "").strip()
    if not q:
        return []

    clamped_limit = max(1, min(int(limit), 15))
    url = "https://query1.finance.yahoo.com/v1/finance/search"
    params = {
        "q": q,
        "quotesCount": clamped_limit,
        "newsCount": 0,
    }
    try:
        async with httpx.AsyncClient(headers=_HEADERS, timeout=_TIMEOUT) as client:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            payload = resp.json()
    except Exception as exc:
        logger.debug("Yahoo search failed: query=%s error=%s", q, exc)
        return []

    quotes = payload.get("quotes") or []
    out: list[dict[str, str | None]] = []
    seen: set[str] = set()
    for item in quotes:
        symbol = str(item.get("symbol") or "").strip().upper()
        if not symbol or symbol in seen:
            continue
        seen.add(symbol)
        out.append(
            {
                "symbol": symbol,
                "name": (
                    item.get("shortname")
                    or item.get("longname")
                    or item.get("name")
                    or None
                ),
                "exchange": item.get("exchDisp") or item.get("exchange") or None,
                "quote_type": item.get("quoteType") or None,
            }
        )
        if len(out) >= clamped_limit:
            break
    return out
