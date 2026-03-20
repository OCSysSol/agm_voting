# Design: Fix Stale `already_submitted` When Admin Reveals New Motions

**PRD story:** US-FIX-NM01
**Schema migration needed:** No

---

## Overview

When all of a voter's lots have submitted ballots for every currently-visible motion, each lot is marked `already_submitted: true` and its checkbox is disabled in `VotingPage`. If an admin then makes an additional motion visible, those lots should automatically unlock — they have not yet voted on the new motion. Currently they remain locked forever because `already_submitted` is a stale value cached in `sessionStorage` and in React component state, and is never refreshed after the initial page mount.

---

## Root Cause

### Server-side (correct)

`POST /api/auth/verify` and `POST /api/auth/session` both compute `already_submitted` dynamically at the time of the call (auth.py lines 289–296 and 460–464):

```python
already_submitted = (
    len(visible_motion_ids) > 0
    and visible_motion_ids.issubset(voted_for_this_lot)
)
```

If a new motion has been made visible since the voter last authenticated, `visible_motion_ids` now contains the new motion ID, which is NOT in `voted_for_this_lot`, so `already_submitted` correctly returns `False`. The server is correct.

### Frontend (broken)

**`AuthPage.tsx` line 22** writes the server-provided `data.lots` (including `already_submitted`) to `sessionStorage`:

```
sessionStorage.setItem(`meeting_lots_info_${meetingId}`, JSON.stringify(data.lots));
```

**`VotingPage.tsx` lines 48–60** reads this from `sessionStorage` on mount and initialises `allLots` state:

```tsx
useEffect(() => {
    const raw = sessionStorage.getItem(`meeting_lots_info_${meetingId}`);
    const lots = JSON.parse(raw) as LotInfo[];
    setAllLots(lots);
    const pending = lots.filter((l) => !l.already_submitted).map((l) => l.lot_owner_id);
    setSelectedIds(new Set(pending));
}, [meetingId]);
```

This `useEffect` only runs once on mount. After that, `allLots` is updated only in `submitMutation.onSuccess` (VotingPage.tsx lines 155–165), which sets `already_submitted: true` for the lots that were just submitted. There is no code path that sets `already_submitted: false` back to unlocked.

**`MotionOut.already_voted`** (returned by `GET /api/general-meeting/{id}/motions`) cannot be used to recompute per-lot `already_submitted`. The `already_voted` field is aggregated across ALL of the voter's lots (voting.py lines 100–113 — `voted_motion_ids` is a union over all lot IDs). A single lot that has not voted on the new motion would still show `already_voted: true` on the old motions, but there is no per-lot breakdown in the motions response.

### Why the hypothesis in the task description differs

The task description mentions `voted_motion_ids` as a per-lot field on `LotInfo`. This field does NOT exist in either the backend `LotInfo` schema (`backend/app/schemas/auth.py` lines 56–61) or the frontend `LotInfo` interface (`frontend/src/api/voter.ts` lines 32–38). The `LotInfo` shape is:

```typescript
interface LotInfo {
  lot_owner_id: string;
  lot_number: string;
  financial_position: string;
  already_submitted: boolean;
  is_proxy: boolean;
}
```

There is no `voted_motion_ids` field. The fix therefore cannot be implemented by deriving `already_submitted` from `lot.voted_motion_ids` — that data is not available in the frontend.

---

## Technical Fix

### Approach: Re-fetch lots from server when motions list changes

The correct approach is to call `POST /api/auth/session` (session restore) whenever the motions list changes. This endpoint recomputes `already_submitted` per lot server-side with the current set of visible motions and returns a fresh `AuthVerifyResponse` including updated `LotInfo[]`. The frontend updates `allLots` state from the response, which causes previously-locked lots to unlock if the new motion ID is not yet voted on.

This is the same endpoint already called by `AuthPage` on mount for session restoration. It requires a valid `session_token` (stored in `localStorage` under `agm_session_${meetingId}`) and the `general_meeting_id`.

### Where to add the logic

In `VotingPage.tsx`, add a `useEffect` that watches `motions` (the React Query result). When `motions` is defined and its length increases compared to the previous render (a new motion has become visible), call `restoreSession` and update `allLots` and the sessionStorage cache.

The effect must:

