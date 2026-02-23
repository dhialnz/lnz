"""Tests for the core metrics computation engine."""

from __future__ import annotations

import math

import pandas as pd
import pytest

from app.services.metrics import (
    compute_rolling_beta,
    compute_summary,
    compute_volatility_ratio,
    compute_weekly_series,
)


def test_alpha_computed_correctly(sample_df):
    df = compute_weekly_series(sample_df)
    for _, row in df.iterrows():
        expected = row["period_return"] - row["benchmark_return"]
        assert abs(row["alpha"] - expected) < 1e-9


def test_cumulative_alpha_is_running_sum(sample_df):
    df = compute_weekly_series(sample_df)
    expected_cumulative = df["alpha"].cumsum().tolist()
    for i, row in df.iterrows():
        assert abs(row["cumulative_alpha"] - expected_cumulative[i]) < 1e-9


def test_rolling_4w_alpha_uses_mean_of_4(sample_df):
    df = compute_weekly_series(sample_df)
    # For the last row, alpha4 should equal mean of last 4 alphas
    last_4_alphas = df["alpha"].iloc[-4:].tolist()
    expected = sum(last_4_alphas) / 4
    assert abs(df["rolling_4w_alpha"].iloc[-1] - expected) < 1e-9


def test_rolling_8w_vol_uses_sample_stdev(sample_df):
    df = compute_weekly_series(sample_df)
    # At row 8+ we should have 8-week sample std
    import numpy as np

    last_8 = df["period_return"].iloc[-8:].tolist()
    expected = float(pd.Series(last_8).std(ddof=1))
    assert abs(df["rolling_8w_vol"].iloc[-1] - expected) < 1e-9


def test_running_peak_is_cumulative_max(sample_df):
    df = compute_weekly_series(sample_df)
    for i, row in df.iterrows():
        expected_peak = sample_df["total_value"].iloc[: i + 1].max()
        assert abs(float(row["running_peak"]) - expected_peak) < 1e-3


def test_drawdown_is_negative_or_zero(sample_df):
    df = compute_weekly_series(sample_df)
    assert (df["drawdown"] <= 0).all(), "Drawdown must be ≤ 0"


def test_drawdown_formula(sample_df):
    df = compute_weekly_series(sample_df)
    for _, row in df.iterrows():
        expected = (row["total_value"] / row["running_peak"]) - 1
        assert abs(row["drawdown"] - expected) < 1e-9


def test_beta_12w_none_when_insufficient_data():
    """Beta should be None for fewer than 12 rows."""
    data = {
        "date": pd.date_range("2024-01-05", periods=5, freq="W-FRI").date.tolist(),
        "total_value": [100_000, 101_000, 102_000, 101_500, 103_000],
        "net_deposits": [100_000] * 5,
        "period_deposits": [0.0] * 5,
        "period_return": [0.01, 0.01, 0.01, -0.005, 0.015],
        "benchmark_return": [0.008, 0.009, 0.010, -0.003, 0.012],
    }
    df = compute_weekly_series(pd.DataFrame(data))
    for val in df["beta_12w"].tolist():
        assert val is None


def test_beta_12w_computed_at_row_12(sample_df):
    df = compute_weekly_series(sample_df)
    # Row 12 (index 11) should have a non-None beta
    assert df["beta_12w"].iloc[-1] is not None
    beta = float(df["beta_12w"].iloc[-1])
    assert not math.isnan(beta)


def test_volatility_ratio_positive(sample_df):
    df = compute_weekly_series(sample_df)
    ratio = compute_volatility_ratio(df)
    assert ratio is not None
    assert ratio > 0


def test_summary_contains_all_keys(sample_df):
    df = compute_weekly_series(sample_df)
    summary = compute_summary(df)
    required = [
        "date", "total_value", "alpha_latest", "cumulative_alpha",
        "rolling_4w_alpha", "rolling_8w_vol", "running_peak",
        "drawdown", "max_drawdown", "beta_12w", "row_count",
    ]
    for key in required:
        assert key in summary, f"Missing key: {key}"


def test_summary_max_drawdown_is_minimum(sample_df):
    df = compute_weekly_series(sample_df)
    summary = compute_summary(df)
    assert summary["max_drawdown"] <= 0
    assert summary["max_drawdown"] == float(df["drawdown"].min())


def test_empty_df_returns_empty_summary():
    df = pd.DataFrame(columns=["date", "total_value", "period_return", "benchmark_return"])
    summary = compute_summary(df)
    assert summary == {}
