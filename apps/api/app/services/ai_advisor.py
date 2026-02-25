from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Any

import httpx
import pandas as pd
from sqlalchemy.orm import Session

from app.config import settings

logger = logging.getLogger("lnz.ai_advisor")
from app.models.market import NewsEvent
from app.models.portfolio import PortfolioSeries
from app.models.rulebook import Rulebook
from app.routers.holdings import get_holdings
from app.services import metrics, regime, yahoo_quotes
from app.services.news_impact import (
    aggregate_top_impacted,
    impact_for_event,
    infer_sector_for_ticker,
)

_SERIES_TAIL_LIMIT = 24
_IMPORTANT_NEWS_LIMIT = 20
_LLM_HOLDINGS_LIMIT = 16
_LLM_NEWS_LIMIT = 16
_RECOMMENDATION_TICKER_LIMIT = 32
_TICKER_PATTERN = re.compile(r"\b[A-Z]{1,5}(?:\.[A-Z]{1,2})?\b")
_TICKER_STOPWORDS = {
    "BUY",
    "SELL",
    "HOLD",
    "TRIM",
    "ADD",
    "USD",
    "CAD",
    "AI",
    "ETF",
    "ALL",
    "NOW",
    "LOW",
    "HIGH",
}
_BUY_WORDS = ("buy", "add", "accumulate", "initiate", "overweight", "long")
_SELL_WORDS = ("sell", "trim", "reduce", "exit", "underweight", "de-risk", "derisk")
_HOLD_WORDS = ("hold", "maintain", "keep")

_EVIDENCE_REQUEST_TERMS = (
    "why",
    "reason",
    "reasoning",
    "evidence",
    "justify",
    "thesis",
    "prove",
    "support",
    "break down",
    "show your work",
)


def _utc_now() -> datetime:
    return datetime.now(tz=timezone.utc)


def resolve_ai_provider() -> tuple[str, str]:
    mode = (settings.AI_PROVIDER or "auto").strip().lower()

    if mode == "deterministic":
        return ("deterministic", "deterministic-v1")
    if mode == "gemini":
        if settings.GEMINI_API_KEY:
            return ("gemini", settings.GEMINI_MODEL)
        if settings.OPENAI_API_KEY:
            return ("openai", settings.OPENAI_MODEL)
        return ("deterministic", "deterministic-v1")
    if mode == "openai":
        if settings.OPENAI_API_KEY:
            return ("openai", settings.OPENAI_MODEL)
        if settings.GEMINI_API_KEY:
            return ("gemini", settings.GEMINI_MODEL)
        return ("deterministic", "deterministic-v1")

    # auto mode: prefer Gemini first for low-cost/free operation.
    if settings.GEMINI_API_KEY:
        return ("gemini", settings.GEMINI_MODEL)
    if settings.OPENAI_API_KEY:
        return ("openai", settings.OPENAI_MODEL)
    return ("deterministic", "deterministic-v1")


def ai_is_enabled() -> bool:
    provider, _ = resolve_ai_provider()
    return provider != "deterministic"


def _openai_model_for_task(task: str | None) -> str:
    task_key = (task or "").strip().lower()
    task_map = {
        "chat": settings.OPENAI_MODEL_CHAT,
        "insights": settings.OPENAI_MODEL_INSIGHTS,
        "dashboard": settings.OPENAI_MODEL_DASHBOARD,
        "news": settings.OPENAI_MODEL_NEWS,
    }
    selected = (task_map.get(task_key) or "").strip()
    return selected or settings.OPENAI_MODEL


def _resolve_provider_model(task: str | None = None) -> tuple[str, str]:
    provider, model = resolve_ai_provider()
    if provider == "openai":
        return provider, _openai_model_for_task(task)
    return provider, model


def _risk_profile_from_thresholds(thresholds: dict[str, Any]) -> str:
    concentration = float(thresholds.get("concentration_trim", 0.15))
    hard_stop = float(thresholds.get("drawdown_hard_stop", -0.10))
    if concentration <= 0.11 or hard_stop >= -0.09:
        return "Conservative"
    if concentration <= 0.17 or hard_stop >= -0.11:
        return "Balanced"
    return "Growth"


def _to_event_dict(row: NewsEvent) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "captured_at": row.captured_at.isoformat(),
        "headline": row.headline,
        "source": row.source,
        "url": row.url,
        "entities": list(row.entities or []),
        "event_type": row.event_type,
        "sentiment_score": row.sentiment_score,
        "volatility_score": row.volatility_score,
        "confidence": row.confidence,
        "raw_payload": row.raw_payload or {},
    }


def _build_portfolio_summary(rows: list[PortfolioSeries]) -> dict[str, Any]:
    if not rows:
        return {
            "date": None,
            "row_count": 0,
            "regime": "Neutral",
            "regime_explanation": "No historical series available yet.",
        }
    df = pd.DataFrame(
        [
            {
                "date": r.date,
                "total_value": float(r.total_value),
                "net_deposits": float(r.net_deposits),
                "period_deposits": float(r.period_deposits),
                "period_return": float(r.period_return),
                "benchmark_return": float(r.benchmark_return),
                "alpha": float(r.alpha) if r.alpha is not None else None,
                "cumulative_alpha": float(r.cumulative_alpha) if r.cumulative_alpha is not None else None,
                "rolling_4w_alpha": float(r.rolling_4w_alpha) if r.rolling_4w_alpha is not None else None,
                "rolling_8w_vol": float(r.rolling_8w_vol) if r.rolling_8w_vol is not None else None,
                "running_peak": float(r.running_peak) if r.running_peak is not None else None,
                "drawdown": float(r.drawdown) if r.drawdown is not None else None,
                "beta_12w": float(r.beta_12w) if r.beta_12w is not None else None,
            }
            for r in rows
        ]
    )
    base = metrics.compute_summary(df)
    reg_name, reg_expl = regime.classify_regime(df)
    base["regime"] = reg_name
    base["regime_explanation"] = reg_expl
    return base


def _series_tail(rows: list[PortfolioSeries], limit: int = _SERIES_TAIL_LIMIT) -> list[dict[str, Any]]:
    tail = rows[-limit:] if rows else []
    out: list[dict[str, Any]] = []
    for r in tail:
        out.append(
            {
                "date": r.date.isoformat() if hasattr(r.date, "isoformat") else str(r.date),
                "total_value": float(r.total_value),
                "net_deposits": float(r.net_deposits),
                "period_deposits": float(r.period_deposits),
                "spy_close": float(r.spy_close) if r.spy_close is not None else None,
                "period_return": float(r.period_return),
                "benchmark_return": float(r.benchmark_return),
                "alpha": float(r.alpha) if r.alpha is not None else None,
                "cumulative_alpha": float(r.cumulative_alpha) if r.cumulative_alpha is not None else None,
                "rolling_4w_alpha": float(r.rolling_4w_alpha) if r.rolling_4w_alpha is not None else None,
                "rolling_8w_vol": float(r.rolling_8w_vol) if r.rolling_8w_vol is not None else None,
                "drawdown": float(r.drawdown) if r.drawdown is not None else None,
                "beta_12w": float(r.beta_12w) if r.beta_12w is not None else None,
            }
        )
    return out


def _important_news_sources(news_events: list[dict[str, Any]], limit: int = _IMPORTANT_NEWS_LIMIT) -> list[str]:
    if not news_events:
        return []
    seen: set[str] = set()
    out: list[str] = []
    for n in news_events:
        headline = str(n.get("headline") or "").strip()
        source = str(n.get("source") or "Unknown").strip()
        url = str(n.get("url") or "").strip()
        if not headline:
            continue
        dedupe_key = f"{headline.lower()}::{url.lower() if url else source.lower()}"
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        impact = n.get("portfolio_impact_score")
        rank = n.get("rank_score")
        meta_bits: list[str] = []
        if isinstance(impact, (int, float)):
            meta_bits.append(f"impact {float(impact):.2f}")
        if isinstance(rank, (int, float)):
            meta_bits.append(f"rank {float(rank):.2f}")
        meta = f" ({', '.join(meta_bits)})" if meta_bits else ""
        url_suffix = f" | {url}" if url else ""
        out.append(f"{source}: {headline}{meta}{url_suffix}")
        if len(out) >= limit:
            break
    return out


def _llm_context_top_holdings(holdings: list[dict[str, Any]], limit: int = _LLM_HOLDINGS_LIMIT) -> list[dict[str, Any]]:
    return sorted(
        [
            {
                "ticker": h.get("ticker"),
                "name": h.get("name"),
                "weight": h.get("weight"),
                "shares": h.get("shares"),
                "total_value": h.get("total_value"),
                "total_cost_basis": h.get("total_cost_basis"),
                "avg_cost_per_share": h.get("avg_cost_per_share"),
                "avg_cost_per_share_usd": h.get("avg_cost_per_share_usd"),
                "current_price": h.get("current_price"),
                "unrealized_pnl_pct": h.get("unrealized_pnl_pct"),
                "day_change_pct": h.get("day_change_pct"),
            }
            for h in holdings
        ],
        key=lambda x: float(x.get("weight") or 0.0),
        reverse=True,
    )[:limit]


