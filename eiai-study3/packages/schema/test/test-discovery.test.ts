import { readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import config from "../../../vitest.config";

/**
 * Every test file on disk is actually collected.
 *
 * `apps/study/test/allocation.test.ts` existed for weeks, was maintained, and
 * never ran once: the include glob covered `.tsx` under `apps/` but not `.ts`.
 * A test that does not run is indistinguishable from one that passes, and
 * nothing in a green suite hints that a file is missing from it.
 *
 * This compares the files on disk against the configured patterns rather than
 * against a hard-coded list, so adding a test in a new shape fails here instead
 * of disappearing.
 */

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const TEST_DIRS = ["packages", "services", "apps"];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Minimal glob matcher covering the shapes the config actually uses. */
function matches(pattern: string, path: string): boolean {
  const expanded = pattern.replace(/\{([^}]*)\}/g, (_, group: string) => `(${group.split(",").join("|")})`);
  const regex = new RegExp(
    "^" +
      expanded
        .replace(/\./g, "\.")
        .replace(/\*\*\//g, "§§")
        .replace(/\*/g, "[^/]*")
        .replace(/§§/g, "(?:.*/)?") +
      "$",
  );
  return regex.test(path);
}

describe("test discovery", () => {
  const patterns = (config as { test?: { include?: string[] } }).test?.include ?? [];

  it("configures at least one include pattern", () => {
    expect(patterns.length).toBeGreaterThan(0);
  });

  it("collects every test file that exists", () => {
    const onDisk = TEST_DIRS.flatMap((dir) => {
      try {
        return walk(join(ROOT, dir));
      } catch {
        return [];
      }
    }).map((file) => relative(ROOT, file).split(sep).join("/"));

    expect(onDisk.length).toBeGreaterThan(5);

    const uncollected = onDisk.filter(
      (path) => !patterns.some((pattern) => matches(pattern, path)),
    );
    expect(
      uncollected,
      uncollected.length === 0
        ? ""
        : `these test files exist but no include pattern matches them, so they ` +
            `never run:\n${uncollected.map((p) => `  ${p}`).join("\n")}`,
    ).toEqual([]);
  });
});
