import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { enumRegistry, schemaRegistry } from "@eiai/schema";
import { buildDataDictionary, dictionaryMatches } from "../src/data-dictionary.js";

const DICTIONARY_PATH = fileURLToPath(
  new URL("../../../docs/DATA_DICTIONARY.md", import.meta.url),
);

describe("data dictionary", () => {
  it("has been generated", () => {
    expect(
      existsSync(DICTIONARY_PATH),
      "docs/DATA_DICTIONARY.md is missing. Run `pnpm codegen`.",
    ).toBe(true);
  });

  it("is up to date with the schemas", () => {
    // The same gate CI runs. If this fails, the schemas changed and the
    // dictionary was not regenerated -- the exact drift the codegen exists to
    // make impossible.
    const committed = readFileSync(DICTIONARY_PATH, "utf8");
    expect(
      dictionaryMatches(committed),
      "docs/DATA_DICTIONARY.md is stale. Run `pnpm codegen` and commit the result.",
    ).toBe(true);
  });

  it("builds deterministically, so the drift gate is meaningful", () => {
    // A timestamp or any other environment-dependent content in the output
    // would make codegen:check fail on every run and train everyone to ignore it.
    expect(buildDataDictionary()).toBe(buildDataDictionary());
  });

  it("documents every registered schema", () => {
    const content = readFileSync(DICTIONARY_PATH, "utf8");
    for (const section of schemaRegistry) {
      for (const entry of section.entries) {
        expect(content, `missing ${entry.name}`).toContain(`\`${entry.name}\``);
      }
    }
  });

  it("documents every enumeration and its values", () => {
    const content = readFileSync(DICTIONARY_PATH, "utf8");
    for (const entry of enumRegistry) {
      expect(content, `missing enum ${entry.name}`).toContain(`\`${entry.name}\``);
      const json = z.toJSONSchema(entry.schema, { io: "input" }) as { enum?: unknown[] };
      for (const value of json.enum ?? []) {
        expect(content, `missing value ${String(value)} of ${entry.name}`).toContain(
          `\`${String(value)}\``,
        );
      }
    }
  });

  it("carries the do-not-edit banner, since it is a build artifact", () => {
    const content = readFileSync(DICTIONARY_PATH, "utf8");
    expect(content).toContain("do not edit by hand");
  });
});
