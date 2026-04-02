"""add_against_to_votechoice_enum

Revision ID: 3869c4d28305
Revises: aec6a1bb5035
Create Date: 2026-04-02 18:59:05.000033

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '3869c4d28305'
down_revision: Union[str, Sequence[str], None] = 'aec6a1bb5035'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema: add 'against' value to votechoice enum."""
    # PostgreSQL only allows adding enum values, not removing or reordering.
    # IF NOT EXISTS is supported since PostgreSQL 9.3 and prevents errors on
    # repeated runs (e.g. CI against a branch that already ran this migration).
    op.execute("ALTER TYPE votechoice ADD VALUE IF NOT EXISTS 'against'")


def downgrade() -> None:
    """Downgrade schema.

    PostgreSQL does not support removing values from an enum type.
    Downgrade is intentionally a no-op: the 'against' value will remain in the
    enum but no code will produce it after the downgrade.  Rows with
    choice = 'against' would need to be manually migrated before a downgrade.
    """
    pass
