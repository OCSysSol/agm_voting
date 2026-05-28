# Design: General Meeting Management

**Status:** Draft

## Overview

General Meetings (AGMs) have a three-state lifecycle: `pending` → `open` → `closed`. Creation sets the initial status based on `meeting_at`. Meetings auto-open and auto-close on Lambda cold start. Admins can manually start (pending → open) or close (open → closed) a meeting. Closing creates absent `BallotSubmission` records for non-voters, deletes draft votes, and triggers the results email. Deletion is permitted for `pending` and `closed` meetings only. The admin list page has building and status filter dropdowns backed by URL search parameters. The voter-facing building list shows only buildings with at least one effectively-open meeting.

---

## Root Cause / Background

The `pending` status lets admins set up meetings in advance without voters being able to enter early. Cold-start auto-transitions eliminate the need for an always-on scheduler (incompatible with Lambda architecture). Meeting filters and the building-list API filter reduce noise in the admin UI and voter home page.

---

## Technical Design

### Database changes

**`general_meetings` table:**

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `building_id` | UUID FK → `buildings.id` CASCADE | |
| `title` | VARCHAR | NOT NULL |
| `meeting_at` | TIMESTAMPTZ | NOT NULL |
| `voting_closes_at` | TIMESTAMPTZ | NOT NULL; CHECK `voting_closes_at > meeting_at` |
| `status` | Enum(`pending`, `open`, `closed`) | NOT NULL |
| `closed_at` | TIMESTAMPTZ | nullable |
| `created_at` | TIMESTAMPTZ | |

`GeneralMeetingStatus` enum: `pending = "pending"`, `open = "open"`, `closed = "closed"`.

The `'pending'` enum value was added via `ALTER TYPE generalmeetingstatus ADD VALUE IF NOT EXISTS 'pending'` in a migration using `autocommit_block()`.

### Backend changes

#### Effective status derivation

`get_effective_status(meeting)` in `backend/app/models/general_meeting.py`:

```
stored status == closed → return closed
voting_closes_at in the past → return closed
meeting_at in the future → return pending
→ return open
```

All API endpoints that return meeting status call `get_effective_status` rather than the raw stored value.

#### Meeting creation

`create_general_meeting` sets initial status:

```python
initial_status = GeneralMeetingStatus.pending if meeting_at > now() else GeneralMeetingStatus.open
```

Snapshots `GeneralMeetingLotWeight` rows for every lot in the building (capturing `unit_entitlement_snapshot` and `financial_position_snapshot` at creation time). These snapshots are never updated by subsequent lot owner imports.

#### Auto-transitions on cold start

`_auto_open_and_close_meetings()` in `api/index.py` runs once per Lambda cold start (after Alembic migrations):

- Phase 1 (auto-open): `SELECT WHERE status='pending' AND meeting_at <= now()` → set `status='open'`
- Phase 2 (auto-close): `SELECT WHERE status='open' AND voting_closes_at < now()` → call `close_general_meeting()` for each

Failures per meeting are caught and logged as warnings; they do not block app startup.

#### Manual start (`POST /api/admin/general-meetings/{id}/start`)

- 409 if effective status is not `pending`
- Sets `status = 'open'` and `meeting_at = now()` (records actual start time)
- Returns `{ id, status, meeting_at }`

#### Meeting close (`POST /api/admin/general-meetings/{id}/close`)

1. 409 if already closed
2. Sets `status = 'closed'`, `closed_at = now()`
3. If `voting_closes_at` is in the future and `meeting_at` is in the past: clamps `voting_closes_at = now()` (preventing violation of the `CHECK` constraint on early close)
4. Deletes all `Vote` rows with `status = 'draft'` for this meeting
5. Sets `voting_closed_at = meeting.closed_at` on all motions where `voting_closed_at IS NULL`
6. Creates absent `BallotSubmission(is_absent=True)` for every `GeneralMeetingLotWeight` lot that has no `BallotSubmission(is_absent=False)`; `voter_email` on absent rows = comma-separated owner emails + proxy email (snapshot at close time)
7. Calls `compute_multi_choice_outcomes()` to store pass/fail/tie on `MotionOption` rows
8. Creates `EmailDelivery(status='pending')` record
9. Router fires `asyncio.create_task(email_service.trigger_with_retry(meeting.id))` after the response is returned

