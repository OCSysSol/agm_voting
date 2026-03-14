import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "../../../../tests/msw/server";
import { AuthPage } from "../AuthPage";
import { AGM_ID } from "../../../../tests/msw/handlers";

const BASE = "http://localhost:8000";

// Navigation spy placeholder
const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

function renderPage(meetingId = AGM_ID) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/vote/${meetingId}/auth`]}>
        <Routes>
          <Route path="/vote/:meetingId/auth" element={<AuthPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

async function fillAndSubmit(lotNumber: string, email: string) {
  const user = userEvent.setup();
  await waitFor(() => screen.getByLabelText("Lot number"));
  await user.type(screen.getByLabelText("Lot number"), lotNumber);
  await user.type(screen.getByLabelText("Email address"), email);
  // Continue is always enabled immediately — no loading gate
  await user.click(screen.getByRole("button", { name: "Continue" }));
}

describe("AuthPage", () => {
  it("renders 'Verify your identity' heading immediately", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "Verify your identity" })).toBeInTheDocument();
  });

  it("Continue button is enabled immediately on render", () => {
    renderPage();
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  });

  it("navigates to voting page on success (not already submitted)", async () => {
    mockNavigate.mockClear();
    renderPage();
    await fillAndSubmit("42", "owner@example.com");
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(`/vote/${AGM_ID}/voting`);
    });
  });

  it("stores building_name and meeting_title in sessionStorage on success", async () => {
    mockNavigate.mockClear();
    renderPage();
    await fillAndSubmit("42", "owner@example.com");
    await waitFor(() => {
      expect(sessionStorage.getItem(`meeting_building_name_${AGM_ID}`)).toBe("Sunset Towers");
      expect(sessionStorage.getItem(`meeting_title_${AGM_ID}`)).toBe("2024 AGM");
    });
  });

  it("navigates to confirmation when all lots already_submitted=true", async () => {
    server.use(
      http.post(`${BASE}/api/auth/verify`, () =>
        HttpResponse.json({
          lots: [{ lot_owner_id: "lo1", lot_number: "42", financial_position: "normal", already_submitted: true, is_proxy: false }],
          voter_email: "owner@example.com",
          agm_status: "open",
          building_name: "Sunset Towers",
          meeting_title: "2024 AGM",
        })
      )
    );
    mockNavigate.mockClear();
    renderPage();
    await fillAndSubmit("42", "owner@example.com");
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(`/vote/${AGM_ID}/confirmation`);
    });
  });

  it("navigates to confirmation when agm_status=closed (submission view)", async () => {
    server.use(
      http.post(`${BASE}/api/auth/verify`, () =>
        HttpResponse.json({
          lots: [{ lot_owner_id: "lo1", lot_number: "42", financial_position: "normal", already_submitted: false, is_proxy: false }],
          voter_email: "owner@example.com",
          agm_status: "closed",
          building_name: "Sunset Towers",
          meeting_title: "2024 AGM",
        })
      )
    );
    mockNavigate.mockClear();
    renderPage(AGM_ID);

    await fillAndSubmit("42", "owner@example.com");
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(`/vote/${AGM_ID}/confirmation`);
    });
  });

  it("shows 401 error message", async () => {
    server.use(
      http.post(`${BASE}/api/auth/verify`, () =>
        HttpResponse.json({ detail: "not found" }, { status: 401 })
      )
    );
    renderPage();
    await fillAndSubmit("99", "wrong@example.com");
    await waitFor(() => {
      expect(
        screen.getByText("Lot number and email address do not match our records")
      ).toBeInTheDocument();
    });
  });

  it("shows loading state while verifying", async () => {
    let resolve!: () => void;
    server.use(
      http.post(`${BASE}/api/auth/verify`, () =>
        new Promise<Response>((res) => {
          resolve = () =>
            res(HttpResponse.json({ lots: [{ lot_owner_id: "lo1", lot_number: "1", financial_position: "normal", already_submitted: false, is_proxy: false }], voter_email: "x@y.com", agm_status: "open", building_name: "B", meeting_title: "T" }) as Response);
        })
      )
    );
    renderPage();
    const user = userEvent.setup();
    await waitFor(() => screen.getByLabelText("Lot number"));
    await user.type(screen.getByLabelText("Lot number"), "1");
    await user.type(screen.getByLabelText("Email address"), "a@b.com");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Verifying..." })).toBeDisabled();
    });
    resolve();
  });

  it("shows empty lot number validation error", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByLabelText("Email address"));
    await user.type(screen.getByLabelText("Email address"), "a@b.com");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("Lot number is required")).toBeInTheDocument();
  });

  it("shows empty email validation error", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByLabelText("Lot number"));
    await user.type(screen.getByLabelText("Lot number"), "42");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("Email address is required")).toBeInTheDocument();
  });

  it("navigates to / with pendingMessage state when agm_status=pending", async () => {
    server.use(
      http.post(`${BASE}/api/auth/verify`, () =>
        HttpResponse.json({
          lots: [{ lot_owner_id: "lo1", lot_number: "42", financial_position: "normal", already_submitted: false, is_proxy: false }],
          voter_email: "owner@example.com",
          agm_status: "pending",
          building_name: "Sunset Towers",
          meeting_title: "2024 AGM",
        })
      )
    );
    mockNavigate.mockClear();
    renderPage();
    await fillAndSubmit("42", "owner@example.com");
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/", {
        state: { pendingMessage: "This meeting has not started yet. Please check back later." },
      });
    });
  });

  it("shows generic error for unexpected failure", async () => {
    server.use(
      http.post(`${BASE}/api/auth/verify`, () => HttpResponse.error())
    );
    renderPage();
    await fillAndSubmit("42", "owner@example.com");
    await waitFor(() => {
      expect(screen.getByText("An error occurred. Please try again.")).toBeInTheDocument();
    });
  });

  it("renders back button", () => {
    renderPage();
    expect(screen.getByRole("button", { name: "← Back" })).toBeInTheDocument();
  });

  it("back button navigates to home", async () => {
    const user = userEvent.setup();
    mockNavigate.mockClear();
    renderPage();
    await waitFor(() => screen.getByLabelText("Lot number"));
    await user.click(screen.getByRole("button", { name: "← Back" }));
    expect(mockNavigate).toHaveBeenCalledWith("/");
  });
});
