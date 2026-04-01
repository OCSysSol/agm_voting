# Design: Multi-Tenant Platform

**Status:** Draft

## Overview

This document describes the technical design for converting the AGM Voting App from a single-tenant system (one global admin credential, all data in one PostgreSQL schema) to a multi-tenant SaaS platform. Each tenant is an independent organisation with its own isolated PostgreSQL schema, its own admin user accounts, and no visibility into other tenants' data. The voter-facing URL and authentication flow are unchanged.

---

## Root Cause / Background

The current system stores all data (buildings, lot owners, AGMs, votes) in a single PostgreSQL schema and authenticates admin users against two env vars (`ADMIN_USERNAME`, `ADMIN_PASSWORD`). This design cannot support multiple independent strata management companies sharing the platform: any admin can see all buildings and meetings, and there is no concept of organisational ownership. The multi-tenant feature addresses this by introducing a `public` schema for platform-level data and one `tenant_{slug}` schema per organisation for all tenant data.

---

## Technical Design

### 1. Schema structure

The database is split into a single `public` schema (platform-level) and one `tenant_{slug}` schema per organisation (tenant-level).

```
public schema
  organisations           (id, name, slug, plan, status, created_at)
  organisation_users      (id, org_id, email, hashed_password, role, invite_token, invite_expires_at, created_at)
  meeting_routing         (meeting_id UUID PK, org_slug TEXT NOT NULL)
  alembic_version_public  (version_num — tracks public schema migrations)

tenant_{slug} schema      (one per org — example: tenant_acme)
  buildings
  lot_owners
  lot_owner_emails
  lot_proxies
  general_meetings
  general_meeting_lot_weights
  motions
  motion_options
  ballot_submissions
  votes
  email_deliveries
  admin_login_attempts
  session_records
  auth_otps
  otp_rate_limits
  tenant_configs
  alembic_version         (version_num — tracks tenant schema migrations)
```

All tables currently in the default schema become tenant tables. No data is shared between tenant schemas at the application layer.

### 2. New models

**`Organisation`** — one row per tenant.

Fields (prose design):
- `id`: UUID, primary key, default `gen_random_uuid()`
- `name`: String, not null — human-readable display name (e.g. "Acme Strata")
- `slug`: String, unique, not null — URL-safe identifier used in API paths and PostgreSQL schema name (e.g. `acme`). Validated as: lowercase letters, digits, and hyphens only; 3–63 characters; must not start or end with a hyphen.
- `plan`: Enum (`free` | `standard` | `enterprise`), not null
- `status`: Enum (`active` | `suspended`), not null, default `active`
- `created_at`: DateTime(timezone=True), server default `now()`

Constraints: `UNIQUE(slug)`.

**`OrganisationUser`** — admin user belonging to one organisation.

Fields (prose design):
- `id`: UUID, primary key, default `gen_random_uuid()`
- `org_id`: UUID, FK → `public.organisations.id` ON DELETE CASCADE, not null
- `email`: String, not null — used as login identifier
- `hashed_password`: String, nullable — null until the user accepts their invite
- `role`: Enum (`owner` | `admin` | `viewer`), not null
- `invite_token`: String, nullable — single-use token sent in the invitation email; cleared on acceptance
- `invite_expires_at`: DateTime(timezone=True), nullable — 48 hours after invite creation
- `created_at`: DateTime(timezone=True), server default `now()`

Constraints: `UNIQUE(org_id, email)`.

**`MeetingRouting`** — lookup table for resolving voter requests to the correct tenant schema without requiring an org slug in the URL.

Fields (prose design):
- `meeting_id`: UUID, primary key — matches `general_meetings.id` in the relevant tenant schema
- `org_slug`: String, not null — slug of the owning organisation; validated before use as a schema name

This table is written to when an AGM is created and deleted when an AGM or organisation is deleted.

### 3. Alembic migration strategy

Two separate Alembic migration trees are required because the `public` schema and tenant schemas evolve independently.

**Directory layout:**
```
backend/alembic/
  versions_public/     # migrations for public.organisations, public.organisation_users, public.meeting_routing
  versions_tenant/     # migrations for all tenant tables (moved from current alembic/versions/)
  env.py               # updated to support --schema flag and two version locations
  alembic_public.ini   # Alembic config pointing at versions_public/
  alembic_tenant.ini   # Alembic config pointing at versions_tenant/
```

