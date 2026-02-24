"""Add avg_cost_currency to holdings

Revision ID: 004
Revises: 003
Create Date: 2026-02-23 07:00:00.000000
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "004"
down_revision: Union[str, None] = "003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "holdings",
        sa.Column("avg_cost_currency", sa.String(length=3), nullable=True),
    )
    op.execute("UPDATE holdings SET avg_cost_currency = 'USD' WHERE avg_cost_currency IS NULL")
    op.alter_column(
        "holdings",
        "avg_cost_currency",
        nullable=False,
        server_default=sa.text("'USD'"),
    )


def downgrade() -> None:
    op.drop_column("holdings", "avg_cost_currency")
