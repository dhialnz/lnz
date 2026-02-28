"""Add portfolio entities and portfolio_id scoping for command-tier multi-portfolio.

Revision ID: 006
Revises: 005
Create Date: 2026-02-28 00:00:00.000000
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "006"
down_revision: Union[str, None] = "005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_USER_OWNED_TABLES = [
    "holdings",
    "portfolio_series",
    "recommendations",
    "rulebook",
    "portfolio_imports",
]


def upgrade() -> None:
    op.create_table(
        "portfolios",
        sa.Column(
            "id",
            sa.dialects.postgresql.UUID(as_uuid=False),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "user_id",
            sa.dialects.postgresql.UUID(as_uuid=False),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_portfolios_user_id", "portfolios", ["user_id"], unique=False)
    op.create_unique_constraint("uq_portfolios_user_name", "portfolios", ["user_id", "name"])

    op.add_column(
        "users",
        sa.Column("active_portfolio_id", sa.dialects.postgresql.UUID(as_uuid=False), nullable=True),
    )

    for table in _USER_OWNED_TABLES:
        op.add_column(
            table,
            sa.Column("portfolio_id", sa.dialects.postgresql.UUID(as_uuid=False), nullable=True),
        )
        op.create_index(f"ix_{table}_portfolio_id", table, ["portfolio_id"], unique=False)

    # Backfill one default portfolio per user and assign all legacy rows to it.
    op.execute(
        """
        DO $$
        DECLARE
          u RECORD;
          default_pid UUID;
          base_name TEXT := 'Main Portfolio';
          candidate_name TEXT;
          seq_no INTEGER;
        BEGIN
          FOR u IN SELECT id, active_portfolio_id FROM users LOOP
            SELECT id INTO default_pid
            FROM portfolios
            WHERE user_id = u.id AND is_default = true
            ORDER BY created_at ASC
            LIMIT 1;

            IF default_pid IS NULL THEN
              candidate_name := base_name;
              seq_no := 1;
              WHILE EXISTS (
                SELECT 1 FROM portfolios
                WHERE user_id = u.id AND name = candidate_name
              ) LOOP
                seq_no := seq_no + 1;
                candidate_name := base_name || ' ' || seq_no::text;
              END LOOP;

              INSERT INTO portfolios (user_id, name, is_default)
              VALUES (u.id, candidate_name, true)
              RETURNING id INTO default_pid;
            END IF;

            UPDATE users
            SET active_portfolio_id = COALESCE(active_portfolio_id, default_pid)
            WHERE id = u.id;

            UPDATE holdings SET portfolio_id = default_pid
            WHERE user_id = u.id AND portfolio_id IS NULL;

            UPDATE portfolio_series SET portfolio_id = default_pid
            WHERE user_id = u.id AND portfolio_id IS NULL;

            UPDATE recommendations SET portfolio_id = default_pid
            WHERE user_id = u.id AND portfolio_id IS NULL;

            UPDATE rulebook SET portfolio_id = default_pid
            WHERE user_id = u.id AND portfolio_id IS NULL;

            UPDATE portfolio_imports SET portfolio_id = default_pid
            WHERE user_id = u.id AND portfolio_id IS NULL;
          END LOOP;
        END$$;
        """
    )

    for table in _USER_OWNED_TABLES:
        op.alter_column(table, "portfolio_id", nullable=False)

    op.create_foreign_key(
        "fk_users_active_portfolio",
        "users",
        "portfolios",
        ["active_portfolio_id"],
        ["id"],
    )

    # Existing unique constraint from migration 005: (user_id, date)
    op.drop_constraint("uq_portfolio_series_user_date", "portfolio_series", type_="unique")
    op.create_unique_constraint(
        "uq_portfolio_series_user_portfolio_date",
        "portfolio_series",
        ["user_id", "portfolio_id", "date"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_portfolio_series_user_portfolio_date", "portfolio_series", type_="unique"
    )
    op.create_unique_constraint(
        "uq_portfolio_series_user_date", "portfolio_series", ["user_id", "date"]
    )

    op.drop_constraint("fk_users_active_portfolio", "users", type_="foreignkey")

    for table in _USER_OWNED_TABLES:
        op.drop_index(f"ix_{table}_portfolio_id", table_name=table)
        op.drop_column(table, "portfolio_id")

    op.drop_column("users", "active_portfolio_id")

    op.drop_constraint("uq_portfolios_user_name", "portfolios", type_="unique")
    op.drop_index("ix_portfolios_user_id", table_name="portfolios")
    op.drop_table("portfolios")

