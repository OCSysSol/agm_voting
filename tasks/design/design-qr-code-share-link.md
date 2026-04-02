# Design: QR Code for Voter Share Link

**Status:** Implemented

## Overview

Display a QR code on the admin AGM detail page that encodes the voter share link. Admins can enlarge, download as PNG, or print the QR code to distribute to in-person attendees.

Covers US-QR-01.

---

## Root Cause / Background

In-person AGM hosts need a quick way to get voters to the correct voting URL without typing it manually. A QR code displayed on the admin screen solves this.

---

## Technical Design

### Database changes

None.

### Backend changes

None. The voter URL is constructed entirely client-side from the known `agm_id`.

### Frontend changes

**New dependency:** Add `qrcode.react` to `frontend/package.json`. This library is small (~15 KB gzipped) and voter-bundle safe (only used in the admin flow, so lazy-loading via dynamic import is used to keep it out of the voter bundle).

**New component:** `AgmQrCode` (`frontend/src/components/AgmQrCode.tsx`):
- Props: `agmId: string`, `voterBaseUrl: string`, `logoUrl: string | null`.
- Renders a `<QRCodeCanvas>` (from `qrcode.react`) with the `imageSettings` prop pointing to `logoUrl` when non-empty.
- `voterBaseUrl` is derived from `window.location.origin` + `/vote/${agmId}`.

**New component:** `AgmQrCodeModal` (`frontend/src/components/AgmQrCodeModal.tsx`):
- Renders a full-size `AgmQrCode` at 400×400 px.
- "Download PNG" button: gets a ref to the `<canvas>` element, calls `canvas.toDataURL("image/png")`, creates a temporary `<a>` tag with `download="agm-qr-{agmId}.png"` and clicks it programmatically.
- "Print" button: calls `window.print()` with a `@media print` style that hides everything except the QR canvas.
- Dismissible via "×" close button or backdrop click.

**Modified `AdminMeetingDetailPage.tsx`:**
- Import `AgmQrCode` lazily (`const AgmQrCode = lazy(() => import(...))`).
- Show a small inline `<AgmQrCode>` (size 120) in the "Share" section of the page header.
- Clicking the small QR code opens `AgmQrCodeModal`.

---

## Files to Change

| File | Change |
|------|--------|
| `frontend/package.json` | Add `qrcode.react` dependency |
| `frontend/src/components/AgmQrCode.tsx` | New QR code component |
| `frontend/src/components/AgmQrCodeModal.tsx` | New modal with download + print |
| `frontend/src/pages/admin/AdminMeetingDetailPage.tsx` | Add inline QR code + modal trigger |
| `frontend/tests/msw/handlers.ts` | No handler changes needed (frontend-only) |

---

## Test Cases

### Unit / Integration
- `AgmQrCode` renders a `<canvas>` element when given an `agmId`.
- `AgmQrCodeModal` renders with Download and Print buttons.
- Logo `imageSettings` prop is set when `logoUrl` is non-empty; absent when empty.

### E2E
- Admin AGM detail page shows QR code; clicking enlarges it; Download button triggers file download.

---

## Schema Migration Required

None.
