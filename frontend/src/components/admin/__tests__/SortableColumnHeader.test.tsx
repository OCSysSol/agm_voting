import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SortableColumnHeader from "../SortableColumnHeader";
import type { SortState } from "../SortableColumnHeader";

function renderHeader(props: {
  label: string;
  column: string;
  currentSort: SortState | null;
  onSort: (col: string) => void;
}) {
  return render(
    <table>
      <thead>
        <tr>
          <SortableColumnHeader {...props} />
        </tr>
      </thead>
    </table>
  );
}

describe("SortableColumnHeader", () => {
  // --- Happy path ---

  it("renders a <th> with a button containing the label", () => {
    const onSort = vi.fn();
    renderHeader({ label: "Name", column: "name", currentSort: null, onSort });
    expect(screen.getByRole("columnheader")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Name/ })).toBeInTheDocument();
  });

  it("renders the neutral ⇅ indicator when column is not active", () => {
    const onSort = vi.fn();
    renderHeader({ label: "Name", column: "name", currentSort: null, onSort });
    expect(screen.getByText("⇅")).toBeInTheDocument();
  });

  it("renders ▲ indicator when column is active and direction is asc", () => {
    const onSort = vi.fn();
    const currentSort: SortState = { column: "name", dir: "asc" };
    renderHeader({ label: "Name", column: "name", currentSort, onSort });
    expect(screen.getByText("▲")).toBeInTheDocument();
    expect(screen.queryByText("⇅")).not.toBeInTheDocument();
  });

  it("renders ▼ indicator when column is active and direction is desc", () => {
    const onSort = vi.fn();
    const currentSort: SortState = { column: "name", dir: "desc" };
    renderHeader({ label: "Name", column: "name", currentSort, onSort });
    expect(screen.getByText("▼")).toBeInTheDocument();
    expect(screen.queryByText("⇅")).not.toBeInTheDocument();
  });

  it("renders ⇅ indicator when a different column is active", () => {
    const onSort = vi.fn();
    const currentSort: SortState = { column: "created_at", dir: "desc" };
    renderHeader({ label: "Name", column: "name", currentSort, onSort });
    expect(screen.getByText("⇅")).toBeInTheDocument();
    expect(screen.queryByText("▼")).not.toBeInTheDocument();
  });

  // --- ARIA attributes ---

  it("sets aria-sort='none' on the th when the column is not active", () => {
    const onSort = vi.fn();
    renderHeader({ label: "Name", column: "name", currentSort: null, onSort });
    expect(screen.getByRole("columnheader")).toHaveAttribute("aria-sort", "none");
  });

  it("sets aria-sort='ascending' when column is active and dir is asc", () => {
    const onSort = vi.fn();
    const currentSort: SortState = { column: "name", dir: "asc" };
    renderHeader({ label: "Name", column: "name", currentSort, onSort });
    expect(screen.getByRole("columnheader")).toHaveAttribute("aria-sort", "ascending");
  });

  it("sets aria-sort='descending' when column is active and dir is desc", () => {
    const onSort = vi.fn();
    const currentSort: SortState = { column: "name", dir: "desc" };
    renderHeader({ label: "Name", column: "name", currentSort, onSort });
    expect(screen.getByRole("columnheader")).toHaveAttribute("aria-sort", "descending");
  });

  it("sets aria-sort='none' when a different column is active", () => {
    const onSort = vi.fn();
    const currentSort: SortState = { column: "other", dir: "asc" };
    renderHeader({ label: "Name", column: "name", currentSort, onSort });
    expect(screen.getByRole("columnheader")).toHaveAttribute("aria-sort", "none");
  });

  // --- User interaction ---

  it("calls onSort with the column name when button is clicked", async () => {
    const user = userEvent.setup();
    const onSort = vi.fn();
    renderHeader({ label: "Name", column: "name", currentSort: null, onSort });
    await user.click(screen.getByRole("button", { name: /Name/ }));
    expect(onSort).toHaveBeenCalledWith("name");
  });

  it("button has type='button' to prevent form submission", () => {
    const onSort = vi.fn();
    renderHeader({ label: "Name", column: "name", currentSort: null, onSort });
    expect(screen.getByRole("button", { name: /Name/ })).toHaveAttribute("type", "button");
  });

  it("button has the admin-table__sort-btn class", () => {
    const onSort = vi.fn();
    renderHeader({ label: "Name", column: "name", currentSort: null, onSort });
    expect(screen.getByRole("button", { name: /Name/ })).toHaveClass("admin-table__sort-btn");
  });

  // --- Edge cases ---

  it("renders correctly with a null currentSort and still shows the label", () => {
    const onSort = vi.fn();
    renderHeader({ label: "Created At", column: "created_at", currentSort: null, onSort });
    expect(screen.getByText("Created At")).toBeInTheDocument();
  });

  it("active indicator span has sort-indicator--active class for active ascending", () => {
    const onSort = vi.fn();
    const currentSort: SortState = { column: "name", dir: "asc" };
    renderHeader({ label: "Name", column: "name", currentSort, onSort });
    const indicator = screen.getByText("▲");
    expect(indicator).toHaveClass("sort-indicator--active");
  });

  it("inactive indicator span does NOT have sort-indicator--active class", () => {
    const onSort = vi.fn();
    renderHeader({ label: "Name", column: "name", currentSort: null, onSort });
    const indicator = screen.getByText("⇅");
    expect(indicator).toHaveClass("sort-indicator");
    expect(indicator).not.toHaveClass("sort-indicator--active");
  });
});
