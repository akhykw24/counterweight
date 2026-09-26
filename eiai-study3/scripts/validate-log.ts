/**
 * Validates an event log against the schema that defines it.
 *
 * Every consumer of the log -- the ingest function, the projection, the
 * analysis -- assumes the rows conform to `StudyEvent`. The browser's rows are
 * checked on arrival, but nothing checked the simulator's, and that gap had a
 * cost: simulate.py wrote `client_ts` as an integer count of milliseconds where
 * the schema declares an ISO 8601 string, the pipeline was written against the
 * integer it saw, and the first real session raised. A log nobody validates is
 * a second, undeclared schema.
 *
 * Reports every distinct failure once, with a count, rather than 66,000 copies
 * of the same message.
 *
 *     pnpm log:check                          # the simulated log
 *     tsx scripts/validate-log.ts data/x.jsonl [more.jsonl]
 *
 * Exit codes: 0 conforms, 1 something does not, 2 no log to read.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { StudyEvent } from "@eiai/schema";

const DEFAULT_LOGS = ["data/sim-events.jsonl"];

const requested = process.argv.slice(2);
const logs = (requested.length > 0 ? requested : DEFAULT_LOGS).map((p) => resolve(process.cwd(), p));

const missing = logs.filter((path) => !existsSync(path));
if (missing.length > 0) {
  console.error(
    `No log to validate:\n${missing.map((m) => `  ${m}`).join("\n")}\n` +
      "  simulated log: pnpm sim\n  browser log:   pnpm e2e:bots",
  );
  process.exit(2);
}

/** distinct failure -> how many rows showed it, and the first row that did. */
const failures = new Map<string, { count: number; example: string }>();
let rows = 0;

for (const path of logs) {
  const lines = readFileSync(path, "utf8").split("\n");
  for (const [index, line] of lines.entries()) {
    const text = line.trim();
    if (text.length === 0) continue;
    rows += 1;

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      const key = "not JSON";
      const previous = failures.get(key);
      failures.set(key, {
        count: (previous?.count ?? 0) + 1,
        example: previous?.example ?? `${path}:${index + 1} ${String(error)}`,
      });
      continue;
    }

    const result = StudyEvent.safeParse(parsed);
    if (result.success) continue;

    const row = parsed as { type?: unknown; seq?: unknown };
    for (const issue of result.error.issues) {
      // Keyed on the shape of the problem, not on the row: one message per
      // distinct defect is actionable, 66,000 identical ones are not.
      const key = `${String(row.type ?? "?")}.${issue.path.join(".") || "(root)"}: ${issue.message}`;
      const previous = failures.get(key);
      failures.set(key, {
        count: (previous?.count ?? 0) + 1,
        example: previous?.example ?? `${path}:${index + 1} (seq ${String(row.seq ?? "?")})`,
      });
    }
  }
}

console.log(`${rows} rows from ${logs.length} log${logs.length === 1 ? "" : "s"}.`);

if (failures.size === 0) {
  console.log("Every row conforms to StudyEvent.");
  process.exit(0);
}

console.error("\nRows that do not conform to the schema:");
for (const [key, { count, example }] of [...failures].sort((a, b) => b[1].count - a[1].count)) {
  console.error(`  ${count} x  ${key}\n           first at ${example}`);
}
console.error(
  "\nThe schema is the definition, not a description. A log that diverges from " +
    "it is read correctly by nothing downstream.",
);
process.exit(1);
