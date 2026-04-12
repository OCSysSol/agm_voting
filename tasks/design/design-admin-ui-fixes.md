# Design: Admin UI Fixes and Enhancements

PRD ref: `tasks/prd/prd-agm-voting-app.md` — stories US-AUIF-01 through US-AUIF-10

**Status:** Implemented

---

## Overview

This document covers a set of targeted frontend fixes and enhancements to the AGM Voting App admin and voter interfaces. All changes are purely frontend — no backend schema or API changes are required. The items are grouped by theme but all ship together in one branch.

**Changes:**
1. Admin vote entry: enforce `option_limit` on multi-choice For selections
2. Admin meeting view: collapsible per-motion vote drill-down
3. Admin report view: multi-choice counts shown collapsed by default, expandable to voter detail
4. Admin report view: highlight winning option(s) per motion
5. Admin report view: multi-choice motion UI styling consistency
6. Voter view: multi-choice motions display correct motion type label (not "Multi-Choice")
7. Voter view: multi-choice motion title duplication fix
8. Voter view: multi-choice motions must not pre-fill from previous lot's votes
9. Admin view: "Closed" motion status uses a styled badge/pill
10. Voter view: "Voting closed" message moves inside the motion card with correct styling
11. OCSS logo/favicon fallback when no branding is configured

---

## Technical Design

### No backend changes

All changes are frontend-only. No new API endpoints, no schema migrations, no model changes.

---

### Fix 1: Admin vote entry — enforce `option_limit` on For selections

**File:** `frontend/src/pages/admin/AdminVoteEntryPanel.tsx`

**Current behaviour:** The multi-choice cell in the vote entry grid shows `{forCount} of {motion.option_limit} voted For` as a label but does not prevent the user from clicking "For" on additional options once the limit is reached. The voter view (`MultiChoiceOptionList`) correctly blocks this via a `limitReached` check.

**Change:** In the `motion.is_multi_choice === true` branch of the per-lot vote cell (around line 637), derive `limitReached` from `forCount >= motion.option_limit`. For each option's "For" button:
- Set `disabled` to `true` when `limitReached && currentChoice !== "for"` (same logic as `MultiChoiceOptionList`).
- Add an `aria-label` suffix `" (limit reached)"` when the button is disabled due to the limit.
- The "Against" and "Abstain" buttons are never disabled due to the limit.

The `setOptionChoice` handler already supports toggling off — no handler changes are needed.

---

### Fix 2: Admin meeting view — collapsible per-motion vote drill-down

**File:** `frontend/src/pages/admin/GeneralMeetingDetailPage.tsx`

**Current behaviour:** The "Results Report" section (`AGMReportView`) is shown unconditionally below the motions management table.

**Change:** Wrap the Results Report section in a collapsible `<details>` element (or a React-controlled expand/collapse toggle) so the admin can collapse/expand each section. This is a page-level structural change: the entire results report section gets a toggle header. Each motion within `AGMReportView` is already rendered as a separate `admin-card`; no change to the card level is needed for this item — the granularity of the drill-down is per-motion as already structured.

**Implementation approach:**
- Add a local `useState<boolean>` (`showResults`, default `true`) in `GeneralMeetingDetailPage`.
- Render the `<h2>Results Report</h2>` heading as a clickable toggle button using `<button type="button" className="btn btn--ghost">` with an aria-expanded attribute.
- When collapsed, render only the heading; when expanded, render `<AGMReportView />`.
- The toggle button shows "▶ Results Report" when collapsed and "▼ Results Report" when expanded.

---

### Fix 3: Multi-choice motion counts shown collapsed, expandable to voter detail

**File:** `frontend/src/components/admin/AGMReportView.tsx`

**Current behaviour:** `MultiChoiceOptionRows` renders each option row with for/against/abstained sub-rows collapsed by default behind an "Expand" button — this is already correct for showing voter detail. The summary counts (for/against/abstained voter count and entitlement) are shown only when expanded.

**Change:** Move the For/Against/Abstained summary counts (voter_count and entitlement_sum) into the **collapsed** option header row so they are visible without expanding. The expand/collapse action then reveals the individual voter list only.

Specifically, update `MultiChoiceOptionRows`:
- In the option header row (`colSpan={3}` td), render the summary counts (For N voters / Against N voters / Abstained N voters) inline after the option text and outcome badge.
- Remove the summary rows (`For / Against / Abstained` count rows) from the expanded section; retain only the voter list rows (lot number, email, entitlement).
- The expand/collapse button label changes from "Expand" to "Show voters" / "Hide voters" for clarity.