Returns `{ id, status, closed_at, voting_closes_at }`.

#### Meeting delete (`DELETE /api/admin/general-meetings/{id}`)

- 404 if not found
- 409 if stored `status == 'open'` (admins must close first)
- `await db.delete(meeting)` cascades to motions, votes, ballot submissions, session records, email delivery

#### Admin list endpoint enhancements

`GET /api/admin/general-meetings`:
- Optional `?name=` substring filter on `GeneralMeeting.title` (case-insensitive `LIKE`)
- Optional `?building_id=` UUID filter
- Default `limit=100`, max 1000

`GET /api/admin/buildings`:
- Optional `?name=` substring filter on `Building.name`
- Default `limit=100`, max 1000

`GET /api/admin/buildings/{building_id}`:
- New single-resource endpoint; 404 if not found

#### Voter building list filter

`GET /api/buildings` (public endpoint) returns only non-archived buildings that have at least one meeting where:

```sql
status != 'closed' AND voting_closes_at > now() AND meeting_at <= now()
```

This mirrors `get_effective_status` returning `'open'` in SQL. Buildings with only `pending`, `closed`, or time-expired meetings are excluded.

### Frontend changes

**`GeneralMeetingListPage.tsx`** (`frontend/src/pages/admin/GeneralMeetingListPage.tsx`):
- Building dropdown filter (all buildings from `listBuildings()`)
- Status dropdown filter: All / Open / Pending / Closed
- Filter state stored in URL search params (`?building=<uuid>&status=<str>`)
- Client-side filtering: `meetings.filter(m => !building || m.building_id === building).filter(m => !status || m.status === status)`
- Page resets to 1 when filter changes

**`GeneralMeetingDetailPage.tsx`** (`frontend/src/pages/admin/GeneralMeetingDetailPage.tsx`):
- `pending`: shows `StartGeneralMeetingButton` + "Delete Meeting" button
- `open`: shows `CloseGeneralMeetingButton` only
- `closed`: shows "Delete Meeting" button + "Resend Summary Email" button
- `deleteMutation` navigates to `/admin/general-meetings` on success
- "Resend Summary Email" button calls `POST /api/admin/general-meetings/{id}/resend-report`; visible whenever `status === "closed"` (not only on failed delivery)

**`StartGeneralMeetingButton.tsx`** (`frontend/src/components/admin/StartGeneralMeetingButton.tsx`):
- Confirmation dialog → calls `POST /api/admin/general-meetings/{id}/start` → invalidates detail query

**`GeneralMeetingListItem.tsx`** (voter-facing):
- `open` → "Enter Voting" button (primary)
- `pending` → "Voting Not Yet Open" button (disabled)
- `closed` → "View My Submission" button

---

## Security Considerations

- All admin meeting management endpoints require `require_admin`
- `POST /api/auth/verify` returns `agm_status: "pending"` for not-yet-started meetings; the frontend routes away to the building selection page with an informational message
- Absent `BallotSubmission` records are created at close time, not earlier, so vote tallies are always consistent

---

## Files Changed

| File | Change |
|------|--------|
| `backend/app/models/general_meeting.py` | `GeneralMeetingStatus` enum, `get_effective_status()` |
| `backend/app/services/admin_service.py` | `create_general_meeting`, `close_general_meeting`, `delete_general_meeting`, `start_general_meeting`, `list_general_meetings` (name + building_id filter), `list_buildings` (name filter) |
| `backend/app/routers/admin.py` | All meeting CRUD + start/close/delete endpoints; building single-resource endpoint; name/building_id filter params |
| `backend/app/routers/public.py` | `list_buildings` with EXISTS subquery filter |
| `api/index.py` | `_auto_open_and_close_meetings()` on cold start |
| `frontend/src/pages/admin/GeneralMeetingListPage.tsx` | Building + status filter dropdowns, URL params |
| `frontend/src/pages/admin/GeneralMeetingDetailPage.tsx` | Start/close/delete buttons, resend email button |
| `frontend/src/components/vote/GeneralMeetingListItem.tsx` | Pending button state |
| `frontend/src/pages/vote/AuthPage.tsx` | Redirect to home with `pendingMessage` when `agm_status === "pending"` |
| `frontend/e2e/workflows/helpers.ts` | `createOpenMeeting`/`createPendingMeeting` use `?building_id=` cleanup query; `seedBuilding` uses `?name=` |

