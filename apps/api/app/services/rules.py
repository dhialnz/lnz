"""
Deterministic rule engine.
Each rule function returns a dict or None.
All decisions are explainable and logged via the Recommendation model.
"""

from __future__ import annotations

import math
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

import pandas as pd


def _safe(val) -> Optional[float]:
    if val is None:
        return None
    try:
        f = float(val)
        return None if math.isnan(f) else f
    except (TypeError, ValueError):
        return None


def _rec(
    title: str,
    risk_level: str,
    category: str,
    triggers: list[str],
    explanation: str,
    supporting_metrics: dict[str, Any],
    actions: list[str],
    confidence: float,
) -> dict:
    return {
        "id": str(uuid.uuid4()),
        "created_at": datetime.now(tz=timezone.utc).isoformat(),
        "title": title,
        "risk_level": risk_level,
        "category": category,
        "triggers": triggers,
        "explanation": explanation,
        "supporting_metrics": supporting_metrics,
        "actions": actions,
        "confidence": round(min(1.0, max(0.0, confidence)), 4),
    }


# ─── Deployment rules ──────────────────────────────────────────────────────────


def rule_deploy_tranche_1(
    df: pd.DataFrame,
    regime: str,
    thresholds: dict,
) -> Optional[dict]:
    """
    Recovery + alpha4 improving ≥ 2 consecutive weeks → deploy Tranche 1.
    """
    if regime != "Recovery" or len(df) < 3:
        return None

    a4_0 = _safe(df.iloc[-1].get("rolling_4w_alpha"))
    a4_1 = _safe(df.iloc[-2].get("rolling_4w_alpha"))
    a4_2 = _safe(df.iloc[-3].get("rolling_4w_alpha"))

    if None in (a4_0, a4_1, a4_2):
        return None
    # Treat stable-to-improving alpha as Recovery confirmation.
    if not (a4_0 >= a4_1 >= a4_2):  # type: ignore[operator]
        return None

    pct = int(thresholds.get("deploy_tranche_1", 0.30) * 100)
    return _rec(
        title="Deploy Tranche 1 — Recovery Confirmed",
        risk_level="Medium",
        category="Deployment",
        triggers=[
            f"Regime=Recovery",
            f"rolling_4w_alpha improving 2 consecutive weeks ({a4_2:.4f} → {a4_1:.4f} → {a4_0:.4f})",
        ],
        explanation=(
            "Portfolio is in Recovery with consistently improving alpha. "
            f"Rules indicate deploying {pct}% of available cash into the planned tranche."
        ),
        supporting_metrics={
            "regime": regime,
            "alpha4_t0": a4_0,
            "alpha4_t1": a4_1,
            "alpha4_t2": a4_2,
        },
        actions=[
            f"Deploy {pct}% of available cash into Tranche 1 per your investment plan.",
            "Prioritise lower-beta, diversified positions.",
            "Review again next week.",
        ],
        confidence=0.75,
    )


def rule_deploy_tranche_2(
    df: pd.DataFrame,
    regime: str,
    thresholds: dict,
) -> Optional[dict]:
    """
    Expansion + alpha4 positive ≥ 2 consecutive weeks → deploy Tranche 2.
    """
    if regime != "Expansion" or len(df) < 2:
        return None

    a4_0 = _safe(df.iloc[-1].get("rolling_4w_alpha"))
    a4_1 = _safe(df.iloc[-2].get("rolling_4w_alpha"))

    if None in (a4_0, a4_1):
        return None
    if not (a4_0 > 0 and a4_1 > 0):  # type: ignore[operator]
        return None

    pct = int(thresholds.get("deploy_tranche_2", 0.30) * 100)
    return _rec(
        title="Deploy Tranche 2 — Expansion Underway",
        risk_level="Low",
        category="Deployment",
        triggers=[
            "Regime=Expansion",
            f"rolling_4w_alpha > 0 for 2 consecutive weeks ({a4_1:.4f}, {a4_0:.4f})",
        ],
        explanation=(
            "Portfolio is in sustained Expansion with positive alpha. "
            f"Rules indicate deploying {pct}% of remaining cash in planned tranches."
        ),
        supporting_metrics={
            "regime": regime,
            "alpha4_t0": a4_0,
            "alpha4_t1": a4_1,
        },
        actions=[
            f"Deploy {pct}% of remaining cash into Tranche 2.",
            "Consider broader diversification into growth sleeves.",
            "Set trailing stop-losses on existing positions.",
        ],
        confidence=0.80,
    )