The existing `alembic/versions/` directory is renamed to `alembic/versions_tenant/`. The `alembic_version` table in each tenant schema tracks tenant migrations; a separate `alembic_version_public` table in the `public` schema tracks public migrations.

**`env.py` changes:** The environment file reads an optional `-x schema=<name>` argument. When `schema=public` is passed, it sets `search_path` to `public` and uses `versions_public/`. When `schema=tenant_<slug>` is passed, it validates the slug (alphanumeric + hyphens only), sets `search_path` to `tenant_{slug}, public`, and uses `versions_tenant/`.

**CLI usage:**

```bash
# Migrate the public schema (platform-level tables):
uv run alembic -c alembic/alembic_public.ini upgrade head

# Provision a new tenant schema:
uv run alembic -c alembic/alembic_tenant.ini -x schema=tenant_acme upgrade head

# Platform-wide migration (all tenants):
uv run python scripts/migrate_all_tenants.py

# Stamp existing tenant_default after data migration:
uv run alembic -c alembic/alembic_tenant.ini -x schema=tenant_default stamp head
```

**`scripts/migrate_all_tenants.py`:** Queries `SELECT slug FROM public.organisations` (optionally filtering by `status = 'active'`), then for each slug runs `alembic -c alembic/alembic_tenant.ini -x schema=tenant_{slug} upgrade head` as a subprocess. Collects per-tenant exit codes and prints a summary. Exits non-zero if any tenant fails. Accepts `--include-suspended` flag.

**Vercel build command:** Updated to run both the public migration and `migrate_all_tenants.py` before the Lambda goes live, replacing the current single `alembic upgrade head` call.

### 4. FastAPI tenant resolution

A dependency chain provides the correct database session scoped to a tenant schema. All admin routes depend on the full chain; voter routes use a lighter chain that resolves from `meeting_routing`.

**Dependency: `get_org(slug: str, db: AsyncSession)`**
- Queries `SELECT * FROM public.organisations WHERE slug = ?`
- Raises `404` if not found
- Raises `403` with `"Organisation is suspended"` if `status == suspended`
- Returns the `Organisation` object

**Dependency: `get_tenant_db(org: Organisation, db: AsyncSession)`**
- Validates `org.slug` against the slug allowlist pattern (`^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$`) before interpolation
- Executes `SET LOCAL search_path = tenant_{org.slug}, public` on the session
- Yields the scoped db session
- On exit, resets `search_path` to `public`

**Dependency: `get_org_user(request: Request, org: Organisation, db: AsyncSession)`**
- Reads `session["user_id"]` and `session["org_id"]` from the cookie
- If the session is missing or `session["org_id"] != org.id`, raises `401`
- Queries `organisation_users WHERE id = user_id AND org_id = org.id`
- Returns the `OrganisationUser` object

**Voter resolution: `get_tenant_db_for_meeting(meeting_id: UUID, db: AsyncSession)`**
- Queries `SELECT org_slug FROM public.meeting_routing WHERE meeting_id = ?`
- Raises `404` if not found
- Calls `get_org` with the resolved slug (which enforces suspension check)
- Calls `get_tenant_db` to set `search_path`
- Yields the scoped db session

All existing admin route handler signatures are updated to depend on `get_org` (slug from path) + `get_tenant_db` + `get_org_user`. Voter route handlers (`auth.py`, `voting.py`, `public.py`) are updated to depend on `get_tenant_db_for_meeting`.

### 5. Auth flow changes

**Old:** `POST /api/admin/auth/login` checks `ADMIN_USERNAME` / `ADMIN_PASSWORD` env vars. Session sets `request.session["admin"] = True`.

**New:** `POST /api/org/{slug}/admin/auth/login` accepts `email` and `password`. Looks up `OrganisationUser WHERE org_id = org.id AND email = ?`. If found and `hashed_password` is not null, runs `bcrypt.checkpw`. On success sets `request.session["org_id"] = str(org.id)`, `request.session["user_id"] = str(user.id)`, `request.session["role"] = user.role`. On failure, increments the `AdminLoginAttempt` record (keyed on IP, scoped to the public schema).

