import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end configuration (STUDY3_SPEC_v3.md section 10, day 5).
 *
 * Runs against a real dev server and a real browser, which is the point: the
 * vitest suites drive React in jsdom, where IndexedDB is faked and layout does
 * not exist. Only this catches a stimulus that fails to bundle, a scroll box
 * with no extent, or a WAL that will not open.
 *
 * Day 6 adds the simulation bots (section 7) to this same project.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  workers: 1,
  reporter: process.env["CI"] ? "line" : "list",

  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    // A dropped session is the failure mode that matters here, so keep the
    // artefacts that let you see one.
    video: "retain-on-failure",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: {
    command: "pnpm --dir apps/study dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env["CI"],
    timeout: 120_000,
  },
});