---

## Schema Migration Required

Yes — `ADD VALUE 'pending'` to `generalmeetingstatus` enum (with `autocommit_block()`); backfill existing future-dated meetings to `pending`.


---

## Feature: Edit Meeting Close Time (US-ECT-01)

### Overview

Admins currently cannot change a meeting's `voting_closes_at` after creation. This feature adds a `PATCH /api/admin/general-meetings/{id}` endpoint and a corresponding UI control on the General Meeting detail page so admins can extend or shorten the voting window for any meeting that has not yet been closed.

No schema migration is needed — `voting_closes_at` already exists on the `general_meetings` table.

---

### Backend changes

#### New Pydantic schema: `GeneralMeetingUpdate`

```python
class GeneralMeetingUpdate(BaseModel):
    voting_closes_at: datetime
```

Added to `backend/app/schemas/admin.py`.

#### New Pydantic schema: `GeneralMeetingUpdateOut`

```python
class GeneralMeetingUpdateOut(BaseModel):
    id: uuid.UUID
    status: str
    voting_closes_at: datetime
```

Added to `backend/app/schemas/admin.py`. Returns the updated `voting_closes_at` and the derived effective status so the frontend can re-render the badge and the "Voting closes" field in one response.

#### New service function: `update_general_meeting`

Location: `backend/app/services/admin_service.py`

```python
async def update_general_meeting(
    general_meeting_id: uuid.UUID,
    data: GeneralMeetingUpdate,
    db: AsyncSession,
) -> GeneralMeeting:
    ...
```

Logic:
1. Fetch meeting; raise 404 if not found.
2. Derive effective status via `get_effective_status(meeting)`. Raise 409 with `detail="Meeting is already closed"` if status is `closed`.
3. Validate `data.voting_closes_at > meeting.meeting_at`; raise 422 with `detail="voting_closes_at must be after meeting_at"` if not.
4. Set `meeting.voting_closes_at = data.voting_closes_at`.
5. `await db.commit()` and `await db.refresh(meeting)`.
6. Return the updated `meeting` ORM object.

No side effects — no email, no absent-record generation, no status change.

#### New router endpoint: `PATCH /api/admin/general-meetings/{id}`

Location: `backend/app/routers/admin.py`

```
PATCH /api/admin/general-meetings/{general_meeting_id}
Auth: require_admin
Request body: GeneralMeetingUpdate
Response 200: GeneralMeetingUpdateOut
Response 404: meeting not found
Response 409: meeting is already closed
Response 422: voting_closes_at not after meeting_at (Pydantic or service-layer)
```

The endpoint calls `update_general_meeting`, then returns `GeneralMeetingUpdateOut` with the effective status derived from the updated meeting.

---

### Frontend changes

#### New TypeScript types in `frontend/src/api/admin.ts`

```ts
export interface GeneralMeetingUpdateRequest {
  voting_closes_at: string; // ISO 8601 UTC
}

export interface GeneralMeetingUpdateOut {
  id: string;
  status: string;
  voting_closes_at: string;
}
```

#### New API function in `frontend/src/api/admin.ts`

```ts
export async function updateGeneralMeeting(
  meetingId: string,
  data: GeneralMeetingUpdateRequest
): Promise<GeneralMeetingUpdateOut> {
  return apiFetch<GeneralMeetingUpdateOut>(
    `/api/admin/general-meetings/${meetingId}`,
    {
      method: "PATCH",
      body: JSON.stringify(data),
    }
  );
}
```

#### UI changes in `GeneralMeetingDetailPage.tsx`

The "Voting closes" meta item in the `.admin-meta` section is enhanced for `pending` and `open` meetings:

- A small "Edit" button (`.btn--admin`) appears inline next to the displayed datetime.
- Clicking "Edit" replaces the displayed value with an inline form containing:
  - A `<datetime-local>` input pre-filled with the current `voting_closes_at` converted to local time.
  - A "Save" button (`.btn--primary`) and a "Cancel" button (`.btn--secondary`).
- Client-side validation runs before calling the API: the selected datetime (converted to UTC) must be strictly after `meeting.meeting_at`. If invalid, a `.field__error` message is shown and no API call is made.
- On save, `updateGeneralMeeting` is called. On success:
  - `queryClient.invalidateQueries(["admin", "general-meetings", meetingId])` refreshes the full detail query.
  - The inline form collapses back to the static display.
- On API error, an error message is shown inline; the form stays open so the admin can correct and retry.
- While the mutation is in-flight, the Save button is disabled and labelled "Saving...".
- The Edit button is only rendered when `meeting.status === "pending" || meeting.status === "open"`.

**Datetime input convention:**
- The `<input type="datetime-local">` provides values in the browser's local time without a timezone suffix.
- On read, the current `voting_closes_at` (UTC ISO string) is converted to a local-time string for the input's `value` attribute using a helper that produces `YYYY-MM-DDTHH:MM`.
- On submit, the local-time string is parsed back to a UTC ISO string before sending to the API, using `new Date(localValue).toISOString()`.

#### New MSW mock handler

Add to `frontend/tests/msw/handlers.ts`:

```ts
http.patch(`${BASE}/api/admin/general-meetings/:meetingId`, async ({ request, params }) => {
  const body = await request.json() as { voting_closes_at: string };
  const meetingId = params.meetingId as string;
  // Return the updated meeting summary
  return HttpResponse.json({
    id: meetingId,
    status: "open",
    voting_closes_at: body.voting_closes_at,
  });
}),
```

---

### Key design decisions

- **PATCH over PUT** — the request body carries only `voting_closes_at`; a PATCH is more appropriate than a full-resource PUT replacement. If future fields become editable, the same endpoint can accept additional optional fields.
- **No 422 from middleware for closed meeting** — a 409 is returned for "meeting already closed" because the constraint is a business rule on the current state, not a validation error on the input shape.
- **Inline edit over modal** — the close time is a single field. An inline edit pattern (show form in place) avoids the cognitive overhead of a modal for a one-field change. The design system supports this with `.admin-form` constraints.
- **Invalidate full detail query on success** — rather than surgically updating the cached `voting_closes_at`, the full detail query is invalidated. This ensures the status badge, the "Voting closes" display, and any effective-status-derived UI (button visibility) are all kept consistent.
- **Validation before API call** — client-side validation (`voting_closes_at > meeting_at`) is enforced before the API call, giving immediate feedback. The backend also validates, serving as the authoritative guard.

---

### Data flow (happy path)

1. Admin opens the General Meeting detail page for an open meeting.
2. Admin clicks "Edit" next to the "Voting closes" timestamp.
3. An inline `datetime-local` input appears, pre-filled with the current close time in local time.
4. Admin selects a new datetime and clicks "Save".
5. Client validates: new time > `meeting.meeting_at`. If invalid, error shown, no API call.
6. `PATCH /api/admin/general-meetings/{id}` is called with `{ voting_closes_at: "<UTC ISO>" }`.
7. Backend service verifies: meeting not closed (409 if it is), new time > `meeting_at` (422 if not).
8. `voting_closes_at` is updated in DB, commit, refresh.
9. Response `{ id, status, voting_closes_at }` returned with HTTP 200.
10. Frontend invalidates the detail query; the page re-renders with the new close time.
11. The inline form collapses; the "Voting closes" row shows the new time.

---

### Security Considerations

All admin meeting management endpoints require `require_admin`. The new PATCH endpoint is on the existing admin router which already enforces this. No new auth logic is needed. Input validation (datetime must be after `meeting_at`) is enforced at both the service layer and the frontend before the API call. No new secrets, external calls, or data exposure paths are introduced.

---

### Files to Change

