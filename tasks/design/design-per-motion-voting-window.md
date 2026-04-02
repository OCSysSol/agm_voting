# Design: Per-Motion Voting Window

**Status:** Implemented

## Overview

Admins can close individual motions while the overall meeting remains open. A `voting_closed_at` timestamp on each motion gates vote submission and disables voter controls for that motion.

Covers US-PMW-01, US-PMW-02.

---

## Root Cause / Background

Some in-person AGMs progress motion by motion — the chair wants to lock each motion after a show of hands before moving to the next. A per-motion close gives finer-grained control over the voting window without closing the entire meeting.

---

## Technical Design

### Database changes

**`motions` table** — add one column:

```sql
ALTER TABLE motions
  ADD COLUMN voting_closed_at TIMESTAMPTZ DEFAULT NULL;
```

`NULL` means voting is open for this motion. Non-null means voting was closed at that timestamp.

No foreign key; no cascade. The column is set by `POST /api/admin/motions/{id}/close` and by the meeting-close path.

### Backend changes

**Modified `Motion` model** (`backend/app/models/motion.py`):
- Add `voting_closed_at: Mapped[datetime | None]` with `nullable=True`.

**New endpoint:** `POST /api/admin/motions/{id}/close`
- Auth: `require_admin`.
- Validates:
  - Motion exists → 404 if not.
  - Motion `is_visible = True` → 409 if hidden ("Motion must be visible before closing").
  - `voting_closed_at IS NULL` → 409 if already closed.
  - Meeting `effective_status == "open"` → 409 if meeting is closed.
- Sets `motion.voting_closed_at = datetime.now(UTC)`.
- Does NOT immediately create absent `Vote` rows; the tally query handles absence by detecting lots with no submitted vote before `voting_closed_at` (same approach as meeting-level absent tallies).
- Returns updated `MotionDetail`.

**Modified `close_general_meeting`** (`admin_service.py`):
- After setting `meeting.status = closed`, set `voting_closed_at = meeting.closed_at` on all motions in the meeting where `voting_closed_at IS NULL`.

**Modified `submit_ballot`** (`voting_service.py`):
- Before recording votes, check each motion in `inline_votes` and `multi_choice_votes` against `Motion.voting_closed_at`.
- If any targeted motion has `voting_closed_at IS NOT NULL`, return 422: `"Voting has closed for motion: {motion_number}"` for each such motion.

**Modified `toggle_motion_visibility`** (`admin_service.py`):
- When hiding (`is_visible = False`): if `voting_closed_at IS NOT NULL`, return 409 ("Cannot hide a closed motion").

**Modified tally calculation** (`admin_service.py` → `get_general_meeting_detail`):
- For each motion, use `voting_closed_at` (or `meeting.closed_at` if `voting_closed_at` is null) as the cutoff when counting absent lots.
- A lot is absent for a motion if it has no `Vote` row with `status = submitted` and `created_at <= motion_voting_closed_at`.

**Modified `MotionOut`** (`backend/app/schemas/voting.py`):
- Add `voting_closed_at: datetime | None`.

**Modified `MotionDetail`** (`backend/app/schemas/admin.py`):
- Add `voting_closed_at: datetime | None`.

### Frontend changes

**Modified `list_motions` response handling** in `VotingPage.tsx`:
- When `motion.voting_closed_at` is non-null:
  - Disable all vote controls for that motion.
  - Show "Voting closed" label instead of vote buttons.
- Polling interval (already 10 s) picks up newly closed motions automatically.
- Exclude motions with `voting_closed_at IS NOT NULL` and no voter answer from the progress bar denominator.

**Modified motion management table** in `AdminMeetingDetailPage.tsx`:
- Add "Close Motion" button in Actions column for each visible motion on an open meeting.
- Button disabled when `voting_closed_at IS NOT NULL`; replaced with a "Closed" badge in that case.
- Clicking "Close Motion" shows a confirmation dialog; on confirm calls `POST /api/admin/motions/{id}/close`.

**New API client function** (`frontend/src/api/admin.ts`):
- `closeMotion(motionId)` calling `POST /api/admin/motions/{id}/close`.

---

## Files to Change

| File | Change |
|------|--------|
| `backend/app/models/motion.py` | Add `voting_closed_at` column |
| `backend/alembic/versions/` | Migration: `motions.voting_closed_at` |
| `backend/app/routers/admin.py` | Add `POST /admin/motions/{id}/close` endpoint |
| `backend/app/schemas/voting.py` | Add `voting_closed_at` to `MotionOut` |
| `backend/app/schemas/admin.py` | Add `voting_closed_at` to `MotionDetail` |
| `backend/app/services/voting_service.py` | Check `voting_closed_at` in `submit_ballot` |
| `backend/app/services/admin_service.py` | Modify `close_general_meeting`; `toggle_motion_visibility`; `get_general_meeting_detail` tally cutoff |
| `frontend/src/api/admin.ts` | Add `closeMotion` function |
| `frontend/src/pages/voter/VotingPage.tsx` | Disable controls for closed motions; update progress bar |
| `frontend/src/pages/admin/AdminMeetingDetailPage.tsx` | Add "Close Motion" button on motion rows |
| `frontend/tests/msw/handlers.ts` | Add MSW handler for close-motion endpoint |

---

## Test Cases

### Unit / Integration
- Close a visible motion: `voting_closed_at` is set; subsequent submit for that motion returns 422.
- Close an already-closed motion: 409.
- Close a hidden motion: 409.
- Close meeting with open motions: all motions get `voting_closed_at = meeting.closed_at`.
- Tally for per-motion-closed motion counts only votes submitted before `voting_closed_at`.
- `list_motions` returns `voting_closed_at` on each motion.
- Attempt to hide a closed motion: 409.

### E2E
- Admin closes Motion 2 on an open meeting; voter page immediately shows Motion 2 as locked (after next poll); voter can still vote on Motion 3.

---

## Schema Migration Required

Yes — additive, backward-compatible:
- `motions.voting_closed_at` (TIMESTAMPTZ nullable)
