import { test, expect } from "./fixtures";
import { E2E_BUILDING_NAME, E2E_LOT_NUMBER, E2E_LOT_EMAIL } from "./global-setup";

// Voting-flow tests rely on data seeded by global-setup.ts:
//   - Building "E2E Test Building"
//   - Lot owner  lot=E2E-1  email=e2e-voter@test.com
//   - An open AGM with at least one motion

test.describe("Lot owner voting flow", () => {
  test("full lot owner journey: select building → auth → vote → confirmation", async ({ page }) => {
    await page.goto("/");

    // Building selector page
    const select = page.getByLabel("Select your building");
    await expect(select).toBeVisible();
    await select.selectOption({ label: E2E_BUILDING_NAME });

    // AGM list should appear — pick the first open AGM
    await expect(page.getByRole("button", { name: "Enter Voting" }).first()).toBeVisible();
    await page.getByRole("button", { name: "Enter Voting" }).first().click();

    // Auth page
    await expect(page.getByLabel("Lot number")).toBeVisible();
    await page.getByLabel("Lot number").fill(E2E_LOT_NUMBER);
    await page.getByLabel("Email address").fill(E2E_LOT_EMAIL);
    await page.getByRole("button", { name: "Continue" }).click();

    // Voting page
    await expect(page.getByRole("button", { name: "Submit Votes" })).toBeVisible();

    // Vote Yes on all motions
    const yesButtons = page.getByRole("button", { name: "Yes" });
    const count = await yesButtons.count();
    for (let i = 0; i < count; i++) {
      await yesButtons.nth(i).click();
    }

    // Submit
    await page.getByRole("button", { name: "Submit Votes" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Submit" }).click();

    // Confirmation
    await expect(page).toHaveURL(/confirmation/);
    await expect(page.getByText(/Your votes/)).toBeVisible();
  });

  test("failed authentication: wrong credentials show error, correct credentials proceed", async ({ page }) => {
    await page.goto("/");

    const select = page.getByLabel("Select your building");
    await select.selectOption({ label: E2E_BUILDING_NAME });
    await expect(page.getByRole("button", { name: "Enter Voting" }).first()).toBeVisible();
    await page.getByRole("button", { name: "Enter Voting" }).first().click();

    // Wrong credentials
    await page.getByLabel("Lot number").fill("NONEXISTENT-9999");
    await page.getByLabel("Email address").fill("wrong@example.com");
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(
      page.getByText("Lot number and email address do not match our records")
    ).toBeVisible();

    // Correct credentials
    await page.getByLabel("Lot number").clear();
    await page.getByLabel("Email address").clear();
    await page.getByLabel("Lot number").fill(E2E_LOT_NUMBER);
    await page.getByLabel("Email address").fill(E2E_LOT_EMAIL);
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page.getByRole("button", { name: "Submit Votes" })).toBeVisible();
  });

  test("AGM closed state: closed AGM shows View My Submission button", async ({ page, request }) => {
    // Find a closed AGM for any building
    const agmsRes = await request.get("/api/admin/agms");
    const agms = (await agmsRes.json()) as { id: string; status: string; building_id: string }[];
    const closedAgm = agms.find((a) => a.status === "closed");

    if (!closedAgm) {
      test.skip();
      return;
    }

    await page.goto("/");
    // Select any building and look for the closed AGM's "View My Submission" button
    const select = page.getByLabel("Select your building");
    await expect(select).toBeVisible();
    // Closed AGMs show "View My Submission" not "Enter Voting"
    await expect(page.getByRole("button", { name: "View My Submission" }).first()).toBeVisible();
  });

  test("admin buildings page is accessible after login", async ({ page }) => {
    await page.goto("/admin");
    await expect(page.getByText(/Admin/i).first()).toBeVisible();
  });
});