def _llm_context_top_news(news_events: list[dict[str, Any]], limit: int = _LLM_NEWS_LIMIT) -> list[dict[str, Any]]:
    return [
        {
            "headline": n.get("headline"),
            "source": n.get("source"),
            "url": n.get("url"),
            "event_type": n.get("event_type"),
            "portfolio_impact_score": n.get("portfolio_impact_score"),
            "rank_score": n.get("rank_score"),
            "sentiment_score": n.get("sentiment_score"),
            "volatility_score": n.get("volatility_score"),
            "impacted": [
                {
                    "ticker": h.get("ticker"),
                    "direction": h.get("direction"),
                    "impact_score": h.get("impact_score"),
                    "reason": h.get("reason"),
                }
                for h in (n.get("impacted_holdings") or [])[:5]
            ],
        }
        for n in news_events[:limit]
    ]


def _llm_compact_context(context: dict[str, Any]) -> dict[str, Any]:
    holdings_snapshot = context.get("holdings_snapshot") or {}
    holdings_totals = context.get("holdings_totals") or {}
    return {
        "summary": context.get("summary"),
        "risk_profile": context.get("risk_profile"),
        "thresholds": context.get("thresholds"),
        "series_tail": (context.get("series_tail") or [])[-_SERIES_TAIL_LIMIT:],
        "holdings_totals": {
            "total_value": holdings_totals.get("total_value"),
            "total_cost_basis": holdings_totals.get("total_cost_basis"),
            "total_unrealized_pnl": holdings_totals.get("total_unrealized_pnl"),
            "total_unrealized_pnl_pct": holdings_totals.get("total_unrealized_pnl_pct"),
            "total_day_change": holdings_totals.get("total_day_change"),
            "total_day_change_pct": holdings_totals.get("total_day_change_pct"),
        },
        "holdings_snapshot": {
            "as_of": holdings_snapshot.get("as_of"),
            "sharpe_30d": holdings_snapshot.get("sharpe_30d"),
            "sortino_30d": holdings_snapshot.get("sortino_30d"),
        },
        "top_holdings": _llm_context_top_holdings(list(context.get("holdings") or [])),
        "top_news": _llm_context_top_news(list(context.get("news_events") or [])),
        "top_impacted_holdings": list(context.get("top_impacted_holdings") or [])[:12],
        "important_sources": list(context.get("important_sources") or [])[:_IMPORTANT_NEWS_LIMIT],
        # Quantitative signals derived from history — ground suggestions in data, not just LLM intuition
        "portfolio_signals": _compute_portfolio_signals(context),
        "holding_signals": _compute_holding_signals(context),
    }


def _window_avg_delta(
    values: list[float], window: int = 4
) -> tuple[float | None, float | None, float | None]:
    """
    Return (recent_avg, prior_avg, delta) where delta = recent_avg - prior_avg.
    If there is not enough history for prior window, prior_avg and delta are None.
    """
    clean = [float(v) for v in values if isinstance(v, (int, float))]
    if not clean:
        return None, None, None
    recent = clean[-window:] if len(clean) >= window else clean
    recent_avg = sum(recent) / len(recent) if recent else None
    if len(clean) < window + 1:
        return recent_avg, None, None
    prior = clean[-(2 * window) : -window] if len(clean) >= 2 * window else clean[: -window]
    if not prior:
        return recent_avg, None, None
    prior_avg = sum(prior) / len(prior)
    return recent_avg, prior_avg, (recent_avg - prior_avg)


def _trend_from_delta(delta: float | None, flat_band: float) -> str:
    if delta is None:
        return "unknown"
    if delta > flat_band:
        return "improving"
    if delta < -flat_band:
        return "deteriorating"
    return "stable"


def _trend_from_delta_labels(
    delta: float | None,
    flat_band: float,
    positive_label: str,
    negative_label: str,
    stable_label: str = "stable",
) -> str:
    if delta is None:
        return "unknown"
    if delta > flat_band:
        return positive_label
    if delta < -flat_band:
        return negative_label
    return stable_label


def _compute_portfolio_signals(context: dict[str, Any]) -> dict[str, Any]:
    """
    Derive quantitative signals from the portfolio series tail.
    These ground suggestions in historical data rather than pure LLM intuition.
    """
    series_tail = list(context.get("series_tail") or [])
    summary = context.get("summary") or {}

    if len(series_tail) < 2:
        return {"weeks_of_history": len(series_tail)}

    # Alpha win rate over available history
    alphas = [float(r["alpha"]) for r in series_tail if r.get("alpha") is not None]
    win_rate = sum(1 for a in alphas if a > 0) / len(alphas) if alphas else 0.0

    # 4-week momentum vs prior 4-week block
    recent4 = alphas[-4:] if len(alphas) >= 4 else alphas
    prior4 = alphas[-8:-4] if len(alphas) >= 8 else []
    recent_avg = sum(recent4) / len(recent4) if recent4 else 0.0
    prior_avg = sum(prior4) / len(prior4) if prior4 else 0.0
    if recent_avg > prior_avg + 0.005:
        momentum_trend = "improving"
    elif recent_avg < prior_avg - 0.005:
        momentum_trend = "declining"
    else:
        momentum_trend = "flat"

    # Volatility trend
    vols = [float(r["rolling_8w_vol"]) for r in series_tail if r.get("rolling_8w_vol") is not None]
    vol_recent = vols[-1] if vols else None
    vol_baseline = sum(vols) / len(vols) if vols else None
    if vol_recent and vol_baseline and vol_recent > vol_baseline * 1.15:
        vol_trend = "elevated"
    elif vol_recent and vol_baseline and vol_recent < vol_baseline * 0.85:
        vol_trend = "subsiding"
    else:
        vol_trend = "stable"

    # Consecutive weeks below-benchmark (losing streak)
    losing_streak = 0
    for r in reversed(series_tail):
        if (r.get("alpha") or 0.0) < 0:
            losing_streak += 1
        else:
            break

    # Weeks spent in a drawdown > 2%
    dd_weeks = sum(1 for r in series_tail if (r.get("drawdown") or 0.0) < -0.02)

    # Outperformance frequency last 8 weeks
    last8 = series_tail[-8:]
    beats_spy_last8 = sum(1 for r in last8 if (r.get("alpha") or 0.0) > 0)

    period_returns = [float(r["period_return"]) for r in series_tail if r.get("period_return") is not None]
    benchmark_returns = [float(r["benchmark_return"]) for r in series_tail if r.get("benchmark_return") is not None]
    rolling_alpha = [float(r["rolling_4w_alpha"]) for r in series_tail if r.get("rolling_4w_alpha") is not None]
    betas = [float(r["beta_12w"]) for r in series_tail if r.get("beta_12w") is not None]
    drawdowns = [float(r["drawdown"]) for r in series_tail if r.get("drawdown") is not None]

    pr_recent, pr_prior, pr_delta = _window_avg_delta(period_returns, window=4)
    bm_recent, bm_prior, bm_delta = _window_avg_delta(benchmark_returns, window=4)
    alpha_recent, alpha_prior, alpha_delta = _window_avg_delta(alphas, window=4)
    roll_alpha_recent, roll_alpha_prior, roll_alpha_delta = _window_avg_delta(rolling_alpha, window=4)
    vol_recent_avg, vol_prior_avg, vol_delta = _window_avg_delta(vols, window=4)
    beta_recent, beta_prior, beta_delta = _window_avg_delta(betas, window=4)
    dd_recent, dd_prior, dd_delta = _window_avg_delta(drawdowns, window=4)

    return {
        "alpha_win_rate_pct": round(win_rate * 100, 1),
        "recent_4w_alpha_avg_pct": round(recent_avg * 100, 3),
        "prior_4w_alpha_avg_pct": round(prior_avg * 100, 3),
        "momentum_trend": momentum_trend,
        "volatility_trend": vol_trend,
        "current_drawdown_pct": round(float(summary.get("drawdown") or 0.0) * 100, 2),
        "consecutive_negative_alpha_weeks": losing_streak,
        "weeks_in_drawdown_gt2pct": dd_weeks,
        "beats_spy_last_8_of_8": beats_spy_last8,
        "weeks_of_history": len(series_tail),
        # 4-week comparative block used by AI summary quality
        "period_return_recent_4w_avg_pct": round(pr_recent * 100, 3) if pr_recent is not None else None,
        "period_return_prior_4w_avg_pct": round(pr_prior * 100, 3) if pr_prior is not None else None,
        "period_return_4w_delta_pct_points": round(pr_delta * 100, 3) if pr_delta is not None else None,
        "period_return_trend": _trend_from_delta_labels(pr_delta, 0.002, "improving", "deteriorating"),
        "benchmark_return_recent_4w_avg_pct": round(bm_recent * 100, 3) if bm_recent is not None else None,
        "benchmark_return_prior_4w_avg_pct": round(bm_prior * 100, 3) if bm_prior is not None else None,
        "benchmark_return_4w_delta_pct_points": round(bm_delta * 100, 3) if bm_delta is not None else None,
        "alpha_recent_4w_avg_pct": round(alpha_recent * 100, 3) if alpha_recent is not None else None,
        "alpha_prior_4w_avg_pct": round(alpha_prior * 100, 3) if alpha_prior is not None else None,
        "alpha_4w_delta_pct_points": round(alpha_delta * 100, 3) if alpha_delta is not None else None,
        "rolling_4w_alpha_recent_pct": round(roll_alpha_recent * 100, 3) if roll_alpha_recent is not None else None,
        "rolling_4w_alpha_prior_pct": round(roll_alpha_prior * 100, 3) if roll_alpha_prior is not None else None,
        "rolling_4w_alpha_delta_pct_points": round(roll_alpha_delta * 100, 3) if roll_alpha_delta is not None else None,
        "rolling_8w_vol_recent_pct": round(vol_recent_avg * 100, 3) if vol_recent_avg is not None else None,
        "rolling_8w_vol_prior_pct": round(vol_prior_avg * 100, 3) if vol_prior_avg is not None else None,
        "rolling_8w_vol_delta_pct_points": round(vol_delta * 100, 3) if vol_delta is not None else None,
        "rolling_8w_vol_4w_trend": _trend_from_delta_labels(vol_delta, 0.001, "elevating", "subsiding"),
        "beta_12w_recent": round(beta_recent, 3) if beta_recent is not None else None,
        "beta_12w_prior": round(beta_prior, 3) if beta_prior is not None else None,
        "beta_12w_delta": round(beta_delta, 3) if beta_delta is not None else None,
        "beta_12w_trend": _trend_from_delta_labels(beta_delta, 0.05, "higher", "lower"),
        "drawdown_recent_4w_avg_pct": round(dd_recent * 100, 3) if dd_recent is not None else None,
        "drawdown_prior_4w_avg_pct": round(dd_prior * 100, 3) if dd_prior is not None else None,
        "drawdown_4w_delta_pct_points": round(dd_delta * 100, 3) if dd_delta is not None else None,
        "drawdown_trend": _trend_from_delta_labels(dd_delta, 0.003, "improving", "deteriorating"),
    }


