/**
 * E2E regression test: BUG-RV-01
 *
 * After a voter submits on all currently-visible motions, the admin reveals a
 * new motion.  On the voter's next login the submit button must reappear so
 * they can vote on the newly-visible motion.
 *
 * Steps:
 *   1. Seed building + AGM with 2 visible motions, one lot owner
 *   2. Voter submits votes on both motions
 *   3. Admin adds a 3rd motion to the meeting and makes it visible
 *   4. Voter re-authenticates in a fresh session
 *   5. Assert: voting page is shown (not confirmation) — submit button visible
 *   6. Voter votes on motion 3 and submits — lands on confirmation
 */

import { test, expect, RUN_SUFFIX } from "../fixtures";
import { request as playwrightRequest } from "@playwright/test";
import {
  ADMIN_AUTH_PATH,
  seedBuilding,
  seedLotOwner,
  createOpenMeeting,
  clearBallots,
  goToAuthPage,
  authenticateVoter,
  getTestOtp,
  submitBallot,
} from "../workflows/helpers";

const BUILDING = `RV01 Revote Building-${RUN_SUFFIX}`;
const LOT = "RV01-1";
const LOT_EMAIL = `rv01-voter-${RUN_SUFFIX}@test.com`;
const MOTION1_TITLE = "RV01 Motion 1 — Budget";
const MOTION2_TITLE = "RV01 Motion 2 — Bylaws";
const MOTION3_TITLE = "RV01 Motion 3 — New Item";

let meetingId = "";

test.describe("BUG-RV-01: submit button visible after admin reveals new motion", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";
    const api = await playwrightRequest.newContext({
      baseURL,
      ignoreHTTPSErrors: true,
      storageState: ADMIN_AUTH_PATH,
    });

    const buildingId = await seedBuilding(api, BUILDING, "rv01-mgr@test.com");

    await seedLotOwner(api, buildingId, {
      lotNumber: LOT,
      emails: [LOT_EMAIL],
      unitEntitlement: 10,
      financialPosition: "normal",
    });

    meetingId = await createOpenMeeting(api, buildingId, `RV01 Meeting-${RUN_SUFFIX}`, [
      {
        title: MOTION1_TITLE,
        description: "Do you approve the annual budget?",
        orderIndex: 0,
        motionType: "general",
      },
      {
        title: MOTION2_TITLE,
        description: "Do you approve the bylaw change?",
        orderIndex: 1,
        motionType: "general",
      },
    ]);

    await clearBallots(api, meetingId);
    await api.dispose();
  }, { timeout: 60000 });

  // ── Step 1: voter submits on all 2 visible motions ─────────────────────────
  test("RV01.1: voter submits on both visible motions — lands on confirmation", async ({ page }) => {
    test.setTimeout(120000);

    const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";
    const api = await playwrightRequest.newContext({
      baseURL,
      ignoreHTTPSErrors: true,
      storageState: ADMIN_AUTH_PATH,
    });

    await goToAuthPage(page, BUILDING);
    await authenticateVoter(page, LOT_EMAIL, () => getTestOtp(api, LOT_EMAIL, meetingId));
    await api.dispose();
    await expect(page).toHaveURL(/vote\/.*\/voting/, { timeout: 20000 });

    const motionCards = page.locator(".motion-card");
    await expect(motionCards).toHaveCount(2);
    await motionCards.filter({ hasText: MOTION1_TITLE }).getByRole("button", { name: "For" }).click();
    await motionCards.filter({ hasText: MOTION2_TITLE }).getByRole("button", { name: "For" }).click();

    await submitBallot(page);
    await expect(page).toHaveURL(/vote\/.*\/confirmation/, { timeout: 20000 });
    await expect(page.getByText("Ballot submitted")).toBeVisible({ timeout: 15000 });
  });

  // ── Step 2: admin adds + reveals a 3rd motion ──────────────────────────────
  test("RV01.2: admin adds a 3rd motion to the meeting and makes it visible", async () => {
    test.setTimeout(60000);

    const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";
    const api = await playwrightRequest.newContext({
      baseURL,
      ignoreHTTPSErrors: true,
      storageState: ADMIN_AUTH_PATH,
    });

    // Add a 3rd motion (new motions are created with is_visible=False)
    const addRes = await api.post(`/api/admin/general-meetings/${meetingId}/motions`, {
      data: {
        title: MOTION3_TITLE,
        description: "A newly added agenda item.",
        motion_type: "general",
      },
    });
    expect(addRes.ok(), `add motion: ${addRes.status()} ${await addRes.text()}`).toBe(true);
    const newMotion = (await addRes.json()) as { id: string; is_visible: boolean };
    expect(newMotion.is_visible).toBe(false);

    // Make the new motion visible
    const visRes = await api.patch(`/api/admin/motions/${newMotion.id}/visibility`, {
      data: { is_visible: true },
    });
    expect(visRes.ok(), `visibility patch: ${visRes.status()} ${await visRes.text()}`).toBe(true);
    const updated = (await visRes.json()) as { is_visible: boolean };
    expect(updated.is_visible).toBe(true);

    await api.dispose();
  });

  // ── Step 3: voter re-authenticates and sees submit button ──────────────────
  test("RV01.3: voter re-authenticates — submit button is visible for new motion", async ({ page }) => {
    test.setTimeout(120000);

    const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";
    const api = await playwrightRequest.newContext({
      baseURL,
      ignoreHTTPSErrors: true,
      storageState: ADMIN_AUTH_PATH,
    });

    // Navigate to home first to clear any in-memory session state
    await page.goto("/");
    await expect(page).toHaveURL("/", { timeout: 10000 });

    await goToAuthPage(page, BUILDING);
    await authenticateVoter(page, LOT_EMAIL, () => getTestOtp(api, LOT_EMAIL, meetingId));
    await api.dispose();

    // Must land on /voting (not /confirmation) — new motion is unvoted
    await expect(page).toHaveURL(/vote\/.*\/voting/, { timeout: 20000 });

    // Three motions visible: 2 already-voted (read-only) + 1 new (interactive)
    const motionCards = page.locator(".motion-card");
    await expect(motionCards).toHaveCount(3);

    // Submit ballot button must be visible
    await expect(page.getByRole("button", { name: "Submit ballot" })).toBeVisible({ timeout: 15000 });
  });

  // ── Step 4: voter votes on motion 3 and submits ────────────────────────────
  test("RV01.4: voter votes on motion 3 and submits — lands on confirmation", async ({ page }) => {
    test.setTimeout(120000);

    const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";
    const api = await playwrightRequest.newContext({
      baseURL,
      ignoreHTTPSErrors: true,
      storageState: ADMIN_AUTH_PATH,
    });

    await page.goto("/");
    await goToAuthPage(page, BUILDING);
    await authenticateVoter(page, LOT_EMAIL, () => getTestOtp(api, LOT_EMAIL, meetingId));
    await api.dispose();

    await expect(page).toHaveURL(/vote\/.*\/voting/, { timeout: 20000 });

    // Vote on the new motion — the previous 2 are read-only (already voted)
    const newMotionCard = page.locator(".motion-card").filter({ hasText: MOTION3_TITLE });
    await expect(newMotionCard).toBeVisible({ timeout: 15000 });
    await newMotionCard.getByRole("button", { name: "For" }).click();

    await submitBallot(page);
    await expect(page).toHaveURL(/vote\/.*\/confirmation/, { timeout: 20000 });
    await expect(page.getByText("Ballot submitted")).toBeVisible({ timeout: 15000 });
  });
});
