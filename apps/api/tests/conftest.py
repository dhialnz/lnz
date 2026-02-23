"""Shared fixtures for the test suite."""

from __future__ import annotations

import pandas as pd
import pytest


@pytest.fixture
def sample_df() -> pd.DataFrame:
    """12-week portfolio series with plausible values for unit tests."""
    data = {
        "date": pd.date_range("2024-01-05", periods=12, freq="W-FRI").date.tolist(),
        "total_value": [
            100_000, 101_500, 102_800, 101_000, 99_500, 98_200,
            97_800, 99_100, 101_300, 103_600, 105_000, 106_200,
        ],
        "net_deposits": [100_000] * 12,
        "period_deposits": [0.0] * 12,
        "period_return": [
            0.0150, 0.0130, 0.0128, -0.0175, -0.0149, -0.0131,
            -0.0041, 0.0133, 0.0222, 0.0225, 0.0135, 0.0114,
        ],
        "benchmark_return": [
            0.0100, 0.0090, 0.0080, -0.0120, -0.0100, -0.0090,
            -0.0030, 0.0100, 0.0150, 0.0180, 0.0110, 0.0090,
        ],
    }
    return pd.DataFrame(data)


@pytest.fixture
def defensive_df() -> pd.DataFrame:
    """Series configured to trigger Defensive regime."""
    data = {
        "date": pd.date_range("2024-01-05", periods=10, freq="W-FRI").date.tolist(),
        "total_value": [
            100_000, 98_000, 95_000, 92_000, 89_000,
            88_000, 87_000, 86_000, 85_500, 85_000,
        ],
        "net_deposits": [100_000] * 10,
        "period_deposits": [0.0] * 10,
        "period_return": [
            0.00, -0.0200, -0.0306, -0.0316, -0.0326,
            -0.0112, -0.0114, -0.0115, -0.0058, -0.0058,
        ],
        "benchmark_return": [
            0.01, 0.00, 0.01, 0.01, 0.01,
            0.01, 0.01, 0.01, 0.01, 0.01,
        ],
    }
    return pd.DataFrame(data)
