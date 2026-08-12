import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@eiai/schema": fileURLToPath(new URL("../../packages/schema/src/index.ts", import.meta.url)),
      "@eiai/fsm": fileURLToPath(new URL("../../packages/fsm/src/index.ts", import.meta.url)),
      "@eiai/telemetry": fileURLToPath(
        new URL("../../packages/telemetry/src/index.ts", import.meta.url),
      ),
    },
  },
  css: {
    // Empty inline config, so Vite does NOT walk up the tree looking for one.
    // This app is nested inside the counterweight repo, whose root
    // postcss.config.js + tailwind.config.ts would otherwise be applied to the
    // study's stylesheet -- a different project's build leaking into an
    // experiment's participant-facing UI.
    postcss: {},
  },
  server: {
    port: 5173,
    // materials/ lives above the app root; the stimulus JSON is imported from there.
    fs: { allow: [fileURLToPath(new URL("../../", import.meta.url))] },
  },
});
