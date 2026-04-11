"""
Tests for the parallel lot-lookup helper coroutines in app/services/auth_service.py.

Covers _load_direct_lot_owner_ids, _load_proxy_lot_owner_ids, and extend_session.

These helpers use AsyncSessionLocal() directly (not via get_db) so that they can
be run concurrently via asyncio.gather.  The autouse patch_parallel_lot_lookup
fixture in conftest.py patches the routers-level imports; tests here target the
service-level functions directly using a local patch of AsyncSessionLocal.

Structure:
  # --- Happy path ---
  # --- Boundary values ---
  # --- Edge cases ---
"""
from __future__ import annotations

import uuid
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.session_record import SessionRecord
from app.services.auth_service import (
    SESSION_DURATION,
    _sign_token,
    extend_session,
    _load_direct_lot_owner_ids,
    _load_proxy_lot_owner_ids,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_mock_session_for_ids(row_ids: list[uuid.UUID]) -> AsyncMock:
    """Build a mock AsyncSession whose execute() returns the given IDs as scalar rows."""
    mock_session = AsyncMock(spec=AsyncSession)
    mock_result = MagicMock()
    mock_result.all.return_value = [(id_,) for id_ in row_ids]
    mock_session.execute = AsyncMock(return_value=mock_result)
    return mock_session


@asynccontextmanager
async def _mock_session_ctx(mock_session):
    """Async context manager that yields the given mock session."""
    yield mock_session


def _mock_async_session_local(mock_session):
    """Return a callable that acts like AsyncSessionLocal() context manager."""
    def factory():
        return _mock_session_ctx(mock_session)
    return factory


# ---------------------------------------------------------------------------
# Tests for _load_direct_lot_owner_ids
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestLoadDirectLotOwnerIds:
    # --- Happy path ---

    async def test_returns_set_of_matching_ids(self):
        """Returns a set of lot_owner_ids from LotOwnerEmail rows matching the email."""
        lot_id_1 = uuid.uuid4()
        lot_id_2 = uuid.uuid4()
        mock_session = _make_mock_session_for_ids([lot_id_1, lot_id_2])

        with patch(
            "app.services.auth_service.AsyncSessionLocal",
            _mock_async_session_local(mock_session),
        ):
            result = await _load_direct_lot_owner_ids(
                voter_email="voter@test.com",
                building_id=uuid.uuid4(),
            )

        assert result == {lot_id_1, lot_id_2}

    async def test_returns_empty_set_when_no_matching_emails(self):
        """Returns an empty set when no LotOwnerEmail row matches the email."""
        mock_session = _make_mock_session_for_ids([])

        with patch(
            "app.services.auth_service.AsyncSessionLocal",
            _mock_async_session_local(mock_session),
        ):
            result = await _load_direct_lot_owner_ids(
                voter_email="unknown@test.com",
                building_id=uuid.uuid4(),
            )

        assert result == set()

    async def test_executes_query_on_session(self):
        """Verifies that a DB query is issued on the session."""
        lot_id = uuid.uuid4()
        mock_session = _make_mock_session_for_ids([lot_id])

        with patch(
            "app.services.auth_service.AsyncSessionLocal",
            _mock_async_session_local(mock_session),
        ):
            await _load_direct_lot_owner_ids(
                voter_email="voter@test.com",
                building_id=uuid.uuid4(),
            )

        mock_session.execute.assert_awaited_once()

    # --- Boundary values ---

    async def test_returns_single_id_when_one_match(self):
        """Returns a set with exactly one ID when there is exactly one match."""
        lot_id = uuid.uuid4()
        mock_session = _make_mock_session_for_ids([lot_id])

        with patch(
            "app.services.auth_service.AsyncSessionLocal",
            _mock_async_session_local(mock_session),
        ):
            result = await _load_direct_lot_owner_ids(
                voter_email="single@test.com",
                building_id=uuid.uuid4(),
            )

        assert result == {lot_id}
        assert len(result) == 1

    async def test_deduplicates_when_duplicate_ids_returned(self):
        """Returns a set (deduplicated) even if the DB returns duplicate IDs."""
        lot_id = uuid.uuid4()
        # DB returns the same ID twice (edge case — should not happen with FK constraints)
        mock_session = _make_mock_session_for_ids([lot_id, lot_id])

        with patch(
            "app.services.auth_service.AsyncSessionLocal",
            _mock_async_session_local(mock_session),
        ):
            result = await _load_direct_lot_owner_ids(
                voter_email="dup@test.com",
                building_id=uuid.uuid4(),
            )

        assert result == {lot_id}
        assert len(result) == 1


# ---------------------------------------------------------------------------
# Tests for _load_proxy_lot_owner_ids
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestLoadProxyLotOwnerIds:
    # --- Happy path ---

    async def test_returns_set_of_proxied_lot_ids(self):
        """Returns a set of lot_owner_ids from LotProxy rows matching the proxy email."""
        proxy_lot_id = uuid.uuid4()
        mock_session = _make_mock_session_for_ids([proxy_lot_id])

        with patch(
            "app.services.auth_service.AsyncSessionLocal",
            _mock_async_session_local(mock_session),
        ):
            result = await _load_proxy_lot_owner_ids(
                voter_email="proxy@test.com",
                building_id=uuid.uuid4(),
            )

        assert result == {proxy_lot_id}

    async def test_returns_empty_set_when_no_proxy_rows(self):
        """Returns an empty set when no LotProxy row matches the email."""
        mock_session = _make_mock_session_for_ids([])

        with patch(
            "app.services.auth_service.AsyncSessionLocal",
            _mock_async_session_local(mock_session),
        ):
            result = await _load_proxy_lot_owner_ids(
                voter_email="notaproxy@test.com",
                building_id=uuid.uuid4(),
            )

        assert result == set()

    async def test_returns_multiple_proxied_lots(self):
        """A single proxy email can proxy for multiple lots — all IDs returned."""
        lot_id_1 = uuid.uuid4()
        lot_id_2 = uuid.uuid4()
        lot_id_3 = uuid.uuid4()
        mock_session = _make_mock_session_for_ids([lot_id_1, lot_id_2, lot_id_3])

        with patch(
            "app.services.auth_service.AsyncSessionLocal",
            _mock_async_session_local(mock_session),
        ):
            result = await _load_proxy_lot_owner_ids(
                voter_email="multiproxy@test.com",
                building_id=uuid.uuid4(),
            )

        assert result == {lot_id_1, lot_id_2, lot_id_3}

    async def test_executes_query_on_session(self):
        """Verifies that a DB query is issued on the session."""
        mock_session = _make_mock_session_for_ids([])

        with patch(
            "app.services.auth_service.AsyncSessionLocal",
            _mock_async_session_local(mock_session),
        ):
            await _load_proxy_lot_owner_ids(
                voter_email="proxy@test.com",
                building_id=uuid.uuid4(),
            )

        mock_session.execute.assert_awaited_once()


# ---------------------------------------------------------------------------
# Tests for extend_session
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestExtendSession:
    # --- Happy path ---

    async def test_returns_signed_token(self):
        """extend_session returns a non-empty signed token string."""
        raw_token = "test_raw_token_abc123"
        session_record = SessionRecord(
            session_token=raw_token,
            voter_email="voter@test.com",
            building_id=uuid.uuid4(),
            general_meeting_id=uuid.uuid4(),
            expires_at=datetime.now(UTC) + timedelta(minutes=10),
        )
        mock_db = AsyncMock(spec=AsyncSession)
        mock_db.flush = AsyncMock()

        result = await extend_session(db=mock_db, session_record=session_record)

        assert isinstance(result, str)
        assert len(result) > 0

    async def test_updates_expires_at_to_approximately_now_plus_duration(self):
        """extend_session sets expires_at to approximately now + SESSION_DURATION."""
        before = datetime.now(UTC)
        raw_token = "test_raw_token_extend"
        session_record = SessionRecord(
            session_token=raw_token,
            voter_email="voter@test.com",
            building_id=uuid.uuid4(),
            general_meeting_id=uuid.uuid4(),
            expires_at=datetime.now(UTC) + timedelta(minutes=1),  # old short expiry
        )
        mock_db = AsyncMock(spec=AsyncSession)
        mock_db.flush = AsyncMock()

        await extend_session(db=mock_db, session_record=session_record)

        after = datetime.now(UTC)
        expected_min = before + SESSION_DURATION - timedelta(seconds=5)
        expected_max = after + SESSION_DURATION + timedelta(seconds=5)
        assert expected_min <= session_record.expires_at <= expected_max

    async def test_calls_db_flush(self):
        """extend_session flushes the session so the UPDATE is queued."""
        session_record = SessionRecord(
            session_token="flush_test_token",
            voter_email="voter@test.com",
            building_id=uuid.uuid4(),
            general_meeting_id=uuid.uuid4(),
            expires_at=datetime.now(UTC) + timedelta(minutes=10),
        )
        mock_db = AsyncMock(spec=AsyncSession)
        mock_db.flush = AsyncMock()

        await extend_session(db=mock_db, session_record=session_record)

        mock_db.flush.assert_awaited_once()

    async def test_reuses_existing_raw_token(self):
        """extend_session re-signs the same raw token — not a new random token."""
        from app.services.auth_service import _unsign_token
        raw_token = "original_raw_token_xyz"
        session_record = SessionRecord(
            session_token=raw_token,
            voter_email="voter@test.com",
            building_id=uuid.uuid4(),
            general_meeting_id=uuid.uuid4(),
            expires_at=datetime.now(UTC) + timedelta(minutes=10),
        )
        mock_db = AsyncMock(spec=AsyncSession)
        mock_db.flush = AsyncMock()

        signed = await extend_session(db=mock_db, session_record=session_record)

        # The signed token must decode back to the original raw token
        extracted = _unsign_token(signed)
        assert extracted == raw_token

    # --- Boundary values ---

    async def test_extends_already_expired_session(self):
        """extend_session can renew an already-expired session (caller is responsible for checking)."""
        raw_token = "expired_token_test"
        session_record = SessionRecord(
            session_token=raw_token,
            voter_email="voter@test.com",
            building_id=uuid.uuid4(),
            general_meeting_id=uuid.uuid4(),
            expires_at=datetime.now(UTC) - timedelta(hours=1),  # already expired
        )
        mock_db = AsyncMock(spec=AsyncSession)
        mock_db.flush = AsyncMock()

        await extend_session(db=mock_db, session_record=session_record)

        # After extend, expires_at should be in the future
        assert session_record.expires_at > datetime.now(UTC)

    # --- Edge cases ---

    async def test_multiple_calls_each_push_expiry_forward(self):
        """Multiple extend_session calls each push expires_at further into the future."""
        raw_token = "multi_extend_token"
        session_record = SessionRecord(
            session_token=raw_token,
            voter_email="voter@test.com",
            building_id=uuid.uuid4(),
            general_meeting_id=uuid.uuid4(),
            expires_at=datetime.now(UTC) + timedelta(minutes=5),
        )
        mock_db = AsyncMock(spec=AsyncSession)
        mock_db.flush = AsyncMock()

        first_expiry_before = datetime.now(UTC) + SESSION_DURATION
        await extend_session(db=mock_db, session_record=session_record)
        first_expiry = session_record.expires_at

        await extend_session(db=mock_db, session_record=session_record)
        second_expiry = session_record.expires_at

        # Each call resets to now + SESSION_DURATION; second must be >= first
        assert second_expiry >= first_expiry
