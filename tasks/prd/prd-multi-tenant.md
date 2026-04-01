# PRD: Multi-Tenant Platform

## Introduction

The AGM Voting App currently operates as a single-tenant system: one global admin credential controls all buildings, lot owners, and meetings. This feature converts the platform into a true multi-tenant SaaS product. Each tenant is an organisation (e.g. a strata management company) with its own admin users, buildings, lot owners, and AGMs — fully isolated from every other tenant. A platform operator (superadmin) manages organisations but has no access to tenant data. Voter-facing URLs and authentication flows are unchanged.

---

## Goals

- Allow multiple independent organisations to share the platform without any data leakage between them
- Replace the single global `ADMIN_PASSWORD` env var with per-organisation user accounts (email + password)
- Give each organisation its own admin user management (invite, remove, change role)
- Provide a platform operator interface for provisioning, suspending, and monitoring tenants
- Preserve the existing voter experience entirely — no URL or flow changes for lot owners

---

## User Stories

### MT-PO-01: Create a new tenant organisation

**Status:**

**Description:** As a platform operator, I want to create a new tenant organisation so that a strata management company can start using the platform.

**Acceptance Criteria:**

- [ ] `POST /api/platform/organisations` accepts `name`, `slug`, and `plan` fields
- [ ] `slug` must be URL-safe (lowercase alphanumeric and hyphens only, 3–63 characters), unique across all organisations; returns 422 if invalid or duplicate
- [ ] `plan` must be one of `free`, `standard`, or `enterprise`; returns 422 if unrecognised
- [ ] On success: a new row is inserted in `public.organisations` with `status = active`, a new `tenant_{slug}` schema is created, and all tenant migrations are applied to that schema
- [ ] Returns 201 with the created organisation `id`, `name`, `slug`, `plan`, `status`, and `created_at`
- [ ] Endpoint requires platform operator session; returns 401 if unauthenticated
- [ ] Tenant onboarding is also available through the superadmin UI at `/platform/admin/organisations/new` (see MT-PO-07); the UI form submits to this same `POST /api/platform/organisations` endpoint
- [ ] All tests pass at 100% coverage
- [ ] Typecheck/lint passes

---

### MT-PO-02: Suspend / reactivate a tenant

**Status:**

**Description:** As a platform operator, I want to suspend or reactivate a tenant organisation so that I can respond to billing issues or policy violations without destroying their data.

**Acceptance Criteria:**

- [ ] `POST /api/platform/organisations/{id}/suspend` sets `status = suspended` on the organisation; returns 200
- [ ] `POST /api/platform/organisations/{id}/reactivate` sets `status = active` on the organisation; returns 200
- [ ] Suspending an already-suspended organisation returns 409; reactivating an already-active organisation returns 409
- [ ] Suspending an organisation that does not exist returns 404
- [ ] While an organisation is suspended, all `POST /api/org/{slug}/admin/*` requests return 403 with `detail: "Organisation is suspended"`
- [ ] Voter routes are also blocked for suspended organisations: `POST /api/auth/verify` returns 403 when the resolved organisation is suspended
- [ ] Both endpoints require platform operator session; return 401 if unauthenticated
- [ ] Disable (suspend) and Delete are UI actions on the superadmin dashboard (see MT-PO-08); destructive actions (disable, delete) require a confirmation modal before the API call is made
- [ ] The confirmation modal for Delete requires the operator to re-enter the org slug before the delete is enabled
- [ ] All tests pass at 100% coverage
- [ ] Typecheck/lint passes

---

### MT-PO-03: View all tenants and their status

**Status:**

**Description:** As a platform operator, I want to see a list of all tenant organisations and their current status so that I can monitor platform health and identify issues.

**Acceptance Criteria:**

- [ ] `GET /api/platform/organisations` returns a list of all organisations with `id`, `name`, `slug`, `plan`, `status`, and `created_at`
- [ ] Response is ordered by `created_at` descending
- [ ] Endpoint requires platform operator session; returns 401 if unauthenticated
- [ ] All tests pass at 100% coverage
- [ ] Typecheck/lint passes