def _portfolio_change_lens_text(context: dict[str, Any], signals: dict[str, Any] | None = None) -> str:
    sig = signals or _compute_portfolio_signals(context)
    weeks = int(sig.get("weeks_of_history") or 0)
    if weeks < 4:
        return "Insufficient history for a robust 4-week change comparison."

    def _fmt(val: Any, digits: int = 2, suffix: str = "") -> str:
        if not isinstance(val, (int, float)):
            return "n/a"
        sign = "+" if float(val) > 0 else ""
        return f"{sign}{float(val):.{digits}f}{suffix}"

    alpha_delta = _fmt(sig.get("alpha_4w_delta_pct_points"), 2, "pp")
    roll_alpha_delta = _fmt(sig.get("rolling_4w_alpha_delta_pct_points"), 2, "pp")
    vol_delta = _fmt(sig.get("rolling_8w_vol_delta_pct_points"), 2, "pp")
    beta_delta = _fmt(sig.get("beta_12w_delta"), 2, "")
    dd_delta = _fmt(sig.get("drawdown_4w_delta_pct_points"), 2, "pp")
    trend_alpha = str(sig.get("momentum_trend") or "flat")
    trend_vol = str(sig.get("rolling_8w_vol_4w_trend") or sig.get("volatility_trend") or "stable")
    trend_beta = str(sig.get("beta_12w_trend") or "stable")
    trend_dd = str(sig.get("drawdown_trend") or "stable")

    return (
        "4-week change vs prior 4 weeks: "
        f"avg alpha {alpha_delta} ({trend_alpha}), "
        f"rolling alpha {roll_alpha_delta}, "
        f"8-week vol {vol_delta} ({trend_vol}), "
        f"beta {beta_delta} ({trend_beta}), "
        f"drawdown {dd_delta} ({trend_dd})."
    )


def _compute_holding_signals(context: dict[str, Any]) -> list[dict[str, Any]]:
    """
    Per-holding quantitative signal assessment used to ground suggestion rationales.
    """
    holdings = list(context.get("holdings") or [])
    top_impacted = list(context.get("top_impacted_holdings") or [])
    thresholds = context.get("thresholds") or {}
    concentration_trim = float(thresholds.get("concentration_trim", 0.15))

    impacted_map: dict[str, dict[str, Any]] = {
        str(h.get("ticker") or "").upper(): h for h in top_impacted if h.get("ticker")
    }

    signals: list[dict[str, Any]] = []
    for h in holdings:
        ticker = str(h.get("ticker") or "").upper()
        weight = float(h.get("weight") or 0.0)
        pnl_pct = h.get("unrealized_pnl_pct")
        day_pct = h.get("day_change_pct")
        news = impacted_map.get(ticker)

        signal_types: list[str] = []
        risk_score = 2  # 1 = low, 5 = critical

        if weight > concentration_trim:
            signal_types.append("concentration")
            risk_score = max(risk_score, 4)

        if isinstance(pnl_pct, (int, float)):
            if pnl_pct > 0.45:
                signal_types.append("profit_taking")
                risk_score = max(risk_score, 3)
            elif pnl_pct < -0.15:
                signal_types.append("stop_loss")
                risk_score = max(risk_score, 4)

        if isinstance(day_pct, (int, float)):
            if day_pct < -0.04:
                signal_types.append("negative_momentum")
                risk_score = max(risk_score, 3)
            elif day_pct > 0.03:
                signal_types.append("positive_momentum")

        if news:
            direction = str(news.get("direction") or "mixed")
            impact_score = float(news.get("impact_score") or 0.0)
            if direction == "negative" and impact_score > 0.25:
                signal_types.append("news_risk")
                risk_score = max(risk_score, 3)
            elif direction == "positive" and impact_score > 0.25:
                signal_types.append("news_tailwind")

        if not signal_types:
            signal_types.append("steady")

        signals.append({
            "ticker": ticker,
            "weight_pct": round(weight * 100, 1),
            "unrealized_pnl_pct": round(float(pnl_pct) * 100, 1) if isinstance(pnl_pct, (int, float)) else None,
            "day_change_pct": round(float(day_pct) * 100, 2) if isinstance(day_pct, (int, float)) else None,
            "signal_types": signal_types,
            "risk_score": risk_score,
            "news_catalyst": str(news.get("reason") or "") if news else None,
            "news_direction": str(news.get("direction") or "") if news else None,
        })

    return signals


def _sanitize_for_llm(value: Any, max_len: int = 200) -> Any:
    """
    Recursively sanitize user-controlled data before embedding in LLM prompts.
    Truncates long strings and strips role-injection attempts.
    """
    if isinstance(value, str):
        # Strip common injection patterns
        cleaned = re.sub(r"(?i)\b(system|user|assistant)\s*:", "  ", value)
        cleaned = cleaned.replace("</s>", "").replace("<|im_end|>", "")
        return cleaned[:max_len]
    if isinstance(value, dict):
        return {k: _sanitize_for_llm(v, max_len) for k, v in value.items()}
    if isinstance(value, list):
        return [_sanitize_for_llm(item, max_len) for item in value]
    return value


def _wants_reasoning_evidence(message: str) -> bool:
    lower = (message or "").strip().lower()
    if not lower:
        return False
    return any(term in lower for term in _EVIDENCE_REQUEST_TERMS)


def _extract_ticker_candidates(text: str) -> list[str]:
    if not text:
        return []
    out: list[str] = []
    seen: set[str] = set()
    for match in _TICKER_PATTERN.findall(text.upper()):
        if match in _TICKER_STOPWORDS:
            continue
        if match in seen:
            continue
        seen.add(match)
        out.append(match)
    return out


def _recommendation_intent(rec: dict[str, Any]) -> str:
    corpus = " ".join(
        [
            str(rec.get("title") or ""),
            str(rec.get("explanation") or ""),
            *[str(x) for x in (rec.get("actions") or [])],
            *[str(x) for x in (rec.get("triggers") or [])],
        ]
    ).lower()
    if any(word in corpus for word in _SELL_WORDS):
        return "sell"
    if any(word in corpus for word in _BUY_WORDS):
        return "buy"
    if any(word in corpus for word in _HOLD_WORDS):
        return "hold"
    return "neutral"


