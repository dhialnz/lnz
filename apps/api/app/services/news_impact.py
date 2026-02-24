from __future__ import annotations

from collections import defaultdict
from typing import Any

from app.schemas.holdings import HoldingLive

# Lightweight sector map for common tickers and ETFs.
_SECTOR_BY_TICKER: dict[str, str] = {
    "AAPL": "technology",
    "MSFT": "technology",
    "NVDA": "technology",
    "MU": "technology",
    "AMD": "technology",
    "GOOG": "technology",
    "META": "technology",
    "AMZN": "consumer",
    "TSLA": "consumer",
    "UNH": "healthcare",
    "JNJ": "healthcare",
    "PFE": "healthcare",
    "JPM": "financials",
    "BAC": "financials",
    "XLF": "financials",
    "XLE": "energy",
    "CVX": "energy",
    "XLI": "industrials",
    "SLV": "metals",
    "GLD": "metals",
    "PHYS": "metals",
    "VFV": "broad_market",
    "SPY": "broad_market",
    "VOO": "broad_market",
    "VTI": "broad_market",
    "XEQT": "broad_market",
    "QQQ": "technology",
    "VGT": "technology",
}

_THEME_KEYWORDS: dict[str, list[str]] = {
    "technology": ["ai", "chip", "semiconductor", "software", "cloud", "nasdaq", "tech"],
    "healthcare": ["healthcare", "pharma", "drug", "biotech", "hospital"],
    "financials": ["bank", "financial", "credit", "lending", "rate cut", "yield curve"],
    "energy": ["oil", "energy", "gas", "opec", "crude"],
    "industrials": ["industrial", "manufacturing", "transport", "shipping"],
    "metals": ["gold", "silver", "bullion", "commodity", "precious metal"],
    "consumer": ["consumer", "retail", "e-commerce", "spending"],
    "broad_market": ["market", "index", "s&p", "equity", "stocks", "volatility", "vix"],
}


def _infer_sector(ticker: str, name: str | None) -> str:
    t = ticker.upper()
    if t in _SECTOR_BY_TICKER:
        return _SECTOR_BY_TICKER[t]
    n = (name or "").lower()
    if "etf" in n or "index" in n:
        return "broad_market"
    if "gold" in n or "silver" in n:
        return "metals"
    if "technology" in n:
        return "technology"
    if "health" in n:
        return "healthcare"
    if "financial" in n or "bank" in n:
        return "financials"
    return "other"


def infer_sector_for_ticker(ticker: str, name: str | None = None) -> str:
    return _infer_sector(ticker, name)


def _extract_event_themes(event_type: str, headline: str) -> set[str]:
    themes: set[str] = set()
    lower = headline.lower()
    for sector, keywords in _THEME_KEYWORDS.items():
        if any(k in lower for k in keywords):
            themes.add(sector)
    if event_type in {"macro", "geopolitical"}:
        themes.add("broad_market")
    return themes


def _direction(sentiment: float | None) -> str:
    if sentiment is None:
        return "mixed"
    if sentiment >= 0.12:
        return "positive"
    if sentiment <= -0.12:
        return "negative"
    return "mixed"


def _rank_score(event: dict[str, Any]) -> float:
    raw = event.get("raw_payload") or {}
    rank = raw.get("rank_score")
    if isinstance(rank, (int, float)):
        return float(max(0.0, min(1.0, rank)))
    # Fallback to a neutral rank.
    return 0.5


def impact_for_event(event: dict[str, Any], holdings: list[HoldingLive]) -> dict[str, Any]:
    headline = str(event.get("headline") or "")
    entities = {str(e).upper() for e in (event.get("entities") or [])}
    event_type = str(event.get("event_type") or "general")
    sentiment = event.get("sentiment_score")
    rank = _rank_score(event)
    themes = _extract_event_themes(event_type, headline)

    impacted: list[dict[str, Any]] = []
    for h in holdings:
        ticker = h.ticker.upper()
        weight = float(h.weight or 0.0)
        sector = _infer_sector(ticker, h.name)

        base_score = 0.0
        reasons: list[str] = []

        direct_hit = ticker in entities
        if direct_hit:
            base_score += 0.90
            reasons.append("direct ticker mention")

        if sector in themes:
            base_score += 0.45
            reasons.append(f"{sector} theme exposure")

        if event_type in {"macro", "geopolitical"} and not direct_hit:
            base_score += 0.22
            reasons.append("broad macro sensitivity")

        if base_score <= 0.0:
            continue

        # Weight and source rank amplify impact.
        weight_multiplier = 0.50 + min(0.50, weight * 2.0)
        rank_multiplier = 0.55 + (0.45 * rank)
        score = min(1.0, base_score * weight_multiplier * rank_multiplier)

        impacted.append(
            {
                "ticker": h.ticker,
                "name": h.name,
                "weight": h.weight,
                "impact_score": round(score, 4),
                "direction": _direction(sentiment),
                "reason": "; ".join(reasons),
            }
        )

    impacted.sort(key=lambda x: x["impact_score"], reverse=True)
    impacted = impacted[:6]

    portfolio_impact = round(sum(x["impact_score"] for x in impacted[:3]), 4)
    net_sentiment = (
        round(float(sentiment) * portfolio_impact, 4)
        if isinstance(sentiment, (int, float))
        else None
    )

    return {
        "rank_score": round(rank, 4),
        "portfolio_impact_score": portfolio_impact,
        "net_sentiment_impact": net_sentiment,
        "impacted_holdings": impacted,
    }


def aggregate_top_impacted(event_impacts: list[dict[str, Any]], top_n: int = 8) -> list[dict[str, Any]]:
    agg: dict[str, dict[str, Any]] = defaultdict(
        lambda: {
            "ticker": "",
            "name": None,
            "weight": None,
            "impact_score": 0.0,
            "direction": "mixed",
            "reason": "Appears repeatedly in high-impact headlines.",
        }
    )
    dir_rank = {"negative": 0, "mixed": 1, "positive": 2}

    for event in event_impacts:
        for h in event.get("impacted_holdings", []):
            ticker = str(h.get("ticker") or "").upper()
            if not ticker:
                continue
            row = agg[ticker]
            row["ticker"] = ticker
            row["name"] = h.get("name")
            row["weight"] = h.get("weight")
            row["impact_score"] += float(h.get("impact_score") or 0.0)
            current_dir = str(h.get("direction") or "mixed")
            if dir_rank.get(current_dir, 1) < dir_rank.get(row["direction"], 1):
                row["direction"] = current_dir

    out = list(agg.values())
    for row in out:
        row["impact_score"] = round(min(1.0, row["impact_score"]), 4)
    out.sort(key=lambda x: x["impact_score"], reverse=True)
    return out[:top_n]
