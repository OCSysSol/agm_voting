# Design: UI Minor Fixes

PRD references: US-UI-FIX-11 (Fix 1), US-UI-FIX-06 (Fix 2), US-UI-FIX-12 (Fix 3), US-UI-FIX-07 (Fix 4), US-UI-FIX-08 (Fix 6)

**Status:** Implemented

---

## Overview

Six targeted UI fixes to the AGM Voting App admin and voter interfaces. All fixes are purely frontend changes — no backend or schema changes are required. The fixes address visual redundancy, layout polish, a React Query cache stale-data bug, and richer per-voter drill-down in the results report.

**Fixes in scope:**

| # | Title |
|---|-------|
| 1 | Remove redundant "Name" column from LotOwnerTable |
| 2 | Logo sizing — admin sidebar fills width; voter header grows to 100px |
| 3 | Proxy name not shown immediately after first save (cache invalidation bug) |
| 4 | Vote drill-down button rename + styling |
| 5 | Vote drill-down in the email results report (analysis + frontend-only recommendation) |
| 6 | Voting drill-down: tabular layout for BinaryVoterList |

---

## Technical Design

### Fix 1 — Remove redundant "Name" column from LotOwnerTable

**File:** `frontend/src/components/admin/LotOwnerTable.tsx`

**Current state:**
The table has seven columns: Lot Number, Name, Email, Unit Entitlement, Financial Position, Proxy, Actions.
The "Name" column renders `LotOwner.given_name` + `LotOwner.surname` (the top-level lot-level name fields).
The "Email" column already renders each `owner_emails` entry in the format `Given Surname <email>` (as implemented in US-UI-FIX-10). The name is therefore displayed twice — once in the Name column and once inline with each email entry.

**Change:**
- Remove the `<SortableColumnHeader label="Name" column="name" .../>` from `<thead>`.
- Remove the `<td>` cell that renders the name from each `<tr>` in `<tbody>`.
- Remove `"name"` from the `LotOwnerSortColumn` union type.
- Remove the `sortState.column === "name"` branch from the sort comparator.
- Update all `colSpan` values in the loading/empty state rows from `7` to `6`.

**What is NOT removed:**
- The `name`-related data fields on the `LotOwner` type are retained — they are used elsewhere (e.g. proxy display, edit modal).
- The sort state type `LotOwnerSortColumn` is narrowed to the remaining 5 sortable columns + proxy.

### Fix 2 — Logo sizing

#### 2a — Admin sidebar logo

**File:** `frontend/src/styles/index.css`

**Current state:** `.admin-sidebar__logo { height: 40px; width: auto; ... }`

The admin sidebar is `220px` wide with `20px` horizontal padding (`22px 20px` on `.admin-sidebar__header`), giving an effective content width of `180px`. The logo is capped at `40px` height which makes it small for landscape-oriented logos.

**Change:**
```css
.admin-sidebar__logo {
  width: 100%;
  max-width: 100%;
  height: auto;
  display: block;
  object-fit: contain;
  margin-bottom: 6px;
}
```

This makes the logo fill the available horizontal space while maintaining its aspect ratio. No height cap is set here; the logo's own aspect ratio controls the rendered height. If a logo is very tall and narrow this could grow disproportionately, but the typical tenant logo is wider than it is tall, so this is the correct trade-off. The mobile nav drawer uses the same `.admin-sidebar__logo` class and will benefit automatically.

#### 2b — Voter header logo

**File:** `frontend/src/styles/index.css`

**Current state:**
```css
.app-header { height: 56px; ... }
.app-header__logo { height: 40px; width: auto; ... }
```

**Change — logo height:**
```css
.app-header__logo {
  height: 100px;
  width: auto;
  display: block;
  object-fit: contain;
}
```

**Change — header height:**
The header must grow to accommodate the taller logo. Increase `.app-header` height from `56px` to `120px` so the logo has breathing room (10px top/bottom padding). The header uses `align-items: center` which will vertically centre the logo automatically once the height is sufficient.

