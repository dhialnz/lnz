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
    text: str | None = None