---

### MT-PO-04: Run platform-wide migrations across all tenant schemas

**Status:**

**Description:** As a platform operator, I want to run a migration across all tenant schemas in a single command so that schema changes are applied consistently to every organisation's data.

**Acceptance Criteria:**

- [ ] A CLI script `scripts/migrate_all_tenants.py` queries `public.organisations` for all active tenant slugs and runs `alembic upgrade head` against each `tenant_{slug}` schema
- [ ] The script prints per-tenant status (`ok` or `error: <message>`) and exits non-zero if any tenant migration fails
- [ ] Skips suspended organisations by default; a `--include-suspended` flag runs all tenants regardless of status
- [ ] Script is executable from the project root via `uv run python scripts/migrate_all_tenants.py`
- [ ] All tests pass at 100% coverage
- [ ] Typecheck/lint passes

---

### MT-PO-05: Superadmin dashboard

**Status:**

**Description:** As a platform operator, I want a dedicated superadmin dashboard so that I can view and manage all tenant organisations in one place.

**Acceptance Criteria:**

- [ ] A superadmin UI is available at `/platform/admin` (completely separate from any tenant admin UI)
- [ ] The dashboard lists all organisations in a table with columns: name, slug, plan, status, created date, building count, AGM count
- [ ] The table supports search/filter by organisation name or status
- [ ] The page is accessible only to users authenticated with superadmin credentials (see MT-PO-06); unauthenticated users are redirected to `/platform/admin/login`
- [ ] No superadmin UI elements are exposed to org admin users
- [ ] All tests pass at 100% coverage
- [ ] Typecheck/lint passes

---

### MT-PO-06: Superadmin authentication

**Status:**

**Description:** As a platform operator, I want to log in to the superadmin interface with dedicated credentials so that my session is isolated from any org admin session.

**Acceptance Criteria:**

- [ ] Superadmin logs in at `/platform/admin/login` using a separate email + password form
- [ ] `POST /api/platform/auth/login` authenticates the superadmin and sets a session cookie; on success redirects to `/platform/admin`
- [ ] The superadmin session is distinct from any org admin session — different cookie scope/name; an org admin cookie cannot grant access to `/platform/admin/*` routes
- [ ] Superadmin credentials are stored securely (a dedicated `public.platform_admins` DB table with hashed passwords, or env vars — exact mechanism is a design decision documented in `design-multi-tenant.md`)
- [ ] No superadmin UI elements (links, buttons, nav items) are rendered in the org admin interface
- [ ] Invalid credentials return 401; response does not indicate whether email or password was wrong
- [ ] All tests pass at 100% coverage
- [ ] Typecheck/lint passes

---

### MT-PO-07: Tenant onboarding UI

**Status:**

**Description:** As a platform operator, I want a form to onboard a new tenant organisation so that I can provision a new strata company without using the API directly.

**Acceptance Criteria:**

- [ ] A form is available at `/platform/admin/organisations/new` accessible only to authenticated superadmins
- [ ] Form fields: organisation name (text), slug (text — auto-generated from name, but editable), plan (select: `free` / `standard` / `enterprise`), initial admin email (email)
- [ ] Slug auto-generation converts the name to lowercase alphanumeric + hyphens (e.g. "Acme Strata" → "acme-strata"); operator may override before submitting
- [ ] Client-side validation: slug must match `^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$`; email must be a valid email format
- [ ] On submit: calls `POST /api/platform/organisations`; on 201 response, creates the org, provisions the schema, and sends an invite email to the initial admin
- [ ] API validation errors (duplicate slug, invalid plan) are surfaced inline next to the relevant field
- [ ] On success: operator is redirected to the new org's detail page at `/platform/admin/organisations/{slug}`
- [ ] All tests pass at 100% coverage
- [ ] Typecheck/lint passes

---

### MT-PO-08: Tenant management UI

**Status:**

**Description:** As a platform operator, I want a detail page for each tenant organisation so that I can view their details and take management actions.

**Acceptance Criteria:**

