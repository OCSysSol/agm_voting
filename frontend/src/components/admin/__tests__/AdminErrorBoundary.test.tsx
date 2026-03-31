import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AdminErrorBoundary from "../AdminErrorBoundary";

// Suppress expected console.error output from ErrorBoundary
beforeAll(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterAll(() => {
  vi.restoreAllMocks();
});

function ThrowingChild({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error("Simulated render error");
  }
  return <div>Normal content</div>;
}

describe("AdminErrorBoundary", () => {
  // RR3-26: renders fallback UI when child throws
  it("renders fallback UI when a child component throws", () => {
    render(
      <AdminErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </AdminErrorBoundary>
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reload page/i })).toBeInTheDocument();
  });

  it("renders children normally when no error occurs", () => {
    render(
      <AdminErrorBoundary>
        <ThrowingChild shouldThrow={false} />
      </AdminErrorBoundary>
    );
    expect(screen.getByText("Normal content")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reload button calls window.location.reload", async () => {
    const user = userEvent.setup();
    const reloadSpy = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload: reloadSpy },
    });

    render(
      <AdminErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </AdminErrorBoundary>
    );

    await user.click(screen.getByRole("button", { name: /Reload page/i }));
    expect(reloadSpy).toHaveBeenCalledOnce();
  });
});
