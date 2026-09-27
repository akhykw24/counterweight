import { defineConfig } from "@playwright/test";

/**
 * Pre-pilot validation for v3 (brief, step 6). Twenty complete sessions and
 * the failure scenarios take a while, so this is its own run, not part of the
 * ordinary end-to-end suite.
 *
 *     pnpm validate:v3          # drives a real browser
 *     pnpm validate:v3:render   # writes docs/PILOT_V3_VALIDATION.md
 */
export default defineConfig({
  testDir: "./validation-v3",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 45 * 60 * 1000,
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium" }],
  webServer: {
    // The default build is v3.
    command: "pnpm --dir apps/study dev --port 5173 --strictPort",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env["CI"],
    timeout: 120_000,
  },
});
