# Design: Admin Vote Entry — For/Against/Abstain Per Multi-Choice Option

**Status:** Draft

## Overview

Extend the admin vote entry panel to support For/Against/Abstain per option for multi-choice motions, matching the voter-facing per-option F/A/Ab UX added in the Multi-Choice For/Against/Abstain slice.

Covers US-AVE2-01.

---

## Root Cause / Background

The admin in-person vote entry grid (Slice 1) used a checkbox model for multi-choice motions. After Slice 3 changed the voter-facing flow to For/Against/Abstain per option, the admin grid needed the same update so paper ballots capturing Against votes can be digitised correctly.

---

## Dependencies

- **Slice 3** (design-multi-choice-for-against-abstain.md) — requires `VoteChoice.against` enum value to be present in the DB.

---

## Technical Design

### Database changes

None. `VoteChoice.against` was added in Slice 3. No new schema changes are required.

### Backend changes

**Modified `enter_votes_for_meeting`** (`backend/app/services/admin_service.py`):
- The `AdminMultiChoiceVoteItem` request schema changes from `{motion_id, option_ids: [uuid]}` to `{motion_id, option_choices: [{option_id, choice: "for"|"against"|"abstained"}]}`.
- Backward compatibility: the old `option_ids` field is accepted alongside `option_choices` (if `option_ids` is non-empty and `option_choices` is absent, treat all listed `option_ids` as `choice = "for"`). Both fields are optional in the request schema; the service picks `option_choices` first.
- Vote recording per choice:
  - `"for"` → `Vote(choice=VoteChoice.selected, motion_option_id=option_id)` (consistent with voter flow).
  - `"against"` → `Vote(choice=VoteChoice.against, motion_option_id=option_id)`.
  - `"abstained"` → `Vote(choice=VoteChoice.abstained, motion_option_id=option_id)`.
  - Options with no entry in `option_choices` are omitted entirely (not auto-abstained); this matches the "blank = no vote" semantic defined in US-AVE2-01.
- `option_limit` enforcement: count only `choice == "for"` entries; return 422 if `for_count > option_limit`.

**Modified Pydantic schemas** `backend/app/schemas/admin.py`:
- `AdminMultiChoiceOptionChoice`: `{option_id: UUID, choice: Literal["for","against","abstained"]}`.
- `AdminMultiChoiceVoteItem`: add `option_choices: list[AdminMultiChoiceOptionChoice] | None = None`; retain `option_ids: list[UUID] | None = None` for backward compatibility.

### Frontend changes

**Modified `AdminVoteEntryPanel.tsx`**:

Replace the checkbox-per-option cell (`toggleMultiOption` + `multiChoiceSelections`) with a per-option For/Against/Abstain button group.

State shape change:
```typescript
// Old
multiChoiceSelections: Record<string, string[]>  // motion_id -> option_ids[]

// New
multiChoiceChoices: Record<string, Record<string, "for" | "against" | "abstained">>
// motion_id -> option_id -> choice
```

New handler `setOptionChoice(lotId, motionId, optionId, choice)` replaces `toggleMultiOption`.

Per-option cell renders three compact toggle buttons ("For", "Against", "Abstain") with the same `aria-pressed` pattern as the binary motion buttons. "For" button is disabled when `forCount >= option_limit AND currentChoice !== "for"`.

Counter label: `{forCount} of {option_limit} voted For`.

Submission: build `option_choices: [{option_id, choice}]` for options where a choice has been made; omit options with no selection.

`isLotAnswered` for multi-choice: unchanged — multi-choice motions are always considered "answered" regardless of per-option selections (matches existing behaviour).

**Modified API types** `frontend/src/api/admin.ts`:
- Add `AdminMultiChoiceOptionChoice: {option_id: string; choice: "for"|"against"|"abstained"}`.
- Update `AdminMultiChoiceVoteItem`: replace `option_ids: string[]` with `option_choices: AdminMultiChoiceOptionChoice[]` (send only this field for new submissions).

---

## Files to Change

| File | Change |
|------|--------|
| `backend/app/schemas/admin.py` | Add `AdminMultiChoiceOptionChoice`; extend `AdminMultiChoiceVoteItem` |
| `backend/app/services/admin_service.py` | Update `enter_votes_for_meeting` to handle `option_choices` |
| `frontend/src/api/admin.ts` | Add `AdminMultiChoiceOptionChoice`; update `AdminMultiChoiceVoteItem` |
| `frontend/src/pages/admin/AdminVoteEntryPanel.tsx` | Replace checkbox cells with For/Against/Abstain button groups |
| `frontend/tests/msw/handlers.ts` | Update mock handlers for new request shape |

---

## Test Cases

### Unit / Integration
- `enter_votes_for_meeting` with `option_choices` containing For on 2 options (limit 2): 2 `Vote(choice=selected)` rows.
- `enter_votes_for_meeting` with Against on 1 option: 1 `Vote(choice=against)` row.
- `enter_votes_for_meeting` with more than `option_limit` For choices: returns 422.
- `enter_votes_for_meeting` with blank options (no `option_choices` entry): no Vote row created for that option.
- Backward compatibility: `option_ids` field still accepted; treated as all-"for".
- Against votes do not count toward `option_limit`; sending 3 Against + 2 For when limit=2 is valid.

### E2E
- Admin opens vote entry grid for a multi-choice motion; sees For/Against/Abstain buttons per option; For buttons disable at limit; Against does not count toward limit; submits successfully.

---

## Schema Migration Required

None. Depends on `VoteChoice.against` from the Multi-Choice For/Against/Abstain slice.
