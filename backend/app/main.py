import asyncio
import logging
import traceback
import uuid as _uuid_module
from contextlib import asynccontextmanager
from contextvars import ContextVar

import structlog
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.middleware.sessions import SessionMiddleware

from app.config import settings
from app.logging_config import configure_logging, get_logger
from app.routers.admin import router as admin_router
from app.routers.admin_auth import router as admin_auth_router

configure_logging()

logger = logging.getLogger(__name__)
_structlog_logger = get_logger(__name__)

# RR3-38: Per-request ID stored in a context variable so all log lines within
# a request include the same request_id for distributed trace correlation.
_request_id_var: ContextVar[str] = ContextVar("request_id", default="")


_SECURITY_HEADERS = {
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "X-XSS-Protection": "1; mode=block",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy": (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' https://vercel.live https://*.vercel.live; "  # unsafe-inline required for Vite module preload polyfill; vercel.live required for Vercel preview feedback widget
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src 'self' https://fonts.gstatic.com; "
        "img-src 'self' data: https:; "
        "connect-src 'self' https://vercel.live wss://vercel.live https://*.vercel.live wss://*.vercel.live; "  # vercel.live WSS and wildcard subdomains required for Vercel preview feedback widget
        "frame-src https://vercel.live https://*.vercel.live; "  # allows Vercel preview toolbar to load iframes
        "frame-ancestors 'none'"
    ),
}


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        try:
            response = await call_next(request)
        except Exception as exc:
            # Catch unhandled exceptions that propagate through call_next (RR3-11).
            # BaseHTTPMiddleware re-raises route exceptions via call_next, bypassing
            # FastAPI's app.exception_handler(Exception) registration.  We catch them
            # here to: (a) log the full traceback server-side, and (b) return a safe
            # generic 500 response so internal details never reach the client.
            logger.error("Unhandled exception: %s\n%s", exc, traceback.format_exc())
            error_response = JSONResponse(
                status_code=500,
                content={"detail": "An internal error occurred"},
            )
            for header, value in _SECURITY_HEADERS.items():
                error_response.headers[header] = value
            return error_response
        for header, value in _SECURITY_HEADERS.items():
            response.headers[header] = value
        return response


class CSRFMiddleware(BaseHTTPMiddleware):
    """US-IAS-05: Require X-Requested-With header on all state-changing requests.

    SameSite=Lax cookies are NOT automatically included in cross-origin subresource
    requests (XHR/fetch) but ARE included on top-level navigation POST from the same
    site.  By requiring the X-Requested-With header on POST/PATCH/PUT/DELETE we prevent
    cross-origin form-based CSRF attacks: a cross-origin attacker cannot set arbitrary
    request headers without first passing a CORS preflight, which our CORS policy blocks.

    Exceptions:
    - OPTIONS (preflight) — must not be blocked
    - GET/HEAD — safe/idempotent, no state change
    - /api/admin/auth/login — called with JSON, X-Requested-With always present via fetch;
      exempt here to avoid blocking admin login from non-browser clients / Playwright tests.
    - testing_mode=True — CSRF check is skipped entirely so unit/integration tests that
      do not send X-Requested-With are not blocked.
    """

    _EXEMPT_PATHS = {"/api/admin/auth/login", "/api/admin/auth/logout", "/api/admin/auth/hash-password"}
    _STATE_CHANGING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

    async def dispatch(self, request: Request, call_next):
        # Skip CSRF in testing mode so integration tests are not required to send the header.
        if settings.testing_mode:
            return await call_next(request)
        if (
            request.method in self._STATE_CHANGING_METHODS
            and request.url.path not in self._EXEMPT_PATHS
            and "X-Requested-With" not in request.headers
        ):
            return JSONResponse(
                status_code=403,
                content={"detail": "CSRF check failed: X-Requested-With header missing"},
            )
        return await call_next(request)


class RequestIDMiddleware(BaseHTTPMiddleware):
    """RR3-38: Attach a UUID request ID to every request.

    Generates a new UUID per request, stores it in the _request_id_var context
    variable, and binds it into structlog's context so every log line emitted
    within the request includes ``request_id``.  Also sets the X-Request-ID
    response header for client-side correlation.
    """

    async def dispatch(self, request: Request, call_next):
        request_id = str(_uuid_module.uuid4())
        _request_id_var.set(request_id)
        structlog.contextvars.bind_contextvars(request_id=request_id)
        try:
            response = await call_next(request)
        finally:
            structlog.contextvars.unbind_contextvars("request_id")
        response.headers["X-Request-ID"] = request_id
        return response


