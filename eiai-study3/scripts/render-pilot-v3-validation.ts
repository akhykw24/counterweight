/**
 * Turns the v3 validation run into docs/PILOT_V3_VALIDATION.md.
 *
 * Browser checks come from data/pilot-v3-validation.json, written by
 * validation-v3/pilot-v3-validation.spec.ts. This adds what is not browser
 * work -- the stimulus manifest, the event schema, the export and the pilot
 * summary run on the very data the bots produced -- and one verdict.
 *
 * Launch readiness is reported beside the verdict, not folded into it. The
 * technical checks can all pass while the consent form still says
 * "[TODO-DARYA: school name]"; both facts matter and neither should hide the
 * other.
 *
 *     pnpm validate:v3:render
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const TSX = createRequire(import.meta.url).resolve("tsx/cli");
const ROOT = process.cwd();
const RESULTS = resolve(ROOT, "data/pilot-v3-validation.json");
const OUT = resolve(ROOT, "docs/PILOT_V3_VALIDATION.md");
const EVENTS = "data/dev-events.jsonl";

interface Check {
  name: string;
  status: "PASS" | "FAIL";
  detail: string;
}

if (!existsSync(RESULTS)) {
  console.error(`${RESULTS} is missing. Run \`pnpm validate:v3\` first.`);
  process.exit(2);
}

const run = JSON.parse(readFileSync(RESULTS, "utf8")) as {
  generated_at: string;
  full_runs: number;
  sessions: number;
  total_rows: number;
  checks: Check[];
};
const checks: Check[] = [...run.checks];

function commandCheck(name: string, command: string, args: string[], detail: string): void {
  try {
    const output = execFileSync(command, args, { cwd: ROOT, encoding: "utf8", stdio: "pipe" });
    const last = output.trim().split("\n").filter(Boolean).slice(0, 2).join(" ");
    checks.push({ name, status: "PASS", detail: `${detail} ${last}`.trim() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    checks.push({ name, status: "FAIL", detail: message.split("\n").slice(0, 4).join(" ") });
  }
}

commandCheck("the v3 stimuli match the approved texts and the manifest", "python", ["pipeline/stimuli_v3.py", "--check"], "");
commandCheck("every recorded event conforms to the event schema", process.execPath, [TSX, "scripts/validate-log.ts", EVENTS], "");
commandCheck(
  "the export runs on this data (long CSV, wide CSV, JSON)",
  "python",
  ["pipeline/v3_export.py", "--events", EVENTS, "--mode", "test", "--out", "results/validation_v3"],
  "",
);
commandCheck(
  "the pilot summary runs on this data",
  "python",
  ["scripts/pilot_v3_summary.py", "--events", EVENTS, "--mode", "test", "--out", "results/validation_v3/SUMMARY.md"],
  "",
);

const manifest = JSON.parse(readFileSync(resolve(ROOT, "stimuli/v3/manifest.json"), "utf8")) as {
  open_placeholders: { where: string; placeholder: string }[];
};

const failed = checks.filter((c) => c.status === "FAIL");
const verdict = failed.length === 0 ? "PASS" : "FAIL";
const blockers = manifest.open_placeholders;

const lines: string[] = [];
lines.push("# Pre-pilot validation — v3");
lines.push("");
lines.push(`**Verdict: ${verdict}** — ${checks.length - failed.length} of ${checks.length} checks passed.`);
lines.push("");
lines.push(
  blockers.length === 0
    ? "**Launch: ready** — no placeholder remains in participant-facing text."
    : `**Launch: blocked** — ${blockers.length} [TODO-DARYA] placeholder(s) are still in participant-facing text (listed below). ` +
        "These need the researcher's text, not a code change.",
);
lines.push("");
lines.push(
  `Run ${run.generated_at.slice(0, 19).replace("T", " ")} UTC against the local dev server and the real ingest handler: ` +
    `${run.full_runs} complete sessions (20 on a desktop screen, 5 per cell, plus one on a phone-sized screen) and the ` +
    `failure scenarios — ${run.sessions} sessions and ${run.total_rows} events in total. Every link used \`test=true\`, ` +
    "so none of it can ever be analysed.",
);
lines.push("");
lines.push("## Checks");
lines.push("");
lines.push("| | Check | Detail |");
lines.push("|---|---|---|");
for (const c of checks) {
  lines.push(`| **${c.status}** | ${c.name} | ${c.detail.replace(/\|/g, "\\|")} |`);
}
lines.push("");
if (failed.length > 0) {
  lines.push("## Failures", "", "**Do not start the pilot until these pass.**", "");
  for (const c of failed) lines.push(`- **${c.name}** — ${c.detail}`);
  lines.push("");
}
if (blockers.length > 0) {
  lines.push("## Launch blockers", "");
  lines.push("Text the brief marked as still to be supplied. The participant would see these exactly as written:", "");
  for (const b of blockers) lines.push(`- \`${b.where}\`: ${b.placeholder}`);
  lines.push("");
  lines.push(
    "Fill them in `stimuli/v3/source/E_consent_questionnaire_debrief.md`, then run `pnpm stimuli:v3` and commit. " +
      "The manifest records `launch_ready: true` once none remain.",
  );
  lines.push("");
}
lines.push("## How to repeat this", "");
lines.push("```bash");
lines.push("pnpm validate:v3          # drives a real browser (about 15 minutes)");
lines.push("pnpm validate:v3:render   # rewrites this file from the run");
lines.push("```");
lines.push("");
lines.push("No retries: a delivery check that passes on a second attempt has answered the opposite question.");
lines.push("");

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, lines.join("\n"), "utf8");
console.log(`${verdict}: ${checks.length - failed.length}/${checks.length} checks. Launch ${blockers.length ? "blocked" : "ready"}. Wrote ${OUT}`);
process.exit(failed.length === 0 ? 0 : 1);
