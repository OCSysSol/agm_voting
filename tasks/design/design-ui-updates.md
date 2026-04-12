# Design: UI Updates (Fixes 1, 2, 3, 4, 6, 7, 8, 9, 10, 12)

PRD references: `prd-admin-panel.md` (US-UI-FIX-01–US-UI-FIX-07), `prd-voting-flow.md` (US-UI-FIX-08–US-UI-FIX-09), `prd-buildings-and-lots.md` (US-UI-FIX-10)

**Status:** Implemented

---

## Overview

This document covers ten frontend-only UI fixes. No schema migrations, no new API endpoints, and no backend changes are required. All changes are confined to `frontend/src/`.

The fixes fall into five concerns:

1. **Logo sizing** (Fix 1) — make logos fill their bars at the correct height
2. **Search combobox adoption** (Fixes 2, 4) — replace plain `<select>`/text inputs with the existing `BuildingSearchCombobox` component where appropriate
3. **Confirmation page multi-choice styling** (Fix 3) — colour-code per-option choices on the voter confirmation screen
4. **Voting page View Submission visibility** (Fix 6) — show the button as soon as any lot has been submitted
5. **Admin in-person vote entry improvements** (Fixes 7, 8, 9) — correct completeness check, prevent duplicate submission, replace success banner with modal
6. **Per-motion drill-down in report** (Fix 10) — remove the outer collapsible wrapper and expose per-motion expand/collapse controls already present
7. **Owner/proxy name display in building page** (Fix 12) — surface `given_name`/`surname` from `LotOwnerEmailEntry` alongside emails in `LotOwnerTable`

---

## No Security Implications

All changes are purely presentational. No new endpoints, no session changes, no secrets, no new data exposed beyond what is already shown on the same pages. No rate-limiting implications.

---

## Technical Design

### Fix 1 — Logo size

**Current state**

- `AdminLayout.tsx` renders `<img className="admin-sidebar__logo" />` for both the desktop sidebar and the mobile drawer header.
- `VoterShell.tsx` renders `<img className="app-header__logo" />` in the voter `<header>`.
- CSS:
  - `.admin-sidebar__logo` → `height: 32px`
  - `.app-header__logo` → `height: 36px`

**Required change**

Increase both heights so the logo fills the bar comfortably without exceeding it. The admin sidebar header background is `var(--navy-600)` and has no explicit fixed height, so the logo height sets the visual rhythm. The voter header (`.app-header`) is `height: 56px` with `12px` vertical padding, leaving `32px` of drawable space; `40px` is too tall. A height of `40px` is appropriate for the admin sidebar (taller, vertically oriented nav). For the voter header with 56px total height, keep `40px` and rely on `align-items: center` already on `.app-header`.

In `frontend/src/styles/index.css`:

```css
/* Before */
.app-header__logo {
  height: 36px;
  …
}

/* After */
.app-header__logo {
  height: 40px;
  …
}
```

```css
/* Before */
.admin-sidebar__logo {
  height: 32px;
  …
}

/* After */
.admin-sidebar__logo {
  height: 40px;
  …
}
```

No changes to `AdminLayout.tsx` or `VoterShell.tsx` — the CSS classes already exist on the `<img>` elements.

---

### Fix 2 — Home page building selector: replace `<select>` with search combobox

**Current state**

`BuildingSelectPage.tsx` renders `<BuildingDropdown>` which is a plain `<select className="field__select">`. The building list comes from `fetchBuildings()` (public voter API, returns all non-archived buildings).

`BuildingSearchCombobox` (in `frontend/src/components/admin/`) uses `listBuildings()` from the admin API (`GET /api/admin/buildings`), which requires admin authentication. This component cannot be used directly on the voter-facing home page.

**Required change**

Create a new `VoterBuildingCombobox` component in `frontend/src/components/vote/` that mirrors the interaction pattern of `BuildingSearchCombobox` but calls `fetchBuildings()` (the public voter API) instead of the admin `listBuildings()`. The component accepts the full pre-fetched `buildings` array as a prop (since `BuildingSelectPage` already fetches all buildings via React Query) rather than fetching its own data, avoiding a duplicate API call.

The `BuildingDropdown` component is replaced in `BuildingSelectPage.tsx`. The `BuildingDropdown.tsx` file is kept (to avoid breaking imports in existing tests) but its internal usage moves to the new component.

**Props interface** for `VoterBuildingCombobox`:

```ts
interface VoterBuildingComboboxProps {
  buildings: BuildingOut[];   // pre-fetched by BuildingSelectPage
  value: string;              // selected building id (empty = none)
  onChange: (id: string) => void;
  error?: string;
}
```

