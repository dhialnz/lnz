"""Tests for the rule engine."""

from __future__ import annotations

import pandas as pd
import pytest

from app.models.rulebook import DEFAULT_THRESHOLDS
from app.services.metrics import compute_weekly_series
from app.services.rules import (
    rule_deploy_tranche_1,
    rule_deploy_tranche_2,
    rule_hard_stop,
    rule_hold_defensive,
    rule_mtd_profit_taking,
    rule_vol_spike,
    run_rule_engine,
)


def _make_expanding_df(n: int = 12) -> pd.DataFrame:
    data = {
        "date": pd.date_range("2024-01-05", periods=n, freq="W-FRI").date.tolist(),
        "total_value": [100_000 + i * 2_000 for i in range(n)],
        "net_deposits": [100_000] * n,
        "period_deposits": [0.0] * n,
        "period_return": [0.02] * n,
        "benchmark_return": [0.01] * n,
    }
    return compute_weekly_series(pd.DataFrame(data))


def _make_defensive_df(n: int = 10) -> pd.DataFrame:
    returns = [-0.03] * n
    vals = [100_000]
    for r in returns[1:]:
        vals.append(vals[-1] * (1 + r))
    data = {
        "date": pd.date_range("2024-01-05", periods=n, freq="W-FRI").date.tolist(),
        "total_value": vals,
        "net_deposits": [100_000] * n,
        "period_deposits": [0.0] * n,
        "period_return": returns,
        "benchmark_return": [0.01] * n,
    }
    df = compute_weekly_series(pd.DataFrame(data))
    return df


class TestDeployRules:
    def test_tranche1_fires_in_recovery(self):
        df = _make_expanding_df()
        result = rule_deploy_tranche_1(df, "Recovery", DEFAULT_THRESHOLDS)
        assert result is not None
        assert result["category"] == "Deployment"
        assert "30%" in result["explanation"] or "30" in result["explanation"]

    def test_tranche1_does_not_fire_in_expansion(self):
        df = _make_expanding_df()
        result = rule_deploy_tranche_1(df, "Expansion", DEFAULT_THRESHOLDS)
        assert result is None

    def test_tranche2_fires_in_expansion(self):
        df = _make_expanding_df()
        result = rule_deploy_tranche_2(df, "Expansion", DEFAULT_THRESHOLDS)
        assert result is not None
        assert result["risk_level"] == "Low"

    def test_tranche2_does_not_fire_in_recovery(self):
        df = _make_expanding_df()
        result = rule_deploy_tranche_2(df, "Recovery", DEFAULT_THRESHOLDS)
        assert result is None

    def test_hold_fires_in_defensive(self):
        df = _make_defensive_df()
        result = rule_hold_defensive(df, "Defensive", DEFAULT_THRESHOLDS)
        assert result is not None
        assert result["risk_level"] == "High"

    def test_hold_does_not_fire_in_expansion(self):
        df = _make_expanding_df()
        result = rule_hold_defensive(df, "Expansion", DEFAULT_THRESHOLDS)
        assert result is None


class TestRiskRules:
    def test_hard_stop_fires_below_threshold(self):
        df = _make_defensive_df(n=12)
        # Force drawdown below threshold
        df.loc[df.index[-1], "drawdown"] = -0.12
        result = rule_hard_stop(df, "Defensive", DEFAULT_THRESHOLDS)
        assert result is not None
        assert result["risk_level"] == "High"
        assert "Hard Stop" in result["title"]

    def test_hard_stop_does_not_fire_above_threshold(self):
        df = _make_expanding_df()
        result = rule_hard_stop(df, "Expansion", DEFAULT_THRESHOLDS)
        assert result is None

    def test_vol_spike_fires_above_threshold(self):
        df = _make_expanding_df()
        df.loc[df.index[-1], "rolling_8w_vol"] = 0.05  # > 0.04 threshold
        result = rule_vol_spike(df, "Expansion", DEFAULT_THRESHOLDS)
        assert result is not None
        assert "Volatility" in result["title"]

    def test_vol_spike_does_not_fire_below_threshold(self):
        df = _make_expanding_df()
        df.loc[df.index[-1], "rolling_8w_vol"] = 0.02
        result = rule_vol_spike(df, "Expansion", DEFAULT_THRESHOLDS)
        assert result is None


class TestProfitTaking:
    def test_mtd_profit_fires_on_outperformance(self):
        df = _make_expanding_df(n=6)
        # Returns are 2% per week, benchmark 1% → strongly outperforming
        result = rule_mtd_profit_taking(df, "Expansion", DEFAULT_THRESHOLDS)
        assert result is not None
        assert result["category"] == "Profit Taking"

    def test_mtd_profit_does_not_fire_when_underperforming(self):
        data = {
            "date": pd.date_range("2024-01-05", periods=6, freq="W-FRI").date.tolist(),
            "total_value": [100_000 - i * 1_000 for i in range(6)],
            "net_deposits": [100_000] * 6,
            "period_deposits": [0.0] * 6,
            "period_return": [-0.01] * 6,
            "benchmark_return": [0.02] * 6,
        }
        df = compute_weekly_series(pd.DataFrame(data))
        result = rule_mtd_profit_taking(df, "Expansion", DEFAULT_THRESHOLDS)
        assert result is None


class TestRunRuleEngine:
    def test_returns_list(self):
        df = _make_expanding_df()
        results = run_rule_engine(df, "Expansion", DEFAULT_THRESHOLDS)
        assert isinstance(results, list)

    def test_each_result_has_required_keys(self):
        df = _make_expanding_df()
        results = run_rule_engine(df, "Expansion", DEFAULT_THRESHOLDS)
        required = ["id", "title", "risk_level", "category", "triggers", "explanation",
                    "supporting_metrics", "actions", "confidence"]
        for rec in results:
            for key in required:
                assert key in rec, f"Missing key '{key}' in recommendation"

    def test_confidence_in_range(self):
        df = _make_expanding_df()
        results = run_rule_engine(df, "Expansion", DEFAULT_THRESHOLDS)
        for rec in results:
            assert 0.0 <= rec["confidence"] <= 1.0

    def test_defensive_regime_triggers_hold(self):
        df = _make_defensive_df()
        results = run_rule_engine(df, "Defensive", DEFAULT_THRESHOLDS)
        categories = [r["category"] for r in results]
        assert "Deployment" in categories
        titles = [r["title"] for r in results]
        assert any("Hold" in t for t in titles)