---

### Fix 4: Highlight winning option(s) per motion

**File:** `frontend/src/components/admin/AGMReportView.tsx`

**Current behaviour:** For standard binary motions, no winner is visually highlighted. For multi-choice, each option shows an `OutcomeBadge` if `optTally.outcome` is set.

**Change — binary motions:** In the per-motion table for non-multi-choice motions, determine the winner by comparing `motion.tally.yes.entitlement_sum` vs `motion.tally.no.entitlement_sum`. Apply a CSS highlight to the winning row:
- If `yes_sum > no_sum`: highlight the "For" row with a left border in `var(--green)` and a light green row background (`var(--green-bg)`).
- If `no_sum > yes_sum`: highlight the "Against" row with a left border in `var(--red)` and `var(--red-bg)`.
- If equal: no highlight (tie).
- Abstained, Absent, Not eligible rows are never highlighted.

**Change — multi-choice motions:** The top N options by `for_entitlement_sum` (where N = `motion.option_limit ?? 1`) are highlighted. Sort the options array by descending `for_entitlement_sum` and mark the top N. Apply the same green-border highlight to the option header row for the winning options.

Implementation: derive `winningOptionIds: Set<string>` before rendering `motion.tally.options`. A highlight is rendered by adding an inline left border style (`borderLeft: "4px solid var(--green)"`) or a `background: var(--green-bg)` to the option header `<tr>` when the option id is in the winning set.

---

### Fix 5: Multi-choice UI styling consistency in admin view

**File:** `frontend/src/components/admin/AGMReportView.tsx`

**Current behaviour:** Multi-choice motion cards render their option tallies without the same row styles as binary motion categories. The binary categories use inline-flex dot + label style; multi-choice options use a plain `<span>` inside a `colSpan={3}` row.

**Change:** No new CSS classes are needed. The existing visual separation (option header row with `background: var(--surface-raised, #f7f7f7)`) is intentional. This fix is addressed by Fix 3 (the collapsed counts in the header) which makes the multi-choice layout look more like the binary layout. Document explicitly: no further structural restyling is in scope for this item.

---

### Fix 6: Voter view — multi-choice motions show correct motion type label

**File:** `frontend/src/components/vote/MotionCard.tsx`

**Current behaviour (bug):**
```tsx
const badgeClass = isSpecial
  ? "motion-type-badge--special"
  : isMultiChoice
  ? "motion-type-badge--multi_choice"
  : "motion-type-badge--general";
const typeLabel = isMultiChoice
  ? "Multi-Choice"
  : MOTION_TYPE_LABELS[motion.motion_type] ?? motion.motion_type;
```
For a multi-choice general motion, the badge shows "Multi-Choice" in a blue tint instead of "General" in a neutral tint, conflating the format flag with the resolution type.

**Change:** Decouple the badge class and label from `isMultiChoice`. The type label should always reflect `motion.motion_type` ("General" or "Special"). The multi-choice badge should be rendered as a separate additional badge (as is already done in `AGMReportView`):

```tsx
// Badge class uses motion_type only
const badgeClass = isSpecial ? "motion-type-badge--special" : "motion-type-badge--general";
const typeLabel = MOTION_TYPE_LABELS[motion.motion_type] ?? motion.motion_type;
```

After the existing type badge, conditionally render a second badge:
```tsx
{isMultiChoice && (
  <span className="motion-type-badge motion-type-badge--multi_choice" aria-label="Multi-choice motion">
    Multi-Choice
  </span>
)}
```

This matches the pattern already used in `AGMReportView.tsx` (lines 274–283) and `MotionManagementTable.tsx` (lines 170–184).

---

### Fix 7: Voter view — multi-choice motion title duplication fix

**File:** `frontend/src/components/vote/MultiChoiceOptionList.tsx`

**Current behaviour (bug):** `MultiChoiceOptionList` renders a `<legend>` with `{motion.title}` (line 46). `MotionCard` also renders `<h3 className="motion-card__title">{motion.title}</h3>` (line 84) for all motions including multi-choice. The title therefore appears twice.

