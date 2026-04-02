# Design: Lot Owner Names

**Status:** Implemented

## Overview

Add optional `given_name` and `surname` fields to lot owners and proxies to improve admin identification during in-person AGMs.

Covers US-LON-01, US-LON-02.

---

## Root Cause / Background

Admins need to identify lot owners by name during in-person AGMs. Currently only lot number and email are stored; there is no way to display a human-readable name in the vote entry grid or lot owner table.

---

## Technical Design

### Database changes

**`lot_owners` table** — add two nullable columns:

```sql
ALTER TABLE lot_owners
  ADD COLUMN given_name VARCHAR,
  ADD COLUMN surname    VARCHAR;
```

**`lot_proxies` table** — add two nullable columns:

```sql
ALTER TABLE lot_proxies
  ADD COLUMN given_name VARCHAR,
  ADD COLUMN surname    VARCHAR;
```

Both columns are nullable; no defaults required. Existing rows have `NULL` for both after migration.

### Backend changes

**Modified `LotOwner` model** (`backend/app/models/lot_owner.py`):
- Add `given_name: Mapped[str | None]` and `surname: Mapped[str | None]`.

**Modified `LotProxy` model** (`backend/app/models/lot_proxy.py`):
- Add `given_name: Mapped[str | None]` and `surname: Mapped[str | None]`.

**Modified Pydantic schemas** (`backend/app/schemas/admin.py`):
- `LotOwnerCreate`: add optional `given_name: str | None = None`, `surname: str | None = None`.
- `LotOwnerUpdate`: add optional `given_name: str | None = None`, `surname: str | None = None`.
- `LotOwnerOut`: add `given_name: str | None`, `surname: str | None`.
- `SetProxyRequest`: add optional `given_name: str | None = None`, `surname: str | None = None`.
- Proxy sub-object within `LotOwnerOut`: add `given_name: str | None`, `surname: str | None`.

**Modified `admin_service`** (`backend/app/services/admin_service.py`):
- `add_lot_owner`: persist `given_name`/`surname` from `LotOwnerCreate`.
- `update_lot_owner`: persist `given_name`/`surname` from `LotOwnerUpdate`.
- `set_lot_owner_proxy`: persist `given_name`/`surname` on `LotProxy`.
- `import_lot_owners_from_csv` / `import_lot_owners_from_excel`: detect optional `given_name`/`surname` columns (case-insensitive); silently skip if absent.
- `import_proxies_from_csv` / `import_proxies_from_excel`: detect optional `proxy_given_name`/`proxy_surname` columns; silently skip if absent.

### Frontend changes

**Modified `AddLotOwnerForm`** (within `BuildingDetailPage.tsx` or its own component):
- Add optional "Given name" and "Surname" `.field` inputs below existing fields.

**Modified `LotOwnerEditModal`**:
- Add "Given name" and "Surname" fields pre-filled from existing values.

**Modified lot owner table** on building detail page:
- Add a "Name" column rendering `${given_name ?? ""} ${surname ?? ""}`.trim(), showing blank for owners with no name.

No voter-facing pages are modified.

---

## Files to Change

| File | Change |
|------|--------|
| `backend/app/models/lot_owner.py` | Add `given_name`, `surname` columns |
| `backend/app/models/lot_proxy.py` | Add `given_name`, `surname` columns |
| `backend/alembic/versions/` | Migration: add nullable name columns to both tables |
| `backend/app/schemas/admin.py` | Extend `LotOwnerCreate/Update/Out`, `SetProxyRequest` |
| `backend/app/services/admin_service.py` | Persist names in CRUD + import functions |
| `frontend/src/pages/admin/BuildingDetailPage.tsx` | Add given name/surname fields to Add and Edit forms; add Name column to table |
| `frontend/tests/msw/handlers.ts` | Update mock responses with name fields |

---

## Test Cases

### Unit / Integration
- Add lot owner with name: `given_name`/`surname` persisted and returned.
- Add lot owner without name: succeeds; fields are null.
- CSV import with name columns: names imported correctly.
- CSV import without name columns: import succeeds; names are null.
- Set proxy with name: name persisted on `LotProxy`.

### E2E
- Admin adds a lot owner with a name; name appears in the lot owner table.

---

## Schema Migration Required

Yes — additive, backward-compatible:
- `lot_owners.given_name` (VARCHAR nullable)
- `lot_owners.surname` (VARCHAR nullable)
- `lot_proxies.given_name` (VARCHAR nullable)
- `lot_proxies.surname` (VARCHAR nullable)