- [ ] Each tenant has a detail page at `/platform/admin/organisations/{slug}` accessible only to authenticated superadmins
- [ ] The page displays: org name, slug, plan, status, created date, list of admin users (email + role), building count, AGM count
- [ ] Actions available on the page:
  - Edit: update org name and/or plan (inline or via modal)
  - Disable: suspends the org; requires a confirmation modal before the API call is made
  - Re-enable: reactivates a suspended org
  - Delete: permanently deletes the org and all its data; requires a separate confirmation modal where the operator must re-enter the org slug before the delete button is enabled
  - Impersonate: opens a view-only session as the org admin (read-only; all mutation endpoints reject impersonated sessions)
- [ ] Disable and Delete actions are only visible/enabled when the org is in the appropriate state (e.g. Delete only shown when suspended)
- [ ] All tests pass at 100% coverage
- [ ] Typecheck/lint passes

---

### MT-TA-01: Sign up / be invited to an organisation

**Status:**

**Description:** As a new tenant admin, I want to be invited to an organisation by email so that I can gain access to the admin portal without needing to share a global password.

**Acceptance Criteria:**

- [ ] `POST /api/org/{slug}/admin/users/invite` (requires owner or admin role) accepts `email` and `role` (`admin` or `viewer`); creates an `organisation_users` row with a temporary invite token
- [ ] An invitation email is sent to the provided address containing a single-use accept link valid for 48 hours
- [ ] `POST /api/org/{slug}/admin/users/accept-invite` accepts `token` and `password`; sets the user's `hashed_password` and clears the invite token
- [ ] Accepting an expired or already-used token returns 400
- [ ] Inviting an email already in the organisation returns 409
- [ ] Returns 404 if the organisation slug is not found
- [ ] All tests pass at 100% coverage
- [ ] Typecheck/lint passes

---

### MT-TA-02: Log in with email + password

**Status:**

**Description:** As a tenant admin, I want to log in with my email and password so that I have a personal, auditable session that does not depend on a shared credential.

**Acceptance Criteria:**

- [ ] `POST /api/org/{slug}/admin/auth/login` accepts `email` and `password`; returns 200 and sets a session cookie on success
- [ ] Invalid credentials return 401; the response does not indicate whether the email or password was wrong
- [ ] Rate limiting: 5 failed attempts within 15 minutes from the same IP returns 429 until the window expires
- [ ] The session encodes `{org_id, user_id, role}` — not a global flag
- [ ] Returns 403 if the organisation is suspended
- [ ] Returns 404 if the organisation slug is not found
- [ ] The old `POST /api/admin/auth/login` endpoint (global ADMIN_PASSWORD) is removed
- [ ] All tests pass at 100% coverage
- [ ] Typecheck/lint passes

---

### MT-TA-03: Manage org admin users

**Status:**

**Description:** As an organisation owner, I want to invite, remove, and change the role of admin users in my organisation so that I can control who has access.

**Acceptance Criteria:**

- [ ] `GET /api/org/{slug}/admin/users` returns a list of users in the organisation with `id`, `email`, `role`, and `created_at`; requires owner or admin role
- [ ] `DELETE /api/org/{slug}/admin/users/{user_id}` removes a user; requires owner role; returns 204
- [ ] An owner cannot delete their own account; returns 409
- [ ] An organisation must retain at least one owner; attempting to delete the last owner returns 409
- [ ] `PATCH /api/org/{slug}/admin/users/{user_id}` changes the role of a user to `owner`, `admin`, or `viewer`; requires owner role; returns 200
- [ ] All endpoints require a valid org session; return 401 if unauthenticated
- [ ] All tests pass at 100% coverage
- [ ] Typecheck/lint passes

---

### MT-TA-04: View org settings

**Status:**

**Description:** As a tenant admin, I want to view my organisation's name, slug, and plan so that I can confirm I am operating in the correct context.

**Acceptance Criteria:**

- [ ] `GET /api/org/{slug}/admin/settings` returns `id`, `name`, `slug`, `plan`, and `status` for the organisation
- [ ] Requires a valid org session; returns 401 if unauthenticated
- [ ] Returns 404 if the slug is not found; returns 403 if the organisation is suspended
- [ ] All tests pass at 100% coverage
- [ ] Typecheck/lint passes

