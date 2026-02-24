"""Add holdings table

Revision ID: 003
Revises: 002
Create Date: 2026-02-23 12:00:00.000000
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "holdings",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("ticker", sa.String(16), nullable=False),
        sa.Column("name", sa.String(255), nullable=True),
        sa.Column("shares", sa.Numeric(18, 6), nullable=False),
        sa.Column("avg_cost_per_share", sa.Numeric(18, 6), nullable=False),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column(
            "added_at",
            sa.DateTime,
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_holdings_ticker", "holdings", ["ticker"])


def downgrade() -> None:
    op.drop_index("ix_holdings_ticker", table_name="holdings")
    op.drop_table("holdings")
