"""rr4_schema_fixes

Revision ID: rr4001schema
Revises: 091424401a0b
Create Date: 2026-04-03 00:00:00.000000

Changes:
  RR4-20: Vote.motion_option_id FK ondelete SET NULL -> RESTRICT
  RR4-23: ballot_hash enforcement via service layer (voting_service validates hash present)
  RR4-27: ballot_submissions.submitted_by_admin_username column
  RR4-33: motions service-layer validation (no DB migration needed — cross-table constraint)
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "rr4001schema"
down_revision: Union[str, Sequence[str], None] = "091424401a0b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # RR4-20: Drop the old SET NULL FK on votes.motion_option_id and recreate as RESTRICT.
    # Use batch_alter_table to handle the FK drop/add atomically.
    with op.batch_alter_table("votes", schema=None) as batch_op:
        batch_op.drop_constraint("fk_votes_motion_option_id", type_="foreignkey")
        batch_op.create_foreign_key(
            "fk_votes_motion_option_id",
            "motion_options",
            ["motion_option_id"],
            ["id"],
            ondelete="RESTRICT",
        )

    # RR4-27: Add submitted_by_admin_username column to ballot_submissions.
    op.add_column(
        "ballot_submissions",
        sa.Column(
            "submitted_by_admin_username",
            sa.String(255),
            nullable=True,
        ),
    )


def downgrade() -> None:
    # RR4-27: Remove submitted_by_admin_username column.
    op.drop_column("ballot_submissions", "submitted_by_admin_username")

    # RR4-20: Revert FK to SET NULL.
    with op.batch_alter_table("votes", schema=None) as batch_op:
        batch_op.drop_constraint("fk_votes_motion_option_id", type_="foreignkey")
        batch_op.create_foreign_key(
            "fk_votes_motion_option_id",
            "motion_options",
            ["motion_option_id"],
            ["id"],
            ondelete="SET NULL",
        )