def _format_pct(value: float | None, digits: int = 2) -> str:
    if not isinstance(value, (int, float)):
        return "n/a"
    return f"{float(value) * 100:.{digits}f}%"


def _format_num(value: float | None, digits: int = 2) -> str:
    if not isinstance(value, (int, float)):
        return "n/a"
    return f"{float(value):.{digits}f}"


def _append_unique_action(actions: list[str], line: str) -> list[str]:
    if not line:
        return actions
    if line in actions:
        return actions
    return [*actions, line]


def _extract_recommendation_tickers(rec: dict[str, Any]) -> list[str]:
    chunks = [
        str(rec.get("title") or ""),
        str(rec.get("explanation") or ""),
        *[str(x) for x in (rec.get("actions") or [])],
        *[str(x) for x in (rec.get("triggers") or [])],
    ]
    out: list[str] = []
    seen: set[str] = set()
    for chunk in chunks:
        for ticker in _extract_ticker_candidates(chunk):
            if ticker in seen:
                continue
            seen.add(ticker)
            out.append(ticker)
    return out


def _enriched_recommendation(
    rec: dict[str, Any],
    *,
    primary_ticker: str,
    intent: str,
    research: dict[str, Any],
) -> dict[str, Any]:
    quote = dict(research.get("quote") or {})
    technical = dict(research.get("technical") or {})
    fundamental = dict(research.get("fundamental") or {})

    rsi14 = technical.get("rsi14")
    ma20_gap_pct = technical.get("ma20_gap_pct")
    momentum_20d_pct = technical.get("momentum_20d_pct")
    trailing_pe = fundamental.get("trailing_pe")
    forward_pe = fundamental.get("forward_pe")

    technical_lines: list[str] = []
    if isinstance(rsi14, (int, float)):
        if rsi14 > 70:
            technical_lines.append(f"RSI14 {_format_num(rsi14)} (overbought)")
        elif rsi14 < 35:
            technical_lines.append(f"RSI14 {_format_num(rsi14)} (oversold)")
        else:
            technical_lines.append(f"RSI14 {_format_num(rsi14)} (neutral)")
    if isinstance(ma20_gap_pct, (int, float)):
        technical_lines.append(f"price vs MA20 {_format_pct(ma20_gap_pct)}")
    if isinstance(momentum_20d_pct, (int, float)):
        technical_lines.append(f"20d momentum {_format_pct(momentum_20d_pct)}")

    fundamental_lines: list[str] = []
    if isinstance(trailing_pe, (int, float)):
        fundamental_lines.append(f"trailing P/E {_format_num(trailing_pe)}")
    if isinstance(forward_pe, (int, float)):
        fundamental_lines.append(f"forward P/E {_format_num(forward_pe)}")
    if isinstance(fundamental.get("price_to_book"), (int, float)):
        fundamental_lines.append(f"P/B {_format_num(fundamental.get('price_to_book'))}")
    if isinstance(fundamental.get("market_cap"), (int, float)):
        fundamental_lines.append(f"mcap ${float(fundamental.get('market_cap')):,.0f}")

    explanation = str(rec.get("explanation") or "").strip()
    explanation_tail_parts: list[str] = []
    if technical_lines:
        explanation_tail_parts.append("Technical: " + "; ".join(technical_lines[:3]) + ".")
    if fundamental_lines:
        explanation_tail_parts.append("Fundamental: " + "; ".join(fundamental_lines[:3]) + ".")
    if explanation_tail_parts:
        explanation = (explanation + " " + " ".join(explanation_tail_parts)).strip()

    actions = [str(x) for x in (rec.get("actions") or []) if str(x).strip()]
    if intent == "buy":
        actions = _append_unique_action(
            actions,
            f"Validate {primary_ticker} entry against RSI/MA trend and valuation before sizing.",
        )
    elif intent == "sell":
        actions = _append_unique_action(
            actions,
            f"Re-check {primary_ticker} downside catalysts and support levels before trimming.",
        )

    metrics = dict(rec.get("supporting_metrics") or {})
    metrics.update(
        {
            "validated_ticker": primary_ticker,
            "yahoo_validation": True,
            "resolved_ticker": research.get("resolved_ticker"),
            "current_price_usd": quote.get("current_price"),
            "day_change_pct": quote.get("day_change_pct"),
            "rsi14": rsi14,
            "ma20_gap_pct": ma20_gap_pct,
            "momentum_20d_pct": momentum_20d_pct,
            "trailing_pe": trailing_pe,
            "forward_pe": forward_pe,
            "price_to_book": fundamental.get("price_to_book"),
            "market_cap": fundamental.get("market_cap"),
            "beta": fundamental.get("beta"),
            "profit_margin": fundamental.get("profit_margin"),
        }
    )

    triggers = [str(x) for x in (rec.get("triggers") or []) if str(x).strip()]
    if "yahoo-validated" not in triggers:
        triggers.append("yahoo-validated")
    if intent == "buy" and "fund-tech-screened" not in triggers:
        triggers.append("fund-tech-screened")

    out = dict(rec)
    out["explanation"] = explanation
    out["actions"] = actions
    out["triggers"] = triggers
    out["supporting_metrics"] = metrics
    return out


