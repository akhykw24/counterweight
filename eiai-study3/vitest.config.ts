import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@eiai/schema": pkg("schema"),
      "@eiai/fsm": pkg("fsm"),
      "@eiai/stimuli": pkg("stimuli"),
      "@eiai/telemetry": pkg("telemetry"),
      "@eiai/ingest": fileURLToPath(
        new URL("./services/ingest/src/handler.ts", import.meta.url),
      ),
    },
  },
  test: {
    // App tests opt into jsdom with a per-file docblock; everything else stays
    // on node, which is faster and catches accidental DOM dependencies.
    // `.ts` as well as `.tsx` under apps/. The pattern used to be .tsx only,
    // which silently excluded apps/study/test/allocation.test.ts entirely: the
    // file existed, was maintained, and never ran. A test that does not run is
    // indistinguishable from one that passes, so the glob is now the same shape
    // everywhere and packages/schema/test/test-discovery.test.ts asserts that
    // every test file on disk is actually collected.
    include: [
      "packages/*/test/**/*.test.ts",
      "services/*/test/**/*.test.ts",
      "apps/*/test/**/*.test.{ts,tsx}",
    ],
    environment: "node",
  },
});