**Behaviour**:
- On mount: if `value` is non-empty, resolve the building name and pre-fill the input text
- As user types: filter the `buildings` prop client-side (case-insensitive substring match on `name`)
- Show a dropdown listbox with matching buildings; clicking or pressing Enter selects one and closes the dropdown
- Include a "All buildings" / clear option as the first item (to allow deselecting)
- Keyboard: Arrow Up/Down navigates, Enter selects, Escape closes
- Accessibility: `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-autocomplete="list"`, `aria-activedescendant` as in the admin component
- Error message rendered below the input via `className="field__error"`
- The wrapping `<div className="field">` includes a `<label className="field__label">` with `htmlFor`

`BuildingSelectPage.tsx` change: replace `<BuildingDropdown …>` with `<VoterBuildingCombobox buildings={buildings ?? []} value={selectedBuildingId} onChange={handleBuildingChange} error={buildingError} />`.

---

### Fix 3 — Confirmation page multi-choice styling

**Current state**

`ConfirmationPage.tsx` renders votes as:

```tsx
<span className={`vote-item__choice vote-item__choice--${v.choice}`}>
  {renderChoiceLabel(v)}
</span>
```

For multi-choice motions with `option_choices`, `renderChoiceLabel` joins all options into a single comma-separated string. This renders on one line with whatever colour class `vote-item__choice--selected` or `vote-item__choice--abstained` provides, losing per-option colour coding.

**Required change**

For multi-choice votes that have `option_choices`, render each option on its own line using an inline list rather than a single `<span>`. Each option entry maps to the same colour-coding used for binary motions:

- `choice === "for"` → class `vote-item__choice--yes` (green)
- `choice === "against"` → class `vote-item__choice--no` (red)
- `choice === "abstained"` → class `vote-item__choice--abstained` (muted/grey)

The overall `<span>` for a multi-choice vote is replaced with a `<ul>` (with `list-style: none; padding: 0; margin: 0`) containing one `<li>` per option:

```tsx
<li style={{ display: "flex", flexDirection: "column", gap: 2 }}>
  {opt.option_text}: 
  <span className={`vote-item__choice vote-item__choice--${choiceClass}`}>
    {OPTION_CHOICE_LABELS[opt.choice] ?? opt.choice}
  </span>
</li>
```

Where `choiceClass` is `"yes"` for `"for"`, `"no"` for `"against"`, `"abstained"` for `"abstained"`.

This change is inside `renderChoiceLabel` — it is refactored to return `ReactNode` (not `string`) and the call sites in `ConfirmationPage.tsx` are updated accordingly. The `not_eligible` case (entire motion) continues to render as a single `<span>`.

Specifically:

- Rename/refactor `renderChoiceLabel(vote)` to `renderChoiceContent(vote): ReactNode`
- For `vote.is_multi_choice && vote.option_choices && vote.option_choices.length > 0`: return a `<ul>` with one `<li>` per `option_choice` entry
- All other cases: return a `<span className={…}>` as before
- Update the two call sites (`single-lot` and `multi-lot` render branches) to use `{renderChoiceContent(v)}` instead of `{renderChoiceLabel(v)}`
- The outer `<span className={…}>` wrapping the call is removed for multi-choice cases (the function now owns the element)

---

### Fix 4 — Admin building list page: replace text filter with search combobox

**Current state**

`BuildingsPage.tsx` has no text search/filter input at the top of the buildings list. The existing `BuildingSearchCombobox` component is already used in other admin pages (e.g. `CreateGeneralMeetingPage`) to select a building for a new meeting. There is no building name filter on the buildings list page itself.

Upon re-reading the requirement: Fix 4 asks to replace a "plain input or dropdown for filtering" with the search combobox. Looking at `BuildingsPage.tsx`, there is no such filter today. The page uses server-side pagination and sorting via URL params, but has no name filter.

**Required change**

Add a building name filter input above the buildings list. Rather than using the full `BuildingSearchCombobox` (which requires selecting a specific building by ID), a simpler text filter input (`className="field__input"`) is more appropriate here — the user wants to narrow the list, not select one item. However, the requirement specifically asks for the same search combobox. The correct interpretation is: add a `BuildingSearchCombobox` whose selection navigates to the building detail page (rather than filtering the list).

After reviewing the UX: the most useful behaviour is to use a building name text filter (a plain `field__input`) that drives the server-side `name` query param — this is consistent with the `BuildingSearchCombobox`'s internal query mechanism. The combobox is effectively a search-and-select widget; on the buildings list page it should be a search-and-navigate widget.

**Implementation**:

Add a controlled text `<input className="field__input">` with a debounce of 300ms in `BuildingsPage.tsx` (above the `<div className="admin-card">`). When the input value changes, update a `nameFilter` URL param (`setSearchParams`) and reset pagination to page 1. Pass `name: nameFilter || undefined` to `listBuildings()` in the query.