**Change:** Remove the `<legend className="motion-card__title" ...>{motion.title}</legend>` from `MultiChoiceOptionList`. Replace it with an accessible `<legend className="sr-only">{motion.title}</legend>` to retain screen reader association for the fieldset without visual duplication. The visible title is already rendered by `MotionCard`'s `<h3>`.

---

### Fix 8: Multi-choice no pre-fill between lots

**File:** `frontend/src/pages/vote/VotingPage.tsx`

**Current behaviour (bug):** The `multiChoiceSelections` state object persists between lot submissions. When a voter submits votes for lot A and then votes for lot B (remaining lots), the multi-choice selections from lot A remain in state and pre-fill the options for lot B.

**Root cause analysis:** After submission success, `setMultiChoiceSelections` is not cleared. The choices seeding effect (`setMultiChoiceSelections((prev) => { const seeded = { ...prev }; ... })`) only seeds locked (read-only) motions, so it does not overwrite the stale selections for the new lot's unlocked motions. The stale `prev` values carry over.

**Change:** In `submitMutation.onSuccess`, clear `multiChoiceSelections` for the motions that were just submitted (i.e. motions that are not read-only after this submission). Concretely, after updating `allLots` and `selectedIds`, call:

```tsx
setMultiChoiceSelections((prev) => {
  // Remove selections for motions that are now submitted and will be read-only.
  // Keep read-only motions (they will be re-seeded by the choices effect).
  const next = { ...prev };
  for (const [motionId] of Object.entries(next)) {
    // Clear the selection so the next lot starts fresh.
    delete next[motionId];
  }
  return next;
});
```

Additionally, clear the corresponding `sessionStorage` key (`meeting_mc_selections_${meetingId}`). The choices seeding effect will re-seed read-only motions from `m.submitted_option_choices` after the query invalidation resolves, restoring the display for already-voted motions.

**Note:** The equivalent `choices` (binary votes) state is also not cleared on submission, but binary motions already handle this correctly because `isMotionReadOnly` + the seeding effect correctly shows previously submitted choices only for locked motions, and unlocked motions start with `choices[motionId] === undefined` (which renders no button selected). The multi-choice bug is distinct because `MultiChoiceOptionList` renders whatever is in `optionChoices` without a separate "locked" check.

---

### Fix 9: Admin view — "Closed" motion status uses a styled badge

**File:** `frontend/src/components/admin/MotionManagementTable.tsx`

**Current behaviour:** When `isMotionVotingClosed` is true, the "Close Motion" button is replaced by:
```tsx
<span className="motion-voting-closed-badge" ...>Closed</span>
```
The class `motion-voting-closed-badge` has no CSS definition (confirmed by grep), so it renders as unstyled plain text.

**Change:** Apply the existing `motion-type-badge` pattern to this element. Add the class `motion-type-badge` alongside `motion-voting-closed-badge` and introduce a new CSS modifier `motion-type-badge--closed`:

```tsx
<span
  className="motion-type-badge motion-type-badge--closed motion-voting-closed-badge"
  ...
>
  Voting Closed
</span>
```

Add the CSS rule in `frontend/src/styles/index.css` within the badge section:
```css
.motion-type-badge--closed {
  background: var(--red-bg);
  color: var(--red);
  border: 1px solid #F5C6C0;
}
```

**File:** `frontend/src/styles/index.css`

---

### Fix 10: Voter view — "Voting closed" moves inside the motion card

**File:** `frontend/src/pages/vote/VotingPage.tsx`

**Current behaviour:** When a motion is individually closed (`isMotionIndividuallyClosed`), the page renders:
```tsx
<div className="motion-closed-label" ...>Voting closed</div>
<MotionCard ... disabled={true} />
```
The `motion-closed-label` class has no CSS definition, so it renders as plain unstyled text **above** the motion card.

**Change 1 — Remove the external `<div>` label:** Remove the `<div className="motion-closed-label" ...>` element from `VotingPage.tsx`.

**Change 2 — Move the closed indicator inside `MotionCard`:** Pass a `isClosed` boolean prop to `MotionCard` that signals the motion is individually closed (distinct from the meeting-level `disabled` prop).

Actually, a simpler approach is to add a `votingClosed` prop to `MotionCard` (boolean, default false). When `votingClosed` is true, render a styled status badge inside the card below the title/description and above the vote buttons. The badge text is "Motion Closed" (not "Voting closed").

**File:** `frontend/src/components/vote/MotionCard.tsx`

Update `MotionCardProps`:
```tsx
votingClosed?: boolean;
```

