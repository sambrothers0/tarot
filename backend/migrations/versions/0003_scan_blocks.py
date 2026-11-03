"""several blocks per scan

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-02
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Nullable, and null for every existing row: a scan of one block is fully
    # described by block_type, count and truncated already.
    op.add_column("saved_scans", sa.Column("blocks", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("saved_scans", "blocks")
