import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../../src/app/App";
import { AppProvider } from "../../src/app/AppContext";
import { createBrowserBackend } from "../../src/lib/backend/browserBackend";
import type { Backend } from "../../src/lib/backend";

function renderApp(backend: Backend = createBrowserBackend({ storage: null })) {
  render(
    <AppProvider backend={backend}>
      <App />
    </AppProvider>,
  );
  return backend;
}

describe("app without an API key", () => {
  it("launches and shows the free defaults", async () => {
    renderApp();
    expect(await screen.findByRole("heading", { name: "Projects" })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Main" });
    await waitFor(() => expect(within(nav).getByText("Mock (free)")).toBeInTheDocument());
    expect(within(nav).getByText("Demo data")).toBeInTheDocument();
    // Screens that need a project are disabled, not silently inert.
    expect(within(nav).getByRole("button", { name: /Board/ })).toBeDisabled();
  });

  it("runs the full free workflow with demo data clearly labeled and no paid calls", async () => {
    const user = userEvent.setup();
    const base = createBrowserBackend({ storage: null });
    const anthropicAnalyzeBrief = vi.fn(base.anthropicAnalyzeBrief);
    const anthropicAnalyzeImages = vi.fn(base.anthropicAnalyzeImages);
    renderApp({ ...base, anthropicAnalyzeBrief, anthropicAnalyzeImages });

    await user.type(await screen.findByLabelText("New project name"), "Winter fox");
    await user.click(screen.getByRole("button", { name: "Create project" }));
    await user.type(
      await screen.findByLabelText("Describe the artwork you want to create"),
      "A red fox in a snowy forest at dawn",
    );
    await user.click(screen.getByRole("button", { name: "Analyze brief" }));
    expect(await screen.findByDisplayValue("red fox")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Search references" }));
    expect(await screen.findByRole("heading", { name: "Results" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole("article").length).toBeGreaterThan(0), {
      timeout: 5000,
    });
    // Demo data is labeled in the header, a banner, and on every card.
    expect(screen.getAllByText("Demo data").length).toBeGreaterThan(0);
    expect(screen.getByText(/These results come from the mock provider/)).toBeInTheDocument();
    for (const card of screen.getAllByRole("article"))
      expect(within(card).getByText("Demo")).toBeInTheDocument();

    const first = screen.getAllByRole("article")[0]!;
    await user.click(within(first).getByRole("button", { name: "Add to board" }));
    await waitFor(() =>
      expect(within(first).getByRole("button", { name: "On board" })).toBeDisabled(),
    );

    expect(anthropicAnalyzeBrief).not.toHaveBeenCalled();
    expect(anthropicAnalyzeImages).not.toHaveBeenCalled();
  });
});

describe("settings and secrets", () => {
  it("never displays or keeps an API key in the UI and never logs it", async () => {
    const user = userEvent.setup();
    const base = createBrowserBackend({ storage: null });
    let stored = false;
    const backend: Backend = {
      ...base,
      kind: "desktop",
      setApiKey: vi.fn(async () => {
        stored = true;
      }),
      getAiStatus: async () => ({
        ...(await base.getAiStatus()),
        hasApiKey: stored,
        secureStorage: "Windows Credential Manager",
      }),
    };
    const logs = [
      vi.spyOn(console, "log"),
      vi.spyOn(console, "warn"),
      vi.spyOn(console, "error"),
      vi.spyOn(console, "info"),
    ];
    renderApp(backend);
    await user.click(await screen.findByRole("button", { name: /Settings/ }));
    const input = await screen.findByLabelText("API key");
    expect(input).toHaveAttribute("type", "password");
    await user.type(input, "sk-ant-TOPSECRET-123");
    await user.click(screen.getByRole("button", { name: "Save key" }));
    await waitFor(() => expect(backend.setApiKey).toHaveBeenCalledWith("sk-ant-TOPSECRET-123"));
    await waitFor(() => expect(input).toHaveValue(""));
    expect(document.body.innerHTML).not.toContain("TOPSECRET");
    await waitFor(() =>
      expect(screen.getByText("Key stored:").parentElement).toHaveTextContent("yes"),
    );
    for (const spy of logs) {
      for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain("TOPSECRET");
      spy.mockRestore();
    }
  });

  it("explains that local limits are not a provider billing cap", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByRole("button", { name: /Settings/ }));
    expect(
      await screen.findByText(/Anthropic API \(usage billed separately\)/),
    ).toBeInTheDocument();
    expect(screen.getByText(/separately from Claude Pro\/Max subscriptions/)).toBeInTheDocument();
    expect(
      screen
        .getAllByText(/not/i)
        .some((el) => /billing cap/.test(el.parentElement?.textContent ?? "")),
    ).toBe(true);
    expect(screen.getByLabelText("Maximum images per analysis batch")).toHaveValue(3);
    expect(screen.getByRole("checkbox", { name: /Disable paid AI/ })).toBeInTheDocument();
  });
});
