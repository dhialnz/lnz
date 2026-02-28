from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class PortfolioOut(BaseModel):
    id: UUID
    name: str
    is_default: bool
    is_active: bool = False
    created_at: datetime


class PortfolioCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class PortfolioActivateOut(BaseModel):
    active_portfolio_id: UUID

