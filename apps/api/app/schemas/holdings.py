from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

CurrencyCode = Literal["USD", "CAD"]


class SparklinePoint(BaseModel):
    date: str
    close: float


class HoldingIn(BaseModel):
    ticker: str = Field(..., min_length=1, max_length=16)
    shares: float = Field(..., gt=0)
    avg_cost_per_share: float = Field(..., gt=0)
    avg_cost_currency: CurrencyCode = Field(default="USD")
    notes: Optional[str] = None

    @field_validator("ticker", mode="before")
    @classmethod
    def uppercase_ticker(cls, v: str) -> str:
        return v.strip().upper()

    @field_validator("avg_cost_currency", mode="before")
    @classmethod
    def normalize_currency(cls, v: str) -> str:
        c = (v or "USD").strip().upper()
        if c not in {"USD", "CAD"}:
            raise ValueError("avg_cost_currency must be USD or CAD")
        return c


class HoldingOut(BaseModel):
    id: uuid.UUID
    ticker: str
    name: Optional[str]
    shares: float
    avg_cost_per_share: float
    avg_cost_currency: CurrencyCode
    notes: Optional[str]
    added_at: datetime
    model_config = {"from_attributes": True}


class HoldingLive(BaseModel):
    id: uuid.UUID
    ticker: str
    name: Optional[str]
    shares: float
    avg_cost_per_share: float
    avg_cost_currency: CurrencyCode
    avg_cost_per_share_usd: Optional[float]
    notes: Optional[str]
    added_at: datetime

    # Live market data (None if price unavailable)
    current_price: Optional[float]
    day_change: Optional[float]
    day_change_pct: Optional[float]
    week_change: Optional[float] = None
    week_change_pct: Optional[float] = None
    month_change: Optional[float] = None
    month_change_pct: Optional[float] = None
    year_change: Optional[float] = None
    year_change_pct: Optional[float] = None

    # Computed fields
    total_cost_basis: float
    total_value: Optional[float]
    unrealized_pnl: Optional[float]
    unrealized_pnl_pct: Optional[float]
    weight: Optional[float]  # fraction of total portfolio value (0-1)

    sparkline: list[SparklinePoint]

    model_config = {"from_attributes": True}


class HoldingsSnapshot(BaseModel):
    holdings: list[HoldingLive]

    total_cost_basis: float
    total_value: Optional[float]
    total_unrealized_pnl: Optional[float]
    total_unrealized_pnl_pct: Optional[float]
    total_day_change: Optional[float]
    total_day_change_pct: Optional[float]
    total_week_change: Optional[float] = None
    total_week_change_pct: Optional[float] = None
    total_month_change: Optional[float] = None
    total_month_change_pct: Optional[float] = None
    total_year_change: Optional[float] = None
    total_year_change_pct: Optional[float] = None

    sharpe_30d: Optional[float]
    sortino_30d: Optional[float]

    # True when CAD-cost holdings are present but the CAD/USD rate is unavailable.
    # Cost-basis figures may be slightly inaccurate until FX data recovers.
    fx_warning: bool = False

    as_of: str  # ISO UTC timestamp of the price fetch


class TickerSuggestion(BaseModel):
    symbol: str
    name: Optional[str] = None
    exchange: Optional[str] = None
    quote_type: Optional[str] = None