```css
.app-header {
  height: 120px;
  /* all other properties unchanged */
}
```

No other CSS changes are needed. `VoterShell.tsx` does not need modification — it renders `<img className="app-header__logo" .../>` which picks up the new rule automatically.

### Fix 3 — Proxy name not shown immediately after first save

**File:** `frontend/src/components/admin/LotOwnerForm.tsx`

**Root cause analysis:**

In the `EditModal`, the proxy section renders from local state `proxyEmail`, `proxyGivenName`, `proxySurname`. These are initialised from `lotOwner.proxy_email`, `lotOwner.proxy_given_name`, `lotOwner.proxy_surname` at mount and whenever `lotOwner` changes (via the `useEffect` with `[lotOwner]` dependency).

The `setProxyMutation.onSuccess` handler:
1. Sets local state: `setProxyEmail(updated.proxy_email ?? null)`, `setProxyGivenName(updated.proxy_given_name ?? "")`, `setProxySurname(updated.proxy_surname ?? "")`
2. Calls `void queryClient.invalidateQueries({ queryKey: ["admin", "lot-owners", lotOwner.building_id] })`

The local state update for `proxyEmail` fires correctly, which switches the proxy section from the "set proxy" form to the "current proxy" display. However, the "current proxy" display renders from `lotOwner.proxy_given_name` and `lotOwner.proxy_surname` directly (not from local state):

```tsx
{(lotOwner.proxy_given_name || lotOwner.proxy_surname)
  ? `${lotOwner.proxy_given_name ?? ""} ${lotOwner.proxy_surname ?? ""}`.trim()
  : <em style={{ color: "var(--text-muted)" }}>— no name —</em>
}
```

On **first** save, `lotOwner` (the prop passed into `EditModal`) still has `proxy_given_name: null` because the cache has not yet been refetched. The invalidation is asynchronous — the refetch happens after the current render. So the proxy email is set correctly (from local state) but the name reads from the stale `lotOwner` prop, showing "— no name —".

On **subsequent** saves, the `lotOwner` prop has been refreshed by the previous invalidation, so it includes the name.

**Fix:**
The "current proxy" display block should read `proxyGivenName` and `proxySurname` (local state, which was just updated in `onSuccess`) instead of `lotOwner.proxy_given_name` / `lotOwner.proxy_surname`.

Change in the proxy display section (inside `EditModal`):

```tsx
{/* Before (buggy — reads stale prop) */}
{(lotOwner.proxy_given_name || lotOwner.proxy_surname)
  ? `${lotOwner.proxy_given_name ?? ""} ${lotOwner.proxy_surname ?? ""}`.trim()
  : <em style={{ color: "var(--text-muted)" }}>— no name —</em>
}

{/* After (correct — reads local state which is updated in onSuccess) */}
{(proxyGivenName || proxySurname)
  ? `${proxyGivenName} ${proxySurname}`.trim()
  : <em style={{ color: "var(--text-muted)" }}>— no name —</em>
}
```

No other changes are needed. The `proxyGivenName`/`proxySurname` state is already updated in `setProxyMutation.onSuccess` before the query is invalidated, so this reads the correct value immediately.

### Fix 4 — Vote drill-down button rename + styling

**File:** `frontend/src/components/admin/AGMReportView.tsx`

**Current state:**
The per-binary-motion expand/collapse button (inside `AGMReportView`, in the `admin-card__header` for each motion) reads:
```
▶ Show voters   /   ▲ Hide voters
```
It is styled with `fontSize: "0.75rem"`, which makes it visually lighter than adjacent controls.

**Change:**

1. Rename button labels:
   - `"▶ Show voters"` → `"▶ Show voting details"`
   - `"▲ Hide voters"` → `"▲ Hide voting details"`
   - Update `aria-label` from `"Collapse/Expand voter list for ..."` to `"Collapse/Expand voting details for ..."`

