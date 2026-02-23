from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel


class RecommendationOut(BaseModel):
    id: UUID
    created_at: datetime
    title: str
    risk_level: str
    category: str
    triggers: list[str]
    explanation: str
    supporting_metrics: dict[str, Any]
    actions: list[str]
    confidence: float

    model_config = {"from_attributes": True}
