from __future__ import annotations

from datetime import datetime
from typing import Any, Optional
from uuid import UUID

from pydantic import BaseModel


class MarketSnapshotOut(BaseModel):
    id: UUID
    captured_at: datetime
    payload: dict[str, Any]

    model_config = {"from_attributes": True}


class NewsEventOut(BaseModel):
    id: UUID
    captured_at: datetime
    headline: str
    source: str
    url: Optional[str]
    entities: list[str]
    event_type: str
    sentiment_score: Optional[float]
    volatility_score: Optional[float]
    confidence: Optional[float]
    raw_payload: dict[str, Any]

    model_config = {"from_attributes": True}


class HoldingImpactOut(BaseModel):
    ticker: str
    name: Optional[str]
    weight: Optional[float]
    impact_score: float
    direction: str
    reason: str


class NewsEventImpactOut(BaseModel):
    event: NewsEventOut
    rank_score: float
    portfolio_impact_score: float
    net_sentiment_impact: Optional[float]
    impacted_holdings: list[HoldingImpactOut]


class NewsPortfolioImpactOut(BaseModel):
    generated_at: datetime
    events: list[NewsEventImpactOut]
    top_impacted_holdings: list[HoldingImpactOut]
