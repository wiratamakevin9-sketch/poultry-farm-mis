"""add eggs_dirty

Revision ID: 60253d4a0b13
Revises: 32bbcd7fef16
Create Date: 2026-10-29 06:11:53.458388

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '60253d4a0b13'
down_revision: Union[str, Sequence[str], None] = '32bbcd7fef16'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


OLD_CHECK = (
    "eggs_good >= 0 AND eggs_cracked >= 0 AND eggs_rejected >= 0 AND dead >= 0 AND culled >= 0"
)
NEW_CHECK = (
    "eggs_good >= 0 AND eggs_cracked >= 0 AND eggs_rejected >= 0 AND eggs_dirty >= 0"
    " AND dead >= 0 AND culled >= 0"
)


def upgrade() -> None:
    """Dirty eggs get their own count (ADR 0002); existing records start at 0."""
    op.add_column(
        "daily_records",
        sa.Column("eggs_dirty", sa.Integer(), server_default="0", nullable=False),
    )
    op.drop_constraint("counts_not_negative", "daily_records", type_="check")
    op.create_check_constraint("counts_not_negative", "daily_records", NEW_CHECK)


def downgrade() -> None:
    op.drop_constraint("counts_not_negative", "daily_records", type_="check")
    op.create_check_constraint("counts_not_negative", "daily_records", OLD_CHECK)
    op.drop_column("daily_records", "eggs_dirty")