| File | Change |
|---|---|
| `backend/app/schemas/admin.py` | Add `GeneralMeetingUpdate` and `GeneralMeetingUpdateOut` Pydantic models |
| `backend/app/services/admin_service.py` | Add `update_general_meeting()` service function |
| `backend/app/routers/admin.py` | Add `PATCH /api/admin/general-meetings/{id}` endpoint; import new schemas |
| `frontend/src/api/admin.ts` | Add `GeneralMeetingUpdateRequest`, `GeneralMeetingUpdateOut` types; add `updateGeneralMeeting()` function |
| `frontend/src/pages/admin/GeneralMeetingDetailPage.tsx` | Add inline edit UI for "Voting closes" field; import and call `updateGeneralMeeting`; add mutation; add local state for edit mode |
| `frontend/tests/msw/handlers.ts` | Add `http.patch` handler for `general-meetings/:meetingId` |
| `backend/tests/test_admin_*.py` | Add unit and integration tests for `update_general_meeting` service and the PATCH endpoint |
| `frontend/src/pages/admin/__tests__/GeneralMeetingDetailPage.test.tsx` | Add unit tests for the edit close time UI: edit button visibility, validation, success, error, cancel |

---

### Test Cases

#### Backend unit tests (mocked DB)

- `update_general_meeting` with valid new close time → updates DB, returns updated meeting
- `update_general_meeting` where meeting does not exist → raises 404
- `update_general_meeting` where meeting is closed → raises 409
- `update_general_meeting` where new close time ≤ `meeting_at` → raises 422
- `PATCH /api/admin/general-meetings/{id}` with valid body → 200 with updated `voting_closes_at`
- `PATCH /api/admin/general-meetings/{id}` unauthenticated → 403

#### Backend integration tests (real test DB)

- Create open meeting, PATCH with future close time → 200, `voting_closes_at` updated in DB
- Create closed meeting (via close endpoint), PATCH → 409
- PATCH with close time equal to `meeting_at` → 422
- PATCH with close time before `meeting_at` → 422
- PATCH for non-existent meeting ID → 404

#### Frontend unit tests (Vitest + RTL)

- "Edit" button visible for `open` meeting
- "Edit" button visible for `pending` meeting
- "Edit" button NOT visible for `closed` meeting
- Clicking "Edit" shows datetime input pre-filled with current `voting_closes_at`
- Clicking "Cancel" collapses form, shows original value, no API call made
- Submitting with new time ≤ `meeting_at` shows validation error, no API call made
- Successful save invalidates query and collapses form
- API error on save shows error message, form stays open

---

## E2E Test Scenarios

### New scenario: Edit close time on an open meeting

1. Admin creates a General Meeting with a future close time.
2. Admin navigates to the meeting detail page.
3. Admin clicks "Edit" next to "Voting closes".
4. Admin sets a new close time further in the future.
5. Admin clicks "Save".
6. The page displays the updated close time.
7. Admin refreshes the page; the updated close time persists.

### Error scenario: Attempt to set close time in the past

1. Admin opens edit form on an open meeting.
2. Admin enters a datetime before the meeting's `meeting_at`.
3. Validation error is shown inline; Save is not called.

### Error scenario: Edit not available on closed meeting

1. Admin closes a meeting.
2. The "Edit" button next to "Voting closes" is not rendered.

### Multi-step sequence: Edit close time, then let meeting auto-close

1. Create an open meeting with `voting_closes_at` 2 hours from now.
2. Edit close time to 5 seconds from now.
3. Wait for Lambda cold start to auto-close the meeting.
4. Verify meeting status transitions to `closed`.
5. Verify the "Edit" button is no longer visible.

### Existing E2E specs affected

The following existing specs cover the Admin persona journey and include the General Meeting detail page. They must be reviewed to confirm the new "Edit" button does not interfere with existing locators or flow expectations:

- `e2e_tests/admin/admin-general-meetings.spec.ts` — meeting detail page interactions
- `e2e_tests/admin/admin-start-meeting.spec.ts` — start meeting flow (uses detail page)
- `e2e_tests/workflows/admin-setup.spec.ts` — full admin setup workflow

---

## Schema Migration Required

No — `voting_closes_at` already exists on the `general_meetings` table. No new columns, tables, or enum values are needed for this feature.
