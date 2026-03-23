import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "../../../../tests/msw/server";
import SettingsPage from "../SettingsPage";
import { resetConfigFixture } from "../../../../tests/msw/handlers";
import * as configApi from "../../../api/config";
import { vi } from "vitest";

const BASE = "http://localhost:8000";

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("SettingsPage", () => {
  beforeEach(() => {
    resetConfigFixture();
  });

  // --- Happy path ---

  it("shows loading state while fetching config", () => {
    renderPage();
    expect(screen.getByText("Loading settings…")).toBeInTheDocument();
  });

  it("renders form fields after config loads", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByLabelText("App name")).toBeInTheDocument());
    expect(screen.getByLabelText("Logo URL")).toBeInTheDocument();
    expect(screen.getByLabelText("Primary colour")).toBeInTheDocument();
    expect(screen.getByLabelText("Support email")).toBeInTheDocument();
  });

  it("populates form with loaded config values", async () => {
    server.use(
      http.get(`${BASE}/api/admin/config`, () =>
        HttpResponse.json({ app_name: "Test Corp", logo_url: "https://example.com/logo.png", primary_colour: "#123456", support_email: "help@test.com" })
      )
    );
    renderPage();
    await waitFor(() => expect(screen.getByLabelText("App name")).toHaveValue("Test Corp"));
    expect(screen.getByLabelText("Logo URL")).toHaveValue("https://example.com/logo.png");
    expect(screen.getByLabelText("Support email")).toHaveValue("help@test.com");
  });

  it("shows page heading", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument());
  });

  it("shows Save button after loading", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument());
  });

  it("saves settings and shows success message", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByLabelText("App name")).toBeInTheDocument());

    await user.clear(screen.getByLabelText("App name"));
    await user.type(screen.getByLabelText("App name"), "New Corp AGM");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByText("Settings saved.")).toBeInTheDocument());
  });

  it("updates public-config query cache immediately on save without waiting for refetch", async () => {
    const user = userEvent.setup();
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <SettingsPage />
        </MemoryRouter>
      </QueryClientProvider>
    );
    await waitFor(() => expect(screen.getByLabelText("App name")).toBeInTheDocument());

    await user.clear(screen.getByLabelText("App name"));
    await user.type(screen.getByLabelText("App name"), "Instant Brand");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByText("Settings saved.")).toBeInTheDocument());

    // The cache should be updated immediately with the saved values
    const cached = qc.getQueryData<{ app_name: string }>(["public-config"]);
    expect(cached?.app_name).toBe("Instant Brand");
  });

  it("disables Save button while saving", async () => {
    const user = userEvent.setup();
    // Slow the response so we can observe the disabled state
    server.use(
      http.put(`${BASE}/api/admin/config`, async () => {
        await new Promise((r) => setTimeout(r, 50));
        return HttpResponse.json({ app_name: "Test", logo_url: "", primary_colour: "#005f73", support_email: "" });
      })
    );
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled());
  });

  it("success message disappears after 3 seconds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    renderPage();
    await waitFor(() => expect(screen.getByLabelText("App name")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByText("Settings saved.")).toBeInTheDocument());
    act(() => vi.advanceTimersByTime(3100));
    await waitFor(() => expect(screen.queryByText("Settings saved.")).not.toBeInTheDocument());
    vi.useRealTimers();
  });

  // --- Error states ---

  it("shows error when config load fails", async () => {
    server.use(
      http.get(`${BASE}/api/admin/config`, () =>
        HttpResponse.json({ detail: "Internal error" }, { status: 500 })
      )
    );
    renderPage();
    await waitFor(() =>
      expect(screen.queryByText("Loading settings…")).not.toBeInTheDocument()
    );
    expect(screen.getByText("Failed to load settings.")).toBeInTheDocument();
  });

  it("shows error message when save fails with HTTP error", async () => {
    server.use(
      http.put(`${BASE}/api/admin/config`, () =>
        HttpResponse.json({ detail: "Validation error" }, { status: 422 })
      )
    );
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument());
    await userEvent.setup().click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByText(/HTTP 422/)).toBeInTheDocument());
  });

  it("shows fallback error message when save throws non-Error value", async () => {
    // Cover the `false` branch of `err instanceof Error ? err.message : "Failed to save settings."`
    vi.spyOn(configApi, "updateAdminConfig").mockRejectedValueOnce("plain string error");
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument());
    await userEvent.setup().click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByText("Failed to save settings.")).toBeInTheDocument());
  });

  // --- Input interactions ---

  it("updates app name field on user input", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByLabelText("App name")).toBeInTheDocument());
    await user.clear(screen.getByLabelText("App name"));
    await user.type(screen.getByLabelText("App name"), "Changed Name");
    expect(screen.getByLabelText("App name")).toHaveValue("Changed Name");
  });

  it("updates logo URL field on user input", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByLabelText("Logo URL")).toBeInTheDocument());
    await user.type(screen.getByLabelText("Logo URL"), "https://cdn.example.com/logo.png");
    expect(screen.getByLabelText("Logo URL")).toHaveValue("https://cdn.example.com/logo.png");
  });

  it("updates primary colour text field on user input", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByLabelText("Primary colour")).toBeInTheDocument());
    await user.clear(screen.getByLabelText("Primary colour"));
    await user.type(screen.getByLabelText("Primary colour"), "#abcdef");
    expect(screen.getByLabelText("Primary colour")).toHaveValue("#abcdef");
  });

  it("updates support email field on user input", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByLabelText("Support email")).toBeInTheDocument());
    await user.type(screen.getByLabelText("Support email"), "support@test.com");
    expect(screen.getByLabelText("Support email")).toHaveValue("support@test.com");
  });

  it("colour picker input syncs with text input state", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByLabelText("Primary colour picker")).toBeInTheDocument());
    // The colour picker and text input share state — both start with the loaded value
    const textInput = screen.getByLabelText("Primary colour");
    expect(textInput).toHaveValue("#005f73");
    await user.clear(textInput);
    await user.type(textInput, "#ff0000");
    expect(screen.getByLabelText("Primary colour picker")).toHaveValue("#ff0000");
  });

  it("colour picker change updates text input", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByLabelText("Primary colour picker")).toBeInTheDocument());
    const picker = screen.getByLabelText("Primary colour picker");
    // type="color" inputs are not keyboard-editable; use fireEvent.change to simulate picker selection
    fireEvent.change(picker, { target: { value: "#123456" } });
    expect(screen.getByLabelText("Primary colour")).toHaveValue("#123456");
  });

  // --- Logo file upload ---

  it("renders the Upload logo image file input", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByLabelText("Upload logo image")).toBeInTheDocument());
  });

  it("uploading a valid file populates the logo URL field with the returned URL", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByLabelText("Upload logo image")).toBeInTheDocument());

    const blobUrl = "https://public.blob.vercel-storage.com/logo-test.png";
    const file = new File(["fake-png"], "logo.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("Upload logo image"), file);

    await waitFor(() =>
      expect(screen.getByLabelText("Logo URL")).toHaveValue(blobUrl)
    );
  });

  it("shows Uploading message during upload then hides it on success", async () => {
    const user = userEvent.setup();
    // Delay the upload response so we can observe the Uploading state
    server.use(
      http.post("http://localhost:8000/api/admin/config/logo", async () => {
        await new Promise((r) => setTimeout(r, 50));
        return HttpResponse.json({ url: "https://public.blob.vercel-storage.com/logo.png" });
      })
    );
    renderPage();
    await waitFor(() => expect(screen.getByLabelText("Upload logo image")).toBeInTheDocument());

    const file = new File(["fake"], "logo.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("Upload logo image"), file);

    // "Uploading…" appears while in flight
    expect(screen.getByText("Uploading…")).toBeInTheDocument();

    // After the response, "Uploading…" disappears
    await waitFor(() =>
      expect(screen.queryByText("Uploading…")).not.toBeInTheDocument()
    );
  });

  it("disables file input during upload", async () => {
    const user = userEvent.setup();
    server.use(
      http.post("http://localhost:8000/api/admin/config/logo", async () => {
        await new Promise((r) => setTimeout(r, 50));
        return HttpResponse.json({ url: "https://public.blob.vercel-storage.com/logo.png" });
      })
    );
    renderPage();
    await waitFor(() => expect(screen.getByLabelText("Upload logo image")).toBeInTheDocument());

    const file = new File(["fake"], "logo.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("Upload logo image"), file);

    expect(screen.getByLabelText("Upload logo image")).toBeDisabled();
    await waitFor(() =>
      expect(screen.getByLabelText("Upload logo image")).not.toBeDisabled()
    );
  });

  it("shows upload error when server returns an error", async () => {
    const user = userEvent.setup();
    server.use(
      http.post("http://localhost:8000/api/admin/config/logo", () =>
        HttpResponse.json({ detail: "Logo upload failed" }, { status: 502 })
      )
    );
    renderPage();
    await waitFor(() => expect(screen.getByLabelText("Upload logo image")).toBeInTheDocument());

    const file = new File(["fake"], "logo.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("Upload logo image"), file);

    await waitFor(() =>
      expect(screen.getByText(/HTTP 502/)).toBeInTheDocument()
    );
  });

  it("shows fallback upload error for non-Error thrown value", async () => {
    vi.spyOn(configApi, "uploadLogo").mockRejectedValueOnce("plain string error");
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByLabelText("Upload logo image")).toBeInTheDocument());

    const file = new File(["fake"], "logo.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("Upload logo image"), file);

    await waitFor(() =>
      expect(screen.getByText("Failed to upload logo.")).toBeInTheDocument()
    );
  });

  it("no-ops when file input changes with no file selected", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByLabelText("Upload logo image")).toBeInTheDocument());

    // Fire change event with an empty file list
    fireEvent.change(screen.getByLabelText("Upload logo image"), { target: { files: [] } });

    // No uploading state, no error
    expect(screen.queryByText("Uploading…")).not.toBeInTheDocument();
  });
});
