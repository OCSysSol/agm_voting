"""Tests for admin authentication endpoints — /api/admin/auth/."""
from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db

# ---------------------------------------------------------------------------
# Admin auth endpoints
# ---------------------------------------------------------------------------


class TestAdminAuth:
    # --- Happy path ---

    async def test_login_valid_credentials_returns_ok(self, db_session: AsyncSession):
        """Valid username + password → {"ok": true}."""
        import bcrypt
        from unittest.mock import patch
        from app.main import create_app

        app_instance = create_app()

        async def override_get_db():
            yield db_session

        app_instance.dependency_overrides[get_db] = override_get_db

        # Hash "admin" so _verify_admin_password accepts it
        hashed = bcrypt.hashpw(b"admin", bcrypt.gensalt()).decode()

        with patch.object(
            __import__("app.config", fromlist=["settings"]).settings,
            "admin_password",
            hashed,
        ), patch.object(
            __import__("app.config", fromlist=["settings"]).settings,
            "admin_username",
            "admin",
        ):
            async with AsyncClient(
                transport=ASGITransport(app=app_instance), base_url="http://test"
            ) as c:
                response = await c.post(
                    "/api/admin/auth/login",
                    json={"username": "admin", "password": "admin"},
                )
        assert response.status_code == 200
        assert response.json()["ok"] is True

    async def test_login_invalid_credentials_returns_401(self, db_session: AsyncSession):
        """Wrong username + wrong password returns 401.

        A bcrypt hash must be patched into admin_password so _verify_admin_password does not
        raise ValueError (which it would with the default plaintext 'admin' value).
        Before the timing-safe fix, short-circuit evaluation meant bcrypt never ran when the
        username was wrong.  Now bcrypt always runs, so a valid hash is required in settings.
        """
        import bcrypt
        from unittest.mock import patch
        from app.main import create_app

        app_instance = create_app()

        async def override_get_db():
            yield db_session

        app_instance.dependency_overrides[get_db] = override_get_db

        hashed = bcrypt.hashpw(b"correct_pw", bcrypt.gensalt()).decode()

        with patch.object(
            __import__("app.config", fromlist=["settings"]).settings,
            "admin_password",
            hashed,
        ), patch.object(
            __import__("app.config", fromlist=["settings"]).settings,
            "admin_username",
            "admin",
        ):
            async with AsyncClient(
                transport=ASGITransport(app=app_instance), base_url="http://test"
            ) as c:
                response = await c.post(
                    "/api/admin/auth/login",
                    json={"username": "wrong", "password": "bad"},
                )
        assert response.status_code == 401

    async def test_logout_clears_session(self, db_session: AsyncSession):
        from app.main import create_app

        app_instance = create_app()

        async def override_get_db():
            yield db_session

        app_instance.dependency_overrides[get_db] = override_get_db

        async with AsyncClient(
            transport=ASGITransport(app=app_instance), base_url="http://test"
        ) as c:
            await c.post(
                "/api/admin/auth/login",
                json={"username": "admin", "password": "admin"},
            )
            response = await c.post("/api/admin/auth/logout")
        assert response.status_code == 200
        assert response.json()["ok"] is True

    async def test_me_authenticated_returns_true(self, db_session: AsyncSession):
        import bcrypt
        from unittest.mock import patch
        from app.main import create_app

        app_instance = create_app()

        async def override_get_db():
            yield db_session

        app_instance.dependency_overrides[get_db] = override_get_db

        hashed = bcrypt.hashpw(b"admin", bcrypt.gensalt()).decode()

        with patch.object(
            __import__("app.config", fromlist=["settings"]).settings,
            "admin_password",
            hashed,
        ), patch.object(
            __import__("app.config", fromlist=["settings"]).settings,
            "admin_username",
            "admin",
        ):
            async with AsyncClient(
                transport=ASGITransport(app=app_instance), base_url="http://test"
            ) as c:
                await c.post(
                    "/api/admin/auth/login",
                    json={"username": "admin", "password": "admin"},
                )
                response = await c.get("/api/admin/auth/me")
        assert response.status_code == 200
        assert response.json()["authenticated"] is True

    async def test_me_unauthenticated_returns_401(self, db_session: AsyncSession):
        from app.main import create_app

        app_instance = create_app()

        async def override_get_db():
            yield db_session

        app_instance.dependency_overrides[get_db] = override_get_db

        async with AsyncClient(
            transport=ASGITransport(app=app_instance), base_url="http://test"
        ) as c:
            response = await c.get("/api/admin/auth/me")
        assert response.status_code == 401

    def test_verify_admin_password_bcrypt_path_verify_called(self):
        """_verify_admin_password calls bcrypt.checkpw for $2b$-prefixed hashes."""
        import bcrypt
        from app.routers.admin_auth import _verify_admin_password

        # Generate a real bcrypt hash and verify it round-trips correctly.
        hashed = bcrypt.hashpw(b"mypass", bcrypt.gensalt()).decode()
        result = _verify_admin_password("mypass", hashed)
        assert result is True

    def test_verify_admin_password_wrong_password_returns_false(self):
        """_verify_admin_password returns False for incorrect password."""
        import bcrypt
        from app.routers.admin_auth import _verify_admin_password

        hashed = bcrypt.hashpw(b"correct", bcrypt.gensalt()).decode()
        result = _verify_admin_password("wrong", hashed)
        assert result is False

    async def test_hash_password_endpoint_returns_bcrypt_hash(self, db_session: AsyncSession):
        """POST /api/admin/auth/hash-password returns a bcrypt hash in non-production."""
        from app.main import create_app

        app_instance = create_app()

        async def override_get_db():
            yield db_session

        app_instance.dependency_overrides[get_db] = override_get_db

        async with AsyncClient(
            transport=ASGITransport(app=app_instance), base_url="http://test"
        ) as c:
            response = await c.post(
                "/api/admin/auth/hash-password",
                json={"password": "mypassword"},
            )
        assert response.status_code == 200
        data = response.json()
        assert data["hash"].startswith("$2b$")

    async def test_hash_password_endpoint_returns_404_in_production(self, db_session: AsyncSession):
        """POST /api/admin/auth/hash-password returns 404 when ENVIRONMENT=production."""
        from unittest.mock import patch
        from app.main import create_app

        app_instance = create_app()

        async def override_get_db():
            yield db_session

        app_instance.dependency_overrides[get_db] = override_get_db

        with patch.object(__import__("app.config", fromlist=["settings"]).settings, "environment", "production"):
            async with AsyncClient(
                transport=ASGITransport(app=app_instance), base_url="http://test"
            ) as c:
                response = await c.post(
                    "/api/admin/auth/hash-password",
                    json={"password": "mypassword"},
                )
        assert response.status_code == 404


