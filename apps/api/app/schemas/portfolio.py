from __future__ import annotations

from datetime import date, datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field


class PortfolioSeriesRow(BaseModel):
    id: UUID
    date: date
    total_value: float
    net_deposits: float
    period_deposits: float
    period_return: float
    benchmark_return: float
    alpha: Optional[float]
    cumulative_alpha: Optional[float]
    rolling_4w_alpha: Optional[float]
    rolling_8w_vol: Optional[float]
    rolling_8w_alpha_vol: Optional[float]
    running_peak: Optional[float]
    drawdown: Optional[float]
    beta_12w: Optional[float]
    created_at: datetime

    model_config = {"from_attributes": True}


class PortfolioSummary(BaseModel):
    date: str
    total_value: float
    alpha_latest: float
    cumulative_alpha: float
    rolling_4w_alpha: Optional[float]
    rolling_8w_vol: Optional[float]
    rolling_8w_alpha_vol: Optional[float]
    running_peak: float
    drawdown: float
    max_drawdown: float
    beta_12w: Optional[float]
    volatility_ratio: Optional[float]
    row_count: int
    regime: str
    regime_explanation: str


class ImportResult(BaseModel):
    import_id: UUID
    filename: str
    row_count: int
    regime: str
    regime_explanation: str
    message: str


class ParsePreview(BaseModel):
    columns: list[str]
    rows: list[dict]
    row_count: int
    errors: list[str]
