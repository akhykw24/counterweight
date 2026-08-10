/**
 * CLI over the pure builder in src/data-dictionary.ts.
 *
 *   pnpm codegen         write docs/DATA_DICTIONARY.md
 *   pnpm codegen:check   fail if the committed file is stale (CI gate)
 *
 * All filesystem access lives here; the builder itself is pure so it can be
 * tested without spawning a process.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildDataDictionary, dictionaryMatches } from "../src/data-dictionary.js";

const OUTPUT_PATH = fileURLToPath(
  new URL("../../../docs/DATA_DICTIONARY.md", import.meta.url),
);

function main(): number {
  const content = buildDataDictionary();

  if (process.argv.includes("--check")) {
    let existing: string;
    try {
      existing = readFileSync(OUTPUT_PATH, "utf8");
    } catch {
      console.error("docs/DATA_DICTIONARY.md does not exist. Run `pnpm codegen`.");
      return 1;
    }
    if (!dictionaryMatches(existing)) {
      console.error(
        "docs/DATA_DICTIONARY.md is stale — the schemas changed but the dictionary was not regenerated.\n" +
          "Run `pnpm codegen` and commit the result.",
      );
      return 1;
    }
    console.log("docs/DATA_DICTIONARY.md is up to date.");
    return 0;
  }

  writeFileSync(OUTPUT_PATH, content, "utf8");
  const fieldCount = (content.match(/^\| `/gm) ?? []).length;
  console.log(
    `Wrote docs/DATA_DICTIONARY.md (${content.split("\n").length} lines, ${fieldCount} documented fields).`,
  );
  return 0;
}

process.exit(main());
