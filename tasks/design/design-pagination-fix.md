# Design: `list_general_meetings` Pagination Correctness Fix

**Status:** Implemented

## Overview

`list_general_meetings` in `admin_service.py` applies the `status` filter in Python after SQL `LIMIT/OFFSET` has already been applied. This means pages can be short (or empty) even when more results exist, and the companion `count_general_meetings` ignores the status filter entirely. The fix pushes the effective-status derivation into a SQL `CASE` expression so that both filtering and counting happen entirely in the database — matching the approach already implemented in `count_general_meetings` (RR5-09) but not yet applied to `list_general_meetings`.

---

## Root Cause / Background

**Root cause: `list_general_meetings`, `admin_service.py` lines 1279–1287.**

The query issues `LIMIT`/`OFFSET` before filtering:

```python
result = await db.execute(q.offset(offset).limit(limit))
rows = result.all()
for general_meeting, building_name in rows:
    effective = get_effective_status(general_meeting)
    if status is not None and effective_str != status:
        continue          # post-SQL discard — item was already counted in LIMIT
```

`count_general_meetings` had the same bug and was fixed in RR5-09 by adding a SQL `CASE` expression. That fix was applied only to the count function. `list_general_meetings` still uses the broken post-filter approach.

The three observable failure modes are:
1. A page of `limit=20` may return fewer than 20 results if some rows in the SQL window have a different effective status.
2. Empty pages appear mid-result-set while later pages still have results.
3. The total count returned by `count_general_meetings` is wrong when a status filter is supplied (because count ignores the status filter at all — it has no `if status is not None` guard in the current code before the RR5-09 fix, and now that `count_general_meetings` has been fixed the count and list results are inconsistent with each other).

---

## Options Evaluated

### Option 1 — SQL CASE expression in WHERE (recommended)

Translate the Python `get_effective_status()` precedence rules verbatim into a SQL `CASE` expression and push it into the `WHERE` clause. This is identical to what `count_general_meetings` already does after RR5-09.

Advantages:
- Zero schema change; no migration required.
- Consistent with the already-fixed `count_general_meetings` — the two functions share the same expression.
- All filtering, counting, ordering, and pagination happen in a single SQL query.
- Straightforward to test.

Disadvantages:
- `func.now()` is evaluated once per query; microsecond races between the list query and the count query could produce a count/page mismatch, but this is the same behaviour as all other pagination implementations in the codebase and is not a practical concern.

### Option 2 — PostgreSQL generated column

Add an `effective_status` stored generated column to `general_meetings`. This would allow a simple `WHERE effective_status = :status` clause.

Rejected because:
- Requires a schema migration and a new Alembic version file.
- PostgreSQL stored generated columns cannot reference `now()` (they are evaluated at write time, not read time), so the column would still not reflect the current effective status dynamically — the whole point of the feature.
- More migration risk for no correctness benefit over Option 1.

### Option 3 — Overfetch approach

Fetch `limit * N` rows, apply Python filter, return first `limit` results.

Rejected because:
- Correctness is not guaranteed for large `N` and skewed data distributions.
- Still does not fix `count_general_meetings`.
- Wastes database and network resources.
- Does not generalise cleanly to offset-based pagination.

---

## Technical Design

### SQL expression

The effective-status `CASE` expression mirrors `get_effective_status()` exactly:

```sql
CASE
  WHEN status = 'closed'              THEN 'closed'
  WHEN voting_closes_at < NOW()       THEN 'closed'
  WHEN meeting_at > NOW()             THEN 'pending'
  ELSE                                     'open'
END
```

In SQLAlchemy this is:

```python
from sqlalchemy import case, literal

_effective_status_expr = case(
    (GeneralMeeting.status == GeneralMeetingStatus.closed.value, literal("closed")),
    (GeneralMeeting.voting_closes_at < func.now(),               literal("closed")),
    (GeneralMeeting.meeting_at > func.now(),                     literal("pending")),
    else_=literal("open"),
)
```

This expression already exists inside `count_general_meetings`. It must be extracted into a module-level helper (or an inline constant) so both functions share one definition.

### Database changes

None. No schema changes. No migration required.

### Backend changes

