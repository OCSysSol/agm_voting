# Design: Multi-Choice For/Against/Abstain (Voter-Facing + Pass/Fail Outcome)

**Status:** Implemented

## Overview

Two related slices that together deliver per-option For/Against/Abstain voting on multi-choice motions and an automated pass/fail result calculation when the meeting is closed.

- **Slice 3** (US-MC-SPLIT-01) — voter-facing per-option F/A/Ab buttons
- **Slice 4** (US-MC-RESULT-01) — pass/fail outcome algorithm stored at meeting close

---

## Root Cause / Background

Multi-choice motions previously used a checkbox "select all that apply" model. To align with general/special resolution UX and support automated result determination, each option now supports For, Against, and Abstain independently. Outcome (pass/fail/tie) is computed once at meeting close and stored for a stable audit record.

---

## Technical Design

### Slice 3 — Multi-Choice Per-Option For/Against/Abstain

#### Database changes

**`VoteChoice` enum** — add new value `against`. The existing `selected` value is retained as the stored representation of "For" to preserve backward compatibility with existing rows. New `against` rows are stored with `choice = "against"` and `motion_option_id` set.

Migration:
```sql
ALTER TYPE votechoice ADD VALUE 'against';
```

No table structure changes; the new enum value is purely additive.

#### Backend changes

**Modified `VoteChoice` enum** (`backend/app/models/vote.py`):
- Add `against = "against"`.

**Modified submit service** (`backend/app/services/voting_service.py`):
- The existing `multi_choice_votes` request field changes shape. The frontend now sends per-option choices instead of a flat list of selected option IDs.
- New `MultiChoiceOptionChoice` schema: `{option_id: uuid, choice: "for" | "against" | "abstained"}`.
- New `MultiChoiceVoteItem` schema: `{motion_id: uuid, option_choices: list[MultiChoiceOptionChoice]}`.
- `submit_ballot` processes `option_choices`:
  - `choice == "for"` → store `Vote(choice=VoteChoice.selected, motion_option_id=option_id)` (consistent with existing "selected" rows).
  - `choice == "against"` → store `Vote(choice=VoteChoice.against, motion_option_id=option_id)`.
  - `choice == "abstained"` → store `Vote(choice=VoteChoice.abstained, motion_option_id=option_id)`.
  - Motion-level abstain (no options interacted with) → store one `Vote(choice=VoteChoice.abstained, motion_option_id=None)` as before.
- Enforce `option_limit` based on count of `choice == "for"` options only; `against`/`abstained` do not count.

**Modified voting schemas** (`backend/app/schemas/voting.py`):
- Replace `MultiChoiceVoteItem` with new shape: `option_choices` list instead of `option_ids`.
- Extend `BallotVoteItem` with `option_choices: list[{option_id, option_text, choice}]` for the confirmation endpoint.

**Modified `get_my_ballot`** (`backend/app/services/voting_service.py`):
- Return `option_choices` per multi-choice motion, including `against` choices.

**Modified `list_motions`** (`backend/app/routers/voting.py`):
- `submitted_option_ids_by_motion` is replaced with `submitted_option_choices_by_motion: dict[uuid, dict[uuid, VoteChoice]]` so the frontend can pre-populate prior per-option choices on re-entry.
- Update `MotionOut.submitted_option_ids` → rename to `submitted_option_choices: dict[str, str]` (option_id → choice string).

#### Frontend changes

**Modified `MotionCard`** (or new `MultiChoiceOptionRow` sub-component):
- Replace checkbox list with one row per option, each row having three compact buttons: "For" / "Against" / "Abstain".
- "For" button disabled when `option_limit` reached AND this option is not already set to "For".
- Counter label: "Select up to N option(s) — X voted For".

**Modified ballot submission** (`VotingPage.tsx`):
- Build `multi_choice_votes` as `[{motion_id, option_choices: [{option_id, choice}]}]`.

**Modified `MyBallotPage` / confirmation screen**:
- Render per-option choices using the updated `BallotVoteItem.option_choices`.

---

### Slice 4 — Multi-Choice Pass/Fail Outcome

#### Database changes

Add `outcome` column to `motion_options`:

```sql
ALTER TABLE motion_options
  ADD COLUMN outcome VARCHAR CHECK (outcome IN ('pass', 'fail', 'tie')) DEFAULT NULL;
```

Outcome is computed once when the meeting is closed and stored. This avoids re-computation on every admin detail page load and ensures the result is stable after close.

#### Backend changes

**Modified `MotionOption` model** (`backend/app/models/motion_option.py`):
- Add `outcome: Mapped[str | None]` with nullable, no default.

