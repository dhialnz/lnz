"""
Core metrics computation engine.
All functions are pure (no DB access) for ease of testing.
"""

from __future__ import annotations

from typing import Optional

import numpy as np
import pandas as pd


# ─── Individual metric helpers ─────────────────────────────────────────────────


def compute_rolling_beta(
    rp: pd.Series,
    rb: pd.Series,
    window: int = 12,
) -> pd.Series:
    """
    Rolling beta of portfolio vs benchmark.
    beta(t) = cov(Rp, Rb) / var(Rb)  over the last `window` weeks.
    Returns NaN where insufficient data exists.
    """
    betas: list[Optional[float]] = []
    for i in range(len(rp)):
        if i < window - 1:
            betas.append(None)
            continue
        rp_w = rp.iloc[i - window + 1 : i + 1].to_numpy(dtype=float)
        rb_w = rb.iloc[i - window + 1 : i + 1].to_numpy(dtype=float)
        rb_var = float(np.var(rb_w, ddof=1))
        if rb_var == 0 or np.isnan(rb_var):
            betas.append(None)
            continue
        cov = float(np.cov(rp_w, rb_w, ddof=1)[0, 1])
        betas.append(cov / rb_var)
    return pd.Series(betas, index=rp.index, dtype=object)


def compute_volatility_ratio(df: pd.DataFrame) -> Optional[float]:
    """stdev(Rp) / stdev(Rb) over the full sample. Returns None if < 2 rows."""
    if len(df) < 2:
        return None
    rp_std = float(df["period_return"].std(ddof=1))
    rb_std = float(df["benchmark_return"].std(ddof=1))
    if rb_std == 0 or np.isnan(rb_std):
        return None
    return rp_std / rb_std


# ─── Full series computation ────────────────────────────────────────────────────


def compute_weekly_series(df: pd.DataFrame) -> pd.DataFrame:
    """
    Compute all derived metrics for the full portfolio time series.

    Expected input columns:
        date, total_value, net_deposits, period_deposits,
        period_return, benchmark_return

    Returns a new DataFrame with the same rows plus computed columns.
    """
    df = df.sort_values("date").reset_index(drop=True).copy()

    # Alpha
    df["alpha"] = df["period_return"] - df["benchmark_return"]

    # Cumulative alpha
    df["cumulative_alpha"] = df["alpha"].cumsum()

    # Rolling 4-week alpha (sample mean)
    df["rolling_4w_alpha"] = df["alpha"].rolling(window=4, min_periods=1).mean()

    # Rolling 8-week volatility (sample stdev)
    df["rolling_8w_vol"] = df["period_return"].rolling(window=8, min_periods=2).std(ddof=1)

    # Rolling 8-week alpha volatility
    df["rolling_8w_alpha_vol"] = df["alpha"].rolling(window=8, min_periods=2).std(ddof=1)

    # Running peak (max Total Value up to and including t)
    df["running_peak"] = df["total_value"].cummax()

    # Drawdown: (Total Value / Peak) - 1
    df["drawdown"] = (df["total_value"] / df["running_peak"]) - 1

    # Rolling 12-week beta
    df["beta_12w"] = compute_rolling_beta(df["period_return"], df["benchmark_return"], window=12)

    return df


# ─── Summary snapshot ───────────────────────────────────────────────────────────


def compute_summary(df: pd.DataFrame) -> dict:
    """
    Return a dict of latest scalar metrics from a computed series DataFrame.
    """
    if df.empty:
        return {}

    latest = df.iloc[-1]

    def _safe(val) -> Optional[float]:
        if val is None:
            return None
        try:
            f = float(val)
            return None if np.isnan(f) else f
        except (TypeError, ValueError):
            return None

    return {
        "date": str(latest["date"]),
        "total_value": float(latest["total_value"]),
        "alpha_latest": float(latest["alpha"]),
        "cumulative_alpha": float(latest["cumulative_alpha"]),
        "rolling_4w_alpha": _safe(latest.get("rolling_4w_alpha")),
        "rolling_8w_vol": _safe(latest.get("rolling_8w_vol")),
        "rolling_8w_alpha_vol": _safe(latest.get("rolling_8w_alpha_vol")),
        "running_peak": float(latest["running_peak"]),
        "drawdown": float(latest["drawdown"]),
        "max_drawdown": float(df["drawdown"].min()),
        "beta_12w": _safe(latest.get("beta_12w")),
        "volatility_ratio": compute_volatility_ratio(df),
        "row_count": len(df),
    }
