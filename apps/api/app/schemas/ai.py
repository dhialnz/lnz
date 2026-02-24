from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field


class AISuggestionOut(BaseModel):
    action: Literal["buy", "hold", "sell"]
    ticker: str
    confidence: float = Field(..., ge=0.0, le=1.0)
    rationale: str
    size_hint: Optional[str] = None


class PortfolioInsightsOut(BaseModel):
    generated_at: datetime
    used_ai: bool
    model: str
    summary: str
    key_risks: list[str]
    key_opportunities: list[str]
    suggestions: list[AISuggestionOut]
    watchlist: list[str]
    sources: list[str]


class AIChatMessageIn(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class AIChatIn(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)
    history: list[AIChatMessageIn] = Field(default_factory=list, max_length=16)


class AIChatOut(BaseModel):
    reply: str
    used_ai: bool
    model: str
    sources: list[str]


class AIStatusOut(BaseModel):
    ai_enabled: bool
    provider: str
    model: str


class AIDashboardRecommendationOut(BaseModel):
    id: str
    created_at: datetime
    title: str
    risk_level: Literal["Low", "Medium", "High"]
    category: str
    triggers: list[str]
    explanation: str
    supporting_metrics: dict
    actions: list[str]
    confidence: float = Field(..., ge=0.0, le=1.0)


class AIDashboardRecommendationsOut(BaseModel):
    generated_at: datetime
    used_ai: bool
    model: str
    recommendations: list[AIDashboardRecommendationOut]


class AINewsSummaryOut(BaseModel):
    generated_at: datetime
    used_ai: bool
    model: str
    summary: str
