# Design: Comprehensive Test Coverage for Motion Number, Position, Visibility, and Login Logo Fixes

## Overview

After several fix PRs (#112–#118) corrected motion number behaviour, motion position rendering, visibility toggle, reorder buttons, and admin login logo, a dedicated test coverage pass (PR #119) added unit, integration, and E2E tests to lock all these behaviours at 100% coverage.

This document records what was covered and why, serving as the authoritative reference for future regressions.

---

## What Was Tested

### 1. Motion number — edit flow (design-fix-motion-number-save.md / design-fix-motion-table-bugs.md)

**Backend (`backend/tests/test_admin_api.py`)**
- `PATCH /api/admin/motions/{id}` with `motion_number` present returns the updated value in the response.
- `PATCH` with `motion_number: ""` (empty string) clears the value to `null`.
- `PATCH` with only `motion_number` field (other fields omitted) returns 200 and updates correctly.
- Response schema `MotionVisibilityOut` includes `motion_number` and `display_order` (not `order_index`).

**Frontend (`GeneralMeetingDetailPage.test.tsx`)**
- Edit modal pre-fills `motion_number` from the current motion value when opened.
- Edit modal `motion_number` input is present and labelled correctly.
- Submitting the edit form sends `motion_number` in the PATCH payload.
- Clearing `motion_number` sends an empty string (which the backend converts to null).

### 2. Motion position — voting page uses display_order not array index (design-fix-motion-bugs.md)

**Frontend (`VotingPage.test.tsx`)**
- When motions are returned with `display_order` 2 and 3 (motion 1 is hidden), the motion cards show "MOTION 2" and "MOTION 3", not "MOTION 1" and "MOTION 2".
- The `#` column in the admin motion table shows `display_order`, not `order_index + 1`.

**E2E (`voting-scenarios.spec.ts`)**
- Voter with hidden first motion sees correct "MOTION {display_order}" labels on remaining visible motions.

### 3. Visibility toggle — optimistic update (design-fix-motion-ux.md / design-fix-motion-table-bugs.md)

**Frontend (`MotionManagementTable.test.tsx` or `GeneralMeetingDetailPage.test.tsx`)**
- Clicking the visibility toggle immediately changes the checkbox state before the API response arrives (optimistic update).
- On API error, the toggle reverts to its original state and an error message is shown inline.
- The optimistic update is sourced from the React Query cache map, not from `localOrder`, so it applies in the same render pass.

### 4. Reorder buttons — Actions column placement (design-fix-motion-ux.md)

**Frontend (`MotionManagementTable.test.tsx`)**
- Reorder buttons (⤒ ↑ ↓ ⤓) render in the same `<td>` as Edit and Delete buttons.
- "Move to top" button has `aria-label` including the motion title.
- Move buttons are absent on closed meetings.
- Move buttons are absent when there is only one motion.
- "Move to top" is disabled for the first motion; "Move to bottom" is disabled for the last.

### 5. Admin login logo — tenant branding (design-fix-admin-login-logo.md)

**Frontend (`LoginPage.test.tsx`)**
- When `BrandingContext` provides a non-empty `logo_url`, the login card renders `<img src={logo_url}>`.
- When `logo_url` is empty, no `<img>` element is rendered in the login card.
- No hardcoded `/logo.png` or `/logo.webp` references exist in the rendered output.

**E2E (`admin-login.spec.ts`)**
- Admin login page displays the configured tenant logo.
- Admin login page with no configured logo shows no broken image.

### 6. Duplicate motion_number returns 409 not 500 (design-fix-motion-number-duplicate.md)

**Backend (`backend/tests/test_admin_api.py`)**
- `POST /api/admin/general-meetings/{id}/motions` with a `motion_number` already used by another motion in the same meeting returns 409 with a clear error message.
- Two motions with `motion_number = null` (auto-assigned distinct values) do not collide.

### 7. Confirmation page / SubmitDialog motion labels (design-fix-confirmation-motion-label.md)

**Frontend (`SubmitDialog.test.tsx`)**
- Unanswered motions list shows `"MOTION {motion_number} — {title}"` format.
- Falls back to `"MOTION {display_order}"` when `motion_number` is null.

**Frontend (`VotingPage.test.tsx`)**
- `unansweredMotions` passed to `SubmitDialog` includes `display_order` and `motion_number` fields (not `order_index`).

**Frontend (`ConfirmationPage.test.tsx`)**
- Submitted ballot items display `"MOTION {motion_number}"` prefix.

**E2E (`voting-scenarios.spec.ts`)**
- SubmitDialog unanswered list shows correct motion number labels.
- Confirmation page shows correct motion number labels.

---

## Files Modified (test-only changes)

| File | Changes |
|------|---------|
| `backend/tests/test_admin_api.py` | Added motion_number edit/clear/patch-only tests; added duplicate-returns-409 test; renamed auto-assign test |
| `frontend/src/pages/admin/__tests__/GeneralMeetingDetailPage.test.tsx` | Added motion_number pre-fill, edit, clear tests; added optimistic toggle test; added reorder buttons in actions column test |
| `frontend/src/components/admin/__tests__/MotionManagementTable.test.tsx` | Added (new file): full coverage for merged table component |
| `frontend/src/components/vote/__tests__/SubmitDialog.test.tsx` | Updated prop shape to `{ display_order, motion_number, title }`; added motion_number label test |
| `frontend/src/pages/vote/__tests__/VotingPage.test.tsx` | Updated unansweredMotions mock; added display_order position test |
| `frontend/src/pages/admin/__tests__/LoginPage.test.tsx` | Added logo_url renders img; empty logo_url renders no img |
| `frontend/e2e/admin/admin-general-meetings.spec.ts` | Updated motion label assertions; added reorder + visibility in merged table |
| `frontend/e2e/admin/admin-login.spec.ts` | Added logo display scenarios |
| `frontend/e2e/workflows/voting-scenarios.spec.ts` | Updated motion label assertions; added SubmitDialog label test |

---

## Schema Migration Note

**Schema migration needed: NO.** All changes in this PR are test-only.