**Platform operator auth:** `POST /api/platform/auth/login` checks `PLATFORM_ADMIN_USERNAME` / `PLATFORM_ADMIN_PASSWORD` env vars (bcrypt). Session sets `request.session["platform_admin"] = True`. Completely separate from per-tenant auth — no org context.

**Existing `POST /api/admin/auth/login`:** Removed. Any frontend or E2E code referencing this endpoint must be updated to use the org-scoped login URL.

**`require_admin` dependency** is replaced by `get_org_user`, which enforces both authentication and org-scoping. A `require_platform_admin` dependency (checks `session["platform_admin"]`) is added for platform operator routes.

**Role-based access:** `owner` can do everything. `admin` can manage buildings, lot owners, meetings, and motions. `viewer` has read-only access. Role enforcement is applied per-endpoint by checking `org_user.role`.

### 6. Admin URL routing

All existing admin routes are moved from the `/api/admin/` prefix to `/api/org/{slug}/admin/`. The slug path parameter is consumed by the `get_org` dependency and never needs to be passed explicitly to service functions — the tenant-scoped `db` session handles schema routing transparently.

**Before:**
```
POST /api/admin/auth/login
GET  /api/admin/buildings
POST /api/admin/agms
...
```

**After:**
```
POST /api/org/{slug}/admin/auth/login
GET  /api/org/{slug}/admin/buildings
POST /api/org/{slug}/admin/agms
...
```

Platform operator routes live on a separate prefix with no org context:
```
POST /api/platform/auth/login
GET  /api/platform/organisations
POST /api/platform/organisations
POST /api/platform/organisations/{id}/suspend
POST /api/platform/organisations/{id}/reactivate
DELETE /api/platform/organisations/{id}
```

**Frontend routing changes:** The React admin app is updated so that on successful login the org slug is stored in the session context (or read from the URL). The API client module (`frontend/src/api/`) prepends `/org/{slug}/` to all admin API calls automatically. Individual admin components do not need to know the slug. Frontend routes change from `/admin/...` to `/org/{slug}/admin/...`.

### 7. Voter URL routing

The voter-facing URL pattern (`/vote/{meetingId}`) and all voter request contracts are unchanged. The backend resolves the tenant schema internally using `public.meeting_routing`.

**Resolution flow:**
1. `POST /api/auth/verify` includes a `meeting_id` in the request body (already present as AGM context)
2. The `get_tenant_db_for_meeting` dependency queries `public.meeting_routing WHERE meeting_id = ?`
3. The resolved `org_slug` is validated and used to set `search_path = tenant_{slug}, public`
4. The remainder of the auth and voting logic proceeds identically to the pre-multi-tenant implementation

**Why a routing table instead of a cross-schema scan:** A `public.meeting_routing` lookup is O(1) on the UUID primary key and requires no knowledge of which schemas exist. A cross-schema scan would require dynamic SQL across a variable number of schemas, cannot be indexed, and leaks schema names to the application layer.

**`meeting_routing` maintenance:**
- Written when: `POST /api/org/{slug}/admin/agms` creates a new `GeneralMeeting`
- Deleted when: `DELETE /api/org/{slug}/admin/agms/{id}` is called (if that endpoint exists)
- Bulk-deleted when: `DELETE /api/platform/organisations/{id}` drops the tenant schema

### 8. Data migration plan for existing single-tenant data

This migration is executed once, in order, against the live database. It is implemented as `scripts/migrate_to_default_org.py` and is idempotent.

