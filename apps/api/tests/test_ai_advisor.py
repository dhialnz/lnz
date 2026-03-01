from __future__ import annotations

from app.services.ai_advisor import (
    _deterministic_suggestions,
    _ensure_min_buy_recommendations,
)


def test_deterministic_suggestions_keeps_buy_floor_under_sell_heavy_portfolio() -> None:
    # Create a sell-heavy portfolio that would previously crowd out buy ideas after slicing.
    holdings = [
        {
            "ticker": ticker,
            "name": f"{ticker} Corp",
            "weight": 0.08,
            "unrealized_pnl_pct": -0.12,
            "day_change_pct": -0.02,
        }
        for ticker in (
            "AAA",
            "AAB",
            "AAC",
            "AAD",
            "AAE",
            "AAF",
            "AAG",
            "AAH",
            "AAI",
            "AAJ",
            "AAK",
            "AAL",
            "AAM",
            "AAN",
            "AAO",
            "AAP",
            "AAQ",
            "AAR",
        )
    ]
    context = {
        "holdings": holdings,
        "thresholds": {"concentration_trim": 0.05, "drawdown_hard_stop": -0.10},
        "risk_profile": "Balanced",
        "summary": {"regime": "Neutral"},
        "top_impacted_holdings": [],
    }

    suggestions = _deterministic_suggestions(context)
    buy_count = sum(1 for row in suggestions if str(row.get("action")) == "buy")

    assert len(suggestions) <= 14
    assert buy_count >= 2


def test_ensure_min_buy_recommendations_backfills_from_fallback() -> None:
    primary = [
        {
            "title": "TRIM NVDA",
            "explanation": "Reduce concentration.",
            "actions": ["Trim size"],
            "triggers": ["risk"],
            "supporting_metrics": {"validated_ticker": "NVDA", "yahoo_validation": True},
            "confidence": 0.8,
        },
        {
            "title": "HOLD AMZN",
            "explanation": "Keep current allocation.",
            "actions": ["Monitor"],
            "triggers": ["steady"],
            "supporting_metrics": {"validated_ticker": "AMZN", "yahoo_validation": True},
            "confidence": 0.6,
        },
    ]
    fallback = [
        {
            "title": "BUY XLI",
            "explanation": "Add cyclical breadth.",
            "actions": ["Add starter"],
            "triggers": ["diversification"],
            "supporting_metrics": {"validated_ticker": "XLI", "yahoo_validation": True},
            "confidence": 0.7,
        },
        {
            "title": "BUY VEA",
            "explanation": "Improve geographic diversification.",
            "actions": ["Add starter"],
            "triggers": ["diversification"],
            "supporting_metrics": {"validated_ticker": "VEA", "yahoo_validation": True},
            "confidence": 0.7,
        },
    ]

    output = _ensure_min_buy_recommendations(primary, fallback, min_buy=2, max_total=10)
    buy_count = sum(1 for row in output if "buy" in str(row.get("title", "")).lower())

    assert len(output) <= 10
    assert buy_count >= 2