---

### MT-TA-05: Access admin dashboard scoped to their organisation only

**Status:**

**Description:** As a tenant admin, I want the admin dashboard to show only my organisation's data so that I cannot accidentally view or modify another organisation's buildings or meetings.

**Acceptance Criteria:**

- [ ] All admin API requests operate against `tenant_{slug}` schema only — no cross-schema data is ever returned
- [ ] The frontend admin portal prefixes all API calls with `/org/{slug}/` using the slug from the active session
- [ ] If a tenant admin attempts to access `/org/{other-slug}/admin/*` with their session, they receive 403
- [ ] All tests pass at 100% coverage
- [ ] Typecheck/lint passes

---

### MT-TA-06: All existing admin features work within org scope

**Status:**

**Description:** As a tenant admin, I want all existing admin features (building management, lot owner import, AGM creation, motion management, report viewing, meeting close) to work exactly as before, scoped to my organisation.

**Acceptance Criteria:**

- [ ] Building CRUD, lot owner import (CSV/Excel), financial position import, proxy import, AGM creation/close, motion management, report viewing, and ballot reset all function under the `/org/{slug}/admin/` prefix
- [ ] Feature behaviour and API contracts are identical to the pre-multi-tenant implementation, except all operations are scoped to `tenant_{slug}` schema
- [ ] Existing integration and E2E tests are updated to use org-scoped URLs
- [ ] All tests pass at 100% coverage
- [ ] Typecheck/lint passes

---

### MT-VT-01: Voter URLs require no org context

**Status:**

**Description:** As a lot owner, I want to access the voting page via a meetingId URL (`/vote/{meetingId}`) without knowing or entering any organisation slug so that the voting flow stays simple.

**Acceptance Criteria:**

- [ ] `POST /api/auth/verify` resolves the correct tenant schema from the `meeting_id` via the `public.meeting_routing` table; no org slug is required in the voter-facing URL or request body
- [ ] If the meeting is not found in `meeting_routing`, the endpoint returns 404
- [ ] The voter frontend URL pattern `/vote/{meetingId}` is unchanged
- [ ] All tests pass at 100% coverage
- [ ] Typecheck/lint passes

---

### MT-VT-02: Voter auth flow unchanged

**Status:**

**Description:** As a lot owner, I want to authenticate using my email and lot number exactly as I do today so that multi-tenancy is invisible to me.

**Acceptance Criteria:**

- [ ] `POST /api/auth/verify` request/response contract is unchanged: accepts email + building context, returns lot list
- [ ] All existing voter auth test scenarios (valid email, email not found, proxy email, closed meeting) continue to pass without modification to the voter-facing contract
- [ ] All tests pass at 100% coverage
- [ ] Typecheck/lint passes

---

### MT-DI-01: Tenant A cannot access Tenant B's data

**Status:**

**Description:** As a platform operator, I want strict data isolation between organisations so that a bug or misconfiguration can never expose one tenant's buildings, lot owners, or votes to another tenant.

**Acceptance Criteria:**

- [ ] Each tenant's data resides in its own PostgreSQL schema (`tenant_{slug}`); no cross-schema JOINs exist in the application layer
- [ ] An authenticated admin session for org A receives 403 on any `/org/{slug-b}/admin/*` request
- [ ] E2E tests seed two orgs (`e2e-org-a`, `e2e-org-b`) and verify: building created in org A is not visible in org B's building list; AGM created in org A cannot be voted on via org B's tenant resolution
- [ ] All tests pass at 100% coverage
- [ ] Typecheck/lint passes

---

### MT-DI-02: Existing single-tenant data migrated to default org

**Status:**

**Description:** As an existing user of the single-tenant system, I want my data to be automatically moved to a default organisation when the platform is upgraded so that there is no data loss or service interruption.

**Acceptance Criteria:**

