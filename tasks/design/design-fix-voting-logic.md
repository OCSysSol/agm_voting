# Design: Fix Voting Logic — Stale Email on Re-entry & Auto-Abstain on New Motions

PRD reference: `prd-voting-flow.md` (US-MV05, US-MOV-01)

**Status:** Implemented

---

## Overview

Three closely related bugs in the ballot submission service affect meetings that use the
re-entry flow (admin reveals new motions after some voters have already submitted):

- **Fix 3** — `BallotSubmission.voter_email` is never updated when a second voter on the same
  lot re-submits for newly visible motions, so admin results and the confirmation page show
  the first voter's email as the submitter of all motions, including those submitted by the
  second voter.
- **Fix 4** — When a voter re-submits to add a vote for a newly visible motion, the service
  auto-records every other unaddressed visible motion as `abstained` in that re-submit call,
  even if the voter has not yet had a chance to answer them. This makes the voter "voted" on
  motions they never saw.
- **Fix 4a** — Because `enter_votes_for_meeting` (admin in-person vote entry) unconditionally
  skips any lot that already has a `BallotSubmission`, the admin cannot enter votes for
  newly visible motions on already-partially-submitted lots. This is the companion problem
  to Fix 4: even if the auto-abstain hadn't happened, the admin cannot fix it via in-person
  entry.

---

## Root Cause Analysis

### Fix 3 — Stale `BallotSubmission.voter_email` on re-entry

**File:** `backend/app/services/voting_service.py`
**Function:** `submit_ballot` (re-entry branch, lines 581–587)

When a lot has two eligible voters (multiple `LotOwnerEmail` rows, or an owner plus a proxy),
voter A submits first and a `BallotSubmission` row is created with `voter_email = A`. When
voter B later calls `submit_ballot` for the same lot (to vote on newly revealed motions), the
code takes the re-entry path:

```python
# lines 581-587 — the re-entry branch (lot_owner_id in existing_subs_by_lot)
else:
    if votes_to_add:
        for vote in votes_to_add:
            db.add(vote)
        await db.flush()
```

