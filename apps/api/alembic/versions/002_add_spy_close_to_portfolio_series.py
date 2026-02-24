"""Add spy_close to portfolio_series

Revision ID: 002
Revises: 001
Create Date: 2026-02-23 04:40:00.000000
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("portfolio_series", sa.Column("spy_close", sa.Numeric(18, 6), nullable=True))


def downgrade() -> None:
    op.drop_column("portfolio_series", "spy_close")
