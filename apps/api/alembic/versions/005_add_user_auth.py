"""Add user auth table and user_id FK on all user-owned tables

Revision ID: 005
Revises: 004
Create Date: 2026-02-27 00:00:00.000000
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "005"
down_revision: Union[str, None] = "004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SYSTEM_UUID = "00000000-0000-0000-0000-000000000001"

_USER_OWNED_TABLES = [
    "holdings",
    "portfolio_series",
    "recommendations",
    "rulebook",
    "portfolio_imports",
]


def upgrade() -> None:
    # ── 1. Create users table ─────────────────────────────────────────────────
    op.create_table(
        "users",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=False), primary_key=True),
        sa.Column("clerk_id", sa.String(255), unique=True, nullable=False),
        sa.Column("email", sa.String(255), nullable=True),
        sa.Column("display_name", sa.String(255), nullable=True),
        sa.Column("tier", sa.String(20), nullable=False, server_default="observer"),
        sa.Column("is_admin", sa.Boolean, nullable=False, server_default="false"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )

    # ── 2. Insert system placeholder ─────────────────────────────────────────
    op.execute(
        f"""
        INSERT INTO users (id, clerk_id, tier, is_admin)
        VALUES ('{SYSTEM_UUID}', 'SYSTEM', 'command', false)
        """
    )

    # ── 3. Add user_id columns (nullable first for backfill) ──────────────────
    for table in _USER_OWNED_TABLES:
        op.add_column(
            table,
            sa.Column(
                "user_id",
                sa.dialects.postgresql.UUID(as_uuid=False),
                sa.ForeignKey("users.id"),
                nullable=True,
                index=True,
            ),
        )

    # ── 4. Backfill existing rows → system placeholder ────────────────────────
    for table in _USER_OWNED_TABLES:
        op.execute(f"UPDATE {table} SET user_id = '{SYSTEM_UUID}'")

    # ── 5. Make NOT NULL ──────────────────────────────────────────────────────
    for table in _USER_OWNED_TABLES:
        op.alter_column(table, "user_id", nullable=False)

    # ── 6. Fix portfolio_series unique constraint (date → user_id + date) ─────
    # The auto-generated constraint name from SQLAlchemy is portfolio_series_date_key
    # Try to drop it; ignore if it doesn't exist under that name.
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'portfolio_series_date_key'
                  AND conrelid = 'portfolio_series'::regclass
            ) THEN
                ALTER TABLE portfolio_series DROP CONSTRAINT portfolio_series_date_key;
            END IF;
        END$$;
        """
    )
    op.create_unique_constraint(
        "uq_portfolio_series_user_date", "portfolio_series", ["user_id", "date"]
    )


def downgrade() -> None:
    op.drop_constraint("uq_portfolio_series_user_date", "portfolio_series")
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'portfolio_series_date_key'
                  AND conrelid = 'portfolio_series'::regclass
            ) THEN
                ALTER TABLE portfolio_series ADD CONSTRAINT portfolio_series_date_key UNIQUE (date);
            END IF;
        END$$;
        """
    )

    for table in _USER_OWNED_TABLES:
        op.drop_column(table, "user_id")

    op.drop_table("users")
