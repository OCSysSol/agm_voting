"""add outcome to motion_options

Revision ID: a9c1d5e7f2b3
Revises: 4ab492b5e61f
Create Date: 2026-04-02 13:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a9c1d5e7f2b3'
down_revision: Union[str, Sequence[str], None] = '4ab492b5e61f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add outcome column to motion_options with check constraint."""
    op.add_column(
        'motion_options',
        sa.Column('outcome', sa.String(), nullable=True),
    )
    op.create_check_constraint(
        'ck_motion_options_outcome',
        'motion_options',
        "outcome IN ('pass', 'fail', 'tie') OR outcome IS NULL",
    )


def downgrade() -> None:
    """Remove outcome column from motion_options."""
    op.drop_constraint('ck_motion_options_outcome', 'motion_options', type_='check')
    op.drop_column('motion_options', 'outcome')