```sql
-- Step 1: Run public schema migrations to create organisations, organisation_users, meeting_routing
uv run alembic -c alembic/alembic_public.ini upgrade head

-- Step 2: Insert the default organisation (idempotent: INSERT ... ON CONFLICT DO NOTHING)
INSERT INTO public.organisations (id, name, slug, plan, status, created_at)
VALUES (gen_random_uuid(), 'Default Organisation', 'default', 'standard', 'active', now())
ON CONFLICT (slug) DO NOTHING;

-- Step 3: Create the tenant_default schema (idempotent: CREATE SCHEMA IF NOT EXISTS)
CREATE SCHEMA IF NOT EXISTS tenant_default;

-- Step 4: Move all existing tables into tenant_default
--         (only executed if table exists in public schema — idempotency check)
ALTER TABLE buildings           SET SCHEMA tenant_default;
ALTER TABLE lot_owners          SET SCHEMA tenant_default;
ALTER TABLE lot_owner_emails    SET SCHEMA tenant_default;
ALTER TABLE lot_proxies         SET SCHEMA tenant_default;
ALTER TABLE general_meetings    SET SCHEMA tenant_default;
ALTER TABLE general_meeting_lot_weights SET SCHEMA tenant_default;
ALTER TABLE motions             SET SCHEMA tenant_default;
ALTER TABLE motion_options      SET SCHEMA tenant_default;
ALTER TABLE ballot_submissions  SET SCHEMA tenant_default;
ALTER TABLE votes               SET SCHEMA tenant_default;
ALTER TABLE email_deliveries    SET SCHEMA tenant_default;
ALTER TABLE admin_login_attempts SET SCHEMA tenant_default;
ALTER TABLE session_records     SET SCHEMA tenant_default;
ALTER TABLE auth_otps           SET SCHEMA tenant_default;
ALTER TABLE otp_rate_limits     SET SCHEMA tenant_default;
ALTER TABLE tenant_configs      SET SCHEMA tenant_default;
ALTER TABLE alembic_version     SET SCHEMA tenant_default;

-- Step 5: Stamp the tenant_default schema at the current Alembic head
--         (marks all existing migrations as applied without re-running them)
uv run alembic -c alembic/alembic_tenant.ini -x schema=tenant_default stamp head

-- Step 6: Populate meeting_routing (idempotent: INSERT ... ON CONFLICT DO NOTHING)
INSERT INTO public.meeting_routing (meeting_id, org_slug)
SELECT id, 'default' FROM tenant_default.general_meetings
ON CONFLICT (meeting_id) DO NOTHING;
```

The script verifies that the `tenant_default` schema and `public.organisations` row both exist and that `meeting_routing` is populated before returning success. If any step fails, the error is reported with the failing SQL and the script exits non-zero without partial rollback (all ALTER TABLE statements are DDL — autocommit in PostgreSQL; the script must be re-run after fixing the issue).

### 9. E2E test strategy

**Test org provisioning:** E2E tests create two organisations at the start of the suite:
- `e2e-org-a` with one building, one AGM, and one lot owner
- `e2e-org-b` with one building, one AGM, and one lot owner (different email/lot)

Both orgs are provisioned via the platform operator API (`POST /api/platform/organisations`) and cleaned up via `DELETE /api/platform/organisations/{id}` after the suite completes (both orgs are pre-suspended before deletion). Schema cleanup also drops `tenant_e2e-org-a` and `tenant_e2e-org-b`.

**Cross-tenant isolation tests:**
- Admin logged into `e2e-org-a` calls `GET /api/org/e2e-org-b/admin/buildings` → expects 403
- Building created in `e2e-org-a` does not appear in `GET /api/org/e2e-org-b/admin/buildings`
- Voter uses AGM from `e2e-org-a`; `POST /api/auth/verify` resolves to `tenant_e2e-org-a` and finds the lot; attempting to re-use the same meeting_id against `e2e-org-b` data finds nothing

**Voter tests:** Unchanged — they use `meetingId` directly and do not reference org slugs.

**Cleanup pattern:** Test orgs match the existing pattern (`E2E*`) and are excluded from real data operations by the documented test data conventions.

### 10. Security considerations

**`search_path` injection:** The `org.slug` value is interpolated directly into `SET LOCAL search_path = tenant_{slug}, public`. Before any interpolation, the slug must be validated against the strict pattern `^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$`. Validation failure raises `400` immediately. This is enforced both at org creation time (write-once) and at every dependency invocation (defence in depth).

**Schema name allowlist:** Before setting `search_path`, the application verifies that a schema named `tenant_{slug}` actually exists in `pg_namespace`. This prevents a suspended-then-deleted org's slug from being used to set an arbitrary search path.