**New service function** `compute_multi_choice_outcomes(general_meeting_id, db)` in `admin_service.py`:
- For each `multi_choice` motion in the meeting:
  1. Compute `total_building_entitlement` = sum of all `AGMLotWeight.unit_entitlement` for the meeting.
  2. For each option:
     - `for_entitlement_sum` = sum of UOE for lots with `Vote.choice = "selected"` (For) for this option.
     - `against_entitlement_sum` = sum of UOE for lots with `Vote.choice = "against"` for this option.
  3. Mark option as `fail` if `against_entitlement_sum / total_building_entitlement > 0.50`.
  4. Among remaining (non-failed) options, rank by `for_entitlement_sum` descending.
  5. Top `option_limit` ranked options: check for ties at the boundary.
     - If position `option_limit` and `option_limit + 1` have the same `for_entitlement_sum`, mark both and all others with the same score at the boundary as `tie`.
     - Positions 1 to `option_limit` without a tie boundary: mark `pass`.
     - Positions after `option_limit` without tie: mark `fail`.
  6. Persist `outcome` on each `MotionOption` row.

**Modified `close_general_meeting`** (`admin_service.py`):
- After setting `status = closed` and creating absent records, call `compute_multi_choice_outcomes`.

**Modified `get_general_meeting_detail`** (`admin_service.py`):
- Include `outcome` in `tally.options[]` in the response.

**Modified Pydantic schemas** (`backend/app/schemas/admin.py`):
- Add `outcome: str | None` to the option tally item schema.

**Modified email template** (`backend/app/services/email_service.py`):
- Add outcome label (Pass / Fail / Tie) beside each option row in the email.

#### Frontend changes

**Modified admin results section** in `AdminMeetingDetailPage.tsx`:
- Add an `OutcomeBadge` component: green "Pass", red "Fail", amber "Tie — admin review required".
- Render `OutcomeBadge` beside each option row when `outcome` is non-null.

---

## Files to Change

| File | Change |
|------|--------|
| `backend/app/models/vote.py` | Add `against` to `VoteChoice` enum |
| `backend/app/models/motion_option.py` | Add `outcome` column |
| `backend/alembic/versions/` | Migration: `votechoice` enum + `motion_options.outcome` |
| `backend/app/routers/voting.py` | Update `list_motions` to return per-option choices |
| `backend/app/schemas/voting.py` | Update `MultiChoiceVoteItem` shape; extend `BallotVoteItem` |
| `backend/app/schemas/admin.py` | Add `outcome` to option tally item schema |
| `backend/app/services/voting_service.py` | Update `submit_ballot` (new multi-choice shape); update `get_my_ballot` |
| `backend/app/services/admin_service.py` | Add `compute_multi_choice_outcomes`; call from `close_general_meeting`; extend `get_general_meeting_detail` |
| `backend/app/services/email_service.py` | Add outcome labels to email template |
| `frontend/src/pages/voter/VotingPage.tsx` | Replace checkbox list with For/Against/Abstain buttons per option |
| `frontend/src/pages/voter/ConfirmationPage.tsx` | Show per-option choices for multi-choice |
| `frontend/src/pages/admin/AdminMeetingDetailPage.tsx` | Add `OutcomeBadge` on option rows |
| `frontend/tests/msw/handlers.ts` | Update mock handlers for new vote shape |

---

## Test Cases

### Slice 3 — Multi-Choice Per-Option For/Against/Abstain

**Unit / Integration:**
- Submit with For on 2 options (limit 2): 2 `Vote(choice=selected)` rows with `motion_option_id` set.
- Submit with Against on 1 option: 1 `Vote(choice=against, motion_option_id=...)` row.
- Submit with For > option_limit: returns 422.
- Submit with all options left blank (abstain entire motion): 1 `Vote(choice=abstained, motion_option_id=None)`.
- `get_my_ballot` returns per-option choices including `against`.

**E2E:**
- Voter sees For/Against/Abstain buttons per option; For buttons disable at limit; Against does not consume limit.

### Slice 4 — Multi-Choice Pass/Fail Outcome

**Unit / Integration:**
- All options below 50% against threshold, top N by for-votes: top N pass, rest fail.
- One option has >50% against: it fails regardless of for-votes.
- Tie at boundary (positions N and N+1 have equal for-votes): both flagged `tie`, neither promoted to pass.
- `compute_multi_choice_outcomes` called on meeting close; outcomes stored in `motion_options.outcome`.
- `get_general_meeting_detail` returns outcome on each option tally item.

**E2E:**
- Close a meeting with a multi-choice motion; admin results page shows Pass/Fail/Tie badges.

---

## Schema Migration Required

Yes — additive, backward-compatible:
- `votechoice` enum: add `'against'` value
- `motion_options.outcome` (VARCHAR nullable, CHECK IN ('pass','fail','tie'))