1. Track the previous motions count using a `useRef`.
2. When `motions` length exceeds the previous count, retrieve `session_token` from `localStorage.getItem(`agm_session_${meetingId}`)`.
3. Call `restoreSession({ session_token, general_meeting_id: meetingId })`.
4. On success, update `allLots` with the fresh `data.lots` and write the updated lots to `sessionStorage` under `meeting_lots_info_${meetingId}`.
5. Also update `selectedIds` — add any lot IDs that were previously locked (`already_submitted: true`) but are now unlocked (`already_submitted: false`) after the new motion appeared. Do not deselect lots that are currently selected.
6. On failure (session expired, network error), silently ignore — the meeting may be closing, and the existing stale state is safe to display.

### Detailed logic

```
prevMotionCount ref: starts at 0

useEffect([motions]):
  if motions is undefined: return
  if motions.length <= prevMotionCount.current:
    prevMotionCount.current = motions.length
    return
  // New motions have appeared
  prevMotionCount.current = motions.length
  token = localStorage.getItem(`agm_session_${meetingId}`)
  if not token: return
  restoreSession({ session_token: token, general_meeting_id: meetingId })
    .then(data => {
      setAllLots(data.lots)
      sessionStorage.setItem(`meeting_lots_info_${meetingId}`, JSON.stringify(data.lots))
      // Unlock any lots that are now not already_submitted
      setSelectedIds(prev => {
        const next = new Set(prev)
        for (const lot of data.lots) {
          if (!lot.already_submitted) next.add(lot.lot_owner_id)
        }
        return next
      })
    })
    .catch(() => { /* silently ignore */ })
```

The condition `motions.length > prevMotionCount.current` is sufficient because:
- Motions are never removed from the voter's view (voted motions remain in the response even when hidden).
- An increase in the motions array length means at least one new visible motion has appeared.
- The initial load sets `prevMotionCount.current` to the initial length, so no spurious re-fetch on mount.

### No backend changes required

The backend already computes `already_submitted` correctly. `POST /api/auth/session` already handles this case — no new endpoints or schema changes are needed.

---

## Impact on `isMotionReadOnly` logic

`isMotionReadOnly` in `VotingPage.tsx` (lines 251–253) is:

```tsx
const hasUnsubmittedSelected = selectedLots.some((l) => !l.already_submitted);
const isMotionReadOnly = (m: { already_voted: boolean }) =>
  m.already_voted && !hasUnsubmittedSelected;
```

This logic is unaffected by the fix. After the re-fetch:
- `already_submitted` on the affected lots will be `false` (server returned the correct value).
- Those lots will be re-added to `selectedIds`.
- `hasUnsubmittedSelected` will be `true` (there are selected lots with `already_submitted: false`).
- Therefore `isMotionReadOnly` returns `false` for the new motion (which has `already_voted: false`), making it interactive.
- Old motions that the lot has already voted on have `already_voted: true`, but since `hasUnsubmittedSelected` is `true`, `isMotionReadOnly` returns `false` for those too — which is correct: the voter can re-submit a vote for those lots on the newly-unlocked slot, and the existing `submitted_choice` is shown as a pre-filled choice via the choices seeding `useEffect` (lines 96–108).

The `isMotionReadOnly` function does not need modification.

---

## Data Flow (Happy Path)

1. Voter authenticates. All lots have `already_submitted: false`. Motions M1 is visible.
2. Voter votes on M1 for all lots and submits. `submitMutation.onSuccess` sets `already_submitted: true` for all lots in state and sessionStorage. Voter is navigated to confirmation page.
3. Admin makes motion M2 visible.
4. Voter returns to VotingPage (via "View my votes" link or direct navigation). On mount, `allLots` is loaded from sessionStorage with `already_submitted: true` for all lots — lots appear locked.
5. React Query fetches motions. The response now contains both M1 (`already_voted: true`) and M2 (`already_voted: false`). The motions array length is 2, but `prevMotionCount.current` was 0 at mount so the condition fires.
6. The `useEffect` calls `restoreSession`. The server computes: M2 is visible and not in `voted_for_this_lot`, so `already_submitted: false` for all lots.
7. `allLots` state is updated with `already_submitted: false`. Lots are re-added to `selectedIds`. SessionStorage is updated.
8. The UI re-renders: lots show as selectable (no "Already submitted" badge, checkbox enabled). M1 is shown with its prior choice pre-filled (read-only via `isMotionReadOnly` — wait, `hasUnsubmittedSelected` is now `true`, so M1 is also shown as interactive with choice pre-seeded). M2 is shown as interactive with no prior choice.
9. Voter votes on M2 and submits.