2. Increase font size and padding to match `.btn--admin` scale:
   ```tsx
   style={{
     marginLeft: "auto",
     fontSize: "0.8125rem",   /* was 0.75rem */
     fontWeight: 600,
     cursor: "pointer",
     background: "none",
     border: "1px solid var(--border)",
     borderRadius: "var(--r-sm)",
     padding: "3px 10px",     /* was "1px 6px" */
     color: "var(--text-secondary)",  /* was var(--text-muted) — slightly darker */
   }}
   ```

   The same visual change applies to the multi-choice option-level expand/collapse button in `MultiChoiceOptionRows`. Those buttons currently say "▲ Hide voters" / "▶ Show voters". Rename those too for consistency:
   - `"▶ Show voters"` → `"▶ Show voting details"`
   - `"▲ Hide voters"` → `"▲ Hide voting details"`
   - Update corresponding `aria-label` attributes

### Fix 5 — Vote drill-down in the email results report

**Analysis:**

The meeting results email is rendered by the Jinja2 template at `backend/app/templates/report_email.html`. This is a static HTML email — there is no JavaScript, no React, and no interactive expand/collapse possible in email clients.

The template already includes full voter lists (Voted Yes, Voted No, Abstained, Absent sections) expanded inline beneath each motion's tally table. There is no "hidden by default" concept in static email HTML.

**Frontend-only recommendation:**

A separate **frontend "email preview" view** does not exist in the current codebase. The closest analog is `AGMReportView` on the admin meeting detail page. There is no component that renders the email layout interactively.

**Decision:** No implementation change is needed for Fix 5. The email template already shows full voter lists expanded. The requirement "add the same per-motion expand/collapse drill-down" cannot apply to a static email template. If a frontend email preview component is added in a future feature, it should use `AGMReportView` directly (which already has drill-down after Fix 4). This is noted in the Non-Goals section below.

### Fix 6 — Voting drill-down: tabular layout

**File:** `frontend/src/components/admin/AGMReportView.tsx`

**Scope:** The `BinaryVoterList` component (lines 170–207 in the current file), which renders the expanded voter details for binary motions.

**Current state:**
Each voter is displayed as a plain `<div>` string: `Lot {v.lot_number} — {v.voter_email}{v.proxy_email ? " (proxy)" : ""} — {v.entitlement} UOE — Admin|Voter`

No name column is shown. All info is packed into a single line with `—` separators. No alignment.

**Available data fields (from `VoterEntry` type):**
```typescript
interface VoterEntry {
  voter_email?: string;
  lot_number?: string;
  entitlement: number;
  proxy_email?: string | null;
  submitted_by_admin?: boolean;
}
```

Note: **No voter name field** is present in `VoterEntry`. The API response does not include the voter's given name or surname in the vote detail records. See the "Backend changes" note below.

**New layout:**
Replace the current per-category `<div>` list with a single `.admin-table` wrapped in `.admin-table-wrapper`. Columns:

| Column | Source | Notes |
|---|---|---|
| Lot # | `v.lot_number` | Monospace font |
| Email | `v.voter_email` | Show proxy indicator if `v.proxy_email` is set |
| UOE | `v.entitlement` | Monospace font, right-aligned |
| Submitted by | `v.submitted_by_admin` | "Admin" or "Voter" |
| Choice | Category loop variable | Coloured badge using existing CSS variables |

The "Name" column is omitted because the backend does not return `lot_owner.given_name` / `lot_owner.surname` in the `VoterEntry` shape (see Backend changes note below). Rather than add a backend change to this fix, the table ships without a Name column and it can be added in a follow-up.

**New `BinaryVoterList` structure:**