async def _validate_and_enrich_recommendations_with_yahoo(
    recs: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    if not recs:
        return []

    ticker_candidates_by_idx: list[list[str]] = []
    all_candidates: list[str] = []
    for rec in recs:
        candidates = _extract_recommendation_tickers(rec)[:4]
        ticker_candidates_by_idx.append(candidates)
        all_candidates.extend(candidates)

    # Keep network bounded.
    limited_candidates: list[str] = []
    seen: set[str] = set()
    for ticker in all_candidates:
        if ticker in seen:
            continue
        seen.add(ticker)
        limited_candidates.append(ticker)
        if len(limited_candidates) >= _RECOMMENDATION_TICKER_LIMIT:
            break

    research_map: dict[str, dict[str, Any] | None] = {}
    if limited_candidates:
        try:
            research_map = await yahoo_quotes.fetch_batch_research(limited_candidates)
            valid_count = sum(1 for v in research_map.values() if v)
            logger.info(
                "Yahoo validation: %d candidates, %d valid", len(limited_candidates), valid_count
            )
        except Exception as exc:
            logger.error("Yahoo batch research failed: %s", exc)
            research_map = {}

    enriched: list[dict[str, Any]] = []
    for idx, rec in enumerate(recs):
        intent = _recommendation_intent(rec)
        candidates = ticker_candidates_by_idx[idx] if idx < len(ticker_candidates_by_idx) else []
        valid = [t for t in candidates if research_map.get(t)]

        # Drop hallucinated buy ideas that cannot be verified on Yahoo.
        if intent == "buy" and not valid:
            continue

        if valid:
            primary = valid[0]
            enriched.append(
                _enriched_recommendation(
                    rec,
                    primary_ticker=primary,
                    intent=intent,
                    research=dict(research_map.get(primary) or {}),
                )
            )
            continue

        rec_copy = dict(rec)
        metrics = dict(rec_copy.get("supporting_metrics") or {})
        metrics["yahoo_validation"] = False
        rec_copy["supporting_metrics"] = metrics
        enriched.append(rec_copy)

    return enriched[:10]


async def build_ai_context(db: Session) -> dict[str, Any]:
    holdings_snapshot = await get_holdings(db=db)
    holdings = holdings_snapshot.holdings

    series_rows = db.query(PortfolioSeries).order_by(PortfolioSeries.date).all()
    summary = _build_portfolio_summary(series_rows)
    series_tail = _series_tail(series_rows)

    rulebook = db.query(Rulebook).first()
    thresholds = dict((rulebook.thresholds if rulebook else {}) or {})
    risk_profile = _risk_profile_from_thresholds(thresholds)

    news_rows = db.query(NewsEvent).order_by(NewsEvent.captured_at.desc()).limit(80).all()
    news_events = [_to_event_dict(r) for r in news_rows]
    impacted_events: list[dict[str, Any]] = []
    for e in news_events:
        impact = impact_for_event(e, holdings)
        impacted_events.append({**e, **impact})
    impacted_events.sort(
        key=lambda e: (
            float(e.get("portfolio_impact_score") or 0.0),
            float(e.get("rank_score") or 0.0),
            e.get("captured_at") or "",
        ),
        reverse=True,
    )
    impacted_events = impacted_events[:40]
    top_impacted_holdings = aggregate_top_impacted(impacted_events, top_n=12)
    important_sources = _important_news_sources(impacted_events, limit=_IMPORTANT_NEWS_LIMIT)
    holdings_snapshot_dict = holdings_snapshot.model_dump()

    return {
        "generated_at": _utc_now().isoformat(),
        "summary": summary,
        "series_tail": series_tail,
        "holdings_snapshot": holdings_snapshot_dict,
        "holdings": [h.model_dump() for h in holdings],
        "holdings_totals": {
            "total_value": holdings_snapshot_dict.get("total_value"),
            "total_cost_basis": holdings_snapshot_dict.get("total_cost_basis"),
            "total_unrealized_pnl": holdings_snapshot_dict.get("total_unrealized_pnl"),
            "total_unrealized_pnl_pct": holdings_snapshot_dict.get("total_unrealized_pnl_pct"),
            "total_day_change": holdings_snapshot_dict.get("total_day_change"),
            "total_day_change_pct": holdings_snapshot_dict.get("total_day_change_pct"),
        },
        "thresholds": thresholds,
        "risk_profile": risk_profile,
        "news_events": impacted_events,
        "top_impacted_holdings": top_impacted_holdings,
        "important_sources": important_sources,
    }


def _deterministic_suggestions(context: dict[str, Any]) -> list[dict[str, Any]]:
    holdings: list[dict[str, Any]] = list(context.get("holdings") or [])
    thresholds = context.get("thresholds") or {}
    concentration_trim = float(thresholds.get("concentration_trim", 0.15))
    summary = context.get("summary") or {}
    regime = str(summary.get("regime") or "Neutral")
    top_impacted = list(context.get("top_impacted_holdings") or [])
    portfolio_signals = _compute_portfolio_signals(context)

    impacted_map: dict[str, dict[str, Any]] = {
        str(h.get("ticker") or "").upper(): h for h in top_impacted if h.get("ticker")
    }

    suggestions: list[dict[str, Any]] = []
    covered_tickers: set[str] = set()

    for h in sorted(holdings, key=lambda x: float(x.get("weight") or 0.0), reverse=True):
        ticker = str(h.get("ticker") or "").upper()
        weight = float(h.get("weight") or 0.0)
        pnl_pct = h.get("unrealized_pnl_pct")
        day_pct = h.get("day_change_pct")
        news = impacted_map.get(ticker)
        weight_str = f"{weight * 100:.1f}%"
        pnl_str = f"{float(pnl_pct) * 100:.1f}%" if isinstance(pnl_pct, (int, float)) else "n/a"
        news_catalyst = str(news.get("reason") or "") if news else None

        # --- SELL signals ---
        # 1. Concentration breach
        if weight > concentration_trim:
            catalyst = news_catalyst or f"Weight {weight_str} exceeds {concentration_trim * 100:.1f}% limit"
            suggestions.append({
                "action": "sell",
                "ticker": ticker,
                "confidence": 0.85,
                "size_hint": f"Trim to below {concentration_trim * 100:.0f}%",
                "rationale": (
                    f"{ticker} at {weight_str} of portfolio breaches your concentration rule "
                    f"({concentration_trim * 100:.1f}% limit). Unrealized P&L: {pnl_str}. "
                    f"Trimming reduces idiosyncratic risk."
                ),
                "signal_type": "concentration",
                "time_horizon": "short",
                "risk_score": 4,
                "catalyst": catalyst,
            })
            covered_tickers.add(ticker)
            continue

        # 2. Negative news + meaningful loss — stop-loss territory
        if (news and str(news.get("direction") or "") == "negative"
                and float(news.get("impact_score") or 0) > 0.3
                and isinstance(pnl_pct, (int, float)) and pnl_pct < -0.08):
            suggestions.append({
                "action": "sell",
                "ticker": ticker,
                "confidence": 0.76,
                "size_hint": "Reduce or exit; reassess thesis",
                "rationale": (
                    f"{ticker} is down {pnl_str} unrealized with active negative news impact "
                    f"(score {float(news.get('impact_score', 0)):.2f}). "
                    f"Catalyst: {news_catalyst or 'negative news flow'}."
                ),
                "signal_type": "news",
                "time_horizon": "short",
                "risk_score": 4,
                "catalyst": news_catalyst,
            })
            covered_tickers.add(ticker)
            continue

        # 3. Profit-take: large gain + price reversal
        if isinstance(pnl_pct, (int, float)) and pnl_pct > 0.50 and isinstance(day_pct, (int, float)) and day_pct < -0.01:
            suggestions.append({
                "action": "sell",
                "ticker": ticker,
                "confidence": 0.73,
                "size_hint": "Take partial profits (10-20%)",
                "rationale": (
                    f"{ticker} is up {pnl_str} unrealized and showing short-term reversal "
                    f"(today {float(day_pct) * 100:.2f}%). Locking in gains while momentum fades is risk-prudent."
                ),
                "signal_type": "momentum",
                "time_horizon": "short",
                "risk_score": 3,
                "catalyst": news_catalyst,
            })
            covered_tickers.add(ticker)
            continue

        # --- HOLD signals ---
        if ticker not in covered_tickers:
            if isinstance(pnl_pct, (int, float)) and pnl_pct >= 0 and isinstance(day_pct, (int, float)) and day_pct >= -0.03:
                hold_rationale = f"{ticker} is up {pnl_str} with stable daily momentum — within risk framework."
                if news and str(news.get("direction") or "") == "positive":
                    hold_rationale += f" News tailwind: {news_catalyst or 'positive sentiment'}."
                suggestions.append({
                    "action": "hold",
                    "ticker": ticker,
                    "confidence": 0.66,
                    "size_hint": None,
                    "rationale": hold_rationale,
                    "signal_type": "steady" if not news else "news",
                    "time_horizon": "medium",
                    "risk_score": 2,
                    "catalyst": news_catalyst if news else None,
                })
                covered_tickers.add(ticker)

    # --- BUY candidates: regime-aware diversification gaps ---
    sector_weights: dict[str, float] = {}
    for h in holdings:
        sector = infer_sector_for_ticker(str(h.get("ticker") or ""), h.get("name"))
        sector_weights[sector] = sector_weights.get(sector, 0.0) + float(h.get("weight") or 0.0)

    momentum_trend = portfolio_signals.get("momentum_trend", "flat")
    is_defensive_regime = regime in ("Defensive",)
    is_recovery_regime = regime in ("Recovery", "Expansion")

    # Regime-adjusted universe: lead with defensive assets in downturns
    if is_defensive_regime:
        candidate_universe = [
            ("BND", "fixed_income", "bond ballast reduces vol in defensive regimes", "diversification", "medium", 1),
            ("GLD", "metals", "gold hedge strengthens in risk-off macro", "regime", "medium", 2),
            ("XLV", "healthcare", "defensive healthcare is recession-resilient", "fundamental", "long", 2),
            ("XLF", "financials", "financial sector adds rebalancing optionality", "diversification", "long", 3),
            ("VEA", "international", "developed-market diversification", "diversification", "long", 2),
        ]
    elif is_recovery_regime:
        candidate_universe = [
            ("XLI", "industrials", "industrials lead cyclical recoveries", "regime", "medium", 3),
            ("XLF", "financials", "financials benefit from rate normalisation", "fundamental", "medium", 3),
            ("VEA", "international", "international equities re-rate early in recovery", "fundamental", "long", 2),
            ("IEMG", "emerging", "EM growth accelerates in recovery phase", "fundamental", "long", 3),
            ("BND", "fixed_income", "bond allocation adds downside buffer", "diversification", "long", 1),
            ("GLD", "metals", "inflation hedge remains relevant", "regime", "long", 2),
        ]
    else:
        candidate_universe = [
            ("XLF", "financials", "adds financial sector balance", "diversification", "long", 2),
            ("XLV", "healthcare", "adds defensive healthcare exposure", "diversification", "long", 2),
            ("XLI", "industrials", "adds cyclical diversification", "diversification", "long", 3),
            ("VEA", "international", "adds developed international diversification", "diversification", "long", 2),
            ("IEMG", "emerging", "adds emerging-market growth exposure", "diversification", "long", 3),
            ("BND", "fixed_income", "adds bond ballast to reduce portfolio volatility", "diversification", "medium", 1),
            ("GLD", "metals", "adds macro hedge for risk-off periods", "regime", "medium", 2),
        ]

    for ticker, sector, why, signal_type, horizon, risk in candidate_universe:
        current = sector_weights.get(sector, 0.0)
        if current < 0.08:
            regime_note = f" Regime is {regime}." if regime != "Neutral" else ""
            momentum_note = f" Portfolio momentum is {momentum_trend}." if momentum_trend != "flat" else ""
            suggestions.append({
                "action": "buy",
                "ticker": ticker,
                "confidence": 0.62 if momentum_trend == "declining" else 0.68,
                "size_hint": "Starter position 3-8%",
                "rationale": (
                    f"{ticker} {why}. Current {sector} exposure is only {current * 100:.1f}%."
                    f"{regime_note}{momentum_note}"
                ),
                "signal_type": signal_type,
                "time_horizon": horizon,
                "risk_score": risk,
                "catalyst": None,
            })

    action_rank = {"sell": 0, "hold": 1, "buy": 2}
    suggestions.sort(key=lambda x: (action_rank.get(x["action"], 9), -float(x["confidence"])))
    return suggestions[:14]


def _deterministic_insights(context: dict[str, Any]) -> dict[str, Any]:
    summary = context.get("summary") or {}
    holdings = context.get("holdings") or []
    top_news = context.get("news_events") or []
    top_impacted = context.get("top_impacted_holdings") or []
    suggestions = _deterministic_suggestions(context)
    portfolio_signals = _compute_portfolio_signals(context)
    change_lens = _portfolio_change_lens_text(context, portfolio_signals)

    regime_name = summary.get("regime", "Neutral")
    drawdown = summary.get("drawdown")
    vol8 = summary.get("rolling_8w_vol")

    risk_lines = []
    if isinstance(drawdown, (int, float)):
        risk_lines.append(f"Current drawdown is {drawdown * 100:.2f}%.")
    if isinstance(vol8, (int, float)):
        risk_lines.append(f"8-week volatility is {vol8 * 100:.2f}%.")
    if top_impacted:
        hottest = ", ".join([h["ticker"] for h in top_impacted[:3]])
        risk_lines.append(f"Most news-exposed holdings right now: {hottest}.")
    if not risk_lines:
        risk_lines.append("Insufficient portfolio history for full risk diagnostics.")

    opp_lines = []
    if suggestions:
        buy_tickers = [s["ticker"] for s in suggestions if s["action"] == "buy"][:4]
        if buy_tickers:
            opp_lines.append("Diversification candidates: " + ", ".join(buy_tickers) + ".")
    if top_news:
        opp_lines.append("Monitor top-ranked headlines before rebalancing decisions.")
    if not opp_lines:
        opp_lines.append("No clear opportunity cluster detected from current data.")

    sources = list(context.get("important_sources") or _important_news_sources(top_news))
    watchlist = [s["ticker"] for s in suggestions if s["action"] == "buy"][:8]

    return {
        "generated_at": _utc_now(),
        "used_ai": False,
        "model": "deterministic-v1",
        "summary": (
            f"Portfolio is in {regime_name} regime with {len(holdings)} holdings. "
            f"{change_lens} Suggestions prioritize risk concentration, recent momentum, and diversification gaps."
        ),
        "key_risks": risk_lines[:5],
        "key_opportunities": opp_lines[:5],
        "suggestions": suggestions,
        "watchlist": watchlist,
        "sources": sources,
    }


def _extract_text_content(data: dict[str, Any]) -> str | None:
    choices = data.get("choices")
    if not isinstance(choices, list) or not choices:
        return None
    first = choices[0] or {}
    message = first.get("message") if isinstance(first, dict) else {}
    if not isinstance(message, dict):
        return None
    content = message.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        chunks: list[str] = []
        for part in content:
            if isinstance(part, dict):
                text = part.get("text")
                if isinstance(text, str):
                    chunks.append(text)
        if chunks:
            return "\n".join(chunks)
    return None


def _extract_json_object(text: str) -> dict[str, Any] | None:
    raw = text.strip()
    # Handle markdown-wrapped JSON from providers.
    fence_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", raw, flags=re.IGNORECASE | re.DOTALL)
    if fence_match:
        raw = fence_match.group(1).strip()
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass

    # Fallback: parse from first '{' to last '}'.
    start = raw.find("{")
    end = raw.rfind("}")
    if start >= 0 and end > start:
        try:
            parsed = json.loads(raw[start : end + 1])
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            return None
    return None


async def _llm_chat(
    messages: list[dict[str, str]],
    *,
    json_mode: bool,
    task: str | None = None,
) -> tuple[str | None, str, str]:
    provider, model = _resolve_provider_model(task)
    if provider == "deterministic":
        return None, provider, model

    if provider == "gemini":
        api_key = settings.GEMINI_API_KEY
        base_url = settings.GEMINI_BASE_URL
    else:
        api_key = settings.OPENAI_API_KEY
        base_url = settings.OPENAI_BASE_URL

    if not api_key:
        return None, "deterministic", "deterministic-v1"

    url = base_url.rstrip("/") + "/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": 0.2,
    }
    # Keep strict JSON mode for OpenAI; Gemini compatibility may return
    # markdown-wrapped JSON, which we parse safely below.
    if json_mode and provider == "openai":
        payload["response_format"] = {"type": "json_object"}

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.post(url, headers=headers, json=payload)
            res.raise_for_status()
            data = res.json()
            text = _extract_text_content(data)
            logger.debug("LLM call succeeded: provider=%s model=%s task=%s", provider, model, task)
            return text, provider, model
    except httpx.TimeoutException:
        logger.warning("LLM call timed out: provider=%s model=%s task=%s", provider, model, task)
        return None, provider, model
    except httpx.HTTPStatusError as exc:
        logger.warning(
            "LLM HTTP error: provider=%s model=%s task=%s status=%d",
            provider, model, task, exc.response.status_code,
        )
        return None, provider, model
    except Exception as exc:
        logger.error("LLM call failed unexpectedly: provider=%s task=%s error=%s", provider, task, exc)
        return None, provider, model


