import { test, expect } from "../fixtures";

test.describe("Admin Lot Owners", () => {
  // Note: Requires a building to exist. Seed via API before tests.

  test("displays lot owner table for a building", async ({ page, request }) => {
    // Seed: create a building and lot owners via API
    const buildingRes = await request.post("/api/admin/buildings/import", {
      multipart: {
        file: {
          name: "buildings.csv",
          mimeType: "text/csv",
          buffer: Buffer.from("building_name,manager_email\nE2E Building,manager@e2e.com"),
        },
      },
    });
    expect(buildingRes.ok()).toBeTruthy();

    const buildingsRes = await request.get("/api/admin/buildings");
    const buildings = await buildingsRes.json() as { id: string; name: string }[];
    const building = buildings.find((b) => b.name === "E2E Building");
    expect(building).toBeDefined();

    await page.goto(`/admin/buildings/${building!.id}`);
    await expect(page.getByText("E2E Building")).toBeVisible();
    await expect(page.getByRole("heading", { name: /E2E Building/ })).toBeVisible();
  });

  test("add lot owner form submits and shows in table", async ({ page, request }) => {
    // Use "E2E Building" by name — never buildings[0] — to avoid touching
    // "E2E Test Building" (which owns the E2E-1 lot owner used by voting-flow
    // tests). The admin API sorts by created_at, so index 0 is not stable.
    const buildingsRes = await request.get("/api/admin/buildings");
    const buildings = await buildingsRes.json() as { id: string; name: string }[];
    const building = buildings.find((b) => b.name === "E2E Building");
    expect(building).toBeDefined();

    const uniqueLot = `E2E-LOT-${Date.now()}`;
    await page.goto(`/admin/buildings/${building!.id}`);
    await page.getByRole("button", { name: "Add Lot Owner" }).click();
    await page.getByLabel("Lot Number").fill(uniqueLot);
    await page.getByLabel("Email").fill("lot1@e2e.com");
    await page.getByLabel("Unit Entitlement").fill("50");
    await page.getByRole("button", { name: "Add Lot Owner" }).last().click();

    await expect(page.getByText(uniqueLot)).toBeVisible({ timeout: 15000 });
  });

  test("CSV import shows imported count", async ({ page, request }) => {
    // Use "E2E Building" by name — never buildings[0] — so the CSV import
    // (which deletes lot owners not present in the file) only touches
    // "E2E Building" and never wipes "E2E Test Building"'s E2E-1 voter.
    const buildingsRes = await request.get("/api/admin/buildings");
    const buildings = await buildingsRes.json() as { id: string; name: string }[];
    const building = buildings.find((b) => b.name === "E2E Building");
    expect(building).toBeDefined();

    await page.goto(`/admin/buildings/${building!.id}`);
    const csvContent =
      "lot_number,email,unit_entitlement\nLOT-A,a@e2e.com,100\nLOT-B,b@e2e.com,200";
    const fileInput = page.getByLabel("Lot owners file");
    await fileInput.setInputFiles({
      name: "owners.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csvContent),
    });
    await page.getByRole("button", { name: "Upload" }).click();
    await expect(page.getByText(/Import complete: 2 records imported/)).toBeVisible();
  });
});