Inside the card render, after `{motion.description && ...}` and before the vote buttons block:
```tsx
{votingClosed && (
  <span className="motion-type-badge motion-type-badge--closed" role="status" aria-label="Motion voting is closed">
    Motion Closed
  </span>
)}
```

In `VotingPage.tsx`, pass `votingClosed={motionClosed}` to `MotionCard` and remove the external `motion-closed-label` div. The `data-testid={`motion-closed-label-${motion.id}`}` must move to the badge element inside `MotionCard` (or be applied as a `data-testid` prop passed through). Update test expectations accordingly.

**File:** `frontend/src/pages/vote/VotingPage.tsx`

---

### Fix 11: OCSS logo/favicon fallback

**File:** `frontend/src/context/BrandingContext.tsx`

**Current behaviour:** `BrandingProvider` falls back to `DEFAULT_CONFIG` on error or missing data. `DEFAULT_CONFIG.logo_url` is `""` (empty string). `VoterShell` checks `config.logo_url ? <img /> : <span>{config.app_name}</span>`, so an empty logo_url shows the app name text. `AdminLayout` does the same. The favicon logic falls back to `"/favicon.ico"` if neither `favicon_url` nor `logo_url` is set.

**Change 1 — Constant fallback URLs:** Define the two OCSS fallback URLs as named constants in `BrandingContext.tsx`:

```tsx
export const FALLBACK_LOGO_URL =
  "https://sentw3x37yabsacv.public.blob.vercel-storage.com/ocss-logo-C9E81q9ZrYhx9aARiYOvaF3gn1cqp1.svg";
export const FALLBACK_FAVICON_URL =
  "https://sentw3x37yabsacv.public.blob.vercel-storage.com/ocss-favicon-4CMVReCEFGq06d9bG9Q8NqTrZqRosj.svg";
```

**Change 2 — Apply fallback in `DEFAULT_CONFIG`:** Update `DEFAULT_CONFIG`:
```tsx
export const DEFAULT_CONFIG: TenantConfig = {
  app_name: "General Meeting",
  logo_url: FALLBACK_LOGO_URL,
  favicon_url: FALLBACK_FAVICON_URL,
  primary_colour: "#005f73",
  support_email: "",
};
```

**Change 3 — Apply fallback when the fetched config has no logo/favicon:** In `BrandingProvider`, after resolving `config`, derive effective URLs:
```tsx
const effectiveLogoUrl = config.logo_url || FALLBACK_LOGO_URL;
const effectiveFaviconUrl = config.favicon_url || FALLBACK_FAVICON_URL;
```

Provide these to a new context shape or apply them in the favicon `useEffect`:
```tsx
// In the useEffect that sets the favicon:
link.href = effectiveFaviconUrl;
```

Pass `effectiveLogoUrl` down via context so `VoterShell` and `AdminLayout` can use it without their own fallback logic.

**File:** `frontend/src/components/vote/VoterShell.tsx`

Remove the conditional: `config.logo_url ? <img> : <span>`. Replace with an unconditional `<img src={effectiveLogoUrl} alt={config.app_name} />` since `effectiveLogoUrl` is always non-empty after the fallback.

**File:** `frontend/src/pages/admin/AdminLayout.tsx`

Apply the same change: replace the conditional logo render with an unconditional `<img>` using `effectiveLogoUrl`.

**Context API shape change:** Add `effectiveLogoUrl: string` and `effectiveFaviconUrl: string` to `BrandingContextValue` so consumers do not need to reimplement fallback logic. Update `useBranding()` callers in `VoterShell`, `AdminLayout`, `AgmQrCode`, and `AgmQrCodeModal` (which pass `logoUrl` to the QR code).

---

## Security Considerations

No security implications. All changes are frontend rendering adjustments. No new endpoints, no auth changes, no new secrets, no data exposure scope changes.

---

## Key Design Decisions

