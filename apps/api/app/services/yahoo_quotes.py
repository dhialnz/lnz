"""
Yahoo Finance quote + history fetcher for individual tickers.
Uses the v8 chart endpoint (same as existing SPY fetches) — no auth required.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import logging
import math
import re
import time
from urllib.parse import quote_plus
from typing import Any

import httpx

logger = logging.getLogger("lnz.yahoo_quotes")

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://finance.yahoo.com/",
}
_TIMEOUT = 12.0
_CAD_USD_TICKER = "CAD=X"
_YAHOO_QUERY_HOSTS = ("query1.finance.yahoo.com", "query2.finance.yahoo.com")
_YAHOO_QUOTE_HOSTS = ("ca.finance.yahoo.com", "finance.yahoo.com")

# ─── In-memory TTL cache ─────────────────────────────────────────────────────

_QUOTE_TTL_S = 300.0  # 5 minutes — balances freshness vs Yahoo rate-limiting
_ticker_cache: dict[tuple[str, str], tuple[dict | None, float]] = {}
_RESEARCH_TTL_S = 900.0
_research_cache: dict[str, tuple[dict[str, Any] | None, float]] = {}
_fx_cache: tuple[float | None, float] | None = None

_RAW_NUM_PATTERN = r"([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)"


def _cache_get_ticker(ticker: str, history_range: str) -> dict | None | bool:
    """Return cached result or ``False`` if cache miss/expired."""
    entry = _ticker_cache.get((ticker, history_range))
    if entry is None:
        return False
    result, ts = entry
    if time.monotonic() - ts > _QUOTE_TTL_S:
        return False
    return result  # may be None (cached miss)


def _cache_set_ticker(ticker: str, history_range: str, result: dict | None) -> None:
    _ticker_cache[(ticker, history_range)] = (result, time.monotonic())


def _cache_get_research(ticker: str) -> dict[str, Any] | None | bool:
    key = (ticker or "").strip().upper()
    if not key:
        return False
    entry = _research_cache.get(key)
    if entry is None:
        return False
    result, ts = entry
    if time.monotonic() - ts > _RESEARCH_TTL_S:
        return False
    return result


def _cache_get_research_any_age(ticker: str) -> dict[str, Any] | None:
    key = (ticker or "").strip().upper()
    if not key:
        return None
    entry = _research_cache.get(key)
    return entry[0] if entry else None


def _cache_set_research(ticker: str, result: dict[str, Any] | None) -> None:
    key = (ticker or "").strip().upper()
    if not key:
        return
    _research_cache[key] = (result, time.monotonic())


async def _fetch_ticker_data_once(
    ticker: str, client: httpx.AsyncClient, history_range: str = "1mo"
) -> dict[str, Any] | None:
    """
    Fetch 30 days of daily closes + current quote for a single ticker candidate.
    Returns None on any fetch/parse failure.
    """
    payload: dict[str, Any] | None = None
    for host in _YAHOO_QUERY_HOSTS:
        url = f"https://{host}/v8/finance/chart/{ticker}?interval=1d&range={history_range}"
        try:
            resp = await client.get(url)
            resp.raise_for_status()
            payload = resp.json()
            break
        except httpx.TimeoutException:
            logger.warning("Yahoo chart timeout: ticker=%s host=%s", ticker, host)
            continue
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 404:
                logger.debug("Yahoo chart 404: ticker=%s host=%s", ticker, host)
            else:
                logger.debug(
                    "Yahoo chart HTTP error: ticker=%s host=%s status=%d",
                    ticker,
                    host,
                    exc.response.status_code,
                )
            continue
        except Exception as exc:
            logger.debug("Yahoo chart unexpected error: ticker=%s host=%s error=%s", ticker, host, exc)
            continue

    if payload is None:
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
    if isinstance(value, str):
        try:
            f = float(value.strip().replace(",", ""))
            return f if math.isfinite(f) else None
        except (TypeError, ValueError):
            return None
    return None


def _parse_abbrev_numeric(value: str | None) -> float | None:
    if not value:
        return None
    s = str(value).strip().replace(",", "")
    if not s:
        return None
    pct = s.endswith("%")
    if pct:
        s = s[:-1]
    mult = 1.0
    suffix = s[-1:].upper()
    if suffix in {"K", "M", "B", "T"}:
        s = s[:-1]
        mult = {"K": 1e3, "M": 1e6, "B": 1e9, "T": 1e12}[suffix]
    try:
        f = float(s) * mult
        if pct:
            f = f / 100.0
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def _extract_from_html_raw(text: str, key: str) -> float | None:
    pattern = rf'"{re.escape(key)}"\s*:\s*\{{\s*"raw"\s*:\s*{_RAW_NUM_PATTERN}'
    m = re.search(pattern, text)
    if not m:
        return None
    return _extract_raw_value(m.group(1))


def _extract_from_html_data_field(html: str, field: str) -> float | None:
    # Handles snippets like: data-field="marketCap" data-value="4.449T"
    pattern = rf'data-field="{re.escape(field)}"[^>]*data-value="([^"]+)"'
    m = re.search(pattern, html)
    if not m:
        return None
    return _parse_abbrev_numeric(m.group(1))


def _pick_best_market_cap(raw_value: float | None, field_value: float | None) -> float | None:
    """
    Prefer the value that best reflects headline quote market cap.
    Some embedded JSON blobs can contain smaller unrelated marketCap-like fields.
    """
    if raw_value is None and field_value is None:
        return None
    if raw_value is None:
        return field_value
    if field_value is None:
        return raw_value
    if raw_value <= 0:
        return field_value
    if field_value <= 0:
        return raw_value

    ratio = max(raw_value, field_value) / min(raw_value, field_value)
    # If they diverge heavily, pick the larger (headline value is usually correct one).
    if ratio >= 10.0:
        return max(raw_value, field_value)
    # Otherwise prefer raw for precision.
    return raw_value


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
    ticker: str, client: httpx.AsyncClient, crumb: str | None = None
) -> dict[str, float | None] | None:
    modules = "summaryDetail,defaultKeyStatistics,financialData"
    payload: dict[str, Any] | None = None
    for host in _YAHOO_QUERY_HOSTS:
        url = f"https://{host}/v10/finance/quoteSummary/{ticker}?modules={modules}"
        if crumb:
            url += f"&crumb={quote_plus(crumb)}"
        try:
            resp = await client.get(url)
            resp.raise_for_status()
            payload = resp.json()
            break
        except httpx.TimeoutException:
            logger.warning("Yahoo quoteSummary timeout: ticker=%s host=%s", ticker, host)
            continue
        except httpx.HTTPStatusError as exc:
            logger.debug(
                "Yahoo quoteSummary HTTP error: ticker=%s host=%s status=%d",
                ticker,
                host,
                exc.response.status_code,
            )
            continue
        except Exception as exc:
            logger.debug("Yahoo quoteSummary unexpected error: ticker=%s host=%s error=%s", ticker, host, exc)
            continue

    if payload is None:
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


def _fundamental_has_values(data: dict[str, Any] | None) -> bool:
    if not isinstance(data, dict):
        return False
    return any(v is not None for v in data.values())


async def _ensure_yahoo_crumb(client: httpx.AsyncClient) -> str | None:
    """
    Yahoo fundamentals endpoints now often require a cookie + crumb pair.
    We seed cookies via fc.yahoo.com, then retrieve crumb from test/getcrumb.
    """
    try:
        await client.get("https://fc.yahoo.com")
    except Exception as exc:
        logger.debug("Yahoo crumb seed cookie request failed: %s", exc)

    for endpoint in (
        "https://query1.finance.yahoo.com/v1/test/getcrumb",
        "https://query2.finance.yahoo.com/v1/test/getcrumb",
    ):
        try:
            resp = await client.get(endpoint)
            resp.raise_for_status()
            crumb = (resp.text or "").strip()
            # Invalid responses are typically JSON error payloads.
            if crumb and not crumb.startswith("{"):
                return crumb
        except Exception as exc:
            logger.debug("Yahoo crumb endpoint failed: endpoint=%s error=%s", endpoint, exc)
    return None


async def _fetch_quote_fundamental_fallback_once(
    ticker: str,
    client: httpx.AsyncClient,
    crumb: str | None = None,
) -> dict[str, float | None] | None:
    """
    Fallback fundamentals via Yahoo v7 quote endpoint when quoteSummary fails.
    """
    row: dict[str, Any] | None = None
    for host in _YAHOO_QUERY_HOSTS:
        url = f"https://{host}/v7/finance/quote?symbols={ticker}"
        if crumb:
            url += f"&crumb={quote_plus(crumb)}"
        try:
            resp = await client.get(url)
            resp.raise_for_status()
            payload = resp.json()
            result = (payload.get("quoteResponse") or {}).get("result") or []
            row = result[0] if result else {}
            if row:
                break
        except Exception as exc:
            logger.debug("Yahoo quote fallback failed: ticker=%s host=%s error=%s", ticker, host, exc)
            continue

    if row is None:
        return None

    return {
        "trailing_pe": _extract_raw_value(row.get("trailingPE")),
        "forward_pe": _extract_raw_value(row.get("forwardPE")),
        "price_to_book": _extract_raw_value(row.get("priceToBook")),
        "market_cap": _extract_raw_value(row.get("marketCap")),
        "beta": _extract_raw_value(row.get("beta")),
        "dividend_yield": (
            _extract_raw_value(row.get("trailingAnnualDividendYield"))
            or _extract_raw_value(row.get("dividendYield"))
        ),
        "profit_margin": _extract_raw_value(row.get("profitMargins")),
    }


async def _fetch_quote_page_fundamental_fallback_once(
    ticker: str,
    client: httpx.AsyncClient,
) -> dict[str, float | None] | None:
    """
    Last-resort fallback via Yahoo quote HTML. Used only when API fundamentals fail.
    """
    html: str | None = None
    for host in _YAHOO_QUOTE_HOSTS:
        url = f"https://{host}/quote/{ticker}"
        try:
            resp = await client.get(url)
            resp.raise_for_status()
            html = resp.text
            if html:
                break
        except Exception as exc:
            logger.debug("Yahoo quote page fallback failed: ticker=%s host=%s error=%s", ticker, host, exc)
            continue

    if not html:
        return None

    normalized = html.replace('\\"', '"')
    trailing_pe = _extract_from_html_raw(normalized, "trailingPE")
    if trailing_pe is None:
        trailing_pe = _extract_from_html_data_field(html, "trailingPE")
    forward_pe = _extract_from_html_raw(normalized, "forwardPE")
    price_to_book = _extract_from_html_raw(normalized, "priceToBook")
    market_cap_raw = _extract_from_html_raw(normalized, "marketCap")
    market_cap_field = _extract_from_html_data_field(html, "marketCap")
    market_cap = _pick_best_market_cap(market_cap_raw, market_cap_field)
    beta = _extract_from_html_raw(normalized, "beta")
    if beta is None:
        beta = _extract_from_html_data_field(html, "beta")
    profit_margin = _extract_from_html_raw(normalized, "profitMargins")

    return {
        "trailing_pe": trailing_pe,
        "forward_pe": forward_pe,
        "price_to_book": price_to_book,
        "market_cap": market_cap,
        "beta": beta,
        "dividend_yield": None,
        "profit_margin": profit_margin,
    }


async def _fetch_ticker_research_with_client(
    ticker: str,
    client: httpx.AsyncClient,
    crumb: str | None = None,
) -> dict[str, Any] | None:
    base_ticker = ticker.strip().upper()
    for candidate in _ticker_candidates(base_ticker):
        quote = await _fetch_ticker_data_once(
            candidate,
            client,
            history_range="1mo",
        )
        if quote is None:
            continue

        fundamentals = await _fetch_quote_summary_once(candidate, client, crumb=crumb) or {}
        if not _fundamental_has_values(fundamentals):
            fallback = await _fetch_quote_fundamental_fallback_once(candidate, client, crumb=crumb) or {}
            if fallback:
                fundamentals = {
                    "trailing_pe": fundamentals.get("trailing_pe") if isinstance(fundamentals, dict) else None,
                    "forward_pe": fundamentals.get("forward_pe") if isinstance(fundamentals, dict) else None,
                    "price_to_book": fundamentals.get("price_to_book") if isinstance(fundamentals, dict) else None,
                    "market_cap": fundamentals.get("market_cap") if isinstance(fundamentals, dict) else None,
                    "beta": fundamentals.get("beta") if isinstance(fundamentals, dict) else None,
                    "dividend_yield": fundamentals.get("dividend_yield") if isinstance(fundamentals, dict) else None,
                    "profit_margin": fundamentals.get("profit_margin") if isinstance(fundamentals, dict) else None,
                }
                for key, value in fallback.items():
                    if fundamentals.get(key) is None:
                        fundamentals[key] = value

        if not _fundamental_has_values(fundamentals):
            html_fallback = await _fetch_quote_page_fundamental_fallback_once(candidate, client) or {}
            if html_fallback:
                if not isinstance(fundamentals, dict):
                    fundamentals = {}
                for key, value in html_fallback.items():
                    if fundamentals.get(key) is None:
                        fundamentals[key] = value

        # Reuse last known fundamentals for transient Yahoo misses/rate-limits.
        cached_any = _cache_get_research_any_age(base_ticker)
        if cached_any and isinstance(cached_any, dict):
            cached_fund = dict(cached_any.get("fundamental") or {})
            for key, value in cached_fund.items():
                if fundamentals.get(key) is None and value is not None:
                    fundamentals[key] = value

        technical = _compute_technical_snapshot(quote.get("history") or [], quote["current_price"])
        return {
            "ticker": base_ticker,
            "resolved_ticker": quote.get("resolved_ticker") or candidate,
            "quote": quote,
            "technical": technical,
            "fundamental": fundamentals,
        }
    return None


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
    Results are cached for 5 minutes to reduce Yahoo Finance API pressure.

    Returns a dict with keys:
        current_price, prev_close, day_change, day_change_pct,
        name, history: [{date: str, close: float}]
    Returns None on any error (invalid ticker, network failure, etc.).
    """
    cached = _cache_get_ticker(ticker, history_range)
    if cached is not False:
        return cached  # type: ignore[return-value]

    async with httpx.AsyncClient(headers=_HEADERS, timeout=_TIMEOUT, follow_redirects=True) as client:
        for candidate in _ticker_candidates(ticker):
            data = await _fetch_ticker_data_once(
                candidate,
                client,
                history_range=history_range,
            )
            if data is not None:
                _cache_set_ticker(ticker, history_range, data)
                return data

    # Cache the miss too so we don't hammer Yahoo on repeated invalid tickers.
    _cache_set_ticker(ticker, history_range, None)
    return None


