import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import BuildingTable from "../BuildingTable";
import type { Building } from "../../../types";
import type { SortDir } from "../SortableColumnHeader";
import { ADMIN_BUILDINGS } from "../../../../tests/msw/handlers";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Use the first two active (non-archived) buildings from the shared MSW fixture.
const buildings: Building[] = ADMIN_BUILDINGS.filter((b) => !b.is_archived);

function renderBuildingTable(props: {
  buildings: Building[];
  isLoading?: boolean;
  sortBy?: string;
  sortDir?: SortDir;
  onSort?: (col: string) => void;
}) {
  return render(
    <MemoryRouter>
      <BuildingTable {...props} />
    </MemoryRouter>
  );
}

describe("BuildingTable", () => {
  it("renders building names and emails", () => {
    renderBuildingTable({ buildings });
    expect(screen.getByText("Alpha Tower")).toBeInTheDocument();
    expect(screen.getByText("alpha@example.com")).toBeInTheDocument();
    expect(screen.getByText("Beta Court")).toBeInTheDocument();
    expect(screen.getByText("beta@example.com")).toBeInTheDocument();
  });

  it("shows empty message when no buildings", () => {
    renderBuildingTable({ buildings: [] });
    expect(screen.getByText("No buildings found.")).toBeInTheDocument();
  });

  it("shows loading row in table body when isLoading and no data yet", () => {
    renderBuildingTable({ buildings: [], isLoading: true });
    expect(screen.getByText("Loading buildings...")).toBeInTheDocument();
    expect(screen.queryByText("No buildings found.")).not.toBeInTheDocument();
  });

  it("does not show loading row when isLoading but data is already present", () => {
    renderBuildingTable({ buildings, isLoading: true });
    expect(screen.queryByText("Loading buildings...")).not.toBeInTheDocument();
    expect(screen.getByText("Alpha Tower")).toBeInTheDocument();
  });

  it("navigates to building detail on name click", async () => {
    const user = userEvent.setup();
    renderBuildingTable({ buildings });
    await user.click(screen.getByRole("button", { name: "Alpha Tower" }));
    expect(mockNavigate).toHaveBeenCalledWith("/admin/buildings/b1");
  });

  it("renders static table headers when no onSort prop provided", () => {
    renderBuildingTable({ buildings });
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Manager Email")).toBeInTheDocument();
    expect(screen.getByText("Created At")).toBeInTheDocument();
  });

  it("does not render a Status column", () => {
    renderBuildingTable({ buildings });
    expect(screen.queryByText("Status")).not.toBeInTheDocument();
  });

  it("archived buildings are rendered with reduced opacity but no Archived badge", () => {
    const archivedBuildings: Building[] = [
      {
        id: "b3",
        name: "Old Tower",
        manager_email: "old@example.com",
        is_archived: true,
        created_at: "2023-01-01T00:00:00Z",
      },
    ];
    renderBuildingTable({ buildings: archivedBuildings });
    // Building row should be rendered (name visible)
    expect(screen.getByText("Old Tower")).toBeInTheDocument();
    // No Archived badge — that information is conveyed by the page-level toggle
    expect(screen.queryByText("Archived")).not.toBeInTheDocument();
  });

  it("does not show Archived badge for active buildings", () => {
    renderBuildingTable({ buildings });
    expect(screen.queryByText("Archived")).not.toBeInTheDocument();
  });

  // --- Sort props ---

  it("renders sortable Name, Manager Email and Created At headers when onSort is provided", () => {
    const onSort = vi.fn();
    renderBuildingTable({ buildings, sortBy: "created_at", sortDir: "desc", onSort });
    expect(screen.getByRole("button", { name: /Name/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Manager Email/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Created At/ })).toBeInTheDocument();
  });

  it("calls onSort with 'name' when Name header button is clicked", async () => {
    const user = userEvent.setup();
    const onSort = vi.fn();
    renderBuildingTable({ buildings, sortBy: "created_at", sortDir: "desc", onSort });
    await user.click(screen.getByRole("button", { name: /Name/ }));
    expect(onSort).toHaveBeenCalledWith("name");
  });

  it("calls onSort with 'manager_email' when Manager Email header button is clicked", async () => {
    const user = userEvent.setup();
    const onSort = vi.fn();
    renderBuildingTable({ buildings, sortBy: "name", sortDir: "asc", onSort });
    await user.click(screen.getByRole("button", { name: /Manager Email/ }));
    expect(onSort).toHaveBeenCalledWith("manager_email");
  });

  it("calls onSort with 'created_at' when Created At header button is clicked", async () => {
    const user = userEvent.setup();
    const onSort = vi.fn();
    renderBuildingTable({ buildings, sortBy: "name", sortDir: "asc", onSort });
    await user.click(screen.getByRole("button", { name: /Created At/ }));
    expect(onSort).toHaveBeenCalledWith("created_at");
  });

  it("shows ▲ on active name column when sortDir is asc", () => {
    const onSort = vi.fn();
    renderBuildingTable({ buildings, sortBy: "name", sortDir: "asc", onSort });
    const nameBtn = screen.getByRole("button", { name: /Name/ });
    expect(nameBtn.textContent).toContain("▲");
  });

  it("shows ▼ on active manager_email column when sortDir is desc", () => {
    const onSort = vi.fn();
    renderBuildingTable({ buildings, sortBy: "manager_email", sortDir: "desc", onSort });
    const emailBtn = screen.getByRole("button", { name: /Manager Email/ });
    expect(emailBtn.textContent).toContain("▼");
  });

  it("shows ▼ on active created_at column when sortDir is desc", () => {
    const onSort = vi.fn();
    renderBuildingTable({ buildings, sortBy: "created_at", sortDir: "desc", onSort });
    const createdBtn = screen.getByRole("button", { name: /Created At/ });
    expect(createdBtn.textContent).toContain("▼");
  });

  it("shows ⇅ on inactive column", () => {
    const onSort = vi.fn();
    renderBuildingTable({ buildings, sortBy: "created_at", sortDir: "desc", onSort });
    const nameBtn = screen.getByRole("button", { name: /Name/ });
    expect(nameBtn.textContent).toContain("⇅");
  });

  it("active th has aria-sort='descending'", () => {
    const onSort = vi.fn();
    renderBuildingTable({ buildings, sortBy: "created_at", sortDir: "desc", onSort });
    const createdBtn = screen.getByRole("button", { name: /Created At/ });
    const th = createdBtn.closest("th");
    expect(th).toHaveAttribute("aria-sort", "descending");
  });

  it("inactive th has aria-sort='none'", () => {
    const onSort = vi.fn();
    renderBuildingTable({ buildings, sortBy: "created_at", sortDir: "desc", onSort });
    const nameBtn = screen.getByRole("button", { name: /Name/ });
    const th = nameBtn.closest("th");
    expect(th).toHaveAttribute("aria-sort", "none");
  });

  it("renders static headers when onSort is undefined (no sortable buttons)", () => {
    renderBuildingTable({ buildings });
    // Should NOT have sort buttons
    expect(screen.queryByRole("button", { name: /Name/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Manager Email/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Created At/ })).not.toBeInTheDocument();
  });

  // --- Pagination top + bottom ---

  it("does not show pagination controls when buildings fit on one page", () => {
    renderBuildingTable({ buildings });
    expect(screen.queryByRole("button", { name: "Previous page" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next page" })).not.toBeInTheDocument();
  });

  it("shows pagination controls at both top and bottom when there are more than 20 buildings", () => {
    const manyBuildings: Building[] = Array.from({ length: 21 }, (_, i) => ({
      id: `b${i + 1}`,
      name: `Building ${i + 1}`,
      manager_email: `mgr${i + 1}@example.com`,
      is_archived: false,
      created_at: "2024-01-01T00:00:00Z",
    }));
    renderBuildingTable({ buildings: manyBuildings });
    const prevButtons = screen.getAllByRole("button", { name: "Previous page" });
    const nextButtons = screen.getAllByRole("button", { name: "Next page" });
    expect(prevButtons).toHaveLength(2);
    expect(nextButtons).toHaveLength(2);
  });

  it("renders only the first 20 buildings on page 1 of a 21-item list", () => {
    const manyBuildings: Building[] = Array.from({ length: 21 }, (_, i) => ({
      id: `b${i + 1}`,
      name: `Building ${i + 1}`,
      manager_email: `mgr${i + 1}@example.com`,
      is_archived: false,
      created_at: "2024-01-01T00:00:00Z",
    }));
    renderBuildingTable({ buildings: manyBuildings });
    expect(screen.getByText("Building 1")).toBeInTheDocument();
    expect(screen.getByText("Building 20")).toBeInTheDocument();
    expect(screen.queryByText("Building 21")).not.toBeInTheDocument();
  });

  it("renders the 21st building when navigating to page 2", async () => {
    const user = userEvent.setup();
    const manyBuildings: Building[] = Array.from({ length: 21 }, (_, i) => ({
      id: `b${i + 1}`,
      name: `Building ${i + 1}`,
      manager_email: `mgr${i + 1}@example.com`,
      is_archived: false,
      created_at: "2024-01-01T00:00:00Z",
    }));
    renderBuildingTable({ buildings: manyBuildings });
    await user.click(screen.getAllByRole("button", { name: "Go to page 2" })[0]);
    expect(screen.getByText("Building 21")).toBeInTheDocument();
    expect(screen.queryByText("Building 1")).not.toBeInTheDocument();
  });

  it("safePage clamps to totalPages when page exceeds available pages after list shrinks", async () => {
    const user = userEvent.setup();
    const manyBuildings: Building[] = Array.from({ length: 21 }, (_, i) => ({
      id: `b${i + 1}`,
      name: `Building ${i + 1}`,
      manager_email: `mgr${i + 1}@example.com`,
      is_archived: false,
      created_at: "2024-01-01T00:00:00Z",
    }));
    const { rerender } = render(
      <MemoryRouter>
        <BuildingTable buildings={manyBuildings} />
      </MemoryRouter>
    );
    // Navigate to page 2
    await user.click(screen.getAllByRole("button", { name: "Go to page 2" })[0]);
    expect(screen.getByText("Building 21")).toBeInTheDocument();

    // Re-render with a shorter list — safePage should clamp to 1
    const fewBuildings = manyBuildings.slice(0, 5);
    rerender(
      <MemoryRouter>
        <BuildingTable buildings={fewBuildings} />
      </MemoryRouter>
    );
    expect(screen.getByText("Building 1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Go to page 2" })).not.toBeInTheDocument();
  });
});