async def _check_migration_head() -> None:
    """Verify the DB schema is at the expected Alembic head revision (RR3-20).

    Performs a direct SELECT on alembic_version rather than running
    `alembic current` (which spawns a subprocess) so the check completes
    in < 100 ms.  Logs a CRITICAL error if the revision does not match
    head — this makes the mismatch visible in structured logs and alerting
    systems without hard-crashing the Lambda (which would prevent rollback
    via a revert deploy).
    """
    try:
        from alembic.config import Config as AlembicConfig
        from alembic.script import ScriptDirectory
        from sqlalchemy import text as _text
        from app.database import AsyncSessionLocal

        # Resolve the Alembic head revision from the migration scripts.
        # script_location is relative to the backend directory.
        import os
        _backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        alembic_cfg = AlembicConfig(os.path.join(_backend_dir, "alembic.ini"))
        script = ScriptDirectory.from_config(alembic_cfg)
        head_rev = script.get_current_head()

        async with AsyncSessionLocal() as db:
            result = await db.execute(_text("SELECT version_num FROM alembic_version LIMIT 1"))
            row = result.first()
            current_rev = row[0] if row else None

        if current_rev != head_rev:
            _structlog_logger.critical(
                "migration_head_mismatch",
                current_revision=current_rev,
                expected_head=head_rev,
            )
        else:
            _structlog_logger.info(
                "migration_head_ok",
                revision=current_rev,
            )
    except Exception as exc:
        _structlog_logger.error("migration_head_check_failed", error=str(exc))


@asynccontextmanager
async def lifespan(app: FastAPI):  # pragma: no cover
    # Startup: check migration head and requeue pending email deliveries
    await _check_migration_head()
    from app.database import AsyncSessionLocal
    from app.services.email_service import EmailService
    async with AsyncSessionLocal() as db:
        await EmailService().requeue_pending_on_startup(db)
    yield
    # Shutdown: cleanup


def create_app() -> FastAPI:
    app = FastAPI(
        title="General Meeting Voting App",
        version="0.1.0",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.allowed_origin],
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        # US-IAS-05: X-Requested-With is our CSRF double-submit header.
        # SameSite=Lax cookies are sent on top-level navigations from cross-origin
        # but NOT on cross-origin subresource requests (XHR/fetch).  However, to
        # defend against CSRF via cross-origin form posts that browsers still allow
        # on Lax, we also require X-Requested-With on every state-changing request
        # (enforced by CSRFMiddleware below).  A cross-origin attacker cannot set
        # arbitrary headers without passing the CORS preflight — providing strong CSRF
        # protection without needing a separate synchronizer token.
        allow_headers=["Content-Type", "Authorization", "Accept", "X-Requested-With"],
    )
    app.add_middleware(
        SessionMiddleware,
        secret_key=settings.session_secret,
        # https_only in all non-development environments (production + preview) — RR3-35
        https_only=settings.environment != "development",
        same_site="lax",
    )
    # SecurityHeadersMiddleware runs after CORS (Starlette runs middleware in
    # reverse registration order, so registering it last means it executes first
    # on the way in / last on the way out — ensuring headers are set on every
    # response including CORS preflight responses).
    app.add_middleware(SecurityHeadersMiddleware)
    # RR3-38: RequestIDMiddleware generates a UUID per request and binds it to
    # structlog context so all log lines include request_id.  Registered after
    # SecurityHeadersMiddleware so it executes before SecurityHeadersMiddleware
    # on the way in (Starlette reverse order).
    app.add_middleware(RequestIDMiddleware)
    # US-IAS-05: CSRFMiddleware enforces X-Requested-With on state-changing requests.
    app.add_middleware(CSRFMiddleware)

    @app.exception_handler(Exception)
    async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        """Catch-all handler that prevents raw exception messages reaching the client.

        Logs the full traceback server-side and returns a generic 500 response so
        that stack traces and internal error details are never exposed to callers
        (RR3-11).

        HTTPException is intentionally not caught here — FastAPI handles it
        before this handler runs, so it only fires for truly unhandled exceptions.
        """
        logger.error("Unhandled exception: %s\n%s", exc, traceback.format_exc())
        return JSONResponse(
            status_code=500,
            content={"detail": "An internal error occurred"},
        )

    from app.routers.public import router as public_router
    from app.routers.auth import router as auth_router
    from app.routers.voting import router as voting_router

    app.include_router(public_router, prefix="/api")
    app.include_router(auth_router, prefix="/api")
    app.include_router(voting_router, prefix="/api")
    app.include_router(admin_auth_router, prefix="/api/admin")
    app.include_router(admin_router, prefix="/api/admin")

    from app.database import get_db

    @app.get("/api/health")
    async def health(db: AsyncSession = Depends(get_db)) -> dict:
        """Health check that verifies live database connectivity.

        Executes SELECT 1 with a 2-second timeout.
        Returns 200 {"status": "ok", "db": "connected"} when the DB is reachable.
        Returns 503 {"status": "degraded", "db": "unreachable", "error": "..."} on
        any DB failure or timeout.
        """
        try:
            await asyncio.wait_for(db.execute(select(1)), timeout=2.0)
            return {"status": "ok", "db": "connected"}
        except Exception as exc:
            raise HTTPException(
                status_code=503,
                detail={"status": "degraded", "db": "unreachable", "error": str(exc)},
            )

    @app.get("/api/health/live")
    async def health_live() -> dict:
        """Process liveness probe — always returns 200 without touching the DB.

        Use this endpoint for container/Lambda process-level liveness checks that
        must never fail due to transient DB issues.
        """
        return {"status": "ok"}

    return app


app = create_app()