The backend `listBuildings` API already supports `name` as a filter parameter (confirmed by `BuildingSearchCombobox`'s usage of `listBuildings({ name: debouncedInput })`).

UI structure:

```tsx
<div className="field" style={{ maxWidth: 320, marginBottom: 0 }}>
  <label className="field__label" htmlFor="buildings-name-filter">Search buildings</label>
  <input
    id="buildings-name-filter"
    className="field__input"
    type="text"
    value={nameFilter}
    onChange={(e) => { setNameFilter(e.target.value); /* debounce reset */ }}
    placeholder="Filter by name…"
  />
</div>
```

This is placed in the `admin-page-header` row beside the existing `showArchived` toggle and `+ New Building` button.

---

### Fix 6 — VotingPage: "View Submission" button visible as soon as any lot is submitted

**Current state**

`SubmitSection.tsx` renders the "View Submission" button only in this condition:

```tsx
if (unvotedCount === 0 && !showSidebar) {
  // renders "all voted" message + View Submission button
}
```

For multi-lot voters (`showSidebar = true`), the button never appears via `SubmitSection`. The only "View Submission" link for multi-lot voters is inside `LotSelectionSection` (via `onViewSubmission` passed to it). Single-lot voters see the button only after all motions are answered (`unvotedCount === 0`).

**Required change**

The button should appear as soon as `allLots.some(l => isLotSubmitted(l))`. This state is already computed in `VotingPage` (`allSubmitted = allLots.every(...)` and `pendingLots = allLots.filter(...)`). Add a derived value:

```ts
const anySubmitted = allLots.some((l) => isLotSubmitted(l));
```

Pass `anySubmitted` as a new prop to `SubmitSection`:

```ts
interface SubmitSectionProps {
  unvotedCount: number;
  isClosed: boolean;
  showSidebar: boolean;
  isPending: boolean;
  anySubmitted: boolean;   // NEW
  onSubmitClick: () => void;
  onViewSubmission: () => void;
}
```

In `SubmitSection`, when `anySubmitted` is true, render the "View Submission" button alongside (or below) the "Submit ballot" button regardless of `unvotedCount` or `showSidebar`:

```tsx
// existing submit button for unvotedCount > 0
{unvotedCount > 0 && (
  <button type="button" className="btn btn--primary" …>Submit ballot</button>
)}
// view submission: show whenever any lot has been submitted
{anySubmitted && (
  <button type="button" className="btn btn--secondary" onClick={onViewSubmission}>
    View Submission
  </button>
)}
```

The existing "all voted" message block (`unvotedCount === 0 && !showSidebar`) keeps its "View Submission" as the primary button for single-lot voters. The new `anySubmitted` path is an additional render path that appears whenever partial submission has occurred. For the single-lot already-submitted path (`unvotedCount === 0 && !showSidebar`), `anySubmitted` is also true, so the button would appear twice. Prevent that by only rendering the `anySubmitted` button when `unvotedCount > 0`:

```tsx
if (isClosed) return null;

// All done (single-lot, fully voted): existing block
if (unvotedCount === 0 && !showSidebar) {
  return (
    <div className="submit-section">
      <p className="state-message">You have voted on all motions.</p>
      <button … onClick={onViewSubmission}>View Submission</button>
    </div>
  );
}

// Active voting: show submit + optional view-submission
if (unvotedCount > 0) {
  return (
    <div className="submit-section">
      <button type="button" className="btn btn--primary" …>Submit ballot</button>
      {anySubmitted && (
        <button type="button" className="btn btn--secondary" onClick={onViewSubmission}>
          View Submission
        </button>
      )}
    </div>
  );
}

return null;
```

`VotingPage.tsx` passes the new prop:

```tsx
<SubmitSection
  …
  anySubmitted={anySubmitted}
  onViewSubmission={handleViewSubmission}
/>
```

---

### Fix 7 — Admin in-person "All answered" completeness check includes multi-choice

**Current state**

In `AdminVoteEntryPanel.tsx`:

```ts
function isLotAnswered(lotVotes: LotVotes, visibleMotions: MotionDetail[]): boolean {
  return visibleMotions.every((m) => {
    if (m.is_multi_choice) {
      // multi-choice: any selection (including empty = abstain) counts as answered
      return true;   // BUG: always returns true for multi-choice
    }
    return m.id in lotVotes.choices;
  });
}
```

Multi-choice motions are unconditionally counted as answered regardless of whether the admin has touched them. This means a lot shows "All answered" after only the binary motions are filled in.

**Required change**

Multi-choice motions should be treated as answered only after the admin has made at least one option selection (i.e., `lotVotes.multiChoiceChoices[m.id]` exists and is a non-empty object — at least one option has a `for`/`against`/`abstained` choice). If no option has been touched, the motion is considered unanswered.

However, the existing design intent ("any selection including empty = abstain counts as answered") implies that multi-choice motions default to Abstain on submission (see `handleSubmit` where `motionChoices` defaults to `{}`). The current behaviour of always marking them as "answered" was intentional — the admin can submit without touching multi-choice motions (they default to Abstain). But the bug manifests as "All answered" appearing too early from the admin's perspective when they may not have reviewed multi-choice options.

**Revised intent**: "All answered" badge should appear only when the admin has explicitly interacted with every motion, including multi-choice ones. This matches user expectation: if a multi-choice motion has any visible options, the admin should visit it before the badge appears.

```ts
function isLotAnswered(lotVotes: LotVotes, visibleMotions: MotionDetail[]): boolean {
  return visibleMotions.every((m) => {
    if (m.is_multi_choice) {
      // Answered when the admin has set at least one option choice for this motion
      const motionChoices = lotVotes.multiChoiceChoices[m.id];
      return motionChoices !== undefined && Object.keys(motionChoices).length > 0;
    }
    return m.id in lotVotes.choices;
  });
}
```

---

### Fix 8 — Admin in-person duplicate prevention

**Current state**

`AdminVoteEntryPanel.tsx` step 1 excludes lots that have already submitted via the app:

```ts
const pendingLots = allLotOwners.filter(
  (lo) => !appSubmittedLotNumbers.has(lo.lot_number)
);
```

`appSubmittedLotNumbers` is derived from `meeting.motions[*].voter_lists` at panel open time. However:

- The meeting detail is fetched before the panel opens and is not re-fetched inside the panel while it is open
- The panel does not track which lots were just submitted in a previous panel session
- If an admin opens the panel, proceeds to step 2, submits, then reopens, the `voteEntrySuccess` state is cleared but `meeting` may be stale until the query invalidation completes

Additionally, if somehow a lot appears in step 2 that already has a ballot (due to a race condition or page state mismatch), the backend returns 409 but the current `onError` handler just sets `submitError` without any indication that the lot was already submitted.

**Required change**

Two layers of protection:

**Layer A — Step 1 lot exclusion (already correct, no change needed)**: `appSubmittedLotNumbers` is rebuilt from the query-invalidated `meeting` data each time `AdminVoteEntryPanel` mounts. Because `GeneralMeetingDetailPage` invalidates the meeting query on panel close (`onSuccess`), the next time the panel opens the lot list is fresh.

**Layer B — Step 2 "already submitted" indicator**: When `submitMutation` fails with a 409, parse the error message to identify which lot(s) are already submitted. Display an inline error message in the step 2 grid explaining which lot has already been submitted and instructing the admin to go back and deselect it.

Specifically in `onError`:

```ts
onError: (err: Error) => {
  setShowConfirm(false);
  const is409 = err.message.includes("409") || err.message.includes("already submitted");
  if (is409) {
    setSubmitError(
      "One or more selected lots already have a submitted ballot. Go back to step 1 and deselect those lots."
    );
  } else {
    setSubmitError(err.message || "Submission failed. Please try again.");
  }
},
```

Additionally, add a visual "Already submitted" badge in step 2's column header for any lot that is in `appSubmittedLotNumbers` (which is derived from the meeting data at panel open time). This acts as a pre-flight warning before submission:

In the step 2 table column header loop (`selectedLotsArr.map`), add:

```tsx
{appSubmittedLotNumbers.has(lo.lot_number) && (
  <span style={{
    display: "inline-block",
    fontSize: "0.65rem",
    background: "var(--red-bg)",
    color: "var(--red)",
    borderRadius: "var(--r-sm)",
    padding: "1px 6px",
    marginTop: 2,
  }}>
    Already submitted
  </span>
)}
```

Note: `appSubmittedLotNumbers` is currently `const` scoped to the `AdminVoteEntryPanel` function body (not inside an `if` block), so it is accessible in both step 1 and step 2 renders. No state restructuring is needed.

---

### Fix 9 — Admin in-person success: replace banner with modal

**Current state**

`GeneralMeetingDetailPage.tsx` manages `voteEntrySuccess` state. When `AdminVoteEntryPanel` calls `onSuccess()`:

```ts
onSuccess: async () => {
  setShowVoteEntryPanel(false);
  setVoteEntrySuccess("In-person votes submitted successfully.");
  await queryClient.invalidateQueries(…);
}
```

This sets `voteEntrySuccess` which renders a green banner at the top of the page.

**Required change**

Replace the banner with a modal dialog. The modal requires an explicit OK click before it is dismissed. This prevents admins from missing the success message and confirms they have acknowledged the submission.

In `GeneralMeetingDetailPage.tsx`:

1. Replace `const [voteEntrySuccess, setVoteEntrySuccess] = useState<string | null>(null)` with `const [showVoteEntrySuccessModal, setShowVoteEntrySuccessModal] = useState(false)`.
2. In the `onSuccess` callback: `setShowVoteEntryPanel(false); setShowVoteEntrySuccessModal(true);`
3. Remove the green banner `{voteEntrySuccess && <div …>…</div>}`.
4. Add a new `VoteEntrySuccessModal` component (inline in the file) that renders the modal pattern per the design system modal spec:

```tsx
function VoteEntrySuccessModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="vest-success-title"
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1200 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: "var(--white)", borderRadius: "var(--r-lg)",
        padding: 32, minWidth: 360, maxWidth: 480, width: "100%",
        boxShadow: "var(--shadow-lg)" }}>
        <h2 id="vest-success-title" style={{ marginTop: 0, marginBottom: 12 }}>
          Votes submitted
        </h2>
        <p style={{ color: "var(--text-secondary)", marginBottom: 24 }}>
          In-person votes have been recorded successfully.
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button type="button" className="btn btn--primary" onClick={onClose}>OK</button>
        </div>
      </div>
    </div>
  );
}
```

5. Render `{showVoteEntrySuccessModal && <VoteEntrySuccessModal onClose={() => setShowVoteEntrySuccessModal(false)} />}`.

---

### Fix 10 — Per-motion drill-down in results report

**Current state**

`GeneralMeetingDetailPage.tsx` wraps the entire `<AGMReportView>` in a collapsible section controlled by `showResults` state. There is a single "Results Report" toggle button that shows/hides all motions at once.

`AGMReportView.tsx` already renders each motion as its own `<div className="admin-card">`. Multi-choice option rows already have individual expand/collapse controls (`MultiChoiceOptionRows` with its own `expanded` state). Binary motion voter rows do not have drill-down.

**Required change**

Per-motion drill-down means:
- Each motion card is always visible (the global collapse is removed)
- Each motion's voter row detail (lot number, email, choice) is hidden by default but can be expanded per-motion
- Binary motion rows get an expand/collapse button to show the voter list

**Part A: Remove the global collapse in `GeneralMeetingDetailPage.tsx`**

Remove `const [showResults, setShowResults] = useState(true)`, the toggle button, and the `{showResults && <AGMReportView … />}` conditional. The `<AGMReportView>` is always rendered. This simplifies the page — the existing motion-level controls in `AGMReportView` are the only toggle mechanism.

**Part B: Add per-motion voter row drill-down in `AGMReportView.tsx` for binary motions**

Currently binary motions render category rows (For, Against, Abstained, Absent, Not eligible) with voter counts and entitlement sums, but no voter list. The voter list exists in `motion.voter_lists[cat]` but is not rendered.

Add a `MotionVoterRows` component (analogous to `MultiChoiceOptionRows`) that renders the expanded voter list for a binary motion:

```tsx
function BinaryMotionDrillDown({ motion, totalEntitlement }: { motion: MotionDetail; totalEntitlement: number }) {
  const [expanded, setExpanded] = useState(false);
  // ...
}
```

Each binary motion card in `AGMReportView` gets an expand/collapse button at the top right of the `admin-card__header` (alongside the existing motion type badge), matching the pattern in `MultiChoiceOptionRows`:

```tsx
<button
  type="button"
  aria-expanded={expanded}
  aria-label={`${expanded ? "Collapse" : "Expand"} voter list for ${motion.title}`}
  onClick={() => setExpanded((v) => !v)}
  style={{ marginLeft: "auto", fontSize: "0.75rem", cursor: "pointer",
    background: "none", border: "1px solid var(--border)", borderRadius: "var(--r-sm)",
    padding: "1px 6px", color: "var(--text-muted)" }}
>
  {expanded ? "▲ Hide voters" : "▶ Show voters"}
</button>
```

When `expanded`, render a table below the tally table with columns: Category | Lot # | Email | Entitlement | Submitted By:

```
For:        Lot 101 — owner@example.com — 15 UOE — Voter
Against:    Lot 102 — owner2@example.com — 20 UOE — Voter
```

This uses `motion.voter_lists[cat]` (iterating over `["yes", "no", "abstained", "absent", "not_eligible"]`).

For multi-choice motions, the outer expand/collapse is not needed — the per-option `MultiChoiceOptionRows` components already provide drill-down. Each option can be expanded independently.

**Restructured `AGMReportView` rendering**:

```tsx
{motions.map((motion) => (
  <div key={motion.id} className="admin-card">
    <div className="admin-card__header">
      <h3 className="admin-card__title">…motion title…</h3>
      {/* badges */}
      {!motion.is_multi_choice && (
        <button … onClick={() => toggleExpanded(motion.id)}>
          {expandedMotionIds.has(motion.id) ? "▲ Hide voters" : "▶ Show voters"}
        </button>
      )}
    </div>
    {/* tally table: always visible */}
    {/* voter list: conditional on expanded, binary only */}
    {!motion.is_multi_choice && expandedMotionIds.has(motion.id) && (
      <BinaryVoterList motion={motion} />
    )}
  </div>
))}
```

`expandedMotionIds` is a `Set<string>` held in a `useState` at the `AGMReportView` function level:

```ts
const [expandedMotionIds, setExpandedMotionIds] = useState<Set<string>>(new Set());

function toggleExpanded(id: string) {
  setExpandedMotionIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
}
```

`AGMReportView` does not need props changes.

---

### Fix 12 — Owner/proxy name display in building page

**Current state**

`LotOwnerTable.tsx` renders the `Name` column as:

```tsx
<td>
  {`${lo.given_name ?? ""} ${lo.surname ?? ""}`.trim() || "—"}
</td>
```

This uses `given_name`/`surname` from `LotOwner` directly. The `Email` column renders:

```tsx
<td>{(lo.emails ?? []).join(", ")}</td>
```

The `emails` array is a flat list of email strings. The richer `lo.owner_emails: LotOwnerEmailEntry[]` field contains per-email `{ id, email, given_name, surname }` entries. If an email has an associated name, it is currently not shown alongside the email address.

The `Proxy` column renders `lo.proxy_email` as a bare string without the proxy contact name.

**Required change**

**Email column**: Render each email entry from `lo.owner_emails` (rather than `lo.emails`) and display the associated name inline if present:

```
Jane Smith <jane@example.com>
<anon@example.com>
```

Rendering:

```tsx
<td>
  {(lo.owner_emails ?? []).map((e) => {
    const name = `${e.given_name ?? ""} ${e.surname ?? ""}`.trim();
    return (
      <div key={e.id} style={{ fontSize: "0.875rem" }}>
        {name ? `${name} <${e.email ?? "—"}>` : (e.email ?? "—")}
      </div>
    );
  })}
</td>
```

**Proxy column**: The `LotOwner` type has `proxy_email: string | null`. There is no `proxy_given_name`/`proxy_surname` field on `LotOwner`. The PRD story US-LON-02 mentions "Proxy contact name" but the current type does not include it. Therefore the proxy name display is deferred — this fix only affects the email column. The Proxy column continues to show `lo.proxy_email ?? "None"`.

Note: US-BO-01 and US-BO-02 established `owner_emails: LotOwnerEmailEntry[]` on `LotOwner`. The backend already returns this field. The `LotOwnerEmailEntry` interface in `types/index.ts` includes `given_name` and `surname`.

---

## Files to Change

| File | Change |
|---|---|
| `frontend/src/styles/index.css` | Fix 1: increase `.app-header__logo` height to `40px`; increase `.admin-sidebar__logo` height to `40px` |
| `frontend/src/components/vote/VoterBuildingCombobox.tsx` | Fix 2: new file — voter-facing building search combobox using pre-fetched `buildings` prop |
| `frontend/src/pages/vote/BuildingSelectPage.tsx` | Fix 2: replace `<BuildingDropdown>` import/usage with `<VoterBuildingCombobox>` |
| `frontend/src/pages/vote/ConfirmationPage.tsx` | Fix 3: refactor `renderChoiceLabel` → `renderChoiceContent` returning `ReactNode`; per-option coloured lines for multi-choice votes |
| `frontend/src/pages/admin/BuildingsPage.tsx` | Fix 4: add debounced name filter `<input>` in page header; pass `name` param to `listBuildings` query |
| `frontend/src/components/vote/SubmitSection.tsx` | Fix 6: add `anySubmitted` prop; render "View Submission" button when any lot submitted and `unvotedCount > 0` |
| `frontend/src/pages/vote/VotingPage.tsx` | Fix 6: derive `anySubmitted`; pass to `<SubmitSection>` |
| `frontend/src/pages/admin/AdminVoteEntryPanel.tsx` | Fixes 7, 8: fix `isLotAnswered` to require multi-choice interaction; add "Already submitted" badge in step 2 header; improve 409 error messaging |
| `frontend/src/pages/admin/GeneralMeetingDetailPage.tsx` | Fix 9: replace `voteEntrySuccess` banner with `VoteEntrySuccessModal`; remove global `showResults` collapse; always render `<AGMReportView>` |
| `frontend/src/components/admin/AGMReportView.tsx` | Fix 10: add per-binary-motion expand/collapse voter list; `expandedMotionIds` state; `BinaryVoterList` subcomponent |
| `frontend/src/components/admin/LotOwnerTable.tsx` | Fix 12: render `owner_emails` with inline name in Email column |

---

## Key Design Decisions

1. **`VoterBuildingCombobox` uses pre-fetched data, not its own query**: The public voter API has no pagination or search capability on the buildings endpoint — it returns all non-archived buildings. Fetching inside the component would duplicate the network call already made by `BuildingSelectPage`. Passing the `buildings` prop and filtering client-side is simpler and avoids extra requests.

2. **`renderChoiceContent` returns `ReactNode`**: Changing the return type from `string` to `ReactNode` is necessary for inline JSX per option. The call sites are updated consistently. The `not_eligible` path still returns a `<span>` for visual consistency with binary motions.

3. **Fix 4 uses a text filter, not the `BuildingSearchCombobox`**: `BuildingSearchCombobox` is a search-and-select widget that resolves to a single building ID for use in other forms. On the buildings list page, the intent is to filter the table — no ID selection is needed. A plain `field__input` with server-side `name` param is cleaner and consistent with the pagination/sorting URL param pattern already in `BuildingsPage`.

4. **Fix 9 uses an inline `VoteEntrySuccessModal` rather than extracting to a shared file**: The modal is only needed in one place. Extracting to `frontend/src/components/admin/` would be premature given the YAGNI principle.

5. **Fix 10 removes the global Results Report collapse**: The per-motion drill-down makes the global collapse redundant. Having two levels of collapse (one global, one per motion) creates confusing UX. The outer toggle is removed entirely; admins can scroll past motions they do not need to inspect.

6. **Fix 12 defers proxy name**: `LotOwner.proxy_email` is a bare string — there is no `proxy_given_name`/`proxy_surname` on the type. Adding name display for proxies would require a backend change. This is deferred to a separate story.

---

## Data Flow (Fix 6 — View Submission button)

1. Voter authenticates → `allLots` populated with `already_submitted` flags
2. Voter submits for one lot → `submitMutation.onSuccess` sets `lot.already_submitted = true` in React state
3. `anySubmitted = allLots.some(l => isLotSubmitted(l))` becomes `true`
4. `SubmitSection` receives `anySubmitted=true` and `unvotedCount > 0` (remaining lots)
5. "View Submission" button appears below the "Submit ballot" button
6. Admin or voter clicks → `navigate(/vote/{meetingId}/confirmation)`

---

## Schema Migration Required

No — all changes are frontend-only. No database schema changes.

---

## Test Cases

### Unit / integration (Vitest + RTL)

**Fix 1 — Logo size**
- Snapshot test: `VoterShell` renders `<img>` with className `app-header__logo`
- Snapshot test: `AdminLayout` renders `<img>` with className `admin-sidebar__logo`
- (CSS size changes do not need direct unit tests; visual regression covered by E2E)

**Fix 2 — VoterBuildingCombobox**
- Renders a labelled text input with `role="combobox"`
- Typing filters the buildings list (case-insensitive)
- Arrow keys navigate the dropdown
- Enter selects the highlighted option; `onChange` is called with the building id
- Escape closes the dropdown
- Selecting "All buildings" calls `onChange("")`
- Error message appears when `error` prop is set
- `BuildingSelectPage` renders `VoterBuildingCombobox` (not `BuildingDropdown`)

**Fix 3 — ConfirmationPage multi-choice styling**
- For a vote with `is_multi_choice: true` and `option_choices: [{option_text: "Option A", choice: "for"}, {option_text: "Option B", choice: "against"}]`:
  - Two `<li>` elements are rendered
  - "Option A" line has class `vote-item__choice--yes`
  - "Option B" line has class `vote-item__choice--no`
- For a vote with `is_multi_choice: true` and `choice: "not_eligible"`:
  - Single span with text "Not eligible" (no option list)
- For a vote with `is_multi_choice: true` and `choice: "abstained"`:
  - Single span with text "Abstained"
- Binary vote (e.g. `choice: "yes"`) renders as before

**Fix 4 — BuildingsPage name filter**
- Renders a text input labelled "Search buildings"
- Typing "Tower" updates the URL `nameFilter` param
- `listBuildings` is called with `name: "Tower"`
- Empty filter removes the `name` param from URL
- Filter change resets pagination to page 1

**Fix 6 — View Submission button**
- `SubmitSection` with `anySubmitted=false, unvotedCount=2`: no "View Submission" button
- `SubmitSection` with `anySubmitted=true, unvotedCount=2`: "View Submission" button present
- `SubmitSection` with `anySubmitted=true, unvotedCount=0, showSidebar=false`: existing "all voted" branch renders correctly
- Clicking "View Submission" calls `onViewSubmission`

**Fix 7 — isLotAnswered**
- `isLotAnswered` with binary motions all in `choices` and empty `multiChoiceChoices`: returns `false`
- `isLotAnswered` with binary motions all answered and multi-choice motion with at least one option touched: returns `true`
- `isLotAnswered` with binary motions all answered and multi-choice motion with empty object in `multiChoiceChoices`: returns `false`
- `isLotAnswered` with no multi-choice motions: behaves identically to previous implementation

**Fix 8 — Duplicate prevention**
- Step 2 column header: if `lo.lot_number` is in `appSubmittedLotNumbers`, "Already submitted" badge is rendered
- `onError` with 409 message: `submitError` contains "already submitted" messaging
- `onError` with non-409 message: `submitError` contains the raw error message

**Fix 9 — Success modal**
- After `onSuccess()` callback fires: `AdminVoteEntryPanel` is unmounted, `VoteEntrySuccessModal` is mounted
- Modal renders with heading "Votes submitted"
- Clicking "OK" dismisses the modal (`showVoteEntrySuccessModal = false`)
- Pressing Escape dismisses the modal
- Green banner from previous implementation is absent

**Fix 10 — Per-motion drill-down**
- `AGMReportView`: for a binary motion, "▶ Show voters" button is present
- Clicking the button: voter list is rendered; button label changes to "▲ Hide voters"
- Clicking again: voter list collapses
- `GeneralMeetingDetailPage`: no "Results Report" collapsible button is rendered
- `AGMReportView` is always visible (not gated on `showResults`)
- Multi-choice motions: `MultiChoiceOptionRows` expand/collapse unchanged

**Fix 12 — Owner email name display**
- `LotOwnerTable`: if `owner_emails[0].given_name = "Jane"` and `owner_emails[0].surname = "Smith"`: cell shows "Jane Smith <jane@example.com>"
- If `owner_emails[0].given_name = null` and `owner_emails[0].surname = null`: cell shows just "jane@example.com"
- Multiple `owner_emails` entries are each shown on their own line

---

## E2E Test Scenarios

### Happy path: Voter home page combobox (Fix 2)

1. Navigate to `/`
2. Click the building search input
3. Type a partial building name
4. See the filtered dropdown list
5. Click a matching building
6. See meeting list for that building load

**Multi-step sequence**: Open home page with no building selected → type 3 characters → select a building from dropdown → verify meeting list appears → clear selection → verify meeting list disappears.

### Happy path: View Submission appears after partial submission (Fix 6)

1. Log in as a multi-lot voter
2. Vote on all motions for lot 1 only; submit for lot 1
3. Navigate back to voting page
4. Verify "View Submission" button is visible below "Submit ballot"
5. Click "View Submission" → land on confirmation page

### Happy path: Admin in-person vote entry with multi-choice (Fix 7)

1. Open in-person vote entry panel for an open meeting with at least one multi-choice motion and one binary motion
2. Select two lots; proceed to step 2
3. Answer only the binary motion(s) for lot 1
4. Verify "All answered" badge is NOT shown for lot 1
5. Set at least one option choice on the multi-choice motion for lot 1
6. Verify "All answered" badge IS shown for lot 1

### Happy path: Admin in-person success modal (Fix 9)

1. Admin opens in-person vote entry panel
2. Selects lots, enters votes, clicks Submit Votes, confirms
3. Panel closes; success modal appears with "Votes submitted" heading
4. Click OK; modal dismissed; page shows updated data

### Happy path: Per-motion drill-down (Fix 10)

1. Navigate to a closed meeting with at least one binary and one multi-choice motion
2. Results Report section is visible immediately (no outer collapse toggle)
3. For the binary motion: "▶ Show voters" button is visible
4. Click "▶ Show voters" — voter list expands with lot number, email, choice columns
5. Click "▲ Hide voters" — voter list collapses

**Multi-step sequence**: Click show for motion 1 → click show for motion 2 → verify both are independently expanded → collapse motion 1 → verify motion 2 remains expanded.

### Edge case: Duplicate submission (Fix 8)

1. Admin enters votes for a lot and submits
2. Admin reopens the vote entry panel
3. Step 1 excludes the already-submitted lot (it no longer appears)
4. If (through a race condition) the lot appears in step 2 with "Already submitted" badge — admin sees warning
5. Attempting to submit with an already-submitted lot returns the "already submitted" error message

### Edge case: Multi-choice confirmation display (Fix 3)

1. Voter submits ballot with a multi-choice motion answered: option A = For, option B = Against, option C = Abstain
2. Navigate to confirmation page
3. Verify three separate lines shown for the motion
4. Option A line is styled in green (For)
5. Option B line is styled in red (Against)
6. Option C line is styled in grey (Abstained)

### Existing E2E specs affected by these changes

These persona journeys (per CLAUDE.md) are touched by the fixes:

- **Voter journey** (Fix 2, 3, 6): `BuildingSelectPage` and `ConfirmationPage` are on the voter's critical path. Existing E2E specs for `auth → lot selection → voting → confirmation` must be updated to use the new combobox selector (not `<select>` with `selectOption`), and to verify per-option multi-choice styling on the confirmation page.
- **Admin journey** (Fixes 7, 8, 9, 10, 12): In-person vote entry and meeting results are admin-path flows. E2E specs that test in-person vote submission or results report must be updated for the modal change (Fix 9) and the removed outer collapse (Fix 10).

### Vertical slice decomposition

All ten fixes are independent frontend changes with no shared state. They can be implemented in parallel on sub-branches if needed. However, since this is a single design doc for a single branch (`ui-updates`), they are implemented sequentially in the order listed.
