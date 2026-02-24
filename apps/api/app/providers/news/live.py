from __future__ import annotations

import asyncio
import math
import re
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import quote_plus
from typing import Optional
from xml.etree import ElementTree as ET

import httpx

from app.providers.news.base import NewsProvider

TIMEOUT = 12.0

_SOURCE_WEIGHTS = {
    "Yahoo Finance": 0.90,
    "CNBC": 0.85,
    "MarketWatch": 0.82,
    "New York Times": 0.80,
    "Investing.com": 0.75,
}

_EVENT_KEYWORDS = {
    "macro": ["fed", "fomc", "inflation", "cpi", "pce", "yield", "rates", "jobs", "recession", "treasury"],
    "earnings": ["earnings", "eps", "guidance", "revenue", "quarter", "beat", "miss"],
    "geopolitical": ["war", "tariff", "sanction", "election", "strike", "conflict", "china", "russia", "middle east"],
    "sector": ["semiconductor", "energy", "financials", "healthcare", "technology", "oil", "bank"],
}

_IMPORTANT_TERMS = {
    "fed": 0.20,
    "fomc": 0.20,
    "inflation": 0.15,
    "cpi": 0.15,
    "earnings": 0.12,
    "guidance": 0.10,
    "recession": 0.18,
    "tariff": 0.14,
    "war": 0.16,
    "volatility": 0.10,
    "vix": 0.12,
}

_FALLBACK_STOCK_IMAGES = {
    "macro": "https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?auto=format&fit=crop&w=1200&q=80",
    "earnings": "https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=1200&q=80",
    "geopolitical": "https://images.unsplash.com/photo-1521295121783-8a321d551ad2?auto=format&fit=crop&w=1200&q=80",
    "sector": "https://images.unsplash.com/photo-1642790106117-e829e14a795f?auto=format&fit=crop&w=1200&q=80",
    "general": "https://images.unsplash.com/photo-1535320903710-d993d3d77d29?auto=format&fit=crop&w=1200&q=80",
}