**Platform operator routes:** Platform routes (`/api/platform/*`) are on a completely separate router, protected by `require_platform_admin`. They have no org context and cannot access tenant schemas directly.

**Session isolation:** Session cookies encode `org_id`; the `get_org_user` dependency cross-checks `session["org_id"] == org.id` on every request. A cookie from org A cannot be used against org B's routes.

**Invitation tokens:** Single-use tokens are generated with `secrets.token_urlsafe(32)` (256 bits of entropy), stored as a bcrypt hash in `invite_token`, and expire after 48 hours. Accepting an invite clears both `invite_token` and `invite_expires_at`.

**Rate limiting:** `AdminLoginAttempt` records are scoped to IP address and stored in the `public` schema (shared across all orgs) to prevent an attacker from brute-forcing one org to avoid triggering another org's rate limit.

**Password storage:** All passwords (org user passwords, platform operator password env var) are stored/compared as bcrypt hashes. The `POST /api/org/{slug}/admin/auth/hash-password` dev helper is gated by `settings.environment != "production"`, same as the existing implementation.

**Data exposure:** The platform operator API returns organisation metadata only (`id`, `name`, `slug`, `plan`, `status`). It never returns `hashed_password`, session data, or any tenant schema data.

**New env vars required:** `PLATFORM_ADMIN_USERNAME`, `PLATFORM_ADMIN_PASSWORD` (bcrypt hash) for platform operator auth. All existing env vars are unchanged.

### 11. Superadmin role

#### Auth

Superadmin credentials are stored in a dedicated `public.platform_admins` table rather than env vars alone. This allows multiple platform operators and provides a proper audit trail.

**`platform_admins` table** (in the `public` schema):
- `id`: UUID, primary key, default `gen_random_uuid()`
- `email`: String, unique, not null
- `hashed_password`: String, not null — bcrypt hash
- `created_at`: DateTime(timezone=True), server default `now()`

Single or very few rows expected. Initial row seeded via a CLI script or migration with a bcrypt-hashed password.

**Login flow:** `POST /api/platform/login` accepts `email` and `password`. Looks up `platform_admins WHERE email = ?`. If found, runs `bcrypt.checkpw`. On success sets `request.session["role"] = "superadmin"` and `request.session["platform_admin_id"] = str(admin.id)`. No `org_id` is present in the session. On failure returns 401.

**Session cookie:** Named differently from the org admin session cookie (e.g. `platform_session` vs `org_session`) so the two session types cannot interfere. Both use `httponly=True`, `samesite="lax"`, `secure=True` in production.

#### Route separation

All superadmin API routes live under `/api/platform/admin/...`. They are mounted on a separate FastAPI `APIRouter` and protected by a `require_superadmin` dependency.

**`require_superadmin` dependency:**
- Reads `session["role"]` from the request
- If `session["role"] != "superadmin"`, raises `401`
- Returns `session["platform_admin_id"]`

This dependency is completely separate from `require_platform_admin` (which checked env vars in the earlier design) and from `get_org_user`. No org admin session can satisfy `require_superadmin`.

**Route prefixes:**
```
POST /api/platform/login                                    # superadmin login
GET  /api/platform/admin/organisations                      # list all orgs (with building/AGM counts)
POST /api/platform/admin/organisations                      # create org + provision schema
GET  /api/platform/admin/organisations/{slug}               # org detail
PATCH /api/platform/admin/organisations/{slug}              # edit name/plan
POST /api/platform/admin/organisations/{slug}/suspend       # disable org
POST /api/platform/admin/organisations/{slug}/reactivate    # re-enable org
DELETE /api/platform/admin/organisations/{slug}             # delete org (requires slug confirmation in body)
POST /api/platform/admin/organisations/{slug}/impersonate   # start view-only impersonation session
DELETE /api/platform/admin/impersonate                      # end impersonation session
```

The older `/api/platform/organisations/*` paths (documented in section 6) are unified under `/api/platform/admin/organisations/*` for consistency. The `require_superadmin` dependency replaces the earlier `require_platform_admin` env-var check.

#### Frontend routes

