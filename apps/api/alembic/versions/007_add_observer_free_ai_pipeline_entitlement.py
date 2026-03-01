"""Add observer one-time AI pipeline entitlement fields.

Revision ID: 007
Revises: 006
Create Date: 2026-03-01 00:00:00.000000
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "007"
down_revision: Union[str, None] = "006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "observer_free_ai_pipeline_used",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "users",
        sa.Column(
            "observer_free_ai_pipeline_window_ends_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "observer_free_ai_pipeline_window_ends_at")
    op.drop_column("users", "observer_free_ai_pipeline_used")
