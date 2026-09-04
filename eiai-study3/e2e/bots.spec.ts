import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Simulation bots driving the **real** app in a real browser (spec section 7).
 *
 * What this is for
 * ----------------
 * `pipeline/simulate.py` produces hundreds of synthetic sessions in seconds by
 * writing the event stream directly. That is the only way to get enough
 * sessions for parameter recovery, and it is worth exactly nothing on its own:
 * it tests my assumptions about what the app emits, not the app.
 *
 * These bots close that gap. They walk the same policies through the actual UI
 * and dump the resulting write-ahead log to `data/browser-events.jsonl`.
 * `pipeline/verify_bridge.py` then compares that log against the simulated one
 * -- same event types, same payload keys, same per-item structure. If the app
 * ever emits a field the simulator does not know about, or stops emitting one
 * it assumes, the bridge fails and the recovery result stops being trustworthy.
 *
 * Sample size
 * -----------
 * Small here on purpose. Sixty sessions per policy per condition in a real
 * browser is hours of wall clock for a structural check that one session per
 * policy already makes. The statistics come from the fast path; this is the
 * calibration that licenses it.
 */

const testId = (id: string) => `[data-testid="${id}"]`;

// ESM: no __dirname here, and the project is type: module.
const OUTPUT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "data",
  "browser-events.jsonl",
);

/** Policies, matching POLICIES in pipeline/simulate.py. */
const POLICIES = {
  SimCentral: { scrollFraction: 1.0, dwellMs: 400, followups: true, verify: true, woa: 0.55 },
  SimPeripheral: { scrollFraction: 0.35, dwellMs: 60, followups: false, verify: false, woa: 0.4 },
  SimRandom: { scrollFraction: 0.5, dwellMs: 120, followups: true, verify: false, woa: 0.35 },
} as const;

type PolicyName = keyof typeof POLICIES;

interface WalRecord {
  seq: number;
  event: { type: string; payload: Record<string, unknown> };
}

async function readWal(page: Page): Promise<WalRecord[]> {
  return page.evaluate(async () => {
    const records = await new Promise<WalRecord[]>((resolve, reject) => {
      const request = indexedDB.open("eiai-telemetry");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const tx = request.result.transaction("events", "readonly");
        const all = tx.objectStore("events").getAll();
        all.onsuccess = () => resolve(all.result as WalRecord[]);
        all.onerror = () => reject(all.error);
      };
    });
    return records.sort((a, b) => a.seq - b.seq);
  });
}

async function resetParticipant(page: Page): Promise<void> {
  await page.goto("/");
  await page.evaluate(async () => {
    localStorage.clear();
    await new Promise((resolve) => {
      const request = indexedDB.deleteDatabase("eiai-telemetry");
      request.onsuccess = resolve;
      request.onerror = resolve;
      request.onblocked = resolve;
    });
  });
  await page.reload();
}

/** Scrolls the advice box to a fraction of its extent, as a reader would. */
async function scrollAdvice(page: Page, fraction: number): Promise<void> {
  await page.locator(testId("advice")).evaluate((element, target) => {
    const box = element as HTMLElement;
    box.scrollTop = (box.scrollHeight - box.clientHeight) * (target as number);
    box.dispatchEvent(new Event("scroll", { bubbles: true }));
  }, fraction);
}