All superadmin pages live under the `/platform/admin/...` path prefix. They use a dedicated React layout component (`PlatformAdminLayout`) that is completely separate from the org admin layout. The layout is lazy-loaded via React Router's `lazy()` so it is never bundled with org admin or voter pages.

No shared state exists between the superadmin pages and org admin pages: different React context providers, different API client instances, different session cookies.

**Superadmin React routes:**
```
/platform/admin/login                        → PlatformLoginPage
/platform/admin                              → PlatformDashboardPage  (org list + search/filter)
/platform/admin/organisations/new            → TenantOnboardingPage
/platform/admin/organisations/{slug}         → TenantDetailPage
```

Route protection: a `PlatformAdminGuard` component wraps all `/platform/admin/*` routes except `/login`. It calls `GET /api/platform/admin/me` on mount; if the response is 401 it redirects to `/platform/admin/login`.

#### Tenant onboarding flow (step by step)

When the operator submits the form at `/platform/admin/organisations/new`, the following sequence executes server-side within a single request handler:

1. Validate `name`, `slug` (unique + pattern check), `plan`, and `initial_admin_email`
2. `INSERT INTO public.organisations ...` — creates the org row with `status = active`
3. `CREATE SCHEMA tenant_{slug}` — creates the isolated tenant schema
4. Run Alembic migrations against the new schema: `alembic -c alembic/alembic_tenant.ini -x schema=tenant_{slug} upgrade head`
5. `INSERT INTO public.organisation_users (org_id, email, role, invite_token, invite_expires_at) ...` — creates the initial admin user row with a single-use invite token (no password set yet)
6. Send invite email to `initial_admin_email` with a password-set link containing the invite token
7. `public.meeting_routing` is not populated at this step — it is written when the new org admin creates their first AGM
8. Return 201 with the created org details

If any step from 3 onward fails, the `public.organisations` row is rolled back and a 500 is returned. Schema creation is non-transactional DDL — if it succeeds but step 4 fails, the orphan schema is logged for manual cleanup.

#### Disable vs Delete

**Disable (suspend):**
- Sets `public.organisations.status = 'suspended'`
- All API calls for that org (`/api/org/{slug}/...`) return 403 with `"Organisation is suspended"`
- Data is fully preserved in `tenant_{slug}` schema
- Reversible via reactivate action

**Delete (permanent):**
- Requires org to already be suspended (returns 409 if attempted on active org)
- Requires the operator to confirm by supplying the org slug in the request body (`{"confirm_slug": "acme"}`)
- Steps executed in order:
  1. `DROP SCHEMA tenant_{slug} CASCADE` — removes all tenant data
  2. `DELETE FROM public.meeting_routing WHERE org_slug = ?`
  3. `DELETE FROM public.organisation_users WHERE org_id = ?`
  4. `DELETE FROM public.organisations WHERE id = ?`
- Returns 204 on success

The frontend confirmation modal for Delete renders a text input and enables the "Delete" button only when the entered value matches the org slug exactly.

#### Impersonation (view-only)

Impersonation allows a superadmin to view an org admin's dashboard without knowing their password. It is strictly read-only.

**Start impersonation:** `POST /api/platform/admin/organisations/{slug}/impersonate`
- Protected by `require_superadmin`
- Validates the org exists and is active
- Sets `request.session["impersonating_org_slug"] = slug` alongside the existing superadmin session fields
- Returns 200

**End impersonation:** `DELETE /api/platform/admin/impersonate`
- Clears `impersonating_org_slug` from the session
- Returns 204

**Enforcement on org admin routes:** A new `reject_impersonation` dependency is added to all mutation endpoints (`POST`, `PATCH`, `PUT`, `DELETE`) under `/api/org/{slug}/admin/...`. It checks `session.get("impersonating_org_slug")` — if present, returns 403 with `"Mutation not permitted during impersonation"`. Read-only endpoints (`GET`) do not apply this dependency and are accessible during impersonation.

**Frontend behaviour:** When the superadmin session has `impersonating_org_slug` set, the org admin frontend renders a persistent banner ("Viewing as {slug} — read-only mode") and disables all action buttons (create, edit, delete, import, close meeting). The banner includes an "Exit impersonation" button that calls `DELETE /api/platform/admin/impersonate`.

---

