/**
 * Playwright global setup — runs once before the entire test suite.
 *
 * 1. Authenticates as admin and persists the session cookie to
 *    e2e/.auth/admin.json so admin-scoped tests can reuse it.
 *
 * 2. Seeds the minimum data required by the voting-flow tests:
 *    - A building called "E2E Test Building"
 *    - A lot owner  lot=E2E-1  email=e2e-voter@test.com  entitlement=10
 *    - An open AGM with one motion attached to that building
 *
 *    All of this is idempotent — the setup checks what already exists
 *    before creating anything, so it is safe to run against a long-lived
 *    shared deployment.
 */

import { chromium, request as playwrightRequest, type FullConfig } from "@playwright/test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "admin";

export const E2E_BUILDING_NAME = "E2E Test Building";
export const E2E_LOT_NUMBER = "E2E-1";
export const E2E_LOT_EMAIL = "e2e-voter@test.com";
export const E2E_LOT_ENTITLEMENT = 10;
export const E2E_AGM_TITLE = "E2E Test AGM";

const BYPASS_TOKEN = process.env.VERCEL_BYPASS_TOKEN;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default async function globalSetup(_config: FullConfig) {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";

  // ── 1. Admin auth state ────────────────────────────────────────────────────
  const authDir = path.join(__dirname, ".auth");
  if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL, ignoreHTTPSErrors: true });
  const page = await context.newPage();

  // Bypass Vercel Deployment Protection when running against a deployed URL.
  // Visiting this URL sets a _vercel_jwt cookie that allows all subsequent
  // same-origin requests through without Vercel's SSO wall.
  if (BYPASS_TOKEN) {
    await page.goto(
      `${baseURL}/?x-vercel-set-bypass-cookie=true&x-vercel-protection-bypass=${BYPASS_TOKEN}`
    );
  }

  // Save bypass cookie (only) as the "public" storageState — used by public
  // project tests (smoke, voting-flow) that don't need an admin session but
  // still need to bypass Vercel Deployment Protection on preview URLs.
  await context.storageState({ path: path.join(authDir, "public.json") });

  await page.goto("/admin/login");
  await page.getByLabel("Username").fill(ADMIN_USERNAME);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  try {
    await page.waitForURL(/\/admin\/buildings/, { timeout: 30000 });
  } catch {
    const url = page.url();
    const content = await page.content();
    throw new Error(
      `Admin login failed — stuck at ${url}\nPage content (first 500 chars):\n${content.slice(0, 500)}`
    );
  }
  await context.storageState({ path: path.join(authDir, "admin.json") });
  await browser.close();

  // ── 2. Seed voting test data via the API ───────────────────────────────────
  const api = await playwrightRequest.newContext({
    baseURL,
    ignoreHTTPSErrors: true,
    storageState: path.join(authDir, "admin.json"),
  });

  // Ensure E2E building exists
  const buildingsRes = await api.get("/api/admin/buildings");
  const buildings = (await buildingsRes.json()) as { id: string; name: string }[];
  let building = buildings.find((b) => b.name === E2E_BUILDING_NAME);

  if (!building) {
    const created = await api.post("/api/admin/buildings", {
      data: { name: E2E_BUILDING_NAME, manager_email: "e2e-manager@test.com" },
    });
    building = (await created.json()) as { id: string; name: string };
  }

  // Ensure lot owner exists
  const lotOwnersRes = await api.get(`/api/admin/buildings/${building.id}/lot-owners`);
  const lotOwners = (await lotOwnersRes.json()) as { lot_number: string }[];
  if (!lotOwners.find((l) => l.lot_number === E2E_LOT_NUMBER)) {
    await api.post(`/api/admin/buildings/${building.id}/lot-owners`, {
      data: {
        lot_number: E2E_LOT_NUMBER,
        email: E2E_LOT_EMAIL,
        unit_entitlement: E2E_LOT_ENTITLEMENT,
      },
    });
  }

  // Always create a fresh open AGM for each test run:
  // close any existing open E2E AGMs first (so the lot owner has no submitted
  // ballot on the new AGM), then create a new one. The just-closed AGM
  // satisfies the "AGM closed state" test which looks for any closed AGM.
  const agmsRes = await api.get("/api/admin/agms");
  const agms = (await agmsRes.json()) as {
    id: string;
    title: string;
    status: string;
    building_id: string;
  }[];
  const openE2eAgms = agms.filter(
    (a) => a.building_id === building!.id && a.status === "open"
  );

  for (const agm of openE2eAgms) {
    await api.post(`/api/admin/agms/${agm.id}/close`);
  }

  const future = new Date();
  future.setFullYear(future.getFullYear() + 1);
  const closesAt = new Date(future);
  closesAt.setDate(closesAt.getDate() + 7);

  await api.post("/api/admin/agms", {
    data: {
      building_id: building.id,
      title: E2E_AGM_TITLE,
      meeting_at: future.toISOString(),
      voting_closes_at: closesAt.toISOString(),
      motions: [
        {
          title: "E2E Test Motion 1",
          description: "Do you approve this E2E test motion?",
          order_index: 1,
        },
      ],
    },
  });

  await api.dispose();
}