Note on step 8: since `hasUnsubmittedSelected` is `true`, `isMotionReadOnly` returns `false` for M1. This is intentional — the voter needs to be able to include M1 in their next submit for the lots that are unlocked. The prior choice for M1 is still pre-filled from the `choices` seeding effect (lines 96–108 — it checks `m.already_voted && m.submitted_choice !== null && !(m.id in seeded)`). So M1 will show its previous choice and the voter can change it or accept it before submitting.

---

## Frontend Changes

### `VotingPage.tsx`

Add one `useRef` and one `useEffect`:

- `const prevMotionCountRef = useRef(0)` — tracks the last-seen motions array length to detect new motions appearing.
- A new `useEffect` that depends on `[motions, meetingId]`. When `motions` is defined and `motions.length > prevMotionCountRef.current`, call `restoreSession` with the stored token, update `allLots` and `selectedIds` from the response, and write back to sessionStorage.

No other files need to change.

### `frontend/src/api/voter.ts`

No changes. `restoreSession` and `LotInfo` already have the correct shapes.

---

## Key Design Decisions

**Why use `restoreSession` rather than a new endpoint?**
`POST /api/auth/session` already performs the exact per-lot `already_submitted` computation the frontend needs. Adding a new "get lots" endpoint would duplicate this logic and require new tests. Reusing the session restore endpoint avoids all of that.

**Why not re-fetch on every motions poll interval?**
The motions query has no explicit `refetchInterval` set — it is only re-fetched on focus, mount, and query invalidation. Even if it were polled, adding a `restoreSession` call on every motions fetch would be unnecessarily chatty. Detecting that the length increased is a cheap guard that makes the extra call only when something material changed.

**Why not add `voted_motion_ids` to `LotInfo` and derive locally?**
This would require a backend schema change, a migration awareness note, and more complex frontend logic. Since `already_submitted` is a derived boolean that the backend already computes correctly, it is simpler and more reliable to ask the backend for the fresh value.

**Why not clear `already_submitted` whenever `motions` changes?**
Clearing it unconditionally would cause a brief flash where all lots appear unlocked every time the motions query re-fetches (e.g. on window focus). Using the server response ensures the state is correct before rendering.

---

## Vertical Slice

This fix is entirely frontend-only. There are no backend changes and no schema migrations. It can be implemented and tested independently of all other open stories.

---

## E2E Test Scenarios

### Happy path: new motion unlocks previously-submitted lots

1. Seed: one open meeting with 1 visible motion (M1), voter with 2 lots.
2. Voter authenticates, votes on M1 for both lots, submits. Both lots show "Already submitted".
3. Admin (via API call) makes motion M2 visible on the same meeting.
4. In the same voter session, navigate back to VotingPage (simulate "View my votes" and return, or reload the page via back-navigation).
5. Assert: both lots no longer show "Already submitted" badge; both checkboxes are enabled.
6. Assert: M1 is shown with the previously-submitted choice pre-filled and editable (not locked).
7. Assert: M2 is shown as interactive with no prior choice.
8. Assert: "Submit ballot" button is visible.
9. Voter votes on M2 for both lots and submits. Navigate to confirmation. Assert both lots appear in the confirmation summary.

### Edge case: single-lot voter

1. Seed: one open meeting with 1 visible motion, voter with 1 lot.
2. Voter authenticates, votes on M1, submits. Voter is navigated to confirmation.
3. Admin makes M2 visible.
4. Voter navigates back to VotingPage.
5. Assert: lot is not marked "Already submitted"; M1 shows prior choice; M2 is interactive.

### Edge case: partial submission (some lots submitted, some not)

1. Seed: one open meeting with 1 visible motion, voter with 3 lots. Lot A and Lot B submitted, Lot C not.
2. Admin makes M2 visible.
3. Voter navigates to VotingPage.
4. Assert: Lot A and Lot B are unlocked (no "Already submitted" badge); Lot C was never submitted, also unlocked.
5. Assert: all three lots are in `selectedIds` (all checkboxes checked).

### No regression: motions count unchanged does not trigger extra re-fetch

1. Seed: one open meeting, voter with 1 lot, 2 visible motions. Voter has NOT yet voted.
2. VotingPage mounts and fetches motions (count = 2). No extra `restoreSession` call should be made beyond the initial mount flow.
3. Voter votes and submits normally. Confirm submission succeeds.

### No regression: session token absent

1. Seed: as above, but manually remove `agm_session_${meetingId}` from localStorage before the motions-change trigger.
2. Admin makes a new motion visible.
3. VotingPage motions refresh detects the new motion.
4. Assert: no unhandled error; lots remain in whatever state they were (graceful no-op).
