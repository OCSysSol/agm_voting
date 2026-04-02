# Design: Admin In-Person Vote Entry

**Status:** Implemented

## Overview

Admin in-person vote entry allows meeting administrators to digitise paper ballots during in-person AGMs. A new `submitted_by_admin` flag on `BallotSubmission` distinguishes admin-entered votes from app-submitted votes.

Covers US-AVE-01, US-AVE-02, US-AVE-03.

---

## Root Cause / Background

In-person AGMs use paper ballots that need to be digitised post-meeting. Admins need a grid-based UI to enter votes for multiple lots at once without bypassing the existing business rules (in-arrear ineligibility, option_limit enforcement, motion visibility).

---

## Technical Design

### Database changes

**`ballot_submissions` table** — add one column:

```sql
ALTER TABLE ballot_submissions
  ADD COLUMN submitted_by_admin BOOLEAN NOT NULL DEFAULT FALSE;
```

No other schema changes. The existing `BallotSubmission` model, `Vote` model, and submission service path are reused. Admin vote entry creates `BallotSubmission` + `Vote` rows identically to the voter flow; the new flag distinguishes origin.

### Backend changes

**New endpoint:** `POST /api/admin/general-meetings/{id}/enter-votes`

- Auth: `require_admin`
- Request body:
  ```json
  {
    "entries": [
      {
        "lot_owner_id": "<uuid>",
        "votes": [{"motion_id": "<uuid>", "choice": "yes|no|abstained"}],
        "multi_choice_votes": [{"motion_id": "<uuid>", "option_ids": ["<uuid>"]}]
      }
    ]
  }
  ```
- Behaviour:
  1. Verify meeting is open (effective status = `open`); return 409 if not.
  2. For each `lot_owner_id` in `entries`: reject with 409 if a `BallotSubmission` already exists for that lot in this meeting (app votes take precedence).
  3. Call the existing `submit_ballot` service for each lot, passing `inline_votes` and `multi_choice_votes` exactly as the voter flow does. All business rules (in-arrear ineligibility, option_limit, motion visibility) are enforced by the existing service layer — no new rule code needed.
  4. Set `submitted_by_admin = True` on each created `BallotSubmission`.
- Returns: `{"submitted_count": N, "skipped_count": M}` — skipped lots are those that already had a submission.
- Returns 404 if meeting not found.

**Modified `BallotSubmission` model** (`backend/app/models/ballot_submission.py`):
- Add `submitted_by_admin: Mapped[bool]` with `default=False, server_default="false"`.

**Modified `admin_service`** (`backend/app/services/admin_service.py`):
- Add `enter_votes_for_meeting(general_meeting_id, entries, db)` service function.
- Extend `get_general_meeting_detail` tally output to include `submitted_by_admin` flag on each `BallotSubmission` row in the voter list.

**Modified Pydantic schemas** (`backend/app/schemas/admin.py`):
- Add `AdminVoteEntry`, `AdminVoteEntryRequest`, `AdminVoteEntryResult` schemas.
- Extend `BallotSubmissionOut` with `submitted_by_admin: bool`.

**Modified CSV export** (`backend/app/services/email_service.py` or equivalent):
- Add `Submitted By` column: `"Admin"` when `submitted_by_admin`, else `"Voter"`.

### Frontend changes

**New component:** `AdminVoteEntryPanel` (`frontend/src/pages/admin/AdminVoteEntryPanel.tsx`)
- Step 1: lot-selection checklist (US-AVE-01).
  - Fetches lots for the building; filters out lots already showing `submitted_by_admin = false AND has_submission = true` (i.e. app-submitted).
  - Renders each lot as a checkbox row: lot number + name (if available).
  - "Proceed to vote entry" button enabled when ≥1 lot checked.
- Step 2: vote entry grid (US-AVE-02).
  - Rows: visible motions (from the existing meeting detail motions list).
  - Columns: one per selected lot.
  - Cell component: `AdminVoteCellBinary` (For/Against/Abstain compact selector) or `AdminVoteCellMultiChoice` (compact option selector with `option_limit` enforcement).
  - In-arrear lots: cells for `general`/`multi_choice` motions are disabled with "Not eligible" label; `special` cells are active.
  - "Submit votes" button at bottom opens a confirmation dialog, then calls `POST /api/admin/general-meetings/{id}/enter-votes`.

**Modified `AdminMeetingDetailPage`** (`frontend/src/pages/admin/AdminMeetingDetailPage.tsx`):
- Show "Enter In-Person Votes" button in page header when `meeting.effective_status === "open"`.
- Clicking it mounts `AdminVoteEntryPanel` as an overlay/modal.

**Modified `AdminVoteEntryPanel` / results section:**
- Add "Admin entered" badge on `BallotSubmission` rows where `submitted_by_admin = true`.

**New API client function** (`frontend/src/api/admin.ts`):
- `enterInPersonVotes(meetingId, entries)` calling `POST /api/admin/general-meetings/{id}/enter-votes`.

---

## Files to Change

| File | Change |
|------|--------|
| `backend/app/models/ballot_submission.py` | Add `submitted_by_admin` column |
| `backend/alembic/versions/` | Migration: add `ballot_submissions.submitted_by_admin` |
| `backend/app/routers/admin.py` | Add `POST /admin/general-meetings/{id}/enter-votes` endpoint |
| `backend/app/schemas/admin.py` | Add `AdminVoteEntryRequest/Result`; extend `BallotSubmissionOut` |
| `backend/app/services/admin_service.py` | Add `enter_votes_for_meeting`; extend `get_general_meeting_detail` |
| `backend/app/services/email_service.py` | Add `Submitted By` column to CSV export |
| `frontend/src/api/admin.ts` | Add `enterInPersonVotes` function |
| `frontend/src/pages/admin/AdminMeetingDetailPage.tsx` | Add "Enter In-Person Votes" button + `AdminVoteEntryPanel` |
| `frontend/src/pages/admin/AdminVoteEntryPanel.tsx` | New component (lot selection + vote entry grid) |
| `frontend/tests/msw/handlers.ts` | Add MSW handler for new endpoint |

---

## Test Cases

### Unit / Integration
- Happy path: admin submits votes for 3 lots; all get `BallotSubmission(submitted_by_admin=True)` + `Vote` rows.
- Skip already-submitted: one lot already has an app submission; it is skipped; the other two are recorded; `skipped_count = 1`.
- In-arrear lot + general motion: vote recorded as `not_eligible`; `special` motion vote recorded normally.
- Multi-choice option_limit enforced: sending 4 options when limit is 3 returns 422.
- Closed meeting: returns 409.
- Unknown lot_owner_id: returns 422.

### E2E
- Admin opens "Enter In-Person Votes", selects 2 lots, fills the grid, submits; both lots appear as voted in the results.
- Lot already submitted via app does not appear in the lot selection panel.

---

## Schema Migration Required

Yes — additive, backward-compatible:
- `ballot_submissions.submitted_by_admin` (BOOLEAN NOT NULL DEFAULT FALSE)