#### `backend/app/services/admin_service.py`

**1. Extract `_effective_status_expr` as a module-level helper.**

Currently the `case(...)` expression is defined inline inside `count_general_meetings`. Extract it to a module-level constant or a zero-argument factory function immediately after the `_MEETINGS_SORT_COLUMNS` dict (around line 1247), so that both `list_general_meetings` and `count_general_meetings` consume the same definition.

Because `func.now()` must be called fresh per query (to get the correct timestamp at execution time rather than import time), the cleanest approach is a factory function:

```python
def _effective_status_case():
    """SQL CASE expression mirroring get_effective_status() for use in WHERE clauses."""
    return case(
        (GeneralMeeting.status == GeneralMeetingStatus.closed.value, literal("closed")),
        (GeneralMeeting.voting_closes_at < func.now(), literal("closed")),
        (GeneralMeeting.meeting_at > func.now(), literal("pending")),
        else_=literal("open"),
    )
```

**2. Modify `list_general_meetings` to push the status filter into SQL.**

Before:
```python
result = await db.execute(q.offset(offset).limit(limit))
rows = result.all()
items = []
for general_meeting, building_name in rows:
    effective = get_effective_status(general_meeting)
    effective_str = effective.value if hasattr(effective, "value") else effective
    if status is not None and effective_str != status:
        continue
    items.append(...)
return items
```

After:
```python
if status is not None:
    q = q.where(_effective_status_case() == status)
result = await db.execute(q.offset(offset).limit(limit))
rows = result.all()
items = []
for general_meeting, building_name in rows:
    effective = get_effective_status(general_meeting)
    effective_str = effective.value if hasattr(effective, "value") else effective
    items.append(...)
return items
```

The `get_effective_status()` call is retained for the response payload (it produces the `"status"` field in the returned dict). The Python filter branch (`if status is not None and effective_str != status: continue`) is removed — it is now redundant.

**3. Simplify `count_general_meetings` to use `_effective_status_case()`.**

Remove the inline `case(...)` definition and the local `from sqlalchemy import case, literal` import from inside the function body. Replace both with a call to `_effective_status_case()`. The top-level `from sqlalchemy import case, literal` import must be added at the module level alongside the existing imports.

### Frontend changes

None. The endpoint signature (`GET /api/admin/general-meetings`) and response shape do not change.

---

## Key Design Decisions

**Why a factory function rather than a module-level constant?**
`func.now()` produces a SQLAlchemy `Function` object. When used as a module-level constant it would still be evaluated lazily at SQL-compile time, so a constant would technically work. However, a factory function makes the intent explicit — each call to `list_general_meetings` or `count_general_meetings` constructs a fresh expression tied to the current transaction's `NOW()`. This avoids any future confusion about whether the constant is safe to reuse across sessions.

**Why retain `get_effective_status()` in the list loop?**
The response dict must include a `"status"` field containing the effective status string. Rather than also selecting the CASE expression from SQL as an additional column (which would require changes to the query result unpacking and is more invasive), we keep the Python calculation for the response payload. This is acceptable because it runs over the small slice of rows returned — it is never applied to the full table. The SQL filter is what fixes the pagination correctness; the Python call is only used to populate the response.

**Why not fix the sort-by-status ordering at the same time?**
Sorting by `status` currently sorts by the stored `status` column, not the effective status. This is a separate, lower-priority issue. The current task is correctness of filtering and counting. A future fix could replace `GeneralMeeting.status` in `_MEETINGS_SORT_COLUMNS` with `_effective_status_case()` but that change is out of scope here.

---

## Data Flow (happy path with status filter)

1. Admin calls `GET /api/admin/general-meetings?status=open&limit=20&offset=0`.
2. Router validates parameters and calls `admin_service.list_general_meetings(db, limit=20, offset=0, status="open")`.
3. Service builds the base query (JOIN with Building, ORDER BY, name/building_id filters if present).
4. Because `status` is not None, appends `WHERE _effective_status_case() = 'open'` to the query.
5. Applies `OFFSET 0 LIMIT 20` — the database now applies limit/offset over the already-filtered result set.
6. Fetches exactly up to 20 rows, all of which have effective status `open`.
7. Loops over rows, calls `get_effective_status()` to populate the `"status"` field, appends to `items`.
8. Returns `items` (length 0–20, always consistent with the filter).

