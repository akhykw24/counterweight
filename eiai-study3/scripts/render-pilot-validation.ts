/**
 * Turns the validation run into docs/PILOT_VALIDATION.md.
 *
 * The browser checks live in data/pilot-validation.json, written by
 * validation/pilot-validation.spec.ts. This adds the checks that are not
 * browser work -- the stimulus manifest, and whether the pipeline can process
 * what the run produced -- and renders one verdict.
 *
 * Separate from the spec so the document can be regenerated without spending
 * twenty minutes driving a browser again, and so a FAIL is visible as a
 * verdict rather than only as a red test somebody has to go and read.
 *
 *     pnpm validate:render
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

// Resolved rather than spawned as `npx`: execFileSync does not go through a
// shell, and on Windows the npx shim is a .cmd file it cannot execute.
const TSX = createRequire(import.meta.url).resolve("tsx/cli");

const ROOT = process.cwd();
const RESULTS = resolve(ROOT, "data/pilot-validation.json");
const OUT = resolve(ROOT, "docs/PILOT_VALIDATION.md");
const EVENTS = resolve(ROOT, "data/dev-events.jsonl");

interface Check {
  name: string;
  status: "PASS" | "FAIL";
  detail: string;
}

if (!existsSync(RESULTS)) {
  console.error(
    `${RESULTS} is missing. Run \`pnpm validate:pilot\` first -- this renders a run, it does not perform one.`,
  );
  process.exit(2);
}

const run = JSON.parse(readFileSync(RESULTS, "utf8")) as {
  generated_at: string;
  full_runs: number;
  total_rows: number;
  sessions: number;
  checks: Check[];
};

const checks: Check[] = [...run.checks];

/** Runs a command and turns its exit status into a check. */
function commandCheck(name: string, command: string, args: string[], detail: string): void {
  try {
    const output = execFileSync(command, args, { cwd: ROOT, encoding: "utf8", stdio: "pipe" });
    const lastLine = output.trim().split("\n").filter(Boolean).pop() ?? "";
    checks.push({ name, status: "PASS", detail: `${detail} ${lastLine}`.trim() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    checks.push({ name, status: "FAIL", detail: message.split("\n").slice(0, 3).join(" ") });
  }
}

commandCheck(
  "the frozen stimuli are unchanged",
  "python",
  ["pipeline/hash_manifest.py", "--check"],
  "Every stimulus file matches the committed manifest.",
);

// The pipeline has to cope with what this run produced. It should project the
// sessions cleanly and then remove every one of them as a test run -- both
// halves matter: projecting without error, and refusing to analyse a rehearsal.
if (existsSync(EVENTS)) {
  // Before asking whether the pipeline can read the log, ask whether the log
  // is what the schema says it is. The alternative is diagnosing a projection
  // error that was really a malformed row.
  commandCheck(
    "every recorded event conforms to the schema",
    process.execPath,
    [TSX, "scripts/validate-log.ts", "data/dev-events.jsonl"],
    "",
  );
  commandCheck(
    "the pipeline projects the validation data without error",
    "python",
    ["pipeline/replay.py", "--events", "data/dev-events.jsonl", "--out", "data/validation-tables"],
    "replay.py completed.",
  );
  commandCheck(
    "the pipeline removes every test session before analysing",
    "python",
    ["-c", [
      "import sys; sys.path.insert(0, 'pipeline')",
      "import pandas as pd",
      "from exclusions import keep_live_only",
      "p = pd.read_csv('data/validation-tables/participants.csv')",
      "kept, counts = keep_live_only({'participants': p})",
      "assert len(kept['participants']) == 0, f\"{len(kept['participants'])} test sessions survived the filter\"",
      "print(f'all {sum(counts.values())} sessions removed as rehearsals: {counts}')",
    ].join("; ")],
    "",
  );
} else {
  checks.push({
    name: "the pipeline projects the validation data without error",
    status: "FAIL",
    detail: `${EVENTS} is missing; the validation run produced no event log.`,
  });
}

const failed = checks.filter((check) => check.status === "FAIL");
const verdict = failed.length === 0 ? "PASS" : "FAIL";

const lines: string[] = [];
lines.push("# Pre-pilot validation");
lines.push("");
lines.push(
  `**Verdict: ${verdict}** — ${checks.length - failed.length} of ${checks.length} checks passed.`,
);
lines.push("");
lines.push(
  `Run ${run.generated_at.slice(0, 19).replace("T", " ")} UTC against the local ` +
    `server. ${run.full_runs} complete sessions plus six failure scenarios, ` +
    `${run.sessions} sessions and ${run.total_rows} events in total.`,
);
lines.push("");
lines.push(
  "Everything here used `?test=true`, so every row it wrote is marked disposable " +
    "and removed by the pipeline before a statistic is computed. The validation " +
    "cannot contaminate what it validates.",
);
lines.push("");
lines.push("## What this is asking");
lines.push("");
lines.push(
  "Not whether the app works — the ordinary test suites cover that. Whether " +
    "*delivery* holds up: whether an event the browser accepted always reaches " +
    "the server, exactly once, in order, across reloads, double clicks and a " +
    "dead network. Those are the failures that would otherwise appear as " +
    "quietly missing rows weeks later, with no error anywhere.",
);
lines.push("");
// A permanent note, not a status line: it stays true however many times this
// document is regenerated, and it is the answer to "has this suite ever caught
// anything?" -- which is the only question worth asking about a green check.
lines.push("## What the first run of this suite found");
lines.push("");
lines.push(
  "One defect, in the pipeline rather than the app. `client_ts` is an ISO 8601 " +
    "string -- that is what the schema declares and what the browser sends -- " +
    "but `pipeline/simulate.py` wrote it as an integer count of milliseconds, " +
    "and the projection had been written against the integer it saw. Every " +
    "duration therefore worked on synthetic data and raised `ValueError` on the " +
    "first real session. No test caught it because every test ran on the " +
    "simulator's own output.",
);
lines.push("");
lines.push(
  "Fixed by one parser (`epoch_ms` in `pipeline/_common.py`) used everywhere, " +
    "by making the simulator emit what the browser emits, and by two new gates: " +
    "`pnpm log:check` validates a log against the schema, and " +
    "`pipeline/verify_bridge.py` now compares field *types* between the real and " +
    "simulated logs instead of only key names.",
);
lines.push("");
lines.push("## Checks");
lines.push("");
lines.push("| | Check | Detail |");
lines.push("|---|---|---|");
for (const check of checks) {
  const mark = check.status === "PASS" ? "**PASS**" : "**FAIL**";
  lines.push(`| ${mark} | ${check.name} | ${check.detail.replace(/\|/g, "\\|")} |`);
}
lines.push("");

if (failed.length > 0) {
  lines.push("## Failures");
  lines.push("");
  lines.push("**Do not run the pilot until these pass.**");
  lines.push("");
  for (const check of failed) {
    lines.push(`- **${check.name}** — ${check.detail}`);
  }
  lines.push("");
}

lines.push("## How to repeat this");
lines.push("");
lines.push("```bash");
lines.push("pnpm validate:pilot     # ~20 minutes: drives a real browser");
lines.push("pnpm validate:render    # rewrites this file from the run");
lines.push("```");
lines.push("");
lines.push(
  "`validate:pilot` does not retry. A delivery check that passes on the second " +
    "attempt has told you the opposite of what it was asked.",
);
lines.push("");

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, lines.join("\n") + "\n", "utf8");
console.log(`${verdict}: ${checks.length - failed.length}/${checks.length} checks. Wrote ${OUT}`);
process.exit(failed.length === 0 ? 0 : 1);
