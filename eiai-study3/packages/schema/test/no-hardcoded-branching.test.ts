import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A literal must never stand in for a branch.
 *
 * This exists because that defect has now been found three times, each time
 * invisible to the tests that were written against it:
 *
 *   1. `ALLOCATE` carried `condition: "warm"` and `stratum: "en:adult"`, which
 *      made the neutral arm unreachable and recorded a stratum contradicting
 *      the participant's own eligibility answers.
 *   2. The advice screen resolved stimuli with `context.language ?? "en"` and
 *      `context.condition ?? "neutral"`, so a participant allocated to warm
 *      Kazakh would have been served English neutral -- and RESPONSE_REVEALED
 *      would have logged that stimulus's own id, internally consistent and
 *      wrong.
 *   3. `CONSENT_GIVEN` recorded `flow: "adult"` outright, describing which
 *      screen fired rather than which participant consented.
 *
 * All three type-check, and all three produce a log that looks valid. So the
 * guard is lexical: a scan for the values themselves, in the files that render
 * or record, with an explicit allow-list for the places where naming a value IS
 * the job -- offering the choices, defining the enum, implementing the mapping.
 */

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));

/** Directories that render to participants or write to the event log. */
const SCANNED = ["apps/study/src", "packages/telemetry/src", "services/ingest/src"];

/**
 * Files where naming a value is the point rather than a substitute for a branch.
 * Each needs a reason, so that adding to this list is a decision rather than a
 * way to silence the test.
 */
const ALLOWED: Record<string, string> = {
  "apps/study/src/allocation.ts":
    "the allocation module itself: it reads the committed sequence and validates its values",
  "apps/study/src/i18n.ts": "the translation table is keyed by language by definition",
};

/**
 * Lines that legitimately mention a value inside a scanned file. Keyed by the
 * literal so the exception is narrow: a file is never wholly exempted.
 */
const ALLOWED_PATTERNS: RegExp[] = [
  // Offering the participant their choices. The eligibility screen has to name
  // the options it is asking them to pick between.
  /data-testid=\{?[`"]?(lang|age)-/,
  /const AGE_OPTIONS: AgeScreenAnswer\[\]/,
  /^\s*"(under-18|18-24|25-34|35\+)": "/,
  /"(under-18|18-24|25-34|35\+)",?$/,
  // Type positions, not values.
  /^\s*(\/\/|\*|\/\*)/,
  /: "(warm|neutral)" \| "(warm|neutral)"/,
];

const FORBIDDEN: { name: string; pattern: RegExp }[] = [
  { name: "condition", pattern: /["'](warm|neutral)["']/ },
  { name: "stratum", pattern: /["'](kk|ru|en):(minor|adult)["']/ },
  { name: "language", pattern: /["'](kk|ru|en)["']/ },
  { name: "age band", pattern: /["'](under-18|18-24|25-34|35\+)["']/ },
  { name: "consent flow", pattern: /["'](minor|adult)["']/ },
  // Archived languages must not reappear in anything a participant can reach.
  { name: "archived language", pattern: /["'](kk|ru)["']/ },
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

interface Finding {
  file: string;
  line: number;
  kind: string;
  text: string;
}

function scan(): Finding[] {
  const findings: Finding[] = [];
  for (const directory of SCANNED) {
    const absolute = join(ROOT, directory);
    let files: string[];
    try {
      files = walk(absolute);
    } catch {
      continue; // directory may not exist in every checkout
    }
    for (const file of files) {
      const rel = relative(ROOT, file).split(sep).join("/");
      if (ALLOWED[rel]) continue;
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((text, index) => {
        if (ALLOWED_PATTERNS.some((pattern) => pattern.test(text))) return;
        for (const { name, pattern } of FORBIDDEN) {
          if (pattern.test(text)) {
            findings.push({ file: rel, line: index + 1, kind: name, text: text.trim() });
          }
        }
      });
    }
  }
  return findings;
}

describe("no hard-coded branching", () => {
  it("never names a condition, stratum, language, age band or consent flow outside the allow-list", () => {
    const findings = scan();
    const report = findings
      .map((f) => `  ${f.file}:${f.line}  [${f.kind}]  ${f.text}`)
      .join("\n");
    expect(
      findings,
      findings.length === 0
        ? ""
        : `A literal is standing in for a branch:\n${report}\n\n` +
            `Read the value from context, or add the file to ALLOWED with a reason.`,
    ).toEqual([]);
  });

  it("actually scans something, so a silent zero is not mistaken for a pass", () => {
    // A broken path or a bad glob would produce zero findings and look green.
    const scanned = SCANNED.map((directory) => {
      try {
        return walk(join(ROOT, directory)).length;
      } catch {
        return 0;
      }
    });
    expect(scanned.reduce((a, b) => a + b, 0)).toBeGreaterThan(5);
  });

  it("keeps every allow-list entry pointing at a file that exists", () => {
    // A stale entry would silently exempt nothing, or worse, mask a rename.
    for (const rel of Object.keys(ALLOWED)) {
      expect(() => statSync(join(ROOT, rel)), rel).not.toThrow();
    }
  });
});
