from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class PortfolioSeries(Base):
    __tablename__ = "portfolio_series"
    __table_args__ = (UniqueConstraint("user_id", "date", name="uq_portfolio_series_user_date"),)

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    date: Mapped[date] = mapped_column(Date, nullable=False, index=True)

    # Raw inputs
    total_value: Mapped[float] = mapped_column(Numeric(18, 6), nullable=False)
    net_deposits: Mapped[float] = mapped_column(Numeric(18, 6), nullable=False, default=0)
    period_deposits: Mapped[float] = mapped_column(Numeric(18, 6), nullable=False, default=0)
    spy_close: Mapped[float | None] = mapped_column(Numeric(18, 6), nullable=True)
    period_return: Mapped[float] = mapped_column(Numeric(12, 8), nullable=False)
    benchmark_return: Mapped[float] = mapped_column(Numeric(12, 8), nullable=False)

    # Computed metrics
    alpha: Mapped[float | None] = mapped_column(Numeric(12, 8), nullable=True)
    cumulative_alpha: Mapped[float | None] = mapped_column(Numeric(12, 8), nullable=True)
    rolling_4w_alpha: Mapped[float | None] = mapped_column(Numeric(12, 8), nullable=True)
    rolling_8w_vol: Mapped[float | None] = mapped_column(Numeric(12, 8), nullable=True)
    rolling_8w_alpha_vol: Mapped[float | None] = mapped_column(Numeric(12, 8), nullable=True)
    running_peak: Mapped[float | None] = mapped_column(Numeric(18, 6), nullable=True)
    drawdown: Mapped[float | None] = mapped_column(Numeric(12, 8), nullable=True)
    beta_12w: Mapped[float | None] = mapped_column(Numeric(12, 8), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class PortfolioImport(Base):
    __tablename__ = "portfolio_imports"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    row_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Encrypted path on disk (AES-256)
    raw_file_path: Mapped[str | None] = mapped_column(Text, nullable=True)
