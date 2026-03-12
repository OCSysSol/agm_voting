"""
Tests for Phase 2 API endpoints:
  - Public endpoints (server-time, buildings, agms)
  - Auth endpoint (verify)
  - Voting endpoints (motions, draft, submit, my-ballot)

Covers all code in app/routers/public.py, app/routers/auth.py, app/routers/voting.py,
app/services/auth_service.py, app/services/voting_service.py.

Structure:
  # --- Happy path ---
  # --- Input validation ---
  # --- State / precondition errors ---
  # --- Edge cases ---
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    AGM,
    AGMStatus,
    BallotSubmission,
    Building,
    LotOwner,
    Motion,
    SessionRecord,
    Vote,
    VoteChoice,
    VoteStatus,
)
from app.models.lot_owner_email import LotOwnerEmail


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def meeting_dt() -> datetime:
    return datetime.now(UTC) + timedelta(days=1)


def closing_dt() -> datetime:
    return datetime.now(UTC) + timedelta(days=2)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def client(app):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        yield ac


@pytest_asyncio.fixture
async def building_with_agm(db_session: AsyncSession):
    """Building with one open AGM and one lot owner with email."""
    b = Building(name="P2 Building", manager_email="p2@test.com")
    db_session.add(b)
    await db_session.flush()

    lo = LotOwner(
        building_id=b.id, lot_number="P2-1", unit_entitlement=100
    )
    db_session.add(lo)
    await db_session.flush()

    lo_email = LotOwnerEmail(lot_owner_id=lo.id, email="voter@p2test.com")
    db_session.add(lo_email)

    agm = AGM(
        building_id=b.id,
        title="P2 AGM",
        status=AGMStatus.open,
        meeting_at=meeting_dt(),
        voting_closes_at=closing_dt(),
    )
    db_session.add(agm)
    await db_session.flush()

    m1 = Motion(agm_id=agm.id, title="P2 Motion 1", order_index=1, description="First")
    m2 = Motion(agm_id=agm.id, title="P2 Motion 2", order_index=2, description=None)
    db_session.add_all([m1, m2])
    await db_session.flush()

    # lo.email is no longer a column; use the LotOwnerEmail row
    return {"building": b, "lot_owner": lo, "voter_email": "voter@p2test.com", "agm": agm, "motions": [m1, m2]}


async def create_session(
    db_session: AsyncSession,
    voter_email: str,
    building_id: uuid.UUID,
    agm_id: uuid.UUID,
) -> str:
    """Helper to create a session token directly in DB."""
    import secrets
    token = secrets.token_urlsafe(32)
    now = datetime.now(UTC)
    session = SessionRecord(
        session_token=token,
        voter_email=voter_email,
        building_id=building_id,
        agm_id=agm_id,
        expires_at=now + timedelta(hours=24),
    )
    db_session.add(session)
    await db_session.flush()
    return token


# ---------------------------------------------------------------------------
# GET /api/server-time
# ---------------------------------------------------------------------------


class TestServerTime:
    # --- Happy path ---

    async def test_server_time_returns_200(self, client: AsyncClient):
        response = await client.get("/api/server-time")
        assert response.status_code == 200

    async def test_server_time_has_utc_field(self, client: AsyncClient):
        response = await client.get("/api/server-time")
        data = response.json()
        assert "utc" in data
        assert "T" in data["utc"]


# ---------------------------------------------------------------------------
# GET /api/buildings
# ---------------------------------------------------------------------------


class TestPublicListBuildings:
    # --- Happy path ---

    async def test_returns_buildings_with_agms(
        self, client: AsyncClient, building_with_agm: dict
    ):
        response = await client.get("/api/buildings")
        assert response.status_code == 200
        data = response.json()
        names = [b["name"] for b in data]
        assert "P2 Building" in names

    async def test_building_has_id_and_name(
        self, client: AsyncClient, building_with_agm: dict
    ):
        response = await client.get("/api/buildings")
        data = response.json()
        assert len(data) > 0
        first = data[0]
        assert "id" in first
        assert "name" in first

    async def test_building_without_agm_is_listed(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Buildings without AGMs now appear — the AGM list for that building will be empty."""
        b = Building(name="No AGM Building P2", manager_email="noagm@test.com")
        db_session.add(b)
        await db_session.flush()

        response = await client.get("/api/buildings")
        data = response.json()
        names = [item["name"] for item in data]
        assert "No AGM Building P2" in names


# ---------------------------------------------------------------------------
# GET /api/buildings/{building_id}/agms
# ---------------------------------------------------------------------------