def rule_hold_defensive(
    df: pd.DataFrame,
    regime: str,
    thresholds: dict,
) -> Optional[dict]:
    """Defensive regime → hold cash, avoid new high-beta exposure."""
    if regime != "Defensive":
        return None

    latest = df.iloc[-1]
    dd = _safe(latest.get("drawdown"))
    alpha4 = _safe(latest.get("rolling_4w_alpha"))

    return _rec(
        title="Hold Cash — Defensive Regime",
        risk_level="High",
        category="Deployment",
        triggers=[
            "Regime=Defensive",
        ],
        explanation=(
            "Portfolio is in Defensive regime. Preserve capital. "
            "Avoid adding new high-beta exposure until Recovery conditions emerge."
        ),
        supporting_metrics={
            "regime": regime,
            "drawdown": dd,
            "rolling_4w_alpha": alpha4,
        },
        actions=[
            "Hold existing cash allocation.",
            "Do not initiate new high-beta positions.",
            "Review weekly; watch for alpha4 improvement and drawdown recovery.",
        ],
        confidence=0.90,
    )


# ─── Profit-taking rules ───────────────────────────────────────────────────────


def rule_concentration_trim(
    df: pd.DataFrame,
    regime: str,
    thresholds: dict,
    holdings: Optional[list[dict]] = None,
) -> Optional[dict]:
    """
    Any holding > concentration_trim threshold → trim 20–30%.
    Holdings data is Phase 2; stub returns None if no holdings provided.
    """
    limit = thresholds.get("concentration_trim", 0.15)

    if not holdings:
        # Phase 2: holdings not yet available
        return None

    over_concentrated = [h for h in holdings if h.get("weight", 0) > limit]
    if not over_concentrated:
        return None

    names = ", ".join(h["ticker"] for h in over_concentrated)
    return _rec(
        title="Trim Concentrated Positions",
        risk_level="Medium",
        category="Profit Taking",
        triggers=[f"Position(s) weight > {int(limit * 100)}%: {names}"],
        explanation=f"One or more positions exceed the {int(limit * 100)}% concentration limit.",
        supporting_metrics={
            "concentration_limit": limit,
            "positions": over_concentrated,
        },
        actions=[
            f"Trim 20–30% of {names} to reduce concentration.",
            "Redeploy proceeds into diversifying positions or hold as cash.",
        ],
        confidence=0.85,
    )


def rule_mtd_profit_taking(
    df: pd.DataFrame,
    regime: str,
    thresholds: dict,
) -> Optional[dict]:
    """
    Portfolio up ≥ profit_taking_mtd MTD and outperforming benchmark → reduce volatility.
    """
    min_mtd = thresholds.get("profit_taking_mtd", 0.06)

    # Approximate MTD return using last 4 rows (roughly 4 weeks ≈ month)
    lookback = min(4, len(df))
    if lookback < 2:
        return None

    window = df.iloc[-lookback:]
    mtd_portfolio = window["period_return"].sum()
    mtd_benchmark = window["benchmark_return"].sum()

    if mtd_portfolio < min_mtd:
        return None
    if mtd_portfolio <= mtd_benchmark:
        return None

    return _rec(
        title="Take Profits — MTD Outperformance",
        risk_level="Low",
        category="Profit Taking",
        triggers=[
            f"MTD portfolio return {mtd_portfolio:.2%} ≥ {min_mtd:.0%}",
            f"Outperforming benchmark by {(mtd_portfolio - mtd_benchmark):.2%}",
        ],
        explanation=(
            f"Portfolio has gained {mtd_portfolio:.2%} MTD, outperforming benchmark by "
            f"{(mtd_portfolio - mtd_benchmark):.2%}. Consider locking in gains."
        ),
        supporting_metrics={
            "mtd_portfolio_return": mtd_portfolio,
            "mtd_benchmark_return": mtd_benchmark,
            "outperformance": mtd_portfolio - mtd_benchmark,
        },
        actions=[
            "Trim the highest-beta sleeve by 20–30%.",
            "Rotate proceeds into lower-volatility holdings or cash.",
        ],
        confidence=0.70,
    )


