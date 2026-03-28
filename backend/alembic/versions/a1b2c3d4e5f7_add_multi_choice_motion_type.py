"""add_multi_choice_motion_type

Revision ID: a1b2c3d4e5f7
Revises: f9a8b7c6d5e4
Create Date: 2026-03-28 00:00:00.000000

Changes:
  - Add 'multi_choice' value to motiontype enum
  - Add 'selected' value to votechoice enum
  - Create motion_options table
  - Add motions.option_limit column
  - Add votes.motion_option_id column
  - Drop old unique constraint uq_votes_gm_motion_lot_owner
  - Add two partial unique indexes on votes
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "a1b2c3d4e5f7"
down_revision = "0b8d45b3ee02"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # 1. Add enum values — must run outside a transaction on PostgreSQL
    #    (ALTER TYPE ... ADD VALUE is not transactional pre-PG 12, and
    #    even on PG 12+ must not run inside an explicit transaction block).
    #    We use the same pattern as d1e2f3a4b5c6 (COMMIT then ALTER TYPE).
    # ------------------------------------------------------------------
    op.execute("COMMIT")
    op.execute("ALTER TYPE motiontype ADD VALUE IF NOT EXISTS 'multi_choice'")
    op.execute("ALTER TYPE votechoice ADD VALUE IF NOT EXISTS 'selected'")

    # ------------------------------------------------------------------
    # 2. Create motion_options table
    # ------------------------------------------------------------------
    op.create_table(
        "motion_options",
        sa.Column("id", sa.UUID(), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("motion_id", sa.UUID(), nullable=False),
        sa.Column("text", sa.String(), nullable=False),
        sa.Column("display_order", sa.Integer(), nullable=False, server_default="1"),
        sa.ForeignKeyConstraint(["motion_id"], ["motions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("motion_id", "display_order", name="uq_motion_options_motion_display_order"),
    )

    # ------------------------------------------------------------------
    # 3. Add option_limit column to motions
    # ------------------------------------------------------------------
    op.add_column("motions", sa.Column("option_limit", sa.Integer(), nullable=True))

    # ------------------------------------------------------------------
    # 4. Add motion_option_id column to votes
    # ------------------------------------------------------------------
    op.add_column(
        "votes",
        sa.Column("motion_option_id", sa.UUID(), nullable=True),
    )
    op.create_foreign_key(
        "fk_votes_motion_option_id",
        "votes",
        "motion_options",
        ["motion_option_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # ------------------------------------------------------------------
    # 5. Drop the old unique constraint on votes
    #    (was uq_votes_gm_motion_lot_owner on general_meeting_id, motion_id, lot_owner_id)
    # ------------------------------------------------------------------
    op.drop_constraint("uq_votes_gm_motion_lot_owner", "votes", type_="unique")

    # ------------------------------------------------------------------
    # 6. Add two partial unique indexes
    # ------------------------------------------------------------------
    op.create_index(
        "uq_votes_non_multi_choice",
        "votes",
        ["general_meeting_id", "motion_id", "lot_owner_id"],
        unique=True,
        postgresql_where=sa.text("motion_option_id IS NULL"),  # nosemgrep: raw-sql-requires-comment -- partial index WHERE predicate; SQLAlchemy ORM has no non-text() alternative for database-level partial index expressions
    )
    op.create_index(
        "uq_votes_multi_choice",
        "votes",
        ["general_meeting_id", "motion_id", "lot_owner_id", "motion_option_id"],
        unique=True,
        postgresql_where=sa.text("motion_option_id IS NOT NULL"),  # nosemgrep: raw-sql-requires-comment -- partial index WHERE predicate; SQLAlchemy ORM has no non-text() alternative for database-level partial index expressions
    )


def downgrade() -> None:
    # Remove partial indexes
    op.drop_index("uq_votes_multi_choice", table_name="votes")
    op.drop_index("uq_votes_non_multi_choice", table_name="votes")

    # Restore original unique constraint
    op.create_unique_constraint(
        "uq_votes_gm_motion_lot_owner",
        "votes",
        ["general_meeting_id", "motion_id", "lot_owner_id"],
    )

    # Remove FK and column from votes
    op.drop_constraint("fk_votes_motion_option_id", "votes", type_="foreignkey")
    op.drop_column("votes", "motion_option_id")

    # Remove option_limit from motions
    op.drop_column("motions", "option_limit")

    # Drop motion_options table
    op.drop_table("motion_options")

    # Note: PostgreSQL does not support removing enum values.
    # 'multi_choice' and 'selected' cannot be removed from their enums.
    # Downgrade leaves those values in the enums.
