import { defineConfig, devices } from "@playwright/test";

/**
 * Pre-pilot validation, kept out of the ordinary end-to-end run.
 *
 * Thirty full sessions plus six failure scenarios take around twenty minutes.
 * That is the right cost before letting people near the study and the wrong
 * cost on every commit, so it lives in its own directory with its own config
 * rather than behind an environment variable -- a flag that has to be
 * remembered is a flag that gets forgotten in both directions.
 *
 *     pnpm validate:pilot
 */
export default defineConfig({
  testDir: "./validation",
  fullyParallel: false,
  workers: 1,
  // No retries on purpose. A delivery check that passes on the second attempt
  // has told you the opposite of what it was asked.
  retries: 0,
  reporter: "list",
  timeout: 20 * 60 * 1000,

  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
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
