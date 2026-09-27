import { defineConfig } from "@playwright/test";

/** The deployed site, walked as a test participant (brief, step 8). */
export default defineConfig({
  testDir: "./walkthrough-v3",
  workers: 1,
  retries: 0,
  reporter: "list",
  use: { baseURL: process.env["STUDY_URL"] ?? "https://counterweight-pearl.vercel.app" },
  projects: [{ name: "chromium" }],
});
