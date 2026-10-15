import { defineConfig } from "@playwright/test";

// End-to-end tests run against the Vite dev server in a real browser. In a plain
// browser the app uses its browser backend (localStorage persistence, mock AI,
// mock search), so the full workflow can be tested without Rust or API keys.
// Uses the Microsoft Edge that ships with Windows (no browser download needed).
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  use: {
    baseURL: "http://localhost:1420",
    channel: process.env.PLAYWRIGHT_CHANNEL ?? "msedge",
    headless: true,
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:1420",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