_VALID_SIGNAL_TYPES = {"momentum", "fundamental", "news", "regime", "concentration", "diversification", "stop_loss", "profit_taking", "steady"}
_VALID_TIME_HORIZONS = {"short", "medium", "long"}


def _safe_suggestions(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    out: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        action = str(item.get("action") or "").lower()
        ticker = str(item.get("ticker") or "").upper()
        if action not in {"buy", "hold", "sell"} or not ticker:
            continue
        conf = item.get("confidence")
        if not isinstance(conf, (int, float)):
            conf = 0.5
        # New enriched fields — pass through if valid, otherwise sensible defaults
        signal_type_raw = str(item.get("signal_type") or "").lower()
        signal_type = signal_type_raw if signal_type_raw in _VALID_SIGNAL_TYPES else "fundamental"
        time_horizon_raw = str(item.get("time_horizon") or "").lower()
        time_horizon = time_horizon_raw if time_horizon_raw in _VALID_TIME_HORIZONS else "medium"
        risk_score_raw = item.get("risk_score")
        risk_score = int(risk_score_raw) if isinstance(risk_score_raw, (int, float)) and 1 <= risk_score_raw <= 5 else 3
        catalyst_raw = item.get("catalyst")
        catalyst = str(catalyst_raw)[:300] if catalyst_raw else None
        out.append(
            {
                "action": action,
                "ticker": ticker,
                "confidence": max(0.0, min(float(conf), 1.0)),
                "rationale": str(item.get("rationale") or "No rationale provided."),
                "size_hint": str(item.get("size_hint")) if item.get("size_hint") else None,
                "signal_type": signal_type,
                "time_horizon": time_horizon,
                "risk_score": risk_score,
                "catalyst": catalyst,
            }
        )
    return out


async def _validate_suggestions_and_watchlist(
    suggestions: list[dict[str, Any]],
    watchlist: list[str],
) -> tuple[list[dict[str, Any]], list[str]]:
    candidates = [str(s.get("ticker") or "").upper() for s in suggestions] + [str(t).upper() for t in watchlist]
    unique: list[str] = []
    seen: set[str] = set()
    for ticker in candidates:
        if not ticker or ticker in seen:
            continue
        seen.add(ticker)
        unique.append(ticker)
        if len(unique) >= _RECOMMENDATION_TICKER_LIMIT:
            break
    if not unique:
        return suggestions, watchlist

    try:
        validation = await yahoo_quotes.fetch_batch_research(unique)
    except Exception:
        return suggestions, watchlist

    valid = {ticker for ticker, data in validation.items() if data}
    clean_suggestions = [s for s in suggestions if str(s.get("ticker") or "").upper() in valid]
    clean_watchlist = [t for t in watchlist if str(t).upper() in valid]
    return clean_suggestions, clean_watchlist


async def generate_portfolio_insights(context: dict[str, Any]) -> dict[str, Any]:
    baseline = _deterministic_insights(context)
    portfolio_signals = _compute_portfolio_signals(context)
    change_lens = _portfolio_change_lens_text(context, portfolio_signals)
    provider, _ = resolve_ai_provider()
    if provider == "deterministic":
        return baseline

    # Sanitize user-controlled fields before embedding in LLM prompt.
    compact_context = _sanitize_for_llm(_llm_compact_context(context))

    messages = [
        {
            "role": "system",
            "content": (
                "You are LNZ AI portfolio copilot. "
                "The user's portfolio context includes: a summary with regime and drawdown, "
                "a series_tail of weekly performance, holdings with weights and unrealized P&L, "
                "news events ranked by portfolio impact, and two computed signal objects: "
                "'portfolio_signals' (alpha win rate, momentum trend, volatility trend, losing streak) "
                "and 'holding_signals' (per-holding risk scores, news catalysts, signal types). "
                "In the top summary, explicitly compare current 4 weeks vs prior 4 weeks "
                "for alpha, rolling alpha, volatility, beta, and drawdown, and state directional change. "
                "Use ALL of these to form grounded, data-driven suggestions. "
                "Return strict JSON with keys: "
                "summary (string), key_risks (string[]), key_opportunities (string[]), "
                "suggestions (array of objects — see schema below), watchlist (string[]). "
                "Each suggestion object must have: "
                "{action: 'buy'|'hold'|'sell', ticker: string, confidence: float 0-1, "
                "rationale: string (cite specific metrics, weights, or news from the context), "
                "size_hint: string|null (e.g. 'Trim 15%', 'Add 3-5%', 'Hold full position'), "
                "signal_type: 'momentum'|'fundamental'|'news'|'regime'|'concentration'|'diversification'|'stop_loss'|'profit_taking', "
                "time_horizon: 'short'|'medium'|'long', "
                "risk_score: integer 1-5 (1=low risk, 5=critical), "
                "catalyst: string|null (the specific metric, news headline, or trigger for this signal)}. "
                "For sell/trim: reference the holding's current weight and unrealized P&L from top_holdings. "
                "For buy: explain why this ticker fits THIS portfolio's gaps given current regime and signals. "
                "Do not be agreeable by default; form independent professional judgments. "
                "When portfolio_signals show declining momentum or elevated volatility, reflect that in risk scores. "
                "If history is short, acknowledge limits but still compare available windows. "
                "Return raw JSON only with no markdown."
            ),
        },
        {"role": "user", "content": json.dumps(compact_context)},
    ]
    raw, _, used_model = await _llm_chat(messages, json_mode=True, task="insights")
    if not raw:
        return baseline

    parsed = _extract_json_object(raw)
    if not parsed:
        return baseline

    suggestions = _safe_suggestions(parsed.get("suggestions"))
    parsed_watchlist = [str(x).upper() for x in (parsed.get("watchlist") or baseline["watchlist"])][:12]
    clean_suggestions, clean_watchlist = await _validate_suggestions_and_watchlist(
        suggestions or baseline["suggestions"],
        parsed_watchlist,
    )
    parsed_summary = str(parsed.get("summary") or baseline["summary"]).strip()
    if change_lens and change_lens not in parsed_summary:
        parsed_summary = f"{parsed_summary} {change_lens}".strip()

    return {
        "generated_at": _utc_now(),
        "used_ai": True,
        "model": used_model,
        "summary": parsed_summary,
        "key_risks": [str(x) for x in (parsed.get("key_risks") or baseline["key_risks"])][:6],
        "key_opportunities": [str(x) for x in (parsed.get("key_opportunities") or baseline["key_opportunities"])][:6],
        "suggestions": clean_suggestions or baseline["suggestions"],
        "watchlist": clean_watchlist or baseline["watchlist"],
        "sources": baseline["sources"],
    }


def _fallback_chat_reply(context: dict[str, Any], message: str) -> tuple[str, list[str]]:
    msg = message.lower()
    wants_evidence = _wants_reasoning_evidence(message)
    insights = _deterministic_insights(context)
    suggestions = insights["suggestions"]
    sources = list(context.get("important_sources") or insights["sources"])[:_IMPORTANT_NEWS_LIMIT]

    if any(k in msg for k in ["sell", "trim", "reduce"]):
        picks = [s for s in suggestions if s["action"] == "sell"][:4]
        if not picks:
            return ("No clear sell/trim candidates right now from the current rule set.", sources)
        lines = [f"- {p['ticker']}: {p['rationale']}" for p in picks]
        if wants_evidence:
            evidence_lines = [f"- {s}" for s in sources[:5]]
            return (
                "Verdict\nPotential trim/sell candidates.\n\nReasoning\n"
                + "\n".join(lines)
                + "\n\nEvidence\n"
                + "\n".join(evidence_lines or ["- Portfolio thresholds and latest impact-ranked headlines."]),
                sources,
            )
        return ("Potential trim/sell candidates:\n" + "\n".join(lines), sources)

    if any(k in msg for k in ["buy", "etf", "stock", "add", "complement"]):
        picks = [s for s in suggestions if s["action"] == "buy"][:5]
        if not picks:
            return ("No clear buy candidates were detected from current diversification gaps.", sources)
        lines = [f"- {p['ticker']}: {p['rationale']}" for p in picks]
        if wants_evidence:
            evidence_lines = [f"- {s}" for s in sources[:5]]
            return (
                "Verdict\nPotential buy candidates and portfolio fit.\n\nReasoning\n"
                + "\n".join(lines)
                + "\n\nEvidence\n"
                + "\n".join(evidence_lines or ["- Portfolio diversification gaps and latest impact-ranked headlines."]),
                sources,
            )
        return ("Potential buy candidates and portfolio fit:\n" + "\n".join(lines), sources)

    if any(k in msg for k in ["news", "impact", "headline"]):
        hot = context.get("top_impacted_holdings") or []
        if not hot:
            return ("No portfolio-impact news mapping available yet. Refresh News first.", sources)
        lines = [f"- {h['ticker']}: impact score {h['impact_score']:.2f}" for h in hot[:5]]
        if wants_evidence:
            evidence_lines = [f"- {s}" for s in sources[:5]]
            return (
                "Verdict\nMost impacted holdings from current news flow.\n\nReasoning\n"
                + "\n".join(lines)
                + "\n\nEvidence\n"
                + "\n".join(evidence_lines or ["- Impact-ranked headlines mapped to your holdings."]),
                sources,
            )
        return ("Most impacted holdings from current news flow:\n" + "\n".join(lines), sources)

    summary = context.get("summary") or {}
    regime_name = summary.get("regime", "Neutral")
    drawdown = summary.get("drawdown")
    vol8 = summary.get("rolling_8w_vol")
    dd_str = f"{drawdown * 100:.2f}%" if isinstance(drawdown, (int, float)) else "n/a"
    vol_str = f"{vol8 * 100:.2f}%" if isinstance(vol8, (int, float)) else "n/a"
    if wants_evidence:
        evidence_lines = [f"- {s}" for s in sources[:5]]
        return (
            (
                "Verdict\nPortfolio is not in a low-risk state by default; evaluate concentration and drawdown before adding risk.\n\n"
                f"Reasoning\n- Regime: {regime_name}\n- Drawdown: {dd_str}\n- 8-week volatility: {vol_str}\n\n"
                "Evidence\n"
                + "\n".join(evidence_lines or ["- Portfolio summary metrics and ranked headline set."])
            ),
            sources,
        )
    return (
        (
            f"Portfolio quick read: regime={regime_name}, drawdown={dd_str}. "
            "I can break this down into sell/hold/buy actions, news impact by holding, "
            "or diversification candidates if you ask specifically."
        ),
        sources,
    )


async def chat_with_portfolio(
    context: dict[str, Any], message: str, history: list[dict[str, str]]
) -> dict[str, Any]:
    provider, _ = resolve_ai_provider()
    if provider == "deterministic":
        reply, sources = _fallback_chat_reply(context, message)
        return {
            "reply": reply,
            "used_ai": False,
            "model": "deterministic-v1",
            "sources": sources,
        }

    # Sanitize user-controlled context data before embedding in LLM prompt.
    compact_context = _sanitize_for_llm(_llm_compact_context(context))
    evidence_mode = _wants_reasoning_evidence(message)
    response_style = (
        "If the user asks for evidence/reasoning, answer with sections exactly: "
        "'Verdict', 'Reasoning', 'Evidence'. In Evidence, cite concrete metrics and top sources from context."
        if evidence_mode
        else "Default to a concise answer. Include only the strongest 2-4 data-backed points."
    )
    messages: list[dict[str, str]] = [
        {
            "role": "system",
            "content": (
                "You are LNZ AI portfolio assistant. Use the provided portfolio context deeply, including "
                "weekly series trends, holdings details, risk thresholds, and ranked news impact. "
                "Form an independent professional opinion; do not agree with the user by default. "
                "If user assumptions conflict with the data, say so directly and explain why. "
                "Ground claims in explicit numbers and provided source headlines/URLs. "
                "Do not invent external research. Mention uncertainty when data is missing. "
                + response_style
            ),
        },
        {"role": "system", "content": "Portfolio context JSON:\n" + json.dumps(compact_context)},
    ]
    for h in history[-8:]:
        role = h.get("role")
        content = h.get("content")
        if role in {"user", "assistant"} and isinstance(content, str):
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": message})

    raw, _, used_model = await _llm_chat(messages, json_mode=False, task="chat")
    if not raw:
        reply, sources = _fallback_chat_reply(context, message)
        return {
            "reply": reply,
            "used_ai": False,
            "model": "deterministic-v1",
            "sources": sources,
        }

    sources = list(context.get("important_sources") or _important_news_sources(list(context.get("news_events") or [])))
    return {
        "reply": raw.strip(),
        "used_ai": True,
        "model": used_model,
        "sources": sources,
    }


def _baseline_dashboard_recommendations(context: dict[str, Any]) -> list[dict[str, Any]]:
    deterministic = _deterministic_suggestions(context)
    now = _utc_now()
    rows: list[dict[str, Any]] = []
    for s in deterministic:
        action = str(s.get("action") or "hold").upper()
        ticker = str(s.get("ticker") or "MKT").upper()
        rows.append(
            {
                "id": str(uuid.uuid4()),
                "created_at": now,
                "title": f"{action} {ticker}",
                "risk_level": "Medium",
                "category": "News/Macro" if action == "HOLD" else "Deployment",
                "triggers": [f"deterministic-{action.lower()}"],
                "explanation": str(s.get("rationale") or "No rationale provided."),
                "supporting_metrics": {"size_hint": s.get("size_hint")},
                "actions": [str(s.get("rationale") or f"Review {ticker} exposure.")],
                "confidence": float(s.get("confidence") or 0.5),
            }
        )
    return rows[:8]


def _normalize_risk_level(value: Any) -> str:
    v = str(value or "").strip().lower()
    if v.startswith("h"):
        return "High"
    if v.startswith("m"):
        return "Medium"
    return "Low"


def _coerce_dashboard_recommendations(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for row in raw:
        if not isinstance(row, dict):
            continue
        title = str(row.get("title") or "").strip()
        explanation = str(row.get("explanation") or "").strip()
        actions = [str(x) for x in (row.get("actions") or []) if str(x).strip()]
        if not title or not explanation or not actions:
            continue
        triggers = [str(x) for x in (row.get("triggers") or []) if str(x).strip()]
        supporting_metrics = row.get("supporting_metrics") if isinstance(row.get("supporting_metrics"), dict) else {}
        conf = row.get("confidence")
        conf_val = float(conf) if isinstance(conf, (int, float)) else 0.5
        out.append(
            {
                "id": str(uuid.uuid4()),
                "created_at": _utc_now(),
                "title": title,
                "risk_level": _normalize_risk_level(row.get("risk_level")),
                "category": str(row.get("category") or "Deployment"),
                "triggers": triggers,
                "explanation": explanation,
                "supporting_metrics": supporting_metrics,
                "actions": actions,
                "confidence": max(0.0, min(conf_val, 1.0)),
            }
        )
    return out[:10]


async def generate_dashboard_recommendations(context: dict[str, Any]) -> dict[str, Any]:
    baseline_raw = _baseline_dashboard_recommendations(context)
    baseline_recs = await _validate_and_enrich_recommendations_with_yahoo(baseline_raw)
    if not baseline_recs:
        baseline_recs = baseline_raw
    provider, _ = resolve_ai_provider()
    if provider == "deterministic":
        return {
            "generated_at": _utc_now(),
            "used_ai": False,
            "model": "deterministic-v1",
            "recommendations": baseline_recs,
        }

    compact_context = {
        "summary": context.get("summary"),
        "risk_profile": context.get("risk_profile"),
        "thresholds": context.get("thresholds"),
        "holdings": sorted(
            [
                {
                    "ticker": h.get("ticker"),
                    "weight": h.get("weight"),
                    "unrealized_pnl_pct": h.get("unrealized_pnl_pct"),
                    "day_change_pct": h.get("day_change_pct"),
                }
                for h in (context.get("holdings") or [])
            ],
            key=lambda x: float(x.get("weight") or 0.0),
            reverse=True,
        )[:16],
        "top_news": [
            {
                "headline": n.get("headline"),
                "source": n.get("source"),
                "event_type": n.get("event_type"),
                "portfolio_impact_score": n.get("portfolio_impact_score"),
                "impacted": [h.get("ticker") for h in (n.get("impacted_holdings") or [])[:5]],
            }
            for n in (context.get("news_events") or [])[:16]
        ],
    }
    messages = [
        {
            "role": "system",
            "content": (
                "You are an institutional portfolio optimizer. Return strict JSON with key 'recommendations'. "
                "Each recommendation must include: title, risk_level (Low/Medium/High), category, triggers (string[]), "
                "explanation, supporting_metrics (object), actions (string[]), confidence (0..1). "
                "Provide 4 to 8 actionable weekly recommendations with ticker-level sizing ideas. "
                "Be opinionated and evidence-driven from the supplied data; do not be agreeable by default."
            ),
        },
        {"role": "user", "content": json.dumps(compact_context)},
    ]
    raw, _, used_model = await _llm_chat(messages, json_mode=True, task="dashboard")
    if not raw:
        return {
            "generated_at": _utc_now(),
            "used_ai": False,
            "model": "deterministic-v1",
            "recommendations": baseline_recs,
        }

    parsed = _extract_json_object(raw)
    if not parsed:
        return {
            "generated_at": _utc_now(),
            "used_ai": False,
            "model": "deterministic-v1",
            "recommendations": baseline_recs,
        }
    recs_raw = _coerce_dashboard_recommendations(parsed.get("recommendations") or parsed.get("recs"))
    if not recs_raw:
        recs = baseline_recs
    else:
        recs = await _validate_and_enrich_recommendations_with_yahoo(recs_raw)
        if not recs:
            recs = baseline_recs
    return {
        "generated_at": _utc_now(),
        "used_ai": True,
        "model": used_model,
        "recommendations": recs,
    }


async def generate_news_summary(context: dict[str, Any]) -> dict[str, Any]:
    provider, _ = resolve_ai_provider()
    top_news = list(context.get("news_events") or [])[:12]
    top_impacted = list(context.get("top_impacted_holdings") or [])[:10]
    summary = context.get("summary") or {}

    def _deterministic_news_text() -> str:
        if not top_news:
            return "What matters now\n- No major portfolio-impact events detected yet.\n\nHoldings most impacted\n- None\n\nActionable watch items (7 days)\n- Refresh news feed after market close."
        bullets = []
        for e in top_news[:3]:
            bullets.append(f"- {e.get('headline')} ({e.get('source')})")
        impacted = []
        for h in top_impacted[:3]:
            impacted.append(f"- {h.get('ticker')}: {h.get('reason')}")
        watch = []
        for e in top_news[:3]:
            impacted_tickers = [i.get("ticker") for i in (e.get("impacted_holdings") or [])[:2]]
            if impacted_tickers:
                watch.append(f"- Track {', '.join(impacted_tickers)} into next session.")
        return (
            "What matters now\n"
            + "\n".join(bullets or ["- No dominant catalyst this cycle."])
            + "\n\nHoldings most impacted\n"
            + "\n".join(impacted or ["- None"])
            + "\n\nActionable watch items (7 days)\n"
            + "\n".join(watch or ["- Reassess top exposures before weekly rebalance."])
        )

    if provider == "deterministic":
        text = _deterministic_news_text()
        return {"generated_at": _utc_now(), "used_ai": False, "model": "deterministic-v1", "summary": text}

    prompt_payload = {
        "portfolio_summary": {
            "regime": summary.get("regime"),
            "drawdown": summary.get("drawdown"),
            "rolling_8w_vol": summary.get("rolling_8w_vol"),
        },
        "thresholds": context.get("thresholds") or {},
        "top_news": [
            {
                "headline": e.get("headline"),
                "source": e.get("source"),
                "event_type": e.get("event_type"),
                "impact_score": e.get("portfolio_impact_score"),
                "rank_score": e.get("rank_score"),
                "sentiment": e.get("sentiment_score"),
                "impacted": [
                    {
                        "ticker": h.get("ticker"),
                        "direction": h.get("direction"),
                        "impact_score": h.get("impact_score"),
                        "reason": h.get("reason"),
                    }
                    for h in (e.get("impacted_holdings") or [])[:5]
                ],
            }
            for e in top_news
        ],
        "top_impacted_holdings": top_impacted,
    }
    messages = [
        {
            "role": "system",
            "content": (
                "You are a portfolio news analyst. Produce a concise weekly-impact brief as plain text. "
                "Use exactly three sections with these headings: "
                "'What matters now', 'Holdings most impacted', 'Actionable watch items (7 days)'. "
                "Make independent judgments from the provided portfolio and news data."
            ),
        },
        {"role": "user", "content": json.dumps(prompt_payload)},
    ]
    raw, _, used_model = await _llm_chat(messages, json_mode=False, task="news")
    if not raw:
        text = _deterministic_news_text()
        return {"generated_at": _utc_now(), "used_ai": False, "model": "deterministic-v1", "summary": text}
    return {"generated_at": _utc_now(), "used_ai": True, "model": used_model, "summary": raw.strip()}