async def fetch_ticker_research(ticker: str) -> dict[str, Any] | None:
    """
    Fetch quote + technical + fundamental snapshot for a ticker.
    Returns None if ticker cannot be validated from Yahoo chart endpoint.
    """
    cached = _cache_get_research(ticker)
    if cached is not False:
        return cached  # type: ignore[return-value]

    async with httpx.AsyncClient(headers=_HEADERS, timeout=_TIMEOUT, follow_redirects=True) as client:
        crumb = await _ensure_yahoo_crumb(client)
        result = await _fetch_ticker_research_with_client(ticker, client, crumb=crumb)
        _cache_set_research(ticker, result)
        return result


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
    out: dict[str, dict[str, Any] | None] = {}
    missing: list[str] = []
    for ticker in unique:
        cached = _cache_get_research(ticker)
        if cached is not False:
            out[ticker] = cached  # type: ignore[assignment]
        else:
            missing.append(ticker)

    if not missing:
        return out

    async with httpx.AsyncClient(headers=_HEADERS, timeout=_TIMEOUT, follow_redirects=True) as client:
        crumb = await _ensure_yahoo_crumb(client)
        results = await asyncio.gather(
            *[_fetch_ticker_research_with_client(t, client, crumb=crumb) for t in missing]
        )

    for ticker, result in zip(missing, results):
        _cache_set_research(ticker, result)
        out[ticker] = result

    return out


async def fetch_usd_per_cad() -> float | None:
    """
    Return USD per 1 CAD from Yahoo's CAD=X ticker.
    Cached alongside other ticker data (5-minute TTL).
    """
    global _fx_cache
    if _fx_cache is not None:
        rate, ts = _fx_cache
        if time.monotonic() - ts <= _QUOTE_TTL_S:
            return rate

    data = await fetch_ticker_data(_CAD_USD_TICKER, history_range="5d")
    if not data:
        _fx_cache = (None, time.monotonic())
        return None
    px = data.get("current_price")
    try:
        value = float(px)
    except (TypeError, ValueError):
        _fx_cache = (None, time.monotonic())
        return None
    if not math.isfinite(value) or value <= 0:
        _fx_cache = (None, time.monotonic())
        return None
    # Yahoo CAD=X typically returns CAD per USD (~1.3+). Convert to USD per CAD.
    rate = 1.0 / value if value > 1 else value
    _fx_cache = (rate, time.monotonic())
    return rate


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