async function runSession(page: Page, policyName: PolicyName): Promise<WalRecord[]> {
  const policy = POLICIES[policyName];
  await resetParticipant(page);

  await page.locator(testId("age-35+")).click();
  await page.locator(testId("cefr-B2")).click();
  await page.locator(testId("study-language-english")).click();
  await page.locator(testId("training-no")).click();
  await page.locator(testId("submit-eligibility")).click();
  await page.locator(testId("give-consent")).click();

  const allocateButton = page.locator(testId("allocate"));
  const condition = await allocateButton.getAttribute("data-condition");
  await allocateButton.click();

  for (let i = 0; i < 12; i += 1) {
    await expect(page.locator(testId("screen-item-estimate"))).toBeVisible();

    const estimateInput = page.locator(testId("initial-estimate"));
    const max = Number(await estimateInput.getAttribute("max"));
    const initial = Math.round(max * 0.3);
    await estimateInput.fill(String(initial));
    // Spread confidence across the three registers so the warm arm exercises
    // all of them rather than only the one the midpoint happens to select.
    await page.locator(testId("initial-confidence")).fill(String(i % 3 === 0 ? 20 : i % 3 === 1 ? 55 : 85));
    await page.locator(testId("submit-initial")).click();

    await scrollAdvice(page, policy.scrollFraction);
    if (policy.followups) {
      await page.locator(testId("followup-measurement")).click();
      if (policyName === "SimCentral") {
        await page.locator(testId("followup-challenge")).click();
      }
    }
    if (policy.verify) {
      await page.locator(testId("verify")).click();
    }
    await page.waitForTimeout(policy.dwellMs);

    await page.locator(testId("request-final")).click();
    // Move toward the advice by the policy's weight. The exact number does not
    // matter here -- the statistics come from the fast path -- but moving at
    // all is what produces a well-formed ESTIMATE_FINALIZED to compare.
    const finalInput = page.locator(testId("final-estimate"));
    await finalInput.fill(String(Math.round(initial * (1 + policy.woa * 0.3))));
    await page.locator(testId("final-confidence")).click();
    await page.locator(testId("submit-final")).click();
    // Perceived argument strength, asked once per item after the estimate.
    await page.locator(testId("argument-strength-4")).click();
  }

  await expect(page.locator(testId("screen-questionnaire"))).toBeVisible();
  for (const id of [
    "warmth_01", "warmth_02", "warmth_03", "warmth_04", "warmth_05",
    "competence_01", "competence_02", "competence_03", "competence_04",
    "trust_01", "trust_02", "trust_03", "trust_04", "cov_prior_knowledge",
  ]) {
    await page.locator(testId(`${id}-5`)).click();
  }
  await page.locator(testId("cov_gender-prefer_not_to_say")).click();
  await page.locator(testId("cov_ai_usage-3")).click();
  await page.locator(testId("submit-questionnaire")).click();

  await page.locator(testId("funnel-purpose-text")).fill("Something about AI advice.");
  await page.locator(testId("funnel-purpose-submit")).click();
  await page.locator(testId("funnel-anomaly-text")).fill("Nothing stood out.");
  await page.locator(testId("funnel-anomaly-submit")).click();
  await page.locator(testId("funnel-belief-unsure")).click();

  await expect(page.locator(testId("screen-debrief"))).toBeVisible();
  await page.locator(testId("submit-debrief")).click();
  await expect(page.locator(testId("screen-done"))).toBeVisible();

  const wal = await readWal(page);
  expect(wal.length, `${policyName} produced no events`).toBeGreaterThan(0);
  expect(
    wal.filter((r) => r.event.type === "ESTIMATE_FINALIZED"),
    `${policyName} (${condition}) did not finalise twelve trials`,
  ).toHaveLength(12);
  return wal;
}

test("bot policies complete real sessions and export a comparable log", async ({ page }) => {
  test.setTimeout(600_000);

  const lines: string[] = [];
  const conditionsSeen = new Set<string>();

  for (const policyName of Object.keys(POLICIES) as PolicyName[]) {
    const wal = await runSession(page, policyName);
    for (const record of wal) {
      lines.push(JSON.stringify(record.event));
    }
    const allocated = wal.find((r) => r.event.type === "ALLOCATED");
    conditionsSeen.add(String(allocated?.event.payload["condition"]));
  }

  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, lines.join("\n") + "\n", "utf8");

  // Not an assertion that both arms appeared -- three sessions cannot promise
  // that -- but a recorded fact, so a run where every bot landed in one arm is
  // visible rather than silently narrowing what the bridge covered.
  console.log(`bots exported ${lines.length} events; conditions seen: ${[...conditionsSeen].join(", ")}`);
});