- **Fix 8 (no multi-choice pre-fill):** Clearing `multiChoiceSelections` entirely on submission is the safest approach. Binary `choices` state is left untouched because the binary vote rendering already shows no button as selected unless the motion is read-only and seeded. Multi-choice does not have this guard.
- **Fix 6 (type label):** Displaying both the motion type badge and the multi-choice badge matches the pattern used in the admin view — consistent across both surfaces.
- **Fix 7 (title duplication):** Making the `<legend>` visually hidden (`.sr-only`) preserves accessibility — `<fieldset>` requires a `<legend>` for screen reader grouping. The `motion-card__title` class is intentionally removed from the legend so the heading styles are not duplicated.
- **Fix 9 & 10 (styled closed badges):** Reusing `motion-type-badge--closed` (new modifier) for both admin and voter contexts keeps the styling centralised. Introducing a single CSS rule rather than inline styles follows the design system convention.
- **Fix 11 (fallback URLs):** Putting the fallback in `BrandingContext` means all consumers benefit automatically. Making the fallback URLs exported constants enables them to be tested and allows future admin UX to display them as hints.

---

## Data Flow

All changes affect only client-side rendering logic. No data flow changes to API contracts.

For **Fix 8**, the data flow on successful ballot submission is:
1. `submitMutation.onSuccess` fires.
2. Clear `multiChoiceSelections` state (and sessionStorage).
3. Update `allLots` to mark submitted lots as `already_submitted`.
4. Remove submitted lot IDs from `selectedIds`.
5. `queryClient.invalidateQueries` triggers a fresh fetch of motions.
6. When motions refetch, the choices seeding effect re-seeds `multiChoiceSelections` only for read-only (already-voted) motions using `m.submitted_option_choices`.
7. The remaining unvoted lots see a clean, empty multi-choice state.

---

## Files to Change

| File | Change |
|---|---|
| `frontend/src/pages/admin/AdminVoteEntryPanel.tsx` | Fix 1: Add `limitReached` check to "For" button in multi-choice vote cell |
| `frontend/src/pages/admin/GeneralMeetingDetailPage.tsx` | Fix 2: Add expand/collapse toggle for Results Report section |
| `frontend/src/components/admin/AGMReportView.tsx` | Fix 3: Show summary counts collapsed; voter list only on expand. Fix 4: Highlight winning options. Fix 5: (no additional change needed beyond Fix 3) |
| `frontend/src/components/vote/MotionCard.tsx` | Fix 6: Separate type badge from multi-choice badge. Fix 10: Add `votingClosed` prop and render closed badge inside card |
| `frontend/src/components/vote/MultiChoiceOptionList.tsx` | Fix 7: Replace visual legend title with `sr-only` legend |
| `frontend/src/pages/vote/VotingPage.tsx` | Fix 8: Clear `multiChoiceSelections` on submission success. Fix 10: Remove external `motion-closed-label` div; pass `votingClosed` prop to `MotionCard` |
| `frontend/src/components/admin/MotionManagementTable.tsx` | Fix 9: Apply `motion-type-badge motion-type-badge--closed` classes to voting-closed span |
| `frontend/src/styles/index.css` | Fix 9 & 10: Add `.motion-type-badge--closed` CSS rule |
| `frontend/src/context/BrandingContext.tsx` | Fix 11: Add fallback constants; update `DEFAULT_CONFIG`; expose `effectiveLogoUrl`/`effectiveFaviconUrl` in context |
| `frontend/src/components/vote/VoterShell.tsx` | Fix 11: Use `effectiveLogoUrl` from context unconditionally |
| `frontend/src/pages/admin/AdminLayout.tsx` | Fix 11: Use `effectiveLogoUrl` from context unconditionally |

### Test files to update

| File | Change |
|---|---|
| `frontend/src/pages/admin/__tests__/AdminVoteEntryPanel.test.tsx` (or similar) | Fix 1: Add test for For-button disabled when limit reached |
| `frontend/src/pages/admin/__tests__/GeneralMeetingDetailPage.test.tsx` | Fix 2: Add test for Results Report toggle |
| `frontend/src/components/admin/__tests__/AGMReportView.test.tsx` (or similar) | Fix 3/4: Add tests for collapsed counts, highlight |
| `frontend/src/components/vote/__tests__/MotionCard.test.tsx` | Fix 6/10: Update type label tests; add votingClosed tests |
| `frontend/src/components/vote/__tests__/MultiChoiceOptionList.test.tsx` | Fix 7: Check legend is sr-only |
| `frontend/src/pages/vote/__tests__/VotingPage.test.tsx` | Fix 8: Test no pre-fill; Fix 10: Test motion-closed-label is inside card |
| `frontend/src/components/admin/__tests__/MotionManagementTable.test.tsx` | Fix 9: Check badge has correct CSS class |
| `frontend/src/context/__tests__/BrandingContext.test.tsx` | Fix 11: Test fallback URL logic |
| `frontend/src/components/vote/__tests__/VoterShell.test.tsx` | Fix 11: Test logo renders unconditionally |
| `frontend/src/pages/admin/__tests__/AdminLayout.test.tsx` | Fix 11: Test logo renders unconditionally |