- [ ] A one-time migration script `scripts/migrate_to_default_org.py` creates a `public.organisations` row (slug: `default`, plan: `standard`, status: `active`) and moves all existing tables to the `tenant_default` schema
- [ ] The script is idempotent: re-running it on an already-migrated database is a no-op
- [ ] `public.meeting_routing` is populated with all existing `general_meetings.id` → `default` mappings
- [ ] After migration, the application starts and all existing admin and voter flows work without manual intervention
- [ ] All tests pass at 100% coverage
- [ ] Typecheck/lint passes

---

### MT-DI-03: Tenant schema created and migrated on org provisioning

**Status:**

**Description:** As a platform operator, I want a new tenant's schema to be created and fully migrated in the same operation that provisions the organisation so that the tenant can start using the platform immediately.

**Acceptance Criteria:**

- [ ] When `POST /api/platform/organisations` succeeds, the `tenant_{slug}` schema exists and all tenant Alembic migrations have been applied before the 201 response is returned
- [ ] If schema creation or migration fails, the `public.organisations` row is rolled back and a 500 is returned
- [ ] All tests pass at 100% coverage
- [ ] Typecheck/lint passes

---

### MT-DI-04: Tenant schema dropped on org deletion

**Status:**

**Description:** As a platform operator, I want to permanently delete an organisation and all its data so that we comply with data retention obligations.

**Acceptance Criteria:**

- [ ] `DELETE /api/platform/organisations/{id}` is only permitted if the organisation is already suspended; returns 409 if attempted on an active org
- [ ] Requires a `confirm=true` query parameter; returns 400 if omitted (confirmation gate)
- [ ] On success: the `tenant_{slug}` schema is dropped with CASCADE, the `public.organisations` row and related `public.organisation_users` rows are deleted, and all `public.meeting_routing` rows for that org's meetings are deleted; returns 204
- [ ] Endpoint requires platform operator session; returns 401 if unauthenticated
- [ ] All tests pass at 100% coverage
- [ ] Typecheck/lint passes

---

## Non-Goals

- SSO / OAuth / SAML — authentication uses email + password only in this version
- Self-service org sign-up — organisations are provisioned by the platform operator only
- Per-tenant custom domains — all tenants share the same domain; orgs are identified by slug in the URL path
- Billing integration — `plan` field is recorded but no payment processing is implemented
- Tenant admin UI for creating/deleting their own organisation — that remains a platform operator action
- Changes to the voter-facing UI or UX — voter flows are explicitly out of scope

---

## Technical Considerations

- PostgreSQL schema-per-tenant is the chosen isolation strategy; see `tasks/design/design-multi-tenant.md` for the full technical design
- The `slug` is used directly in PostgreSQL schema names (`tenant_{slug}`) — must be validated as lowercase alphanumeric + hyphens only before any interpolation to prevent schema name injection
- Alembic requires two separate migration trees: one for the `public` schema, one for tenant schemas
- The `public.meeting_routing` table is the mechanism that lets voter routes resolve the correct tenant schema without an org slug in the URL
- Session cookie must encode `org_id` and `user_id` to enforce per-org access control
- Existing `ADMIN_USERNAME` / `ADMIN_PASSWORD` env vars become the platform operator credentials; all per-tenant auth moves to `public.organisation_users`

---

## Success Metrics

- Zero cross-tenant data leakage detected in E2E isolation tests
- All existing admin and voter E2E tests pass after migration to org-scoped URLs
- New tenant can be provisioned and begin using the platform within 30 seconds of the platform operator API call
- Platform-wide migration script completes all tenant migrations with zero manual intervention

---

## Open Questions

- Should the `viewer` role exist at launch, or should only `owner` and `admin` be implemented initially?
- Should org slugs be immutable after creation, or should the platform operator be able to rename them (which requires renaming the PostgreSQL schema)?
- What is the desired onboarding flow — does the platform operator create the first org owner account, or does the invited owner set their password via the invite flow?
- The platform operator UI is a separate frontend route at `/platform/admin` (decided — see MT-PO-05 through MT-PO-08). CLI tooling (`migrate_all_tenants.py`) remains available for server-side operations.
