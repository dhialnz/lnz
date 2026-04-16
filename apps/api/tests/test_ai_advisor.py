from __future__ import annotations

from app.services import ai_advisor
from app.services.ai_advisor import (
    _deterministic_suggestions,
    _ensure_min_buy_recommendations,
)


def _sample_portfolio_context() -> dict[str, object]:
    return {
        "holdings": [
            {
                "ticker": "MSFT",
                "name": "Microsoft",
                "weight": 0.24,
                "unrealized_pnl_pct": 0.08,
                "day_change_pct": 0.01,
                "sector": "technology",
            }
        ],
        "thresholds": {"concentration_trim": 0.15, "drawdown_hard_stop": -0.10},
        "risk_profile": "Balanced",
        "summary": {"regime": "Neutral", "drawdown": -0.04, "rolling_8w_vol": 0.12},
        "top_impacted_holdings": [{"ticker": "MSFT", "reason": "Cloud demand remains a key driver."}],
        "news_events": [],
        "important_sources": ["https://example.com/msft"],
    }


def _stub_portfolio_insights_llm(monkeypatch, raw: str) -> None:
    monkeypatch.setattr(ai_advisor, "resolve_ai_provider", lambda: ("openai", "gpt-test"))

    async def fake_llm_chat(messages, *, json_mode: bool, task: str | None = None):
        assert messages
        assert json_mode is True
        assert task == "insights"
        return raw, "openai", "gpt-test"

    async def fake_validate(context, suggestions, watchlist):
        return suggestions, watchlist

    monkeypatch.setattr(ai_advisor, "_llm_chat", fake_llm_chat)
    monkeypatch.setattr(ai_advisor, "_validate_suggestions_and_watchlist", fake_validate)


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


async def test_generate_portfolio_insights_salvages_balanced_object_with_trailing_noise(monkeypatch) -> None:
    _stub_portfolio_insights_llm(
        monkeypatch,
        """
Portfolio readout:
{'summary': 'AI sees alpha stabilizing while beta cools after last month''s drawdown.',
 'key_risks': ['Mega-cap concentration still leaves the book exposed to single-theme reversals.'],
 'key_opportunities': ['Industrial and semiconductor breadth is improving on capex resilience.'],
 'suggestions': ['Buy AMD - add diversified AI demand exposure after the recent reset.'],
 'watchlist': ['AMD', 'AVGO']}
Notes: keep {cash} flexible.
""",
    )

    result = await ai_advisor.generate_portfolio_insights(_sample_portfolio_context())

    assert result["used_ai"] is True
    assert result["model"] == "gpt-test"
    assert "alpha stabilizing" in result["summary"]
    assert any("concentration" in line.lower() for line in result["key_risks"])
    assert any(item["ticker"] == "AMD" for item in result["suggestions"])
    assert result["watchlist"][:2] == ["AMD", "AVGO"]


async def test_generate_portfolio_insights_salvages_structured_plaintext(monkeypatch) -> None:
    _stub_portfolio_insights_llm(
        monkeypatch,
        """
Summary: AI sees improving breadth after a soft patch in relative performance.
Key Risks:
- Software concentration still amplifies downside if leadership narrows again.
Key Opportunities:
- Industrials momentum is broadening and improving diversification.
Suggestions:
- Buy XLI - broaden cyclical exposure without adding single-name concentration.
Watchlist:
- XLI
- UNP
""",
    )

    result = await ai_advisor.generate_portfolio_insights(_sample_portfolio_context())

    assert result["used_ai"] is True
    assert result["model"] == "gpt-test"
    assert result["summary"].startswith("AI sees improving breadth")
    assert any("software concentration" in line.lower() for line in result["key_risks"])
    assert any(item["ticker"] == "XLI" for item in result["suggestions"])
    assert result["watchlist"][:2] == ["XLI", "UNP"]


async def test_generate_portfolio_insights_keeps_deterministic_fallback_for_garbage(monkeypatch) -> None:
    _stub_portfolio_insights_llm(monkeypatch, "<html>not valid portfolio insight output</html>")

    result = await ai_advisor.generate_portfolio_insights(_sample_portfolio_context())

    assert result["used_ai"] is False
    assert result["model"] == "deterministic-v1"