## Files to Change

| File | Change |
|------|--------|
| `backend/app/models/__init__.py` | Export `Organisation`, `OrganisationUser`, `MeetingRouting` |
| `backend/app/models/organisation.py` | New — `Organisation` and `OrganisationUser` models |
| `backend/app/models/meeting_routing.py` | New — `MeetingRouting` model |
| `backend/app/routers/admin_auth.py` | Replace env-var auth with `OrganisationUser` lookup; update session payload |
| `backend/app/routers/admin.py` | Add `org` path param + `get_org` / `get_tenant_db` / `get_org_user` dependencies to all endpoints |
| `backend/app/routers/auth.py` | Add `get_tenant_db_for_meeting` dependency; replace `get_db` |
| `backend/app/routers/voting.py` | Add `get_tenant_db_for_meeting` dependency; replace `get_db` |
| `backend/app/routers/public.py` | Add `get_tenant_db_for_meeting` dependency; replace `get_db` |
| `backend/app/routers/platform.py` | New — platform operator CRUD for organisations |
| `backend/app/dependencies.py` | New — `get_org`, `get_tenant_db`, `get_org_user`, `get_tenant_db_for_meeting`, `require_platform_admin` |
| `backend/app/services/admin_service.py` | Remove global credential checks; add `meeting_routing` write on AGM create |
| `backend/app/services/org_service.py` | New — org provisioning, suspension, deletion, user invite/accept |
| `backend/app/schemas/platform.py` | New — Pydantic schemas for platform operator API |
| `backend/app/schemas/org_user.py` | New — Pydantic schemas for org user management |
| `backend/app/main.py` | Mount platform router; update admin router prefix to `/api/org/{slug}/admin` |
| `backend/app/config.py` | Add `platform_admin_username`, `platform_admin_password` settings |
| `backend/alembic/env.py` | Support `--schema` flag; route to `versions_public/` vs `versions_tenant/` |
| `backend/alembic/alembic_public.ini` | New — Alembic config for public schema |
| `backend/alembic/alembic_tenant.ini` | New — Alembic config for tenant schemas |
| `backend/alembic/versions_public/` | New directory — public schema migrations |
| `backend/alembic/versions_tenant/` | Renamed from `alembic/versions/` — tenant schema migrations |
| `backend/scripts/migrate_all_tenants.py` | New — platform-wide migration runner |
| `backend/scripts/migrate_to_default_org.py` | New — one-time single-tenant → multi-tenant data migration |
| `frontend/src/api/adminApi.ts` | Prefix all admin API calls with `/org/{slug}/` |
| `frontend/src/api/authApi.ts` | Update login endpoint to `/org/{slug}/admin/auth/login` |
| `frontend/src/api/platformApi.ts` | New — API client for all `/api/platform/admin/...` endpoints |
| `frontend/src/context/OrgContext.tsx` | New — stores active org slug in React context |
| `frontend/src/pages/admin/` | Update all admin page routes from `/admin/...` to `/org/{slug}/admin/...` |
| `frontend/src/components/admin/` | Remove hardcoded `/api/admin/` references |
| `frontend/src/pages/platform/PlatformLoginPage.tsx` | New — superadmin login form at `/platform/admin/login` |
| `frontend/src/pages/platform/PlatformDashboardPage.tsx` | New — org list with search/filter at `/platform/admin` |
| `frontend/src/pages/platform/TenantOnboardingPage.tsx` | New — new org form at `/platform/admin/organisations/new` |
| `frontend/src/pages/platform/TenantDetailPage.tsx` | New — org detail + management actions at `/platform/admin/organisations/{slug}` |
| `frontend/src/components/platform/PlatformAdminLayout.tsx` | New — separate layout wrapper for all `/platform/admin/*` pages |
| `frontend/src/components/platform/PlatformAdminGuard.tsx` | New — auth guard; redirects unauthenticated visitors to `/platform/admin/login` |
| `frontend/src/components/platform/ImpersonationBanner.tsx` | New — read-only mode banner shown during superadmin impersonation |
| `frontend/tests/msw/handlers.ts` | Update all admin API mock handlers to use org-scoped URLs; add platform admin mock handlers |
| `backend/app/models/platform_admin.py` | New — `PlatformAdmin` SQLAlchemy model (`public.platform_admins` table) |
| `backend/app/models/__init__.py` | Export `PlatformAdmin` |
| `backend/app/routers/platform_admin.py` | New — superadmin CRUD + suspend/reactivate/delete/impersonate routes under `/api/platform/admin/...` |
| `backend/app/dependencies.py` | Add `require_superadmin` and `reject_impersonation` dependencies |
| `backend/app/services/platform_admin_service.py` | New — superadmin login, org detail queries (building/AGM counts), impersonation logic |
| `backend/app/schemas/platform_admin.py` | New — Pydantic schemas for superadmin API (org list with counts, impersonation) |
| `backend/alembic/versions_public/` | New migration — `public.platform_admins` table |
| `vercel.json` | Update `buildCommand` to run public migration + `migrate_all_tenants.py` |