```tsx
function BinaryVoterList({ motion }: { motion: MotionDetail }) {
  const categories = ["yes", "no", "abstained", "absent", "not_eligible"] as const;
  const rows: Array<{ cat: typeof categories[number]; voter: VoterEntry }> = [];
  for (const cat of categories) {
    for (const v of motion.voter_lists[cat] ?? []) {
      rows.push({ cat, voter: v });
    }
  }
  if (rows.length === 0) {
    return (
      <p style={{ padding: "12px 20px", fontSize: "0.875rem", color: "var(--text-muted)" }}>
        No voter records.
      </p>
    );
  }
  return (
    <div style={{ padding: "0 0 8px 0", borderTop: "1px solid var(--border-subtle)" }}>
      <div className="admin-table-wrapper">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Lot #</th>
              <th>Email</th>
              <th style={{ textAlign: "right" }}>UOE</th>
              <th>Submitted By</th>
              <th>Choice</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ cat, voter }) => (
              <tr key={`${cat}-${voter.lot_number}-${voter.voter_email}`}>
                <td style={{ fontFamily: "'Overpass Mono', monospace", fontSize: "0.875rem" }}>
                  {voter.lot_number ?? "—"}
                </td>
                <td style={{ fontSize: "0.875rem" }}>
                  {voter.voter_email ?? "—"}
                  {voter.proxy_email && (
                    <span style={{ marginLeft: 6, fontSize: "0.75rem", color: "var(--text-muted)" }}>
                      (proxy)
                    </span>
                  )}
                </td>
                <td style={{ fontFamily: "'Overpass Mono', monospace", fontSize: "0.875rem", textAlign: "right" }}>
                  {voter.entitlement}
                </td>
                <td style={{ fontSize: "0.875rem" }}>
                  {voter.submitted_by_admin ? "Admin" : "Voter"}
                </td>
                <td>
                  <span style={{
                    fontSize: "0.7rem",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.07em",
                    padding: "3px 8px",
                    borderRadius: "100px",
                    color: CHOICE_COLORS[cat],
                    background: CHOICE_BG_COLORS[cat],
                  }}>
                    {CATEGORY_LABELS[cat]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

Add supporting colour maps (leveraging the existing `CATEGORY_COLORS` and new background values):

```tsx
const CHOICE_BG_COLORS: Record<string, string> = {
  yes: "var(--green-bg)",
  no: "var(--red-bg)",
  abstained: "#F0EFEE",
  absent: "#F0EFEE",
  not_eligible: "#F0EFEE",
};
```

`CATEGORY_COLORS` already exists in the file and can be reused for text colours.

---

## Backend Changes

**No backend changes are required for any of the six fixes.**

**Note on Fix 6 (Name column):** The `VoterEntry` type returned by `GET /api/admin/agms/{id}` does not include `lot_owner.given_name` or `lot_owner.surname`. These fields are available on `LotOwner` and `LotOwnerEmailEntry` but are not joined into the voter list query. Adding a Name column would require:
- Modifying the `admin_service.py` voter list builder to join `lot_owner_emails` and return name fields
- Extending the `VoterEntry` Pydantic schema with `voter_name: str | None`
- Extending the `VoterEntry` TypeScript interface

This is a non-trivial backend query change and should be tracked as a separate story. The current fix ships the tabular layout without the Name column; a follow-up can add it.

**Note on Fix 5 (Email template):** The `report_email.html` Jinja2 template is a static HTML email — no interactive drill-down is possible. The template already shows all voter lists expanded. No change is needed.

---

## Security Considerations

No security implications. All fixes are frontend-only changes to existing admin and voter UI components. No new API endpoints, no new data exposure, no auth changes, no secrets. The admin results report is already protected behind admin auth.

---

## Files to Change

| File | Change |
|---|---|
| `frontend/src/components/admin/LotOwnerTable.tsx` | Fix 1: remove Name column, narrow `LotOwnerSortColumn` type, remove sort branch, update colSpan |
| `frontend/src/styles/index.css` | Fix 2: update `.admin-sidebar__logo` and `.app-header__logo`/`.app-header` |
| `frontend/src/components/admin/LotOwnerForm.tsx` | Fix 3: use `proxyGivenName`/`proxySurname` state instead of `lotOwner.proxy_given_name`/`proxy_surname` in proxy display |
| `frontend/src/components/admin/AGMReportView.tsx` | Fix 4: rename button labels + update aria-labels; Fix 6: replace `BinaryVoterList` with tabular layout + add `CHOICE_BG_COLORS` |
| `frontend/src/components/admin/__tests__/LotOwnerTable.test.tsx` | Update tests: remove assertions for Name column; update colSpan expectations |
| `frontend/src/components/admin/__tests__/LotOwnerForm.test.tsx` | Update proxy tests: assert name is shown immediately after first proxy save |
| `frontend/src/components/admin/__tests__/AGMReportView.test.tsx` | Update tests: assert new button labels; assert tabular voter list structure |
| `frontend/src/pages/admin/__tests__/BuildingDetailPage.test.tsx` | Update: remove any assertions for Name table header |

---

## Test Cases

### Fix 1 — LotOwnerTable name column removal

**Unit tests (LotOwnerTable.test.tsx):**
- Render with lot owners that have `given_name` + `surname` set: assert no "Name" column header is present in the table
- Render with lot owners: assert exactly 6 columns (Lot Number, Email, Unit Entitlement, Financial Position, Proxy, Actions)
- Loading state: `colSpan` on loading row equals 6
- Empty state: `colSpan` on "No lot owners found" row equals 6
- Sort by `lot_number`, `email`, `unit_entitlement`, `financial_position`, `proxy`: all work correctly; sorting by "name" is no longer present

### Fix 2 — Logo sizing

**Unit tests (VoterShell.test.tsx):**
- Render `VoterShell`: assert `<img className="app-header__logo">` is present (CSS change is verified by visual/E2E test, not unit test)

**Unit tests (AdminLayout.test.tsx):**
- Render `AdminLayout`: assert `<img className="admin-sidebar__logo">` is present

**E2E (visual check):** No automated visual regression test; covered by E2E login flow render and manual review.

### Fix 3 — Proxy name shown on first save

**Unit tests (LotOwnerForm.test.tsx):**
- Render `EditModal` with a lot owner that has no proxy
- Fill in proxy given name, surname, and email
- Submit "Set proxy" — mock mutation returns `{ proxy_email: "proxy@test.com", proxy_given_name: "Jane", proxy_surname: "Doe" }`
- Assert that "Jane Doe proxy@test.com" (or similar) is rendered immediately in the proxy display section, without waiting for a cache refetch
- Assert that "— no name —" is NOT shown

**Regression scenario:**
- After first save shows name correctly, simulate a second save with a different name
- Assert the new name appears immediately on the second save too

### Fix 4 — Button rename + styling

**Unit tests (AGMReportView.test.tsx):**
- Render with a binary motion and voter lists
- Assert the expand button text is "Show voting details" (not "Show voters")
- Click the button; assert "Hide voting details" is shown
- Assert `aria-expanded` is `"false"` initially, `"true"` after click
- Assert the `aria-label` contains "voting details" (not "voter list")
- For multi-choice motion with options: assert option-level button labels also say "Show voting details" / "Hide voting details"

### Fix 5 — Email template

No new tests. The email template fix is declined (static HTML, already expanded). Document in test: note that `report_email.html` voter lists are always expanded and no interactive drill-down exists.

### Fix 6 — Tabular BinaryVoterList

**Unit tests (AGMReportView.test.tsx):**
- Render with a binary motion; click "Show voting details" to expand
- Assert an `<table>` with class `admin-table` is rendered inside `.admin-table-wrapper`
- Assert table headers: "Lot #", "Email", "UOE", "Submitted By", "Choice"
- Assert a voter row contains the lot number, email, entitlement, "Admin"/"Voter" label, and a coloured choice badge
- Proxy voter: assert "(proxy)" indicator appears next to the email
- Admin-submitted ballot: assert "Admin" appears in the Submitted By cell
- Voter-submitted ballot: assert "Voter" appears in the Submitted By cell
- Empty voter lists: assert "No voter records." message is shown
- Not_eligible category: assert "Not eligible" choice badge is rendered

---

## Schema Migration Required

**No** — all changes are pure frontend CSS and React component edits. No database schema changes.

---

## E2E Test Scenarios

### Happy path — lot owner table (Fix 1)
1. Admin navigates to a building detail page with at least one lot owner
2. Assert "Lot Number", "Email", "Unit Entitlement", "Financial Position", "Proxy", "Actions" columns are visible
3. Assert no "Name" column header exists

### Happy path — proxy name immediate display (Fix 3)
1. Admin opens lot owner edit modal for a lot with no proxy
2. Enters given name "Jane", surname "Doe", proxy email "jane@test.com"
3. Clicks "Set proxy"
4. Without closing and reopening the modal, assert "Jane Doe jane@test.com" is displayed in the proxy section
5. Asserts "— no name —" is not shown

### Multi-step: proxy set then re-open (Fix 3 regression)
1. Set proxy as above — verify name shown immediately
2. Close and reopen the edit modal for the same lot owner
3. Assert name still shows correctly on second open (data was persisted)

### Happy path — vote drill-down table (Fix 6)
1. Admin navigates to a closed meeting detail page
2. In the Results Report, find a binary motion with at least one Yes and one No voter
3. Click "Show voting details" on the motion
4. Assert a table is visible with columns: Lot #, Email, UOE, Submitted By, Choice
5. Assert at least one row shows "For" badge and at least one shows "Against" badge
6. Assert lot numbers are in monospace font
7. Click "Hide voting details" — assert table collapses

### Logo sizing (Fix 2 — visual check)
1. Load admin portal — assert sidebar logo is rendered wider than 40px on a desktop viewport
2. Load voter portal (any page with `VoterShell`) — assert header logo height appears larger than previous 40px

### Existing E2E specs affected

The following persona journey specs in `e2e_tests/` touch components modified by these fixes and must be verified (not necessarily modified unless they assert the removed Name column or old button text):

- **Admin journey:** building detail page, lot owner table, meeting results report — affected by Fix 1, Fix 4, Fix 6
- **Admin journey:** lot owner edit modal, proxy management — affected by Fix 3
- **Voter journey:** voter shell header — affected by Fix 2

---

## Key Design Decisions

1. **Fix 1 — Why remove the top-level Name column rather than consolidate it into Email:** The `owner_emails` Email column already shows names inline (per US-UI-FIX-10). Showing the top-level `LotOwner.given_name`/`surname` in a separate column duplicates data that is more accurately represented at the per-email level. Removing the redundant column reduces cognitive load and makes the table narrower.

2. **Fix 2 — Why increase header height for the voter logo:** A `100px` logo in a `56px` header would be clipped. The header must grow to fit. `120px` provides `10px` top/bottom padding with `align-items: center`. The admin sidebar logo uses `width: 100%` instead of a fixed height because the sidebar is a vertical container — filling width is the natural dimension to control.

3. **Fix 3 — Why read from local state not from the prop:** The `lotOwner` prop is the React Query cache entry passed down from the parent. Cache invalidation is asynchronous; the refetch happens after the render triggered by `onSuccess`. Reading from local state (updated synchronously in `onSuccess`) ensures the name is visible immediately without an extra round-trip.

4. **Fix 5 — Why no implementation:** The "email results report" is a static Jinja2 HTML email template. Email clients do not execute JavaScript, so interactive expand/collapse is not possible. The existing template already renders all voter lists expanded. A frontend "email preview" component does not exist, and building one is out of scope for this minor-fixes branch.

5. **Fix 6 — Why omit the Name column for now:** The `VoterEntry` shape returned by the backend does not include `lot_owner.given_name` / `lot_owner.surname`. Adding a Name column requires a backend query change (join to `lot_owner_emails` or `lot_owners`) plus Pydantic/TypeScript schema changes. This is a separate, trackable backend story. The table ships without it to keep this branch purely frontend.

---

## Vertical Slice Decomposition

All six fixes are independent of each other — each can be implemented, tested, and reviewed as a separate commit on the same branch. There are no inter-fix data dependencies.

Fixes 4 and 6 both touch `AGMReportView.tsx`, so they should be applied together in one commit to avoid merge conflicts.
