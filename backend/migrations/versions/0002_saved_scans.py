"""saved scans

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-01
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "saved_scans",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(100), nullable=True),
        sa.Column("block_type", sa.String(255), nullable=False),
        sa.Column("dimension", sa.String(16), nullable=False),
        sa.Column("source_kind", sa.String(16), nullable=False),
        sa.Column("source_name", sa.String(255), nullable=False),
        sa.Column("scanned_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("count", sa.BigInteger(), nullable=False),
        sa.Column("truncated", sa.Boolean(), nullable=False),
        sa.Column("preview", sa.JSON(), nullable=False),
        sa.Column("coords", sa.LargeBinary(), nullable=False),
        sa.Column("coords_bytes", sa.Integer(), nullable=False),
    )
    op.create_index("ix_saved_scans_user_scanned", "saved_scans", ["user_id", "scanned_at"])


def downgrade() -> None:
    op.drop_index("ix_saved_scans_user_scanned", table_name="saved_scans")
    op.drop_table("saved_scans")
