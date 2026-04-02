# Design: Co-Owner Ballot Visibility

**Status:** Implemented

## Overview

All lot owners associated with a lot can see the submitted ballot on the confirmation page, regardless of which owner or proxy submitted it.

Covers US-MOV-01.

---

## Root Cause / Background

When multiple emails are registered to the same lot (co-owners) or a proxy submits on behalf of an owner, co-owners authenticating after submission were unable to see the ballot because the `get_my_ballot` query filtered by `voter_email` rather than `lot_owner_id`.

---

## Technical Design

### Database changes

None. `BallotSubmission` is already keyed on `lot_owner_id`. The fix is purely a backend query change.

### Backend changes

**Modified `get_my_ballot`** (`backend/app/services/voting_service.py`):

Currently the function queries `BallotSubmission` filtered by `voter_email = session.voter_email`. This means a co-owner or proxy who did not submit cannot see the ballot.

Change the query to:
1. Resolve all `lot_owner_id` values associated with `session.voter_email` in this building (same lookup as in `list_motions`: direct `LotOwnerEmail` + `LotProxy`).
2. Query `BallotSubmission` by `lot_owner_id IN (resolved_ids)` AND `general_meeting_id`.
3. For each found `BallotSubmission`, fetch the `Vote` rows and build the ballot item as before.
4. Include `submitter_email` and `proxy_email` from `BallotSubmission` in the response so the frontend can render the "submitted by" note.

**Modified `MyBallotResponse`** (`backend/app/schemas/voting.py`):
- Add `submitter_email: str` and `proxy_email: str | None` to `BallotItem`.

### Frontend changes

**Modified `ConfirmationPage.tsx`**:
- Render "This ballot was submitted by {submitter_email}" note beneath each ballot item.
- When `proxy_email` is set, render "Submitted via proxy by {proxy_email}".

No routing changes — `already_submitted` per lot (existing auth response field) already returns `true` when any `BallotSubmission` exists for that `lot_owner_id`, so co-owners are already routed to the confirmation page.

---

## Files to Change

| File | Change |
|------|--------|
| `backend/app/services/voting_service.py` | Modify `get_my_ballot` to query by `lot_owner_id IN (...)` |
| `backend/app/schemas/voting.py` | Add `submitter_email`/`proxy_email` to `BallotItem` |
| `frontend/src/pages/voter/ConfirmationPage.tsx` | Show "submitted by" note |
| `frontend/tests/msw/handlers.ts` | Update mock ballot response with new fields |

---

## Test Cases

### Unit / Integration
- Voter A submits ballot for Lot 101. Voter B (different email, same lot via `LotOwnerEmail`) authenticates; `get_my_ballot` returns Lot 101's ballot with `submitter_email = voter_a@example.com`.
- Proxy authenticates after lot owner submitted; same result with `submitter_email` set.
- Voter has no associated lots with submissions: `get_my_ballot` returns empty list.

### E2E
- Co-owner authenticates after ballot submitted by other owner; confirmation page shows ballot with "submitted by" note.

---

## Schema Migration Required

None.
