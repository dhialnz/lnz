from __future__ import annotations

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.portfolio import PortfolioSeries
from app.models.recommendations import Recommendation
from app.models.rulebook import Rulebook, DEFAULT_THRESHOLDS
from app.models.user import User
from app.schemas.recommendations import RecommendationOut
from app.services import metrics, regime, rules
from app.services.auth_service import get_current_user
from app.services.portfolio_scope import require_active_portfolio_id

router = APIRouter(prefix="/recommendations", tags=["recommendations"])


@router.get("", response_model=list[RecommendationOut])
def get_recommendations(
    limit: int = 50,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    portfolio_id = require_active_portfolio_id(user)
    return (
        db.query(Recommendation)
        .filter(
            Recommendation.user_id == user.id,
            Recommendation.portfolio_id == portfolio_id,
        )
        .order_by(Recommendation.created_at.desc())
        .limit(limit)
        .all()
    )


@router.post("/run", response_model=list[RecommendationOut])
def run_recommendations(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    portfolio_id = require_active_portfolio_id(user)
    """Recompute metrics and re-run rule engine. Stores new recommendations."""
    rows = (
        db.query(PortfolioSeries)
        .filter(
            PortfolioSeries.user_id == user.id,
            PortfolioSeries.portfolio_id == portfolio_id,
        )
        .order_by(PortfolioSeries.date)
        .all()
    )
    if not rows:
        raise HTTPException(status_code=404, detail="No portfolio data. Import data first.")

    df = pd.DataFrame([
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
    ])

    regime_name, _ = regime.classify_regime(df)

    rb = (
        db.query(Rulebook)
        .filter(Rulebook.user_id == user.id, Rulebook.portfolio_id == portfolio_id)
        .first()
    )
    thresholds = rb.thresholds if rb else DEFAULT_THRESHOLDS

    recs_dicts = rules.run_rule_engine(df, regime_name, thresholds)
    created = []
    for r in recs_dicts:
        rec = Recommendation(
            user_id=user.id,
            portfolio_id=portfolio_id,
            title=r["title"],
            risk_level=r["risk_level"],
            category=r["category"],
            triggers=r["triggers"],
            explanation=r["explanation"],
            supporting_metrics=r["supporting_metrics"],
            actions=r["actions"],
            confidence=r["confidence"],
        )
        db.add(rec)
        created.append(rec)

    db.commit()
    for rec in created:
        db.refresh(rec)
    return created
