from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from typing import Any

import httpx
import pandas as pd
from sqlalchemy.orm import Session

from app.config import settings
from app.models.market import NewsEvent
from app.models.portfolio import PortfolioSeries
from app.models.rulebook import Rulebook
from app.routers.holdings import get_holdings
from app.services import metrics, regime
from app.services.news_impact import (
    aggregate_top_impacted,
    impact_for_event,
    infer_sector_for_ticker,
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


async def build_ai_context(db: Session) -> dict[str, Any]:
    holdings_snapshot = await get_holdings(db=db)
    holdings = holdings_snapshot.holdings

    series_rows = db.query(PortfolioSeries).order_by(PortfolioSeries.date).all()
    summary = _build_portfolio_summary(series_rows)

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
    impacted_events = impacted_events[:30]
    top_impacted_holdings = aggregate_top_impacted(impacted_events, top_n=10)

    return {
        "generated_at": _utc_now().isoformat(),
        "summary": summary,
        "holdings_snapshot": holdings_snapshot.model_dump(),
        "holdings": [h.model_dump() for h in holdings],
        "thresholds": thresholds,
        "risk_profile": risk_profile,
        "news_events": impacted_events,
        "top_impacted_holdings": top_impacted_holdings,
    }


def _deterministic_suggestions(context: dict[str, Any]) -> list[dict[str, Any]]:
    holdings: list[dict[str, Any]] = list(context.get("holdings") or [])
    thresholds = context.get("thresholds") or {}
    concentration_trim = float(thresholds.get("concentration_trim", 0.15))

    suggestions: list[dict[str, Any]] = []

    for h in sorted(holdings, key=lambda x: float(x.get("weight") or 0.0), reverse=True):
        ticker = str(h.get("ticker"))
        weight = float(h.get("weight") or 0.0)
        pnl_pct = h.get("unrealized_pnl_pct")
        day_pct = h.get("day_change_pct")

        if weight > concentration_trim:
            suggestions.append(
                {
                    "action": "sell",
                    "ticker": ticker,
                    "confidence": 0.82,
                    "size_hint": "Trim 10-25%",
                    "rationale": (
                        f"{ticker} is above your concentration limit "
                        f"({weight * 100:.1f}% vs {concentration_trim * 100:.1f}%)."
                    ),
                }
            )
            continue

        if isinstance(pnl_pct, (int, float)) and pnl_pct > 0.55 and isinstance(day_pct, (int, float)) and day_pct < 0:
            suggestions.append(
                {
                    "action": "sell",
                    "ticker": ticker,
                    "confidence": 0.71,
                    "size_hint": "Take partial profits",
                    "rationale": f"{ticker} has large gains with short-term weakness; de-risking may help lock in profit.",
                }
            )
            continue

        if isinstance(pnl_pct, (int, float)) and pnl_pct >= 0 and isinstance(day_pct, (int, float)) and day_pct >= -0.03:
            suggestions.append(
                {
                    "action": "hold",
                    "ticker": ticker,
                    "confidence": 0.64,
                    "size_hint": None,
                    "rationale": f"{ticker} remains within normal volatility bounds versus your risk framework.",
                }
            )

    # Build sector gaps for buy candidates.
    sector_weights: dict[str, float] = {}
    for h in holdings:
        sector = infer_sector_for_ticker(str(h.get("ticker") or ""), h.get("name"))
        sector_weights[sector] = sector_weights.get(sector, 0.0) + float(h.get("weight") or 0.0)

    candidate_universe = [
        ("XLF", "financials", "adds financial sector balance"),
        ("XLV", "healthcare", "adds defensive healthcare exposure"),
        ("XLI", "industrials", "adds cyclical diversification"),
        ("VEA", "international", "adds developed international diversification"),
        ("IEMG", "emerging", "adds emerging-market diversification"),
        ("BND", "fixed_income", "adds bond ballast to reduce portfolio volatility"),
        ("GLD", "metals", "adds macro hedge for risk-off periods"),
    ]
    for ticker, sector, why in candidate_universe:
        current = sector_weights.get(sector, 0.0)
        if current < 0.08:
            suggestions.append(
                {
                    "action": "buy",
                    "ticker": ticker,
                    "confidence": 0.60,
                    "size_hint": "Starter position 3-8%",
                    "rationale": f"{ticker} {why}; current {sector} exposure is {current * 100:.1f}%.",
                }
            )

    # Keep output compact and action-balanced.
    action_rank = {"sell": 0, "hold": 1, "buy": 2}
    suggestions.sort(key=lambda x: (action_rank.get(x["action"], 9), -float(x["confidence"])))
    return suggestions[:12]


def _deterministic_insights(context: dict[str, Any]) -> dict[str, Any]:
    summary = context.get("summary") or {}
    holdings = context.get("holdings") or []
    top_news = context.get("news_events") or []
    top_impacted = context.get("top_impacted_holdings") or []
    suggestions = _deterministic_suggestions(context)

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

    sources = [f"{n.get('source')}: {n.get('headline')}" for n in top_news[:5]]
    watchlist = [s["ticker"] for s in suggestions if s["action"] == "buy"][:8]

    return {
        "generated_at": _utc_now(),
        "used_ai": False,
        "model": "deterministic-v1",
        "summary": (
            f"Portfolio is in {regime_name} regime with {len(holdings)} holdings. "
            "Suggestions prioritize risk concentration, recent momentum, and diversification gaps."
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
            return text, provider, model
    except Exception:
        return None, provider, model


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
        out.append(
            {
                "action": action,
                "ticker": ticker,
                "confidence": max(0.0, min(float(conf), 1.0)),
                "rationale": str(item.get("rationale") or "No rationale provided."),
                "size_hint": str(item.get("size_hint")) if item.get("size_hint") else None,
            }
        )
    return out


async def generate_portfolio_insights(context: dict[str, Any]) -> dict[str, Any]:
    baseline = _deterministic_insights(context)
    provider, _ = resolve_ai_provider()
    if provider == "deterministic":
        return baseline

    compact_context = {
        "summary": context.get("summary"),
        "risk_profile": context.get("risk_profile"),
        "thresholds": context.get("thresholds"),
        "top_holdings": sorted(
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
        )[:12],
        "top_news": [
            {
                "headline": n.get("headline"),
                "source": n.get("source"),
                "event_type": n.get("event_type"),
                "portfolio_impact_score": n.get("portfolio_impact_score"),
                "impacted": [h.get("ticker") for h in (n.get("impacted_holdings") or [])[:4]],
            }
            for n in (context.get("news_events") or [])[:10]
        ],
        "top_impacted_holdings": context.get("top_impacted_holdings")[:8],
    }

    messages = [
        {
            "role": "system",
            "content": (
                "You are LNZ AI portfolio copilot. Return strict JSON with keys: "
                "summary (string), key_risks (string[]), key_opportunities (string[]), "
                "suggestions (array of {action,buy|hold|sell,ticker,confidence,rationale,size_hint}), "
                "watchlist (string[]). Keep it concise, practical, and risk-aware. "
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
    return {
        "generated_at": _utc_now(),
        "used_ai": True,
        "model": used_model,
        "summary": str(parsed.get("summary") or baseline["summary"]),
        "key_risks": [str(x) for x in (parsed.get("key_risks") or baseline["key_risks"])][:6],
        "key_opportunities": [str(x) for x in (parsed.get("key_opportunities") or baseline["key_opportunities"])][:6],
        "suggestions": suggestions or baseline["suggestions"],
        "watchlist": [str(x).upper() for x in (parsed.get("watchlist") or baseline["watchlist"])][:12],
        "sources": baseline["sources"],
    }


def _fallback_chat_reply(context: dict[str, Any], message: str) -> tuple[str, list[str]]:
    msg = message.lower()
    insights = _deterministic_insights(context)
    suggestions = insights["suggestions"]
    sources = insights["sources"][:5]

    if any(k in msg for k in ["sell", "trim", "reduce"]):
        picks = [s for s in suggestions if s["action"] == "sell"][:4]
        if not picks:
            return ("No clear sell/trim candidates right now from the current rule set.", sources)
        lines = [f"- {p['ticker']}: {p['rationale']}" for p in picks]
        return ("Potential trim/sell candidates:\n" + "\n".join(lines), sources)

    if any(k in msg for k in ["buy", "etf", "stock", "add", "complement"]):
        picks = [s for s in suggestions if s["action"] == "buy"][:5]
        if not picks:
            return ("No clear buy candidates were detected from current diversification gaps.", sources)
        lines = [f"- {p['ticker']}: {p['rationale']}" for p in picks]
        return ("Potential buy candidates and portfolio fit:\n" + "\n".join(lines), sources)

    if any(k in msg for k in ["news", "impact", "headline"]):
        hot = context.get("top_impacted_holdings") or []
        if not hot:
            return ("No portfolio-impact news mapping available yet. Refresh News first.", sources)
        lines = [f"- {h['ticker']}: impact score {h['impact_score']:.2f}" for h in hot[:5]]
        return ("Most impacted holdings from current news flow:\n" + "\n".join(lines), sources)

    summary = context.get("summary") or {}
    regime_name = summary.get("regime", "Neutral")
    drawdown = summary.get("drawdown")
    dd_str = f"{drawdown * 100:.2f}%" if isinstance(drawdown, (int, float)) else "n/a"
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

    compact_context = {
        "summary": context.get("summary"),
        "risk_profile": context.get("risk_profile"),
        "top_impacted_holdings": context.get("top_impacted_holdings")[:8],
        "top_news": [
            {
                "headline": n.get("headline"),
                "portfolio_impact_score": n.get("portfolio_impact_score"),
            }
            for n in (context.get("news_events") or [])[:8]
        ],
        "top_holdings": sorted(
            [
                {"ticker": h.get("ticker"), "weight": h.get("weight")}
                for h in (context.get("holdings") or [])
            ],
            key=lambda x: float(x.get("weight") or 0.0),
            reverse=True,
        )[:10],
    }
    messages: list[dict[str, str]] = [
        {
            "role": "system",
            "content": (
                "You are LNZ AI portfolio assistant. Keep answers practical, concise, and tied to "
                "the provided portfolio context. Mention uncertainty when data is missing."
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

    sources = [
        f"{n.get('source')}: {n.get('headline')}"
        for n in (context.get("news_events") or [])[:5]
    ]
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
    baseline_recs = _baseline_dashboard_recommendations(context)
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
                "Provide 4 to 8 actionable weekly recommendations with ticker-level sizing ideas."
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
    recs = _coerce_dashboard_recommendations(parsed.get("recommendations") or parsed.get("recs"))
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
                "'What matters now', 'Holdings most impacted', 'Actionable watch items (7 days)'."
            ),
        },
        {"role": "user", "content": json.dumps(prompt_payload)},
    ]
    raw, _, used_model = await _llm_chat(messages, json_mode=False, task="news")
    if not raw:
        text = _deterministic_news_text()
        return {"generated_at": _utc_now(), "used_ai": False, "model": "deterministic-v1", "summary": text}
    return {"generated_at": _utc_now(), "used_ai": True, "model": used_model, "summary": raw.strip()}
