"""Initial schema

Revision ID: 001
Revises:
Create Date: 2024-01-01 00:00:00.000000

"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "portfolio_series",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("total_value", sa.Numeric(18, 6), nullable=False),
        sa.Column("net_deposits", sa.Numeric(18, 6), nullable=False, server_default="0"),
        sa.Column("period_deposits", sa.Numeric(18, 6), nullable=False, server_default="0"),
        sa.Column("period_return", sa.Numeric(12, 8), nullable=False),
        sa.Column("benchmark_return", sa.Numeric(12, 8), nullable=False),
        sa.Column("alpha", sa.Numeric(12, 8), nullable=True),
        sa.Column("cumulative_alpha", sa.Numeric(12, 8), nullable=True),
        sa.Column("rolling_4w_alpha", sa.Numeric(12, 8), nullable=True),
        sa.Column("rolling_8w_vol", sa.Numeric(12, 8), nullable=True),
        sa.Column("rolling_8w_alpha_vol", sa.Numeric(12, 8), nullable=True),
        sa.Column("running_peak", sa.Numeric(18, 6), nullable=True),
        sa.Column("drawdown", sa.Numeric(12, 8), nullable=True),
        sa.Column("beta_12w", sa.Numeric(12, 8), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("date"),
    )
    op.create_index("ix_portfolio_series_date", "portfolio_series", ["date"])

    op.create_table(
        "portfolio_imports",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column(
            "uploaded_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("row_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("raw_file_path", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "recommendations",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("risk_level", sa.String(20), nullable=False),
        sa.Column("category", sa.String(50), nullable=False),
        sa.Column("triggers", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("explanation", sa.Text(), nullable=False),
        sa.Column("supporting_metrics", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("actions", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("confidence", sa.Numeric(5, 4), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "rulebook",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("thresholds", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("text", sa.Text(), nullable=False, server_default=""),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "market_snapshots",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "captured_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("payload", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_market_snapshots_captured_at", "market_snapshots", ["captured_at"])

    op.create_table(
        "news_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "captured_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("headline", sa.Text(), nullable=False),
        sa.Column("source", sa.String(100), nullable=False),
        sa.Column("url", sa.Text(), nullable=True),
        sa.Column("entities", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("event_type", sa.String(50), nullable=False),
        sa.Column("sentiment_score", sa.Float(), nullable=True),
        sa.Column("volatility_score", sa.Float(), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=True),
        sa.Column("raw_payload", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_news_events_captured_at", "news_events", ["captured_at"])

    op.create_table(
        "portfolio_exposure",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("ticker", sa.String(20), nullable=False),
        sa.Column("sector", sa.String(100), nullable=True),
        sa.Column("weight", sa.Float(), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_portfolio_exposure_ticker", "portfolio_exposure", ["ticker"])


def downgrade() -> None:
    op.drop_table("portfolio_exposure")
    op.drop_table("news_events")
    op.drop_table("market_snapshots")
    op.drop_table("rulebook")
    op.drop_table("recommendations")
    op.drop_table("portfolio_imports")
    op.drop_table("portfolio_series")
