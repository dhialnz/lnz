from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel


class RulebookOut(BaseModel):
    id: UUID
    thresholds: dict[str, Any]
    text: str
    updated_at: datetime

    model_config = {"from_attributes": True}


class RulebookUpdate(BaseModel):
    thresholds: dict[str, Any] | None = None
    replace_thresholds: bool = False
    text: str | None = None


class RiskQuizIn(BaseModel):
    age: int
    investment_horizon_years: int
    liquidity_needs: str  # low | medium | high
    drawdown_tolerance: str  # low | medium | high
    investing_experience: str  # beginner | intermediate | advanced


class RiskQuizRecommendationOut(BaseModel):
    profile: str
    score: int
    thresholds: dict[str, Any]
    rationale: list[str]