class TestPublicListAGMs:
    # --- Happy path ---

    async def test_returns_agms_for_building(
        self, client: AsyncClient, building_with_agm: dict
    ):
        building = building_with_agm["building"]
        response = await client.get(f"/api/buildings/{building.id}/agms")
        assert response.status_code == 200
        data = response.json()
        assert len(data) >= 1
        titles = [a["title"] for a in data]
        assert "P2 AGM" in titles

    async def test_agm_has_required_fields(
        self, client: AsyncClient, building_with_agm: dict
    ):
        building = building_with_agm["building"]
        response = await client.get(f"/api/buildings/{building.id}/agms")
        data = response.json()
        agm = data[0]
        assert "id" in agm
        assert "title" in agm
        assert "status" in agm
        assert "meeting_at" in agm
        assert "voting_closes_at" in agm

    # --- State / precondition errors ---

    async def test_building_not_found_returns_404(self, client: AsyncClient):
        response = await client.get(f"/api/buildings/{uuid.uuid4()}/agms")
        assert response.status_code == 404


# ---------------------------------------------------------------------------
# POST /api/auth/verify
# ---------------------------------------------------------------------------


class TestAuthVerify:
    # --- Happy path ---

    async def test_valid_auth_returns_200(
        self, client: AsyncClient, building_with_agm: dict
    ):
        voter_email = building_with_agm["voter_email"]
        agm = building_with_agm["agm"]
        building = building_with_agm["building"]

        response = await client.post(
            "/api/auth/verify",
            json={
                "email": voter_email,
                "building_id": str(building.id),
                "agm_id": str(agm.id),
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["voter_email"] == voter_email
        assert "lots" in data
        assert len(data["lots"]) == 1
        assert data["lots"][0]["already_submitted"] is False

    async def test_valid_auth_already_submitted(
        self, client: AsyncClient, db_session: AsyncSession, building_with_agm: dict
    ):
        lo = building_with_agm["lot_owner"]
        voter_email = building_with_agm["voter_email"]
        agm = building_with_agm["agm"]
        building = building_with_agm["building"]

        # Create a ballot submission for this lot owner
        bs = BallotSubmission(
            agm_id=agm.id,
            lot_owner_id=lo.id,
            voter_email=voter_email,
        )
        db_session.add(bs)
        await db_session.flush()

        response = await client.post(
            "/api/auth/verify",
            json={
                "email": voter_email,
                "building_id": str(building.id),
                "agm_id": str(agm.id),
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["lots"][0]["already_submitted"] is True

    async def test_sets_session_cookie(
        self, client: AsyncClient, building_with_agm: dict
    ):
        voter_email = building_with_agm["voter_email"]
        agm = building_with_agm["agm"]
        building = building_with_agm["building"]

        response = await client.post(
            "/api/auth/verify",
            json={
                "email": voter_email,
                "building_id": str(building.id),
                "agm_id": str(agm.id),
            },
        )
        assert response.status_code == 200
        assert "agm_session" in response.cookies

    async def test_lots_contain_lot_info(
        self, client: AsyncClient, building_with_agm: dict
    ):
        lo = building_with_agm["lot_owner"]
        voter_email = building_with_agm["voter_email"]
        agm = building_with_agm["agm"]
        building = building_with_agm["building"]

        response = await client.post(
            "/api/auth/verify",
            json={
                "email": voter_email,
                "building_id": str(building.id),
                "agm_id": str(agm.id),
            },
        )
        assert response.status_code == 200
        data = response.json()
        lot = data["lots"][0]
        assert lot["lot_owner_id"] == str(lo.id)
        assert lot["lot_number"] == lo.lot_number
        assert "financial_position" in lot
        assert "already_submitted" in lot

    # --- Input validation ---

    async def test_empty_email_returns_422(
        self, client: AsyncClient, building_with_agm: dict
    ):
        agm = building_with_agm["agm"]
        building = building_with_agm["building"]

        response = await client.post(
            "/api/auth/verify",
            json={
                "email": "",
                "building_id": str(building.id),
                "agm_id": str(agm.id),
            },
        )
        assert response.status_code == 422

    # --- State / precondition errors ---

    async def test_wrong_email_returns_401(
        self, client: AsyncClient, building_with_agm: dict
    ):
        agm = building_with_agm["agm"]
        building = building_with_agm["building"]

        response = await client.post(
            "/api/auth/verify",
            json={
                "email": "wrong@email.com",
                "building_id": str(building.id),
                "agm_id": str(agm.id),
            },
        )
        assert response.status_code == 401

    async def test_agm_not_found_for_building_returns_404(
        self, client: AsyncClient, db_session: AsyncSession, building_with_agm: dict
    ):
        voter_email = building_with_agm["voter_email"]
        building = building_with_agm["building"]

        response = await client.post(
            "/api/auth/verify",
            json={
                "email": voter_email,
                "building_id": str(building.id),
                "agm_id": str(uuid.uuid4()),
            },
        )
        assert response.status_code == 404

    async def test_closed_agm_returns_200_with_closed_status(
        self, client: AsyncClient, db_session: AsyncSession, building_with_agm: dict
    ):
        """Closed AGMs allow auth so lot owners can view their submission."""
        voter_email = building_with_agm["voter_email"]
        building = building_with_agm["building"]

        # Create a closed AGM in the same building
        closed_agm = AGM(
            building_id=building.id,
            title="Closed P2 AGM",
            status=AGMStatus.closed,
            meeting_at=meeting_dt(),
            voting_closes_at=closing_dt(),
            closed_at=datetime.now(UTC),
        )
        db_session.add(closed_agm)
        await db_session.flush()

        response = await client.post(
            "/api/auth/verify",
            json={
                "email": voter_email,
                "building_id": str(building.id),
                "agm_id": str(closed_agm.id),
            },
        )
        assert response.status_code == 200
        assert response.json()["agm_status"] == "closed"

    async def test_email_in_different_building_returns_401(
        self, client: AsyncClient, db_session: AsyncSession, building_with_agm: dict
    ):
        """An email that belongs to a different building returns 401."""
        agm = building_with_agm["agm"]

        # Create a second building with no matching email
        b2 = Building(name="Other Building", manager_email="other@test.com")
        db_session.add(b2)
        await db_session.flush()
        agm2 = AGM(
            building_id=b2.id,
            title="Other AGM",
            status=AGMStatus.open,
            meeting_at=meeting_dt(),
            voting_closes_at=closing_dt(),
        )
        db_session.add(agm2)
        await db_session.flush()

        response = await client.post(
            "/api/auth/verify",
            json={
                "email": "voter@p2test.com",
                "building_id": str(b2.id),
                "agm_id": str(agm2.id),
            },
        )
        assert response.status_code == 401


# ---------------------------------------------------------------------------
# auth_service tests (get_session)
# ---------------------------------------------------------------------------


class TestAuthService:
    # --- Happy path ---

    async def test_get_session_with_bearer_token(
        self, client: AsyncClient, db_session: AsyncSession, building_with_agm: dict
    ):
        """Session can be validated via Authorization: Bearer header."""
        agm = building_with_agm["agm"]
        voter_email = building_with_agm["voter_email"]
        building = building_with_agm["building"]

        token = await create_session(db_session, voter_email, building.id, agm.id)

        response = await client.get(
            f"/api/agm/{agm.id}/motions",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200

    async def test_no_session_returns_401(
        self, client: AsyncClient, building_with_agm: dict
    ):
        agm = building_with_agm["agm"]
        response = await client.get(f"/api/agm/{agm.id}/motions")
        assert response.status_code == 401

    async def test_invalid_token_returns_401(
        self, client: AsyncClient, building_with_agm: dict
    ):
        agm = building_with_agm["agm"]
        response = await client.get(
            f"/api/agm/{agm.id}/motions",
            headers={"Authorization": "Bearer invalid_token_xyz"},
        )
        assert response.status_code == 401

    async def test_authorization_without_bearer_prefix_returns_401(
        self, client: AsyncClient, building_with_agm: dict
    ):
        agm = building_with_agm["agm"]
        response = await client.get(
            f"/api/agm/{agm.id}/motions",
            headers={"Authorization": "notabearer token"},
        )
        assert response.status_code == 401

    async def test_expired_session_returns_401(
        self, client: AsyncClient, db_session: AsyncSession, building_with_agm: dict
    ):
        agm = building_with_agm["agm"]
        voter_email = building_with_agm["voter_email"]
        building = building_with_agm["building"]

        import secrets
        token = secrets.token_urlsafe(32)
        expired_session = SessionRecord(
            session_token=token,
            voter_email=voter_email,
            building_id=building.id,
            agm_id=agm.id,
            expires_at=datetime.now(UTC) - timedelta(hours=1),
        )
        db_session.add(expired_session)
        await db_session.flush()

        response = await client.get(
            f"/api/agm/{agm.id}/motions",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 401


# ---------------------------------------------------------------------------
# GET /api/agm/{agm_id}/motions
# ---------------------------------------------------------------------------


class TestListMotions:
    # --- Happy path ---

    async def test_returns_motions(
        self, client: AsyncClient, db_session: AsyncSession, building_with_agm: dict
    ):
        agm = building_with_agm["agm"]
        voter_email = building_with_agm["voter_email"]
        building = building_with_agm["building"]

        token = await create_session(db_session, voter_email, building.id, agm.id)

        response = await client.get(
            f"/api/agm/{agm.id}/motions",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 2

    async def test_motion_fields(
        self, client: AsyncClient, db_session: AsyncSession, building_with_agm: dict
    ):
        agm = building_with_agm["agm"]
        voter_email = building_with_agm["voter_email"]
        building = building_with_agm["building"]

        token = await create_session(db_session, voter_email, building.id, agm.id)

        response = await client.get(
            f"/api/agm/{agm.id}/motions",
            headers={"Authorization": f"Bearer {token}"},
        )
        data = response.json()
        motion = data[0]
        assert "id" in motion
        assert "title" in motion
        assert "description" in motion
        assert "order_index" in motion


# ---------------------------------------------------------------------------
# PUT /api/agm/{agm_id}/draft
# ---------------------------------------------------------------------------


class TestSaveDraft:
    # --- Happy path ---

    async def test_save_draft_yes(
        self, client: AsyncClient, db_session: AsyncSession, building_with_agm: dict
    ):
        agm = building_with_agm["agm"]
        lo = building_with_agm["lot_owner"]
        voter_email = building_with_agm["voter_email"]
        building = building_with_agm["building"]
        motions = building_with_agm["motions"]

        token = await create_session(db_session, voter_email, building.id, agm.id)

        response = await client.put(
            f"/api/agm/{agm.id}/draft",
            json={"motion_id": str(motions[0].id), "choice": "yes", "lot_owner_id": str(lo.id)},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200
        assert response.json()["saved"] is True

    async def test_save_draft_no(
        self, client: AsyncClient, db_session: AsyncSession, building_with_agm: dict
    ):
        agm = building_with_agm["agm"]
        lo = building_with_agm["lot_owner"]
        voter_email = building_with_agm["voter_email"]
        building = building_with_agm["building"]
        motions = building_with_agm["motions"]

        token = await create_session(db_session, voter_email, building.id, agm.id)

        response = await client.put(
            f"/api/agm/{agm.id}/draft",
            json={"motion_id": str(motions[0].id), "choice": "no", "lot_owner_id": str(lo.id)},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200

    async def test_save_draft_without_lot_owner_id(
        self, client: AsyncClient, db_session: AsyncSession, building_with_agm: dict
    ):
        """Draft can be saved without lot_owner_id (legacy/fallback path)."""
        agm = building_with_agm["agm"]
        voter_email = building_with_agm["voter_email"]
        building = building_with_agm["building"]
        motions = building_with_agm["motions"]

        token = await create_session(db_session, voter_email, building.id, agm.id)

        response = await client.put(
            f"/api/agm/{agm.id}/draft",
            json={"motion_id": str(motions[0].id), "choice": "yes"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200
        assert response.json()["saved"] is True

    async def test_save_draft_update_existing(
        self, client: AsyncClient, db_session: AsyncSession, building_with_agm: dict
    ):
        """Saving draft twice updates the existing record."""
        agm = building_with_agm["agm"]
        lo = building_with_agm["lot_owner"]
        voter_email = building_with_agm["voter_email"]
        building = building_with_agm["building"]
        motions = building_with_agm["motions"]

        token = await create_session(db_session, voter_email, building.id, agm.id)

        # Save once
        await client.put(
            f"/api/agm/{agm.id}/draft",
            json={"motion_id": str(motions[0].id), "choice": "yes", "lot_owner_id": str(lo.id)},
            headers={"Authorization": f"Bearer {token}"},
        )

        # Save again with different choice
        response = await client.put(
            f"/api/agm/{agm.id}/draft",
            json={"motion_id": str(motions[0].id), "choice": "no", "lot_owner_id": str(lo.id)},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200

    async def test_save_draft_null_choice_deletes_draft(
        self, client: AsyncClient, db_session: AsyncSession, building_with_agm: dict
    ):
        """Saving with null choice (deselect) removes the draft."""
        agm = building_with_agm["agm"]
        lo = building_with_agm["lot_owner"]
        voter_email = building_with_agm["voter_email"]
        building = building_with_agm["building"]
        motions = building_with_agm["motions"]

        token = await create_session(db_session, voter_email, building.id, agm.id)

        # Save first
        await client.put(
            f"/api/agm/{agm.id}/draft",
            json={"motion_id": str(motions[0].id), "choice": "yes", "lot_owner_id": str(lo.id)},
            headers={"Authorization": f"Bearer {token}"},
        )

        # Then deselect (null choice)
        response = await client.put(
            f"/api/agm/{agm.id}/draft",
            json={"motion_id": str(motions[0].id), "choice": None, "lot_owner_id": str(lo.id)},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200

    async def test_save_draft_null_choice_no_existing_draft(
        self, client: AsyncClient, db_session: AsyncSession, building_with_agm: dict
    ):
        """Saving with null choice when no draft exists is a no-op."""
        agm = building_with_agm["agm"]
        lo = building_with_agm["lot_owner"]
        voter_email = building_with_agm["voter_email"]
        building = building_with_agm["building"]
        motions = building_with_agm["motions"]

        token = await create_session(db_session, voter_email, building.id, agm.id)

        response = await client.put(
            f"/api/agm/{agm.id}/draft",
            json={"motion_id": str(motions[0].id), "choice": None, "lot_owner_id": str(lo.id)},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200

    # --- State / precondition errors ---

    async def test_save_draft_closed_agm_returns_403(
        self, client: AsyncClient, db_session: AsyncSession, building_with_agm: dict
    ):
        building = building_with_agm["building"]
        voter_email = building_with_agm["voter_email"]

        closed_agm = AGM(
            building_id=building.id,
            title="Closed Draft AGM",
            status=AGMStatus.closed,
            meeting_at=meeting_dt(),
            voting_closes_at=closing_dt(),
            closed_at=datetime.now(UTC),
        )
        db_session.add(closed_agm)
        await db_session.flush()

        motion = Motion(agm_id=closed_agm.id, title="CM1", order_index=1)
        db_session.add(motion)
        await db_session.flush()

        token = await create_session(db_session, voter_email, building.id, closed_agm.id)

        response = await client.put(
            f"/api/agm/{closed_agm.id}/draft",
            json={"motion_id": str(motion.id), "choice": "yes"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 403

    async def test_save_draft_already_submitted_returns_409(
        self, client: AsyncClient, db_session: AsyncSession, building_with_agm: dict
    ):
        agm = building_with_agm["agm"]
        lo = building_with_agm["lot_owner"]
        voter_email = building_with_agm["voter_email"]
        building = building_with_agm["building"]
        motions = building_with_agm["motions"]

        # Submit ballot for this lot owner
        bs = BallotSubmission(
            agm_id=agm.id,
            lot_owner_id=lo.id,
            voter_email=voter_email,
        )
        db_session.add(bs)
        await db_session.flush()

        token = await create_session(db_session, voter_email, building.id, agm.id)

        response = await client.put(
            f"/api/agm/{agm.id}/draft",
            json={"motion_id": str(motions[0].id), "choice": "yes", "lot_owner_id": str(lo.id)},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 409

    async def test_save_draft_wrong_agm_motion_returns_422(
        self, client: AsyncClient, db_session: AsyncSession, building_with_agm: dict
    ):
        agm = building_with_agm["agm"]
        voter_email = building_with_agm["voter_email"]
        building = building_with_agm["building"]

        token = await create_session(db_session, voter_email, building.id, agm.id)

        response = await client.put(
            f"/api/agm/{agm.id}/draft",
            json={"motion_id": str(uuid.uuid4()), "choice": "yes"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 422

    async def test_no_session_returns_401(
        self, client: AsyncClient, building_with_agm: dict
    ):
        agm = building_with_agm["agm"]
        motions = building_with_agm["motions"]
        response = await client.put(
            f"/api/agm/{agm.id}/draft",
            json={"motion_id": str(motions[0].id), "choice": "yes"},
        )
        assert response.status_code == 401


# ---------------------------------------------------------------------------
# GET /api/agm/{agm_id}/drafts
# ---------------------------------------------------------------------------


class TestGetDrafts:
    # --- Happy path ---

    async def test_get_drafts_empty(
        self, client: AsyncClient, db_session: AsyncSession, building_with_agm: dict
    ):
        agm = building_with_agm["agm"]
        voter_email = building_with_agm["voter_email"]
        building = building_with_agm["building"]

        token = await create_session(db_session, voter_email, building.id, agm.id)

        response = await client.get(
            f"/api/agm/{agm.id}/drafts",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200
        assert response.json()["drafts"] == []

    async def test_get_drafts_with_saved_drafts(
        self, client: AsyncClient, db_session: AsyncSession, building_with_agm: dict
    ):
        agm = building_with_agm["agm"]
        lo = building_with_agm["lot_owner"]
        voter_email = building_with_agm["voter_email"]
        building = building_with_agm["building"]
        motions = building_with_agm["motions"]

        # Save a draft
        vote = Vote(
            agm_id=agm.id,
            motion_id=motions[0].id,
            voter_email=voter_email,
            lot_owner_id=lo.id,
            choice=VoteChoice.yes,
            status=VoteStatus.draft,
        )
        db_session.add(vote)
        await db_session.flush()

        token = await create_session(db_session, voter_email, building.id, agm.id)

        response = await client.get(
            f"/api/agm/{agm.id}/drafts",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data["drafts"]) == 1
        assert data["drafts"][0]["choice"] == "yes"

    async def test_get_drafts_filtered_by_lot_owner_id(
        self, client: AsyncClient, db_session: AsyncSession, building_with_agm: dict
    ):
        """Drafts endpoint accepts optional lot_owner_id query param."""
        agm = building_with_agm["agm"]
        lo = building_with_agm["lot_owner"]
        voter_email = building_with_agm["voter_email"]
        building = building_with_agm["building"]
        motions = building_with_agm["motions"]

        vote = Vote(
            agm_id=agm.id,
            motion_id=motions[0].id,
            voter_email=voter_email,
            lot_owner_id=lo.id,
            choice=VoteChoice.yes,
            status=VoteStatus.draft,
        )
        db_session.add(vote)
        await db_session.flush()

        token = await create_session(db_session, voter_email, building.id, agm.id)

        response = await client.get(
            f"/api/agm/{agm.id}/drafts?lot_owner_id={lo.id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data["drafts"]) == 1

    async def test_null_choice_drafts_excluded(
        self, client: AsyncClient, db_session: AsyncSession, building_with_agm: dict
    ):
        agm = building_with_agm["agm"]
        lo = building_with_agm["lot_owner"]
        voter_email = building_with_agm["voter_email"]
        building = building_with_agm["building"]
        motions = building_with_agm["motions"]

        # Save a draft with null choice
        vote = Vote(
            agm_id=agm.id,
            motion_id=motions[0].id,
            voter_email=voter_email,
            lot_owner_id=lo.id,
            choice=None,
            status=VoteStatus.draft,
        )
        db_session.add(vote)
        await db_session.flush()

        token = await create_session(db_session, voter_email, building.id, agm.id)

        response = await client.get(
            f"/api/agm/{agm.id}/drafts",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200
        assert response.json()["drafts"] == []


# ---------------------------------------------------------------------------
# POST /api/agm/{agm_id}/submit
# ---------------------------------------------------------------------------


class TestSubmitBallot:
    # --- Happy path ---

    async def test_submit_all_answered(
        self, client: AsyncClient, db_session: AsyncSession, building_with_agm: dict
    ):
        agm = building_with_agm["agm"]
        lo = building_with_agm["lot_owner"]
        voter_email = building_with_agm["voter_email"]
        building = building_with_agm["building"]
        motions = building_with_agm["motions"]

        # Save drafts for both motions
        for i, motion in enumerate(motions):
            vote = Vote(
                agm_id=agm.id,
                motion_id=motion.id,
                voter_email=voter_email,
                lot_owner_id=lo.id,
                choice=VoteChoice.yes if i == 0 else VoteChoice.no,
                status=VoteStatus.draft,
            )
            db_session.add(vote)
        await db_session.flush()

        token = await create_session(db_session, voter_email, building.id, agm.id)

        response = await client.post(
            f"/api/agm/{agm.id}/submit",
            json={"lot_owner_ids": [str(lo.id)]},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["submitted"] is True
        assert len(data["lots"]) == 1
        assert len(data["lots"][0]["votes"]) == 2

    async def test_submit_unanswered_motions_recorded_as_abstained(
        self, client: AsyncClient, db_session: AsyncSession, building_with_agm: dict
    ):
        agm = building_with_agm["agm"]
        lo = building_with_agm["lot_owner"]
        voter_email = building_with_agm["voter_email"]
        building = building_with_agm["building"]
        motions = building_with_agm["motions"]

        # Save draft only for first motion
        vote = Vote(
            agm_id=agm.id,
            motion_id=motions[0].id,
            voter_email=voter_email,
            lot_owner_id=lo.id,
            choice=VoteChoice.yes,
            status=VoteStatus.draft,
        )
        db_session.add(vote)
        await db_session.flush()

        token = await create_session(db_session, voter_email, building.id, agm.id)

        response = await client.post(
            f"/api/agm/{agm.id}/submit",
            json={"lot_owner_ids": [str(lo.id)]},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200
        data = response.json()
        # Second motion should be abstained
        votes = data["lots"][0]["votes"]
        choices = {v["motion_id"]: v["choice"] for v in votes}
        assert choices[str(motions[0].id)] == "yes"
        assert choices[str(motions[1].id)] == "abstained"

    async def test_submit_no_drafts_all_abstained(
        self, client: AsyncClient, db_session: AsyncSession, building_with_agm: dict
    ):
        agm = building_with_agm["agm"]
        lo = building_with_agm["lot_owner"]
        voter_email = building_with_agm["voter_email"]
        building = building_with_agm["building"]

        token = await create_session(db_session, voter_email, building.id, agm.id)

        response = await client.post(
            f"/api/agm/{agm.id}/submit",
            json={"lot_owner_ids": [str(lo.id)]},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200
        data = response.json()
        assert all(v["choice"] == "abstained" for v in data["lots"][0]["votes"])

    async def test_submit_with_null_choice_draft_gets_abstained(
        self, client: AsyncClient, db_session: AsyncSession, building_with_agm: dict
    ):
        """A draft with null choice should be treated as abstained on submit."""
        agm = building_with_agm["agm"]
        lo = building_with_agm["lot_owner"]
        voter_email = building_with_agm["voter_email"]
        building = building_with_agm["building"]
        motions = building_with_agm["motions"]

        # Save draft with null choice
        vote = Vote(
            agm_id=agm.id,
            motion_id=motions[0].id,
            voter_email=voter_email,
            lot_owner_id=lo.id,
            choice=None,
            status=VoteStatus.draft,
        )
        db_session.add(vote)
        await db_session.flush()

        token = await create_session(db_session, voter_email, building.id, agm.id)

        response = await client.post(
            f"/api/agm/{agm.id}/submit",
            json={"lot_owner_ids": [str(lo.id)]},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200
        votes = response.json()["lots"][0]["votes"]
        choices = {v["motion_id"]: v["choice"] for v in votes}
        assert choices[str(motions[0].id)] == "abstained"

    # --- Input validation ---

    async def test_submit_empty_lot_owner_ids_returns_422(
        self, client: AsyncClient, db_session: AsyncSession, building_with_agm: dict
    ):
        agm = building_with_agm["agm"]
        voter_email = building_with_agm["voter_email"]
        building = building_with_agm["building"]

        token = await create_session(db_session, voter_email, building.id, agm.id)

        response = await client.post(
            f"/api/agm/{agm.id}/submit",
            json={"lot_owner_ids": []},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 422

    async def test_submit_lot_owner_not_belonging_to_voter_returns_403(
        self, client: AsyncClient, db_session: AsyncSession, building_with_agm: dict
    ):
        """Submitting on behalf of a lot that doesn't belong to this email → 403."""
        agm = building_with_agm["agm"]
        voter_email = building_with_agm["voter_email"]
        building = building_with_agm["building"]

        # Create another lot owner with a different email
        lo2 = LotOwner(building_id=building.id, lot_number="P2-OTHER", unit_entitlement=50)
        db_session.add(lo2)
        await db_session.flush()
        lo2_email = LotOwnerEmail(lot_owner_id=lo2.id, email="other@p2test.com")
        db_session.add(lo2_email)
        await db_session.flush()

        token = await create_session(db_session, voter_email, building.id, agm.id)

        response = await client.post(
            f"/api/agm/{agm.id}/submit",
            json={"lot_owner_ids": [str(lo2.id)]},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 403

    # --- State / precondition errors ---

    async def test_submit_closed_agm_returns_403(
        self, client: AsyncClient, db_session: AsyncSession, building_with_agm: dict
    ):
        building = building_with_agm["building"]
        voter_email = building_with_agm["voter_email"]

        closed_agm = AGM(
            building_id=building.id,
            title="Closed Submit AGM",
            status=AGMStatus.closed,
            meeting_at=meeting_dt(),
            voting_closes_at=closing_dt(),
            closed_at=datetime.now(UTC),
        )
        db_session.add(closed_agm)
        await db_session.flush()

        token = await create_session(db_session, voter_email, building.id, closed_agm.id)

        lo = building_with_agm["lot_owner"]
        response = await client.post(
            f"/api/agm/{closed_agm.id}/submit",
            json={"lot_owner_ids": [str(lo.id)]},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 403

    async def test_submit_already_submitted_returns_409(
        self, client: AsyncClient, db_session: AsyncSession, building_with_agm: dict
    ):
        agm = building_with_agm["agm"]
        lo = building_with_agm["lot_owner"]
        voter_email = building_with_agm["voter_email"]
        building = building_with_agm["building"]

        # Submit ballot already
        bs = BallotSubmission(
            agm_id=agm.id,
            lot_owner_id=lo.id,
            voter_email=voter_email,
        )
        db_session.add(bs)
        await db_session.flush()

        token = await create_session(db_session, voter_email, building.id, agm.id)

        response = await client.post(
            f"/api/agm/{agm.id}/submit",
            json={"lot_owner_ids": [str(lo.id)]},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 409

    async def test_no_session_returns_401(
        self, client: AsyncClient, building_with_agm: dict
    ):
        agm = building_with_agm["agm"]
        lo = building_with_agm["lot_owner"]
        response = await client.post(
            f"/api/agm/{agm.id}/submit",
            json={"lot_owner_ids": [str(lo.id)]},
        )
        assert response.status_code == 401


# ---------------------------------------------------------------------------
# GET /api/agm/{agm_id}/my-ballot
# ---------------------------------------------------------------------------


class TestMyBallot:
    # --- Happy path ---

    async def test_my_ballot_after_submit(
        self, client: AsyncClient, db_session: AsyncSession, building_with_agm: dict
    ):
        agm = building_with_agm["agm"]
        lo = building_with_agm["lot_owner"]
        voter_email = building_with_agm["voter_email"]
        building = building_with_agm["building"]
        motions = building_with_agm["motions"]

        # Add submitted votes and ballot submission
        for motion in motions:
            vote = Vote(
                agm_id=agm.id,
                motion_id=motion.id,
                voter_email=voter_email,
                lot_owner_id=lo.id,
                choice=VoteChoice.yes,
                status=VoteStatus.submitted,
            )
            db_session.add(vote)
        bs = BallotSubmission(
            agm_id=agm.id,
            lot_owner_id=lo.id,
            voter_email=voter_email,
        )
        db_session.add(bs)
        await db_session.flush()

        token = await create_session(db_session, voter_email, building.id, agm.id)

        response = await client.get(
            f"/api/agm/{agm.id}/my-ballot",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["voter_email"] == voter_email
        assert data["agm_title"] == agm.title
        assert data["building_name"] == building.name
        assert len(data["submitted_lots"]) == 1
        assert len(data["submitted_lots"][0]["votes"]) == 2

    async def test_my_ballot_has_remaining_lot_owner_ids(
        self, client: AsyncClient, db_session: AsyncSession, building_with_agm: dict
    ):
        """Unsubmitted lots appear in remaining_lot_owner_ids."""
        agm = building_with_agm["agm"]
        lo = building_with_agm["lot_owner"]
        voter_email = building_with_agm["voter_email"]
        building = building_with_agm["building"]

        # Add a second lot for same voter_email, not yet submitted
        lo2 = LotOwner(building_id=building.id, lot_number="P2-2", unit_entitlement=50)
        db_session.add(lo2)
        await db_session.flush()
        lo2_email = LotOwnerEmail(lot_owner_id=lo2.id, email=voter_email)
        db_session.add(lo2_email)
        await db_session.flush()

        # Submit ballot for lo only
        bs = BallotSubmission(
            agm_id=agm.id,
            lot_owner_id=lo.id,
            voter_email=voter_email,
        )
        db_session.add(bs)
        await db_session.flush()

        token = await create_session(db_session, voter_email, building.id, agm.id)

        response = await client.get(
            f"/api/agm/{agm.id}/my-ballot",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200
        data = response.json()
        assert str(lo2.id) in [str(lid) for lid in data["remaining_lot_owner_ids"]]

    # --- State / precondition errors ---

    async def test_my_ballot_not_submitted_returns_404(
        self, client: AsyncClient, db_session: AsyncSession, building_with_agm: dict
    ):
        agm = building_with_agm["agm"]
        voter_email = building_with_agm["voter_email"]
        building = building_with_agm["building"]

        token = await create_session(db_session, voter_email, building.id, agm.id)

        response = await client.get(
            f"/api/agm/{agm.id}/my-ballot",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 404

    async def test_no_session_returns_401(
        self, client: AsyncClient, building_with_agm: dict
    ):
        agm = building_with_agm["agm"]
        response = await client.get(f"/api/agm/{agm.id}/my-ballot")
        assert response.status_code == 401