---

## Test Cases

### Unit / Integration

**Organisation provisioning (`POST /api/platform/organisations`):**
- Happy path: valid name/slug/plan → 201, org row created, `tenant_{slug}` schema exists in `pg_namespace`
- Duplicate slug → 422
- Invalid slug (uppercase, spaces, too short) → 422
- Unknown plan → 422
- Platform auth missing → 401

**Tenant suspension / reactivation:**
- Suspend active org → 200, status = suspended
- Suspend already-suspended org → 409
- Reactivate suspended org → 200, status = active
- Admin login on suspended org → 403
- Voter auth on meeting belonging to suspended org → 403

**Org user invite / accept:**
- Invite new email → 200, invite email sent, `hashed_password` is null
- Invite duplicate email → 409
- Accept with valid token → 200, `hashed_password` set, token cleared
- Accept with expired token → 400
- Accept with already-used token → 400

**Org-scoped admin login:**
- Valid credentials → 200, session encodes org_id + user_id + role
- Invalid password → 401
- Wrong org slug in URL → 404
- 5 failed attempts from same IP → 429

**Cross-tenant access control:**
- Admin of org A calls `GET /api/org/org-b/admin/buildings` with org A session → 403
- `get_org_user` with mismatched `session["org_id"]` → 401

**Voter resolution (`get_tenant_db_for_meeting`):**
- Valid meeting_id in `meeting_routing` → resolves to correct tenant schema
- Unknown meeting_id → 404
- meeting_id belongs to suspended org → 403

**`meeting_routing` maintenance:**
- Creating an AGM inserts a row into `public.meeting_routing`
- Deleting an org (DELETE platform route) removes all routing rows for that org's meetings

**`migrate_all_tenants.py`:**
- All active tenants migrated → exits 0, prints `ok` per tenant
- One tenant fails → exits non-zero, reports failed slug
- `--include-suspended` flag includes suspended orgs

### E2E

- **Scenario: Org A admin cannot see Org B buildings.** Log in as e2e-org-a admin. Call buildings list. Verify only org-a buildings are returned. Call `/org/e2e-org-b/admin/buildings` — expect 403.
- **Scenario: Voter uses meetingId to vote without knowing org slug.** Navigate to `/vote/{meeting_id_from_org_a}`. Auth with org-a lot owner email. Vote. Confirm ballot recorded in `tenant_e2e-org-a.ballot_submissions`.
- **Scenario: Suspended org blocks login.** Platform operator suspends e2e-org-a. Attempt admin login → 403. Attempt voter auth for org-a meeting → 403. Reactivate → login succeeds.
- **Scenario: Org deletion with confirmation gate.** Attempt DELETE without `confirm=true` → 400. Attempt DELETE on active org → 409. Suspend org, then DELETE with `confirm=true` → 204, schema no longer in `pg_namespace`.
- **Scenario: All existing admin E2E tests pass under org-scoped URLs.** The full existing Playwright suite is re-run with updated API base URLs; no test should fail due to the URL change alone.

---

## Schema Migration Required

Yes — adds `public.organisations`, `public.organisation_users`, and `public.meeting_routing` tables; moves all existing tenant tables from the default PostgreSQL schema into `tenant_default`; adds two new Alembic migration trees (`versions_public/`, `versions_tenant/`).