# ─── Risk-control rules ────────────────────────────────────────────────────────


def rule_hard_stop(
    df: pd.DataFrame,
    regime: str,
    thresholds: dict,
) -> Optional[dict]:
    """Drawdown ≤ hard_stop threshold → reduce risk immediately."""
    limit = thresholds.get("drawdown_hard_stop", -0.10)
    latest = df.iloc[-1]
    dd = _safe(latest.get("drawdown"))
    if dd is None or dd > limit:
        return None

    return _rec(
        title="Hard Stop — Reduce Risk Immediately",
        risk_level="High",
        category="Risk Control",
        triggers=[f"Drawdown {dd:.2%} ≤ {limit:.0%} hard stop"],
        explanation=(
            f"Portfolio drawdown has reached {dd:.2%}, breaching the {limit:.0%} hard-stop rule. "
            "Immediate risk reduction required."
        ),
        supporting_metrics={"drawdown": dd, "hard_stop_threshold": limit},
        actions=[
            "Cut weakest-performing contributors immediately.",
            "Suspend all new deployments until drawdown recovers above −5%.",
            "Review position sizing and risk limits.",
        ],
        confidence=0.95,
    )


def rule_vol_spike(
    df: pd.DataFrame,
    regime: str,
    thresholds: dict,
) -> Optional[dict]:
    """Rolling-8w vol > vol8_high → reduce speculative exposure."""
    limit = thresholds.get("vol8_high", 0.04)
    latest = df.iloc[-1]
    vol8 = _safe(latest.get("rolling_8w_vol"))
    if vol8 is None or vol8 <= limit:
        return None

    return _rec(
        title="Volatility Spike — Reduce Speculative Exposure",
        risk_level="Medium",
        category="Risk Control",
        triggers=[f"Rolling-8w volatility {vol8:.4f} > {limit:.4f}"],
        explanation=(
            f"Rolling 8-week portfolio volatility ({vol8:.2%}) exceeds the {limit:.0%} threshold. "
            "Reduce high-volatility, speculative positions."
        ),
        supporting_metrics={"rolling_8w_vol": vol8, "vol8_high_threshold": limit},
        actions=[
            "Reduce speculative / high-vol positions by 20–40%.",
            "Increase allocation to lower-beta, defensive holdings.",
            "Monitor weekly; reassess when vol8 drops below threshold.",
        ],
        confidence=0.75,
    )


# ─── Engine entry point ────────────────────────────────────────────────────────


def run_rule_engine(
    df: pd.DataFrame,
    regime: str,
    thresholds: dict,
    holdings: Optional[list[dict]] = None,
) -> list[dict]:
    """
    Run all rules and return a list of triggered recommendation dicts.
    """
    rules = [
        rule_hold_defensive(df, regime, thresholds),
        rule_deploy_tranche_1(df, regime, thresholds),
        rule_deploy_tranche_2(df, regime, thresholds),
        rule_concentration_trim(df, regime, thresholds, holdings),
        rule_mtd_profit_taking(df, regime, thresholds),
        rule_hard_stop(df, regime, thresholds),
        rule_vol_spike(df, regime, thresholds),
    ]
    return [r for r in rules if r is not None]
