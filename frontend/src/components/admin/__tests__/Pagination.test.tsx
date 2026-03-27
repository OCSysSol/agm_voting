import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Pagination from "../Pagination";

describe("Pagination", () => {
  it("returns null when totalPages is 1", () => {
    const { container } = render(
      <Pagination page={1} totalPages={1} totalItems={5} pageSize={10} onPageChange={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("returns null when totalPages is 0", () => {
    const { container } = render(
      <Pagination page={1} totalPages={0} totalItems={0} pageSize={10} onPageChange={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows page range info on page 1", () => {
    render(
      <Pagination page={1} totalPages={3} totalItems={25} pageSize={10} onPageChange={vi.fn()} />
    );
    expect(screen.getByText("1–10 of 25")).toBeInTheDocument();
  });

  it("shows correct range on page 2", () => {
    render(
      <Pagination page={2} totalPages={3} totalItems={25} pageSize={10} onPageChange={vi.fn()} />
    );
    expect(screen.getByText("11–20 of 25")).toBeInTheDocument();
  });

  it("caps end at totalItems on last page", () => {
    render(
      <Pagination page={3} totalPages={3} totalItems={25} pageSize={10} onPageChange={vi.fn()} />
    );
    expect(screen.getByText("21–25 of 25")).toBeInTheDocument();
  });

  it("disables Previous button on page 1", () => {
    render(
      <Pagination page={1} totalPages={3} totalItems={25} pageSize={10} onPageChange={vi.fn()} />
    );
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
  });

  it("disables Next button on last page", () => {
    render(
      <Pagination page={3} totalPages={3} totalItems={25} pageSize={10} onPageChange={vi.fn()} />
    );
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  });

  it("calls onPageChange with page - 1 when Previous clicked", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(
      <Pagination page={2} totalPages={3} totalItems={25} pageSize={10} onPageChange={onPageChange} />
    );
    await user.click(screen.getByRole("button", { name: "Previous page" }));
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it("calls onPageChange with page + 1 when Next clicked", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(
      <Pagination page={2} totalPages={3} totalItems={25} pageSize={10} onPageChange={onPageChange} />
    );
    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(onPageChange).toHaveBeenCalledWith(3);
  });

  it("calls onPageChange when a page number button is clicked", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(
      <Pagination page={1} totalPages={3} totalItems={25} pageSize={10} onPageChange={onPageChange} />
    );
    await user.click(screen.getByRole("button", { name: "Go to page 2" }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it("marks current page button with aria-current=page", () => {
    render(
      <Pagination page={2} totalPages={3} totalItems={25} pageSize={10} onPageChange={vi.fn()} />
    );
    expect(screen.getByRole("button", { name: "Go to page 2" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Go to page 1" })).not.toHaveAttribute("aria-current");
  });

  it("shows ellipsis for non-adjacent pages", () => {
    render(
      <Pagination page={1} totalPages={10} totalItems={100} pageSize={10} onPageChange={vi.fn()} />
    );
    expect(screen.getByText("…")).toBeInTheDocument();
  });

  // --- RR2-05: ARIA attributes ---

  it("renders nav wrapper with aria-label=Pagination", () => {
    render(
      <Pagination page={1} totalPages={3} totalItems={25} pageSize={10} onPageChange={vi.fn()} />
    );
    expect(screen.getByRole("navigation", { name: "Pagination" })).toBeInTheDocument();
  });

  it("renders results count span with aria-live=polite", () => {
    render(
      <Pagination page={1} totalPages={3} totalItems={25} pageSize={10} onPageChange={vi.fn()} />
    );
    const info = screen.getByText("1–10 of 25");
    expect(info).toHaveAttribute("aria-live", "polite");
  });

  it("each numbered page button has aria-label=Go to page N", () => {
    render(
      <Pagination page={1} totalPages={3} totalItems={25} pageSize={10} onPageChange={vi.fn()} />
    );
    expect(screen.getByRole("button", { name: "Go to page 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go to page 2" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go to page 3" })).toBeInTheDocument();
  });

  it("Previous button has aria-disabled=true on page 1", () => {
    render(
      <Pagination page={1} totalPages={3} totalItems={25} pageSize={10} onPageChange={vi.fn()} />
    );
    expect(screen.getByRole("button", { name: "Previous page" })).toHaveAttribute("aria-disabled", "true");
  });

  it("Next button has aria-disabled=true on last page", () => {
    render(
      <Pagination page={3} totalPages={3} totalItems={25} pageSize={10} onPageChange={vi.fn()} />
    );
    expect(screen.getByRole("button", { name: "Next page" })).toHaveAttribute("aria-disabled", "true");
  });

  // --- RR2-07: isLoading disables controls ---

  it("disables all page buttons when isLoading=true", () => {
    render(
      <Pagination page={2} totalPages={3} totalItems={25} pageSize={10} onPageChange={vi.fn()} isLoading={true} />
    );
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Go to page 1" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Go to page 2" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Go to page 3" })).toBeDisabled();
  });

  it("does not disable buttons when isLoading=false (default)", () => {
    render(
      <Pagination page={2} totalPages={3} totalItems={25} pageSize={10} onPageChange={vi.fn()} />
    );
    expect(screen.getByRole("button", { name: "Previous page" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Next page" })).not.toBeDisabled();
  });

  it("Previous/Next buttons have aria-disabled=true when isLoading=true", () => {
    render(
      <Pagination page={2} totalPages={3} totalItems={25} pageSize={10} onPageChange={vi.fn()} isLoading={true} />
    );
    expect(screen.getByRole("button", { name: "Previous page" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Next page" })).toHaveAttribute("aria-disabled", "true");
  });
});
