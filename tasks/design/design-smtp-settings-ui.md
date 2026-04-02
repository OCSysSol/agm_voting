# Design: DB-Backed SMTP Configuration

**Status:** Draft

## Overview

Move SMTP configuration from environment variables into the database so admins can update mail server settings through the admin settings page without a redeployment.

Covers US-SMTP-01 through US-SMTP-06.

---

## Root Cause / Background

Currently SMTP credentials are hardcoded in Vercel env vars. When the mail server changes or credentials rotate, a redeployment is required. Storing SMTP config in DB allows admins to update it at runtime through the admin UI, and gives an "unconfigured" warning banner when no SMTP is set.

---

## Technical Design

### Database changes

**New table `tenant_smtp_config`:**

```sql
CREATE TABLE tenant_smtp_config (
    id               INTEGER PRIMARY KEY DEFAULT 1,
    smtp_host        VARCHAR NOT NULL DEFAULT '',
    smtp_port        INTEGER NOT NULL DEFAULT 587,
    smtp_username    VARCHAR NOT NULL DEFAULT '',
    smtp_password_enc VARCHAR,          -- AES-256-GCM encrypted, base64-encoded; NULL means not set
    smtp_from_email  VARCHAR NOT NULL DEFAULT '',
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Row `id = 1` is the singleton. A CHECK constraint `id = 1` enforces the singleton invariant. Seeded by the migration from existing `SMTP_*` env vars (if present).

**No changes to `TenantConfig` table** — SMTP is kept in a separate table to isolate credentials.

### Backend changes

**New model** `backend/app/models/tenant_smtp_config.py`:
- `TenantSmtpConfig` SQLAlchemy model mirroring the table above.
- `smtp_password_enc` is stored encrypted; a `@property` method `smtp_password` decrypts and returns the plaintext using the `SMTP_ENCRYPTION_KEY` env var. If the key is absent or the field is null, returns `""`.

**New encryption utility** `backend/app/crypto.py`:
- `encrypt_smtp_password(plaintext: str, key_b64: str) -> str` — AES-256-GCM, returns base64-encoded `nonce + ciphertext + tag`.
- `decrypt_smtp_password(enc_b64: str, key_b64: str) -> str` — reverses the above.
- Uses Python `cryptography` library (`Fernet`-style but with explicit GCM for auditability).

**New service** `backend/app/services/smtp_config_service.py`:
- `get_smtp_config(db) -> TenantSmtpConfig` — returns singleton row; creates empty default row if missing.
- `update_smtp_config(data: SmtpConfigUpdate, db) -> TenantSmtpConfig` — upserts all fields; if `password` field in `data` is `None` or empty string, leaves `smtp_password_enc` unchanged.
- `is_smtp_configured(db) -> bool` — returns `True` only when `smtp_host`, `smtp_username`, `smtp_from_email` are non-empty AND `smtp_password_enc IS NOT NULL`.

**New Pydantic schemas** `backend/app/schemas/config.py` (additions):
- `SmtpConfigOut`: `smtp_host`, `smtp_port`, `smtp_username`, `smtp_from_email` — **no** `smtp_password` field.
- `SmtpConfigUpdate`: `smtp_host`, `smtp_port`, `smtp_username`, `smtp_from_email` (all required), `smtp_password: str | None = None` (optional; `None` = keep existing).
- `SmtpStatusOut`: `{"configured": bool}`.

**New endpoints** in `backend/app/routers/admin.py`:
- `GET /api/admin/config/smtp` → `SmtpConfigOut` (no password field in response).
- `PUT /api/admin/config/smtp` → `SmtpConfigOut` — calls `smtp_config_service.update_smtp_config`.
- `POST /api/admin/config/smtp/test` — loads current DB config, attempts `aiosmtplib.send` of a plain-text test message to `smtp_from_email`; returns `{"ok": true}` on success or raises HTTPException with the SMTP error message; rate-limited to 5 requests/min per admin session.
- `GET /api/admin/config/smtp/status` → `SmtpStatusOut` — unauthenticated-accessible (needed by admin layout banner, which is already behind admin auth, but this keeps the status check cheap).

**Modified `email_service.py`**:
- `send_report()` and `send_otp_email()` both gain a new `db: AsyncSession` parameter (already present on `send_report` via the `EmailService` class; add to `send_otp_email` call signature or pass via a new `_get_smtp_config(db)` helper).
- Both functions call `smtp_config_service.get_smtp_config(db)` to obtain `host`, `port`, `username`, `password` (decrypted), `from_email`. If any required field is empty, raise `SmtpNotConfiguredError` (new exception class in `email_service.py`).
- `SmtpNotConfiguredError` is caught in `trigger_with_retry`: transitions `EmailDelivery.status = failed` immediately (no retry) and sets `last_error = "SMTP not configured — configure mail server in admin settings"`.

**Modified `config.py` (Settings)**:
- `smtp_host`, `smtp_port`, `smtp_username`, `smtp_password`, `smtp_from_email` fields are marked deprecated with a comment; they are retained for the migration seeding step only and must be removed in a subsequent release.
- `smtp_encryption_key: str = ""` — new field for the AES key; logged as WARNING on startup if empty.

**Migration** (`backend/alembic/versions/`):
- Creates `tenant_smtp_config` table.
- Data migration: reads `settings.smtp_host` etc. at migration time; if `smtp_host` is non-empty, inserts seed row; encrypts password if `settings.smtp_encryption_key` is non-empty.
- The migration is written to be idempotent: skips the seed insert if a row already exists.

### Frontend changes

**Modified `SettingsPage.tsx`**:
- On mount, also calls `GET /api/admin/config/smtp` to load SMTP fields.
- New "Mail Server" card section below Tenant Branding:
  - Fields: Host (text, required), Port (number, min=1, max=65535, default 587), Username (text, required), From email (type="email", required), Password (type="password", placeholder="Enter new password to change", `autocomplete="new-password"`).
  - Save button submits `PUT /api/admin/config/smtp`.
  - "Send test email" button calls `POST /api/admin/config/smtp/test`; shows inline success/error message.
- If SMTP fields load as all-empty (unconfigured), shows an amber inline notice above the Mail Server fields.

**Modified `AdminLayout.tsx`** (or a new `SmtpWarningBanner` component):
- On mount, calls `GET /api/admin/config/smtp/status`.
- When `configured = false`, renders a dismissible amber banner at the top of the admin shell content area (not inside the nav).

**New API client functions** in `frontend/src/api/config.ts`:
- `getSmtpConfig()` → `SmtpConfigOut`.
- `updateSmtpConfig(data: SmtpConfigUpdate)` → `SmtpConfigOut`.
- `testSmtpConfig()` → `{ok: true}` or throws with error message.
- `getSmtpStatus()` → `{configured: boolean}`.

---

## Security Considerations

- `SMTP_ENCRYPTION_KEY` — a 32-byte random key stored as a base64-encoded env var. The encrypted password is stored in the DB but never returned to clients. The key must be rotated if compromised; a key-rotation endpoint is out of scope but documented as a runbook step.
- `GET /api/admin/config/smtp` and `SmtpConfigOut` never include the password field (write-only).
- `POST /api/admin/config/smtp/test` is rate-limited to 5 calls/min per admin session to prevent SMTP relay abuse.
- SMTP config fields are validated server-side (port range 1–65535, from_email must be a valid email address, host must be non-empty).

---

## Files to Change

| File | Change |
|------|--------|
| `backend/app/models/tenant_smtp_config.py` | New model for SMTP singleton config row |
| `backend/app/crypto.py` | New AES-256-GCM encrypt/decrypt utility |
| `backend/app/services/smtp_config_service.py` | New service: get/update/status |
| `backend/app/schemas/config.py` | Add `SmtpConfigOut`, `SmtpConfigUpdate`, `SmtpStatusOut` |
| `backend/alembic/versions/` | Migration: create `tenant_smtp_config` + data seed |
| `backend/app/routers/admin.py` | Add SMTP config endpoints |
| `backend/app/services/email_service.py` | Load SMTP from DB; add `SmtpNotConfiguredError` |
| `backend/app/config.py` | Add `smtp_encryption_key`; deprecate existing SMTP fields |
| `frontend/src/api/config.ts` | Add SMTP config API client functions |
| `frontend/src/pages/admin/SettingsPage.tsx` | Add Mail Server section |
| `frontend/src/pages/admin/AdminLayout.tsx` | Add SMTP unconfigured banner |
| `frontend/tests/msw/handlers.ts` | Add MSW handlers for SMTP config endpoints |

---

## Test Cases

### Unit / Integration
- `get_smtp_config` returns default empty row when table has no row.
- `update_smtp_config` with all fields: row is upserted; password is encrypted.
- `update_smtp_config` with blank password: existing encrypted password is retained.
- `is_smtp_configured` returns `False` when host is empty; `True` when all required fields set.
- `send_report` raises `SmtpNotConfiguredError` when host is empty; `EmailDelivery.status = failed` immediately with no retry.
- `send_otp_email` raises `SmtpNotConfiguredError` when unconfigured.
- `POST /api/admin/config/smtp/test` — success: returns `{ok: true}`; SMTP failure: returns 400 with SMTP error message.
- `GET /api/admin/config/smtp` never includes `smtp_password` field in response.
- Migration seeding: when `SMTP_HOST` env var is set, the migration inserts a seed row; running migration twice does not duplicate the row.

### E2E
- Admin navigates to Settings; enters SMTP host/port/username/from-email/password; saves; "Saved" message appears.
- Admin clicks "Send test email"; inline success message appears.
- Unconfigured banner visible on meetings list page; disappears after saving valid SMTP config.

---

## Schema Migration Required

Yes — includes data migration:
- Create `tenant_smtp_config` table (id, smtp_host, smtp_port, smtp_username, smtp_password_enc, smtp_from_email, updated_at)
- Data migration: seed from `SMTP_*` env vars if present (idempotent)
