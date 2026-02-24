from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.rulebook import Rulebook, DEFAULT_THRESHOLDS, DEFAULT_RULE_TEXT
from app.schemas.rulebook import (
    RiskQuizIn,
    RiskQuizRecommendationOut,
    RulebookOut,
    RulebookUpdate,
)

router = APIRouter(prefix="/rulebook", tags=["rulebook"])


def _get_or_create(db: Session) -> Rulebook:
    rb = db.query(Rulebook).first()
    if rb is None:
        rb = Rulebook(thresholds=DEFAULT_THRESHOLDS.copy(), text=DEFAULT_RULE_TEXT)
        db.add(rb)
        db.commit()
        db.refresh(rb)
    return rb


def _risk_score(payload: RiskQuizIn) -> int:
    score = 0

    # Age: younger investors usually have higher risk capacity.
    if payload.age < 35:
        score += 2
    elif payload.age < 55:
        score += 1

    # Horizon: longer horizon can typically tolerate more volatility.
    if payload.investment_horizon_years >= 15:
        score += 3
    elif payload.investment_horizon_years >= 7:
        score += 2
    elif payload.investment_horizon_years >= 3:
        score += 1

    score += {"low": 2, "medium": 1, "high": 0}.get(payload.liquidity_needs.lower(), 0)
    score += {"high": 3, "medium": 2, "low": 0}.get(payload.drawdown_tolerance.lower(), 0)
    score += {"advanced": 2, "intermediate": 1, "beginner": 0}.get(payload.investing_experience.lower(), 0)

    return max(0, min(score, 12))


def _thresholds_for_profile(profile: str) -> dict:
    # Risk profile bands are aligned to common strategic mixes used in managed portfolios:
    # conservative ~30/70, balanced ~60/40, growth ~80/20.
    if profile == "Conservative":
        return {
            "drawdown_defensive": -0.05,
            "drawdown_hard_stop": -0.08,
            "vol8_high": 0.030,
            "concentration_trim": 0.10,
            "deploy_tranche_1": 0.20,
            "deploy_tranche_2": 0.30,
            "deploy_tranche_3": 0.50,
            "expansion_drawdown": -0.02,
            "near_peak_pct": 0.015,
            "profit_taking_mtd": 0.035,
        }
    if profile == "Balanced":
        return {
            "drawdown_defensive": -0.08,
            "drawdown_hard_stop": -0.10,
            "vol8_high": 0.040,
            "concentration_trim": 0.15,
            "deploy_tranche_1": 0.30,
            "deploy_tranche_2": 0.30,
            "deploy_tranche_3": 0.40,
            "expansion_drawdown": -0.03,
            "near_peak_pct": 0.020,
            "profit_taking_mtd": 0.060,
        }
    return {
        "drawdown_defensive": -0.10,
        "drawdown_hard_stop": -0.13,
        "vol8_high": 0.055,
        "concentration_trim": 0.20,
        "deploy_tranche_1": 0.40,
        "deploy_tranche_2": 0.35,
        "deploy_tranche_3": 0.25,
        "expansion_drawdown": -0.04,
        "near_peak_pct": 0.030,
        "profit_taking_mtd": 0.090,
    }


@router.get("", response_model=RulebookOut)
def get_rulebook(db: Session = Depends(get_db)):
    return _get_or_create(db)


@router.put("", response_model=RulebookOut)
def update_rulebook(payload: RulebookUpdate, db: Session = Depends(get_db)):
    rb = _get_or_create(db)
    if payload.thresholds is not None:
        if payload.replace_thresholds:
            rb.thresholds = payload.thresholds
        else:
            # Merge: keep existing keys not in payload
            merged = {**rb.thresholds, **payload.thresholds}
            rb.thresholds = merged
    if payload.text is not None:
        rb.text = payload.text
    db.commit()
    db.refresh(rb)
    return rb


@router.post("/recommend-thresholds", response_model=RiskQuizRecommendationOut)
def recommend_thresholds(payload: RiskQuizIn):
    score = _risk_score(payload)
    if score <= 4:
        profile = "Conservative"
    elif score <= 8:
        profile = "Balanced"
    else:
        profile = "Growth"

    thresholds = _thresholds_for_profile(profile)
    rationale = [
        f"Risk score {score}/12 from age, horizon, liquidity needs, drawdown tolerance, and experience.",
        f"Profile mapped to {profile} policy settings.",
        "Thresholds are tighter for conservative profiles and wider for growth profiles.",
    ]
    return RiskQuizRecommendationOut(
        profile=profile,
        score=score,
        thresholds=thresholds,
        rationale=rationale,
    )