---

## Security Considerations

No security implications. This fix changes only internal query construction for an admin-authenticated endpoint. No new endpoints, no new parameters, no changes to auth requirements, no new data exposed.

---

## Files to Change

| File | Change |
|------|--------|
| `backend/app/services/admin_service.py` | Extract `_effective_status_case()` factory; remove Python post-filter from `list_general_meetings`; add SQL WHERE clause for status; simplify `count_general_meetings` to call the factory |

---

## Test Cases

### Unit / Integration

New tests belong in `backend/tests/test_rr5_fixes.py` alongside the existing `TestCountGeneralMeetings` class, or in a new `TestListGeneralMeetingsPagination` class in `backend/tests/test_admin_meetings_api.py`.

**Pagination correctness (the core regression):**
- Seed a building with `limit + 5` meetings that are effectively `open` and `limit - 1` meetings that are effectively `closed`. Call `list_general_meetings(limit=limit, offset=0, status="open")`. Assert result length equals `limit` (not `limit - 1` or fewer). This directly exercises the bug where the old Python post-filter would discard rows after `LIMIT` had already been applied.
- Seed a building with 3 pages worth of open meetings. Call with `offset=0`, `offset=limit`, `offset=2*limit`. Assert each page returns exactly `limit` items (or the remainder on the last page) and that no meeting appears on multiple pages.
- Seed a mix of open, closed, and pending meetings. Call without a status filter. Assert total returned equals total seeded (no accidental filtering).

**Effective-status → open:**
- Meeting stored as `open`, `meeting_at` in the past, `voting_closes_at` in the future → listed under `status=open`.

**Effective-status → closed (via stored status):**
- Meeting stored as `closed`, `voting_closes_at` in the future → listed under `status=closed` (stored status wins).

**Effective-status → closed (via timestamp):**
- Meeting stored as `open`, `voting_closes_at` in the past → listed under `status=closed` (timestamp overrides stored status).

**Effective-status → pending:**
- Meeting stored as `pending`, `meeting_at` in the future, `voting_closes_at` further in the future → listed under `status=pending`.

**List/count agreement with status filter:**
- For each of `open`, `closed`, `pending`: call both `list_general_meetings(status=x, limit=10000)` and `count_general_meetings(status=x)` against the same building; assert `len(list_result) == count_result`.

**Status filter returns empty:**
- `list_general_meetings(status="nonexistent")` → empty list (not an error).

**No status filter returns all:**
- `list_general_meetings()` with no status filter returns all meetings regardless of stored or effective status.

**Existing tests must pass without modification:** All tests in `TestListGeneralMeetingsStatusFilter` and `TestCountGeneralMeetings` in `test_admin_meetings_api.py` and `test_rr5_fixes.py` must continue to pass — they already assert correct behaviour and the fix must satisfy them.

### E2E

The pagination bug is not directly observable in E2E flows (the admin meetings list is not paginated in the current UI — it fetches all meetings). No new E2E scenario is required. The existing admin journey E2E (`admin → login → meeting list`) is unaffected and must continue to pass.

---

## Schema Migration Required

No

---

## E2E Test Scenarios

**Happy path (existing, must continue to pass):**
- Admin logs in, navigates to meeting list — all meetings visible with correct status badges.
- Admin filters by building — only that building's meetings shown.

**Affected existing E2E specs:**
- `admin-meetings.spec.ts` (or equivalent) — exercises the meeting list endpoint. No changes needed to these specs; the fix is transparent to the frontend.

**No new E2E scenarios required** — the pagination correctness issue is a backend API concern not exercisable through the current admin UI, which does not use paginated calls. Integration tests (Option above) provide full coverage.

---

## Vertical Slice Decomposition

This is a pure backend fix with no frontend changes. It is a single slice:

- **Slice**: push effective-status filter into SQL in `list_general_meetings`, extract shared `_effective_status_case()` factory, add regression tests.
- **Independently testable**: yes — backend unit and integration tests cover it fully without any frontend involvement.