The new `Vote` rows are correctly constructed with `voter_email = voter_email` (B's email).
However, the existing `BallotSubmission` record is never touched, so
`BallotSubmission.voter_email` remains A's email.

The admin results view reads `BallotSubmission.voter_email` at line 1799:

```python
lot_owner_to_email: dict[uuid.UUID, str] = {
    sub.lot_owner_id: sub.voter_email for sub in voted_submissions
}
```

The confirmation page (`get_my_ballot`) reads the same field at line 858:

```python
submitter_email=sub.voter_email if sub is not None else "",
```

Both therefore display voter A's email as the submitter even for motions that voter B
actually submitted.

**Vote records are correct** — the individual `Vote` rows for B's submissions do carry
`voter_email = B`. Only the `BallotSubmission.voter_email` is stale.

---

### Fix 4 — Incorrect auto-abstain on re-entry for unaddressed visible motions

**File:** `backend/app/services/voting_service.py`
**Function:** `submit_ballot` (lines 406–534)

The service loops over all visible motions for each lot. For each motion not in
`already_voted_for_lot`:

1. If the motion has an explicit choice in `inline_votes` → record that choice.
2. Otherwise → add to `motions_needing_new_vote`.

At lines 519–534, `motions_needing_new_vote` is flushed as `VoteChoice.abstained` with
`VoteStatus.submitted`.

On a **first submission** this is correct: every visible motion must be resolved
(answered or abstained) in a single atomic batch.

On **re-entry**, this behaviour is wrong. When a voter returns to vote on newly visible
motion M3, they call `submit_ballot` with only `inline_votes = {M3: yes}`. If M4 has also
become visible since their first submission (but they haven't been told about it yet, e.g.
because of a stale frontend state), M4 ends up in `motions_needing_new_vote` and is
permanently recorded as `abstained` — even though the voter never saw M4 or intended to
abstain on it.

The fundamental problem is that `submit_ballot` makes no distinction between:
- "first-time submission where unanswered motions should be abstained"
- "re-entry where only the explicitly provided motions should be recorded"

---

### Fix 4a — Admin vote entry blocked on partially-submitted lots

**File:** `backend/app/services/admin_service.py`
**Function:** `enter_votes_for_meeting` (lines 3755–3807)

The function builds `already_submitted` from all real `BallotSubmission` rows for the
targeted lots:

```python
existing_result = await db.execute(
    select(BallotSubmission.lot_owner_id).where(
        BallotSubmission.general_meeting_id == general_meeting_id,
        BallotSubmission.lot_owner_id.in_(lot_owner_ids),
        BallotSubmission.is_absent == False,
    )
)
already_submitted: set[uuid.UUID] = {row[0] for row in existing_result.all()}
```

Then at lines 3805–3807:

```python
if lot_owner_id in already_submitted:
    skipped_count += 1
    continue
```

Any lot with ANY real submission (even a partial one from before the new motion became
visible) is skipped entirely. The admin cannot add votes for newly visible motions via
in-person entry. The fix is to make `enter_votes_for_meeting` re-entrant in the same way
`submit_ballot` is: load already-voted motion IDs per lot, and only skip lots that have
voted on ALL currently visible motions.

---

## Technical Design

### Database changes

None. No schema migrations required.

### Backend changes

#### Fix 3 — `backend/app/services/voting_service.py`

In the re-entry branch of `submit_ballot`, after successfully flushing new `Vote` rows,
update `BallotSubmission.voter_email` to the current submitter's email.

The existing submission object is available via `existing_subs_by_lot[lot_owner_id]`.
Set `submission.voter_email = voter_email` before flushing.

Specifically, the re-entry branch (currently lines 581–587) becomes:

```python
else:
    # Re-entry: BallotSubmission already exists.  Add any newly visible
    # motion Vote rows and update voter_email to reflect the current submitter.
    submission = existing_subs_by_lot[lot_owner_id]
    if votes_to_add:
        for vote in votes_to_add:
            db.add(vote)
    # Always update voter_email to the current submitter so the audit trail
    # reflects who most recently submitted.  This matters when a co-owner
    # (different email, same lot) adds votes for newly revealed motions.
    submission.voter_email = voter_email
    await db.flush()
```

No new query is needed — `existing_subs_by_lot` already holds the ORM-tracked object.

#### Fix 4 — `backend/app/services/voting_service.py`

Change the `motions_needing_new_vote` logic so that, on re-entry, unanswered visible
motions are **not** auto-abstained.

The fix requires knowing whether this lot is a first submission or a re-entry. This
information is already available: `lot_owner_id in existing_subs_by_lot` is True for
re-entry.

Change:

```python
# (current lines 499-534)
else:
    motions_needing_new_vote.append(motion)
```

To:

```python
else:
    # On first submission: auto-abstain unanswered visible motions.
    # On re-entry: leave them unrecorded — the voter will handle them
    # in a subsequent submit or they will be inferred as absent at
    # meeting close.
    if lot_owner_id not in existing_subs_by_lot:
        motions_needing_new_vote.append(motion)
```

The `not_eligible` path is unchanged — in-arrear lots still get `not_eligible` recorded
regardless of re-entry, because eligibility is a fixed property that doesn't depend on
whether the voter has already submitted.

The same guard is applied to the multi-choice abstain path (inside
`if motion.is_multi_choice:` at lines 423–431):

```python
# No options interacted with — record motion-level abstain on first submission;
# leave unrecorded on re-entry.
if lot_owner_id not in existing_subs_by_lot:
    motions_needing_new_vote.append(motion)
```

#### Fix 4a — `backend/app/services/admin_service.py`

Replace the coarse "skip entirely if already submitted" check with a per-motion check,
mirroring the re-entry logic in `submit_ballot`.

Steps in `enter_votes_for_meeting`:

1. **Load already-voted motion IDs per lot** (single IN query, mirrors the pattern in
   `submit_ballot` at lines 273–283):

   ```python
   all_voted_result = await db.execute(
       select(Vote.lot_owner_id, Vote.motion_id).where(
           Vote.general_meeting_id == general_meeting_id,
           Vote.lot_owner_id.in_(lot_owner_ids),
           Vote.status == VoteStatus.submitted,
       )
   )
   already_voted_by_lot: dict[uuid.UUID, set[uuid.UUID]] = {}
   for row in all_voted_result.all():
       already_voted_by_lot.setdefault(row[0], set()).add(row[1])
   ```

2. **Keep `already_submitted`** — still needed to distinguish "new submission" from
   "re-entry submission" in the BallotSubmission creation step.

3. **Inside the per-entry loop**, replace the full lot skip with a per-motion skip:

   ```python
   for motion in visible_motions:
       if motion.id in already_voted_by_lot.get(lot_owner_id, set()):
           continue  # already voted on this motion — skip
       # ... build vote
   ```

4. **BallotSubmission creation**: keep the same `begin_nested` savepoint pattern, but
   only create a new `BallotSubmission` when `lot_owner_id not in already_submitted`.
   When re-entering, just add the new Vote rows without creating a new submission.

The complete re-entry block for admin vote entry:

```python
try:
    async with db.begin_nested():
        if lot_owner_id not in already_submitted:
            submission = BallotSubmission(
                general_meeting_id=general_meeting_id,
                lot_owner_id=lot_owner_id,
                voter_email="admin",
                proxy_email=None,
                submitted_by_admin=True,
                submitted_by_admin_username=admin_username,
            )
            db.add(submission)
        for vote in votes_to_add:
            db.add(vote)
        await db.flush()
except IntegrityError:
    skipped_count += 1
    continue
```

When all motions for a lot are already voted (because the voter submitted them all
online), `votes_to_add` will be empty and the loop adds nothing — equivalent to the
old `already_submitted` skip but correct for partial-submission cases.

The `skipped_count` semantics change slightly: previously it counted lots with any
existing submission; now it counts lots where `votes_to_add` was empty (no new votes
to add) OR where an IntegrityError occurred. The response shape (`submitted_count`,
`skipped_count`) does not change.

### Frontend changes

None. These are backend-only fixes. The existing frontend re-entry flow (returning to the
voting page after new motions are revealed) is not affected.

---

## Data Flow — Happy Path for Fix 3

1. Voter A authenticates, votes on M1 and M2 (both visible). `submit_ballot` first-entry
   path: `BallotSubmission(voter_email=A)` created, `Vote(M1, email=A)` and
   `Vote(M2, email=A)` inserted.
2. Admin makes M3 visible.
3. Voter B (co-owner of same lot) authenticates, votes on M3.
4. `submit_ballot` re-entry path:
   - `votes_to_add` = [Vote(M3, email=B)]
   - `existing_subs_by_lot[lot_X].voter_email = B` (Fix 3 change)
   - DB now has `BallotSubmission(voter_email=B)` and `Vote(M3, email=B)`.
5. Admin results view reads `BallotSubmission.voter_email` → shows voter B's email.
6. Confirmation page reads `BallotSubmission.voter_email` → shows voter B's email.

---

## Data Flow — Happy Path for Fix 4

1. Voter A submits when M1 and M2 are visible, providing inline_votes for M1 only.
   First-entry: M1 recorded with choice, M2 auto-abstained (correct — first submission).
2. Admin makes M3 visible.
3. Voter A returns and calls `submit_ballot` with `inline_votes = {M3: yes}`.
   - Re-entry path (lot_X in `existing_subs_by_lot`).
   - M1 and M2 are in `already_voted_for_lot` → skipped.
   - M3: choice provided → `votes_to_add` = [Vote(M3, choice=yes)].
   - No motions added to `motions_needing_new_vote` (Fix 4: only applies on first entry).
   - Vote(M3) inserted with voter_email=A.
4. If admin also makes M4 visible after step 3, and voter A returns again, M4 will be in
   `motions_needing_new_vote` only if this is a first-entry submission. Since it's still
   a re-entry, M4 is left unrecorded until explicitly answered.

---

## Data Flow — Happy Path for Fix 4a

1. Voter A submits when M1 visible (first-entry). `BallotSubmission` created.
2. Admin makes M2 visible.
3. Admin enters in-person vote for lot X on M2 via `enter_votes_for_meeting`.
   - `already_submitted` contains lot X (from step 1). Previously: skip lot X.
   - Fixed: `already_voted_by_lot[X]` = {M1}. M1 is skipped (already voted). M2 is not.
   - `votes_to_add` = [Vote(M2, choice=<admin choice>)].
   - `lot_owner_id in already_submitted` → no new `BallotSubmission` created.
   - Vote(M2) inserted.
4. `submitted_count += 1`.

---

## Key Design Decisions

1. **Update `BallotSubmission.voter_email` to last submitter (Fix 3)** rather than keeping
   first submitter. The BallotSubmission is an audit record of who most recently touched the
   ballot. Having it show a stale email is misleading. Individual Vote records each carry
   their own `voter_email` for fine-grained audit.

2. **Re-entry does not auto-abstain (Fix 4)** rather than recording a timestamp on the
   motion to distinguish "visible at submission time" from "visible after". The timestamp
   approach would require a schema migration and added complexity. The simpler fix is: on
   re-entry, if you don't say anything about a motion, nothing happens. On first entry, all
   visible motions are resolved.

3. **Admin re-entry mirrors voter re-entry (Fix 4a)** — the admin vote entry function gets
   the same "skip already-voted motions" logic that `submit_ballot` has. This keeps the two
   paths consistent.

4. **No change to `not_eligible` auto-recording on re-entry** — in-arrear eligibility is
   a property of the lot, not a choice the voter makes. Recording `not_eligible` on re-entry
   for any new visible general/multi-choice motions is correct and unchanged.

---

## Security Considerations

No security implications. These fixes modify in-memory logic inside existing endpoints
(`POST /api/general-meeting/{id}/submit` and `POST /api/admin/general-meetings/{id}/vote-entry`).
Both endpoints already require authentication (voter session or admin session respectively).
No new endpoints, no new data exposure, no new secrets, no input changes.

---

## Files to Change

| File | Change |
|------|--------|
| `backend/app/services/voting_service.py` | Fix 3: update `BallotSubmission.voter_email` on re-entry (lines 581–587). Fix 4: guard `motions_needing_new_vote` so it only applies on first submission, not re-entry (lines 499 and ~431). |
| `backend/app/services/admin_service.py` | Fix 4a: replace "skip if already submitted" with per-motion skip; add `already_voted_by_lot` query; split BallotSubmission creation from Vote insertion in re-entry case (lines 3755–3807, 3895–3978). |
| `backend/tests/test_phase2_api.py` | Add unit/integration tests for Fix 3 (voter B email on re-entry BallotSubmission), Fix 4 (no auto-abstain on re-entry for unaddressed motions), Fix 4a (admin vote entry on partially submitted lot). |
| `backend/tests/test_admin_vote_entry_api.py` | Add integration tests for Fix 4a (admin re-entry on partially submitted lot). |

---

## Test Cases

### Unit / Integration — Fix 3

- **Two voters, same lot, re-entry**: voter A submits M1 (first entry). Admin reveals M2.
  Voter B submits M2 (re-entry). Assert `BallotSubmission.voter_email == B`.
- **Single voter re-entry (no co-owner)**: voter A submits M1, then re-submits M2.
  Assert `BallotSubmission.voter_email == A` (unchanged — same email).
- **Proxy re-entry**: proxy B submits for lot X (first entry). Admin reveals M2. Proxy B
  submits again (re-entry). Assert `BallotSubmission.voter_email == B` still (same).

### Unit / Integration — Fix 4

- **Re-entry with only one motion in inline_votes**: voter submits M1 (first entry, M1 and
  M2 both visible — M2 auto-abstained correctly). Admin reveals M3. Voter re-submits with
  `inline_votes={M3: yes}`. Assert: only `Vote(M3, choice=yes)` is newly inserted.
  No new Vote row for any other motion is created. `Vote(M2, abstained)` already exists
  from first entry and is untouched.
- **Re-entry with empty inline_votes**: voter re-submits with no inline_votes after a new
  motion is revealed. Assert: no new Vote rows are created (`votes_to_add` empty, no
  `motions_needing_new_vote` populated). `submitted_count` still returns 200 (no-op).
- **First entry with unanswered motions still auto-abstains**: voter submits for the first
  time with only `inline_votes={M1: yes}` when M1 and M2 are both visible. Assert:
  `Vote(M2, abstained)` is created (first-entry behaviour unchanged).
- **In-arrear lot re-entry**: in-arrear lot re-submits after new general motion revealed.
  `not_eligible` is still recorded for the new general motion regardless of re-entry.

### Unit / Integration — Fix 4a

- **Admin enters votes for newly visible motion on partially submitted lot**: lot X has
  submitted for M1. Admin reveals M2 and calls `enter_votes_for_meeting` with choice for
  M2. Assert: `Vote(M2, choice=<admin choice>)` is created. No new `BallotSubmission`.
  `submitted_count = 1`.
- **Admin skips lot that has voted on all visible motions**: lot X has submitted for M1 and
  M2, both visible. Admin calls `enter_votes_for_meeting`. Assert: `skipped_count = 1`,
  no new Vote rows, no new BallotSubmission.
- **Admin enters votes for lot with no prior submission** (existing behaviour): no
  BallotSubmission exists. Admin votes M1. Assert: new BallotSubmission created,
  Vote(M1) created. `submitted_count = 1`.
- **Existing E2E spec** `e2e_tests/admin/admin-general-meetings.spec.ts` — verify
  in-person vote entry still works for un-submitted lots (regression guard).

### E2E Test Scenarios

- **Happy path — co-owner re-entry email**: seed a lot with two emails (A and B).
  Voter A authenticates and submits M1 (first entry). Admin reveals M2. Voter B
  authenticates, votes M2. Admin opens results page for M2. Verify voter_email shown
  for lot X is B's email, not A's.

- **Happy path — no stale auto-abstain on re-entry**: seed meeting with M1 visible.
  Voter submits M1. Admin reveals M2 and M3. Voter re-authenticates and votes M2 only
  (does not mention M3). Assert: `GET /motions` shows M3 still interactive (not
  already-voted). Voter votes M3 on a subsequent submit.

- **Admin in-person re-entry**: seed meeting with M1 visible. Voter submits M1 online.
  Admin reveals M2. Admin uses in-person vote entry for the lot on M2. Assert: admin
  results show M1 (voter choice) and M2 (admin choice) for the lot.

- **Multi-step sequence (Fix 3 + 4 combined)**: lot X has email A and email B.
  (1) Voter A votes M1 (first entry). (2) Admin reveals M2. (3) Voter B votes M2
  (re-entry). Verify: M2 Vote has `voter_email=B`, `BallotSubmission.voter_email=B`,
  and M1 Vote still has `voter_email=A`. Admin results show B as submitter for the lot.

---

## Affected Persona Journeys

- **Voter re-entry journey** (US-MV05): existing E2E spec
  `e2e_tests/voter/revote-new-motion-batches.spec.ts` — must still pass after Fix 4
  changes. The spec verifies lots are "unlocked" after new motion reveals and that the
  voter can vote and reach confirmation. The Fix 4 change (no auto-abstain on re-entry)
  does not break this flow because the spec always provides explicit votes for each
  motion in `submitBallot`.

- **Co-owner ballot visibility journey** (US-MOV-01): existing test
  `test_phase2_api.py::test_voter_b_co_owner_sees_ballot_submitted_by_voter_a` — verify
  it still passes. New test for Fix 3 checks the submitter email shown is the last
  submitter.

- **Admin vote entry journey** (US-AVE-01/02): existing spec
  `e2e_tests/admin/admin-general-meetings.spec.ts` — must still pass (admin entry on
  non-submitted lots unchanged).

---

## Schema Migration Required

**No.** All three fixes are pure service-layer logic changes. No new columns, tables,
indexes, or enum values are needed.
