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
