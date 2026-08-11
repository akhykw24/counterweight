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
    },
  },
  test: {
    // App tests opt into jsdom with a per-file docblock; everything else stays
    // on node, which is faster and catches accidental DOM dependencies.
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.tsx"],
    environment: "node",
  },
});
