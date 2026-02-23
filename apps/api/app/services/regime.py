"""
Deterministic regime classification.
Priority: Defensive > Recovery > Expansion > Neutral
"""

from __future__ import annotations

import pandas as pd


def classify_regime(df: pd.DataFrame) -> tuple[str, str]:
    """
    Classify the portfolio regime from the computed series DataFrame.

    Returns (regime_name, explanation) where regime_name is one of:
        "Defensive", "Recovery", "Expansion", "Neutral"
    """
    if len(df) < 2:
        return "Neutral", "Insufficient data for regime classification (need ≥ 2 rows)."

    df = df.sort_values("date").reset_index(drop=True)

    latest = df.iloc[-1]
    prev = df.iloc[-2] if len(df) >= 2 else None

    alpha4 = _safe(latest.get("rolling_4w_alpha"))
    vol8_now = _safe(latest.get("rolling_8w_vol"))
    vol8_prev = _safe(prev.get("rolling_8w_vol")) if prev is not None else None
    dd = _safe(latest.get("drawdown"))
    dd_prev = _safe(prev.get("drawdown")) if prev is not None else None
    tv = float(latest["total_value"])
    peak = float(latest["running_peak"])

    # ── Defensive ─────────────────────────────────────────────────────────────
    d_triggers: list[str] = []
    if alpha4 is not None and alpha4 < 0:
        d_triggers.append(f"rolling-4w alpha {alpha4:.4f} < 0")
    if dd is not None and dd <= -0.08:
        d_triggers.append(f"drawdown {dd:.4f} ≤ −8%")
    if vol8_now is not None and vol8_prev is not None and vol8_now > vol8_prev:
        d_triggers.append(f"vol8 rising ({vol8_prev:.4f} → {vol8_now:.4f})")

    if len(d_triggers) >= 3:
        return "Defensive", "Triggers: " + "; ".join(d_triggers)

    # ── Recovery ──────────────────────────────────────────────────────────────
    r_triggers: list[str] = []

    # Alpha4 improving for 3 consecutive weeks (need at least 4 rows)
    if len(df) >= 4:
        a4_t0 = _safe(df.iloc[-1].get("rolling_4w_alpha"))
        a4_t1 = _safe(df.iloc[-2].get("rolling_4w_alpha"))
        a4_t2 = _safe(df.iloc[-3].get("rolling_4w_alpha"))
        a4_t3 = _safe(df.iloc[-4].get("rolling_4w_alpha"))
        if (
            None not in (a4_t0, a4_t1, a4_t2, a4_t3)
            and a4_t0 > a4_t1 > a4_t2 > a4_t3  # type: ignore[operator]
        ):
            r_triggers.append("alpha4 improving 3 consecutive weeks")

    if dd is not None and dd_prev is not None and dd > dd_prev:
        r_triggers.append(f"drawdown improving ({dd_prev:.4f} → {dd:.4f})")

    if vol8_now is not None and vol8_prev is not None and vol8_now <= vol8_prev:
        r_triggers.append(f"vol8 stable/declining ({vol8_prev:.4f} → {vol8_now:.4f})")

    if len(r_triggers) >= 3:
        return "Recovery", "Triggers: " + "; ".join(r_triggers)

    # ── Expansion ─────────────────────────────────────────────────────────────
    e_triggers: list[str] = []

    if len(df) >= 2:
        a4_t0 = _safe(df.iloc[-1].get("rolling_4w_alpha"))
        a4_t1 = _safe(df.iloc[-2].get("rolling_4w_alpha"))
        if a4_t0 is not None and a4_t1 is not None and a4_t0 > 0 and a4_t1 > 0:
            e_triggers.append("alpha4 > 0 for 2 consecutive weeks")

    if dd is not None and dd >= -0.03:
        e_triggers.append(f"drawdown {dd:.4f} ≥ −3%")

    near_peak = (tv >= peak * (1 - 0.02)) if peak > 0 else False
    if near_peak:
        e_triggers.append(f"total value within 2% of peak (tv={tv:.0f}, peak={peak:.0f})")

    if len(e_triggers) >= 3:
        return "Expansion", "Triggers: " + "; ".join(e_triggers)

    # ── Neutral ───────────────────────────────────────────────────────────────
    return (
        "Neutral",
        "No regime conditions fully satisfied. "
        f"alpha4={alpha4}, dd={dd}, vol8={vol8_now}",
    )


def _safe(val) -> float | None:
    if val is None:
        return None
    try:
        import math

        f = float(val)
        return None if math.isnan(f) else f
    except (TypeError, ValueError):
        return None
