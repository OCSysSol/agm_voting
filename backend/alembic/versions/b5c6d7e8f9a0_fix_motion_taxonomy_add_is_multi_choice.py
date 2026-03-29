"""fix_motion_taxonomy_add_is_multi_choice

Revision ID: b5c6d7e8f9a0
Revises: a1b2c3d4e5f7
Create Date: 2026-03-29 00:00:00.000000

Changes:
  - Add is_multi_choice BOOLEAN NOT NULL DEFAULT false to motions
  - For any rows where motion_type = 'multi_choice': set is_multi_choice = true,
    then change motion_type to 'general'
  - The 'multi_choice' enum value cannot be removed from motiontype in PostgreSQL
    (ALTER TYPE ... DROP VALUE is not supported), so it stays in the DB enum but
    the application no longer sets or reads it.  Any existing rows are migrated away.

Note: PostgreSQL does not support removing enum values at all (not even in PG 12+).
The 'multi_choice' label stays dormant in the database enum definition but the
Python MotionType enum no longer includes it.  The migration safely converts every
row that uses it to 'general' + is_multi_choice=true.
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "b5c6d7e8f9a0"
down_revision = "a1b2c3d4e5f7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Add is_multi_choice column with default false
    op.add_column(
        "motions",
        sa.Column(
            "is_multi_choice",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),  # nosemgrep: raw-sql-requires-comment -- server_default for boolean column
        ),
    )

    # 2. For existing rows where motion_type = 'multi_choice':
    #    set is_multi_choice = true AND change motion_type to 'general'
    op.execute(
        "UPDATE motions SET is_multi_choice = true, motion_type = 'general' WHERE motion_type = 'multi_choice'"  # nosemgrep: raw-sql-requires-comment -- data migration; no ORM alternative available inside Alembic upgrade()
    )


def downgrade() -> None:
    # Reverse: set motion_type back to 'multi_choice' for rows with is_multi_choice=true
    op.execute(
        "UPDATE motions SET motion_type = 'multi_choice' WHERE is_multi_choice = true"  # nosemgrep: raw-sql-requires-comment -- data migration; no ORM alternative available inside Alembic downgrade()
    )

    # Drop the is_multi_choice column
    op.drop_column("motions", "is_multi_choice")
