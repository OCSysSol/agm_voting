"""slice_c_multi_email_per_lot_voting

Revision ID: a1b2c3d4e5f6
Revises: 1e1b0a488622
Create Date: 2026-03-12 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = '1e1b0a488622'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema for Slice C: multi-email + per-lot voting."""

    # 1. Create lot_owner_emails table
    op.create_table(
        'lot_owner_emails',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('lot_owner_id', sa.Uuid(), nullable=False),
        sa.Column('email', sa.String(), nullable=True),
        sa.ForeignKeyConstraint(['lot_owner_id'], ['lot_owners.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('lot_owner_id', 'email', name='uq_lot_owner_emails_owner_email'),
    )
    op.create_index('ix_lot_owner_emails_email', 'lot_owner_emails', ['email'])

    # 2. Migrate existing lot_owners.email -> lot_owner_emails rows
    op.execute(
        """
        INSERT INTO lot_owner_emails (id, lot_owner_id, email)
        SELECT gen_random_uuid(), id, email
        FROM lot_owners
        WHERE email IS NOT NULL AND email != ''
        """
    )

    # 3. Drop voter_email from agm_lot_weights
    op.drop_column('agm_lot_weights', 'voter_email')

    # 4. Add financial_position_snapshot to agm_lot_weights
    #    Default existing rows to 'normal'
    financial_position_snapshot_enum = sa.Enum('normal', 'in_arrear', name='financialpositionsnapshot')
    financial_position_snapshot_enum.create(op.get_bind(), checkfirst=True)
    op.add_column(
        'agm_lot_weights',
        sa.Column(
            'financial_position_snapshot',
            financial_position_snapshot_enum,
            nullable=False,
            server_default='normal',
        ),
    )

    # 5. Add lot_owner_id to ballot_submissions
    #    We need to populate it from the existing voter_email -> lot_owner mapping.
    #    For existing rows, set lot_owner_id by matching voter_email to lot_owner via agm_lot_weights.
    #    If no match is found we cannot determine the lot, so we set to a placeholder temporarily.
    #    In practice the database should be empty or we can do best-effort migration.
    op.add_column(
        'ballot_submissions',
        sa.Column('lot_owner_id', sa.Uuid(), nullable=True),
    )
    # Populate lot_owner_id from agm_lot_weights for existing rows
    op.execute(
        """
        UPDATE ballot_submissions bs
        SET lot_owner_id = (
            SELECT alw.lot_owner_id
            FROM agm_lot_weights alw
            JOIN lot_owner_emails loe ON loe.lot_owner_id = alw.lot_owner_id
            WHERE alw.agm_id = bs.agm_id
              AND loe.email = bs.voter_email
            LIMIT 1
        )
        """
    )
    # Delete any submissions we could not resolve (orphaned data from before migration)
    op.execute(
        "DELETE FROM ballot_submissions WHERE lot_owner_id IS NULL"
    )
    # Make the column non-nullable now
    op.alter_column('ballot_submissions', 'lot_owner_id', nullable=False)
    op.create_foreign_key(
        'fk_ballot_submissions_lot_owner_id',
        'ballot_submissions', 'lot_owners',
        ['lot_owner_id'], ['id'],
        ondelete='CASCADE',
    )

    # 6. Drop old unique constraint on ballot_submissions (agm_id, voter_email)
    #    and add new one on (agm_id, lot_owner_id)
    op.drop_constraint('uq_ballot_submissions_agm_voter', 'ballot_submissions', type_='unique')
    op.create_unique_constraint(
        'uq_ballot_submissions_agm_lot_owner',
        'ballot_submissions',
        ['agm_id', 'lot_owner_id'],
    )

    # 7. Add lot_owner_id to votes (nullable FK to lot_owners)
    op.add_column(
        'votes',
        sa.Column('lot_owner_id', sa.Uuid(), nullable=True),
    )
    op.create_foreign_key(
        'fk_votes_lot_owner_id',
        'votes', 'lot_owners',
        ['lot_owner_id'], ['id'],
        ondelete='SET NULL',
    )

    # 8. Replace unique constraint on votes from (agm_id, motion_id, voter_email)
    #    to (agm_id, motion_id, lot_owner_id) so that multi-lot voters can vote
    op.drop_constraint('uq_votes_agm_motion_voter', 'votes', type_='unique')
    op.create_unique_constraint(
        'uq_votes_agm_motion_lot_owner',
        'votes',
        ['agm_id', 'motion_id', 'lot_owner_id'],
    )

    # 9. Drop email column from lot_owners
    op.drop_column('lot_owners', 'email')


def downgrade() -> None:
    """Downgrade schema for Slice C."""

    # Restore email column to lot_owners (nullable initially)
    op.add_column(
        'lot_owners',
        sa.Column('email', sa.String(), nullable=True),
    )
    # Populate email from lot_owner_emails (take first email per lot owner)
    op.execute(
        """
        UPDATE lot_owners lo
        SET email = (
            SELECT loe.email
            FROM lot_owner_emails loe
            WHERE loe.lot_owner_id = lo.id
            LIMIT 1
        )
        """
    )
    op.alter_column('lot_owners', 'email', nullable=False)

    # Restore ballot_submissions unique constraint
    op.drop_constraint('uq_ballot_submissions_agm_lot_owner', 'ballot_submissions', type_='unique')
    op.drop_constraint('fk_ballot_submissions_lot_owner_id', 'ballot_submissions', type_='foreignkey')
    op.create_unique_constraint(
        'uq_ballot_submissions_agm_voter',
        'ballot_submissions',
        ['agm_id', 'voter_email'],
    )
    op.drop_column('ballot_submissions', 'lot_owner_id')

    # Restore voter_email to agm_lot_weights
    op.add_column(
        'agm_lot_weights',
        sa.Column('voter_email', sa.String(), nullable=True),
    )
    # Populate voter_email from lot_owner_emails
    op.execute(
        """
        UPDATE agm_lot_weights alw
        SET voter_email = (
            SELECT loe.email
            FROM lot_owner_emails loe
            WHERE loe.lot_owner_id = alw.lot_owner_id
            LIMIT 1
        )
        """
    )
    op.alter_column('agm_lot_weights', 'voter_email', nullable=False)
    op.drop_column('agm_lot_weights', 'financial_position_snapshot')
    op.execute("DROP TYPE IF EXISTS financialpositionsnapshot")

    # Restore votes unique constraint
    op.drop_constraint('uq_votes_agm_motion_lot_owner', 'votes', type_='unique')
    op.create_unique_constraint(
        'uq_votes_agm_motion_voter',
        'votes',
        ['agm_id', 'motion_id', 'voter_email'],
    )

    # Remove lot_owner_id from votes
    op.drop_constraint('fk_votes_lot_owner_id', 'votes', type_='foreignkey')
    op.drop_column('votes', 'lot_owner_id')

    # Drop lot_owner_emails table
    op.drop_index('ix_lot_owner_emails_email', table_name='lot_owner_emails')
    op.drop_table('lot_owner_emails')