---

## Schema Migration Required

**No** — all changes are frontend-only.

---

## E2E Test Scenarios

### Affected persona journeys

These fixes affect all four journeys. Existing E2E specs for Voter and Admin journeys must be updated — not just new scenarios added.

### New / updated scenarios

**Fix 1 — Admin vote entry for-option limit:**
- Happy path: Admin enters votes for a multi-choice motion (option_limit = 2), selects For on 2 options; the third "For" button is disabled and cannot be clicked.
- Error path: Attempt to click a disabled For button (verify no state change).

**Fix 2 — Collapsible results report:**
- Happy path: Admin opens a closed meeting; Results Report section is expanded by default; clicking the toggle collapses it; clicking again expands it.
- State: After toggling, navigating away and back resets to default expanded state.

**Fix 3 — Multi-choice collapsed counts:**
- Happy path: In the Results Report, a multi-choice motion option shows For/Against/Abstained counts in the collapsed row header without clicking Expand.
- Expand path: Clicking "Show voters" reveals the voter list (lot number, email); the summary counts remain visible in the header.

**Fix 4 — Highlight winning options:**
- Binary motion: The "For" row has a green highlight when For has higher entitlement; the "Against" row has a red highlight when Against has higher entitlement; no highlight on a tie.
- Multi-choice: The top N options by For entitlement are highlighted in green; others are not.

**Fix 6 — Type label in voter view:**
- A multi-choice general motion shows a "General" badge and a separate "Multi-Choice" badge in the voter view (not just "Multi-Choice").
- A multi-choice special motion shows "Special" and "Multi-Choice".

**Fix 7 — Title duplication:**
- A multi-choice motion in the voter view shows the motion title exactly once on screen.

**Fix 8 — No multi-choice pre-fill:**
- Multi-step sequence (required): Voter with 2 lots — Lot A and Lot B — opens the voting page. Selects Lot A only. Votes on a multi-choice motion (selects option X as For). Submits. Returns to vote for Lot B. The multi-choice motion shows no options selected (all buttons in default state).

**Fix 9 — Closed motion badge (admin):**
- Admin opens a meeting with a motion where voting_closed_at is set. The motion row shows a styled red pill "Voting Closed" where the Close Motion button would be.

**Fix 10 — Motion closed styling (voter):**
- Voter visits a meeting that has one individually-closed motion. The closed indicator appears inside the motion card (not above it), styled as a red "Motion Closed" pill.
- The motion card is disabled (buttons unclickable) and the indicator is visible at screen level.

**Fix 11 — Logo/favicon fallback:**
- Voter opens the voting portal when no logo is configured in admin settings; the OCSS fallback logo renders in the header (not a broken image or app name text).
- Admin opens the portal; the OCSS fallback logo renders in the sidebar.

### Existing E2E specs to update

- `frontend/tests/e2e/voter-journey.spec.ts` (or equivalent) — update assertions for motion-closed-label location (Fix 10), type badge label (Fix 6), title duplication check (Fix 7).
- `frontend/tests/e2e/admin-journey.spec.ts` (or equivalent) — update for Results Report section toggle (Fix 2), voting-closed badge class (Fix 9).
- `frontend/tests/e2e/multi-choice-voting.spec.ts` (or equivalent) — update for no-prefill scenario (Fix 8), type label (Fix 6).

---

## Vertical Slice Decomposition

All fixes are independent frontend changes with no shared state or component dependencies between them. They can technically be split into parallel branches but the total scope is small enough to implement in a single branch. The multi-step sequence for Fix 8 is the most complex and should be implemented last after the simpler fixes are tested.

Recommended implementation order within the branch:
1. Fixes 9 + 10 (CSS + badge, low risk)
2. Fixes 6 + 7 (MotionCard, tightly coupled)
3. Fix 11 (BrandingContext, self-contained)
4. Fix 1 (AdminVoteEntryPanel)
5. Fixes 3 + 4 + 5 (AGMReportView)
6. Fix 2 (GeneralMeetingDetailPage)
7. Fix 8 (VotingPage — most complex; depends on understanding choices clearing order)