_TICKERS = ["SPY", "QQQ", "DIA", "AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "META"]
_BASE_MARKET_QUERIES = ["SPY", "QQQ", "Federal Reserve", "US Treasury Yield", "inflation", "earnings"]
_MAX_ENTITY_QUERIES = 12
_BASE_QUERY_NEWS_COUNT = 14
_ENTITY_QUERY_NEWS_COUNT = 16


def _now_utc() -> datetime:
    return datetime.now(tz=timezone.utc)


def _to_iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat()


def _parse_pub_date(raw: Optional[str]) -> datetime:
    if not raw:
        return _now_utc()
    try:
        return parsedate_to_datetime(raw).astimezone(timezone.utc)
    except Exception:
        return _now_utc()


def _extract_entities(text: str) -> list[str]:
    upper = text.upper()
    entities = [t for t in _TICKERS if t in upper]
    if "FED" in upper or "FOMC" in upper:
        entities.append("macro")
    return sorted(set(entities))


def _looks_like_ticker(token: str) -> bool:
    return bool(re.fullmatch(r"[A-Z][A-Z0-9.\-]{0,9}", token.upper()))


def _normalize_entity_queries(entities: Optional[list[str]]) -> list[tuple[str, str]]:
    if not entities:
        return []
    out: list[tuple[str, str]] = []
    seen: set[str] = set()
    for raw in entities:
        token = re.sub(r"\s+", " ", str(raw or "").strip())
        if len(token) < 2:
            continue
        tickerish = _looks_like_ticker(token)
        query = token.upper() if tickerish else token
        focus = token.upper()
        key = f"{query.lower()}::{focus.lower()}"
        if key in seen:
            continue
        seen.add(key)
        out.append((query, focus))
        if len(out) >= _MAX_ENTITY_QUERIES:
            break
    return out


def _event_type_from_headline(headline: str) -> str:
    h = headline.lower()
    for event_type, kws in _EVENT_KEYWORDS.items():
        if any(kw in h for kw in kws):
            return event_type
    return "general"


def _importance_score(source: str, headline: str, entities: list[str]) -> float:
    score = _SOURCE_WEIGHTS.get(source, 0.7)
    lower = headline.lower()
    for term, w in _IMPORTANT_TERMS.items():
        if term in lower:
            score += w
    score += min(0.20, 0.03 * len(entities))
    return max(0.0, min(score, 1.0))


def _recency_score(published_at: datetime) -> float:
    hours_old = max(0.0, (_now_utc() - published_at).total_seconds() / 3600.0)
    return math.exp(-hours_old / 36.0)


def _volatility_score(event_type: str) -> float:
    return {
        "geopolitical": 0.85,
        "macro": 0.70,
        "earnings": 0.60,
        "sector": 0.45,
        "general": 0.35,
    }.get(event_type, 0.35)


def _sentiment_score(headline: str) -> float:
    pos_terms = ["beat", "gain", "rally", "surge", "upgrade", "strong", "growth"]
    neg_terms = ["miss", "fall", "drop", "cut", "downgrade", "weak", "loss", "recession"]
    h = headline.lower()
    pos = sum(1 for t in pos_terms if t in h)
    neg = sum(1 for t in neg_terms if t in h)
    if pos == neg:
        return 0.0
    raw = (pos - neg) / max(1, pos + neg)
    return max(-1.0, min(raw, 1.0))


def _rank_score(importance: float, recency: float) -> float:
    return (0.65 * importance) + (0.35 * recency)


def _item_matches_entities(item: dict, wanted: set[str]) -> bool:
    item_entities = {str(e).upper() for e in item.get("entities", [])}
    if wanted.intersection(item_entities):
        return True
    headline = str(item.get("headline") or "").upper()
    return any(w in headline for w in wanted)


def _safe_thumbnail_from_yahoo(item: dict) -> Optional[str]:
    thumb = item.get("thumbnail", {}) or {}
    if not isinstance(thumb, dict):
        return None
    resolutions = thumb.get("resolutions") or []
    if resolutions and isinstance(resolutions, list):
        best = sorted(
            [r for r in resolutions if isinstance(r, dict) and r.get("url")],
            key=lambda r: (r.get("width") or 0) * (r.get("height") or 0),
            reverse=True,
        )
        if best:
            return str(best[0]["url"])
    if thumb.get("url"):
        return str(thumb["url"])
    return None


def _find_rss_image(item_el: ET.Element) -> Optional[str]:
    media_ns = "{http://search.yahoo.com/mrss/}"
    content_ns = "{http://purl.org/rss/1.0/modules/content/}"
    for tag in [f"{media_ns}content", f"{media_ns}thumbnail", "enclosure"]:
        el = item_el.find(tag)
        if el is not None and el.attrib.get("url"):
            return el.attrib["url"]
    c = item_el.find(f"{content_ns}encoded")
    if c is not None and c.text:
        m = re.search(r'<img[^>]+src="([^"]+)"', c.text, flags=re.IGNORECASE)
        if m:
            return m.group(1)
    desc = item_el.findtext("description") or ""
    m = re.search(r'<img[^>]+src="([^"]+)"', desc, flags=re.IGNORECASE)
    if m:
        return m.group(1)
    return None


class LiveNewsProvider(NewsProvider):
    async def _fetch_yahoo_news(
        self,
        client: httpx.AsyncClient,
        *,
        query: str,
        news_count: int,
        focus_entity: str | None = None,
    ) -> list[dict]:
        items: list[dict] = []
        encoded = quote_plus(query)
        url = f"https://query2.finance.yahoo.com/v1/finance/search?q={encoded}&quotesCount=0&newsCount={news_count}"
        resp = await client.get(url)
        resp.raise_for_status()
        payload = resp.json()
        focus_upper = focus_entity.upper() if focus_entity else None
        for n in payload.get("news", []):
            headline = str(n.get("title") or "").strip()
            if not headline:
                continue
            published = datetime.fromtimestamp(
                int(n.get("providerPublishTime") or int(_now_utc().timestamp())),
                tz=timezone.utc,
            )
            source = str(n.get("publisher") or "Yahoo Finance")
            event_type = _event_type_from_headline(headline)
            entities = list(
                {
                    *(str(t).upper() for t in (n.get("relatedTickers") or []) if str(t).strip()),
                    *_extract_entities(headline),
                }
            )
            if focus_upper:
                in_headline = focus_upper in headline.upper()
                in_entities = focus_upper in {str(e).upper() for e in entities}
                if in_headline or in_entities:
                    entities.append(focus_upper)
            importance = _importance_score(source, headline, entities)
            if focus_upper and focus_upper in {str(e).upper() for e in entities}:
                importance = min(1.0, importance + 0.12)
            recency = _recency_score(published)
            rank = _rank_score(importance, recency)
            if focus_upper and focus_upper in {str(e).upper() for e in entities}:
                rank = min(1.0, rank + 0.08)
            image_url = _safe_thumbnail_from_yahoo(n) or _FALLBACK_STOCK_IMAGES.get(event_type, _FALLBACK_STOCK_IMAGES["general"])
            items.append(
                {
                    "headline": headline,
                    "source": source,
                    "url": n.get("link"),
                    "entities": entities,
                    "event_type": event_type,
                    "sentiment_score": _sentiment_score(headline),
                    "volatility_score": _volatility_score(event_type),
                    "confidence": min(1.0, 0.55 + (0.35 * importance)),
                    "captured_at": _to_iso(published),
                    "raw_payload": {
                        "provider": "yahoo",
                        "query": query,
                        "focus_entity": focus_upper,
                        "importance_score": importance,
                        "recency_score": recency,
                        "rank_score": rank,
                        "image_url": image_url,
                        "original": n,
                    },
                }
            )
        return items

    async def _fetch_rss(self, client: httpx.AsyncClient, url: str, source: str, default_event: str) -> list[dict]:
        items: list[dict] = []
        resp = await client.get(url)
        resp.raise_for_status()
        root = ET.fromstring(resp.text.encode("utf-8", errors="ignore"))
        for item_el in root.findall(".//item"):
            headline = (item_el.findtext("title") or "").strip()
            if not headline:
                continue
            link = (item_el.findtext("link") or "").strip() or None
            published = _parse_pub_date(item_el.findtext("pubDate"))
            event_type = _event_type_from_headline(headline)
            if event_type == "general":
                event_type = default_event
            entities = _extract_entities(headline)
            importance = _importance_score(source, headline, entities)
            recency = _recency_score(published)
            rank = _rank_score(importance, recency)
            image_url = _find_rss_image(item_el) or _FALLBACK_STOCK_IMAGES.get(event_type, _FALLBACK_STOCK_IMAGES["general"])
            items.append(
                {
                    "headline": headline,
                    "source": source,
                    "url": link,
                    "entities": entities,
                    "event_type": event_type,
                    "sentiment_score": _sentiment_score(headline),
                    "volatility_score": _volatility_score(event_type),
                    "confidence": min(1.0, 0.50 + (0.35 * importance)),
                    "captured_at": _to_iso(published),
                    "raw_payload": {
                        "provider": "rss",
                        "feed_url": url,
                        "importance_score": importance,
                        "recency_score": recency,
                        "rank_score": rank,
                        "image_url": image_url,
                    },
                }
            )
        return items

    async def get_news(self, entities: Optional[list[str]] = None) -> list[dict]:
        feeds = [
            ("https://www.cnbc.com/id/100003114/device/rss/rss.html", "CNBC", "macro"),
            ("https://feeds.marketwatch.com/marketwatch/topstories/", "MarketWatch", "general"),
            ("https://rss.nytimes.com/services/xml/rss/nyt/Business.xml", "New York Times", "macro"),
            ("https://www.investing.com/rss/news.rss", "Investing.com", "macro"),
        ]
        yahoo_queries: list[tuple[str, str | None, int]] = [
            (q, None, _BASE_QUERY_NEWS_COUNT) for q in _BASE_MARKET_QUERIES
        ]
        for query, focus in _normalize_entity_queries(entities):
            yahoo_queries.append((query, focus, _ENTITY_QUERY_NEWS_COUNT))

        # Preserve order and deduplicate duplicate query+focus combinations.
        deduped_queries: list[tuple[str, str | None, int]] = []
        seen_queries: set[str] = set()
        for query, focus, count in yahoo_queries:
            key = f"{query.lower()}::{(focus or '').lower()}"
            if key in seen_queries:
                continue
            seen_queries.add(key)
            deduped_queries.append((query, focus, count))

        headers = {"User-Agent": "Mozilla/5.0 (compatible; LNZ/1.0; +http://localhost)"}
        async with httpx.AsyncClient(timeout=TIMEOUT, headers=headers, follow_redirects=True) as client:
            tasks = [
                self._fetch_yahoo_news(client, query=q, news_count=count, focus_entity=focus)
                for (q, focus, count) in deduped_queries
            ] + [
                self._fetch_rss(client, u, s, t) for (u, s, t) in feeds
            ]
            results = await asyncio.gather(*tasks, return_exceptions=True)

        merged: list[dict] = []
        for result in results:
            if isinstance(result, Exception):
                continue
            merged.extend(result)

        if entities:
            wanted = {e.upper() for e in entities}
            merged = [
                i
                for i in merged
                if _item_matches_entities(i, wanted)
                or str(i.get("event_type") or "") in {"macro", "geopolitical"}
            ]

        # Deduplicate by URL or headline+source.
        seen = set()
        deduped: list[dict] = []
        for item in merged:
            key = item.get("url") or f"{item.get('source')}::{item.get('headline')}"
            if key in seen:
                continue
            seen.add(key)
            deduped.append(item)

        deduped.sort(
            key=lambda x: (
                float((x.get("raw_payload") or {}).get("rank_score", 0.0)),
                x.get("captured_at") or "",
            ),
            reverse=True,
        )
        return deduped[:120]
