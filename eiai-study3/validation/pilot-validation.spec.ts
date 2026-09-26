import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EVENT_LOG, rowsFor, sessionIdOf, storedRows, waitForType } from "../e2e/event-log.js";

/**
 * Pre-pilot validation: thirty full sessions and six ways a session goes wrong.
 *
 * Run before any human takes part. Everything here uses `?test=true`, so every
 * row it writes is marked disposable and removed by the pipeline before a
 * statistic is computed -- the validation cannot contaminate what it validates.
 *
 * What it is actually checking
 * ----------------------------
 * Not "does the app work" -- the other suites cover that. This asks whether
 * the *delivery* holds up: whether an event the browser accepted always
 * reaches the server, exactly once, in order, across reloads, double clicks
 * and a dead network. Those are the failures that would show up as quietly
 * missing rows weeks later, with no error anywhere.
 *
 * Results are written to data/pilot-validation.json and rendered into
 * docs/PILOT_VALIDATION.md.
 */

const testId = (id: string) => `[data-testid="${id}"]`;

const RESULTS = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "data",
  "pilot-validation.json",
);

const FULL_RUNS = 30;

interface Check {
  name: string;
  status: "PASS" | "FAIL";
  detail: string;
}

const checks: Check[] = [];

function record(name: string, ok: boolean, detail: string) {
  checks.push({ name, status: ok ? "PASS" : "FAIL", detail });
  return ok;
}

async function reset(page: Page): Promise<void> {
  await page.goto("/?test=true");
  await page.evaluate(async () => {
    localStorage.clear();
    await new Promise((done) => {
      const request = indexedDB.deleteDatabase("eiai-telemetry");
      request.onsuccess = done;
      request.onerror = done;
      request.onblocked = done;
    });
  });
  await page.goto("/?test=true");
}

async function screenOut(page: Page, age: string, cefr: string): Promise<void> {
  await page.locator(testId(`age-${age}`)).click();
  await page.locator(testId(`cefr-${cefr}`)).click();
  await page.locator(testId("study-language-english")).click();
  await page.locator(testId("training-no")).click();
  await page.locator(testId("submit-eligibility")).click();
}

async function consent(page: Page): Promise<void> {
  await screenOut(page, "35+", "B2");
  await page.locator(testId("confirm-adult")).click();
  await page.locator(testId("give-consent")).click();
  await page.locator(testId("allocate")).click();
}

/** One item: estimate, read, revise, rate. */
async function oneItem(page: Page, index: number): Promise<void> {
  await expect(page.locator(testId("screen-item-estimate"))).toBeVisible();
  await page.locator(testId("initial-estimate")).click();
  await page.locator(testId("initial-confidence")).fill(String(index % 3 === 0 ? 25 : 75));
  await expect(
    page.locator(testId("submit-initial")),
    "submit stayed disabled: a slider value matched its current one and fired no event",
  ).toBeEnabled();
  await page.locator(testId("submit-initial")).click();
  await page.locator(testId("request-final")).click();
  await page.locator(testId("final-estimate")).click();
  await page.locator(testId("final-confidence")).click();
  await page.locator(testId("submit-final")).click();
  await page.locator(testId("argument-strength-4")).click();
}

async function finishSession(page: Page): Promise<void> {
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
  await page.locator(testId("funnel-anomaly-text")).fill("Nothing unusual.");
  await page.locator(testId("funnel-anomaly-submit")).click();
  await page.locator(testId("funnel-belief-unsure")).click();

  await expect(page.locator(testId("screen-debrief"))).toBeVisible();
  await page.locator(testId("submit-debrief")).click();
  await expect(page.locator(testId("screen-done"))).toBeVisible();
}

/** Events the browser still holds, i.e. accepted but not yet acknowledged. */
async function undelivered(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const records = await new Promise<unknown[]>((done, fail) => {
      const request = indexedDB.open("eiai-telemetry");
      request.onerror = () => fail(request.error);
      request.onsuccess = () => {
        const all = request.result.transaction("events", "readonly").objectStore("events").getAll();
        all.onsuccess = () => done(all.result);
        all.onerror = () => fail(all.error);
      };
    });
    return records.length;
  });
}

test.beforeAll(() => {
  rmSync(EVENT_LOG, { force: true });
  checks.length = 0;
});

test.describe.configure({ mode: "serial" });

test("thirty complete sessions are delivered whole", async ({ page }) => {
  test.setTimeout(20 * 60 * 1000);

  const ids: string[] = [];
  for (let run = 0; run < FULL_RUNS; run += 1) {
    await reset(page);
    await consent(page);
    for (let item = 0; item < 12; item += 1) await oneItem(page, item);
    await finishSession(page);
    const id = await sessionIdOf(page);
    await waitForType(id, "SESSION_COMPLETED", 1, 60_000);
    ids.push(id);
  }

  record(
    `${FULL_RUNS} complete sessions reach the server`,
    ids.length === FULL_RUNS,
    `${ids.length} of ${FULL_RUNS} sessions recorded SESSION_COMPLETED server-side.`,
  );

  // Per session: the twelve trials are all there, and the sequence has no gaps.
  const incomplete: string[] = [];
  const gaps: string[] = [];
  for (const id of ids) {
    const rows = rowsFor(id);
    const finals = rows.filter((r) => r.type === "ESTIMATE_FINALIZED").length;
    const rated = rows.filter((r) => r.type === "ARGUMENT_RATED").length;
    if (finals !== 12 || rated !== 12) incomplete.push(`${id} (${finals} finals, ${rated} ratings)`);
    const positions = rows.map((r) => r.seq);
    for (let i = 1; i < positions.length; i += 1) {
      if (positions[i] !== positions[i - 1]! + 1) {
        gaps.push(`${id} between seq ${positions[i - 1]} and ${positions[i]}`);
        break;
      }
    }
  }
  record(
    "every session delivered all twelve trials",
    incomplete.length === 0,
    incomplete.length === 0
      ? "All sessions carry twelve finalised estimates and twelve argument ratings."
      : `Incomplete: ${incomplete.join("; ")}`,
  );
  record(
    "no event was lost in the middle of a session",
    gaps.length === 0,
    gaps.length === 0
      ? "Sequence numbers are contiguous within every session."
      : `Gaps found: ${gaps.join("; ")}`,
  );

  const all = storedRows();
  const uniqueEvents = new Set(all.map((r) => r.event_id));
  record(
    "no event was stored twice",
    uniqueEvents.size === all.length,
    `${all.length} rows, ${uniqueEvents.size} distinct event ids.`,
  );

  const positions = new Set(all.map((r) => `${r.session_id}#${r.seq}`));
  record(
    "no two events share a position in a session",
    positions.size === all.length,
    `${positions.size} distinct (session, seq) pairs across ${all.length} rows.`,
  );

  const modes = new Set(all.map((r) => (r as unknown as { run_mode: string }).run_mode));
  record(
    "every row is marked as a test run",
    modes.size === 1 && modes.has("test"),
    `run_mode values present: ${[...modes].join(", ")}.`,
  );
});

test("a reload in the middle of an item loses nothing", async ({ page }) => {
  test.setTimeout(120_000);
  await reset(page);
  await consent(page);
  await oneItem(page, 0);
  await expect(page.locator(testId("screen-item-estimate"))).toBeVisible();

  const id = await sessionIdOf(page);
  await waitForType(id, "ARGUMENT_RATED", 1);
  const before = rowsFor(id).map((r) => r.event_id);

  await page.reload();
  await expect(page.locator(testId("screen-item-estimate"))).toBeVisible();
  await oneItem(page, 1);
  await waitForType(id, "ARGUMENT_RATED", 2);

  const after = rowsFor(id).map((r) => r.event_id);
  const kept = before.every((eventId) => after.includes(eventId));
  const duplicated = new Set(after).size !== after.length;
  record(
    "a reload mid-session keeps what came before and duplicates nothing",
    kept && !duplicated,
    kept
      ? `Resumed on the same item; ${after.length} events, all distinct.`
      : "Events recorded before the reload were missing afterwards.",
  );
});

test("the back button does not corrupt the session", async ({ page }) => {
  test.setTimeout(120_000);
  await reset(page);
  await consent(page);
  await oneItem(page, 0);
  const id = await sessionIdOf(page);
  await waitForType(id, "ARGUMENT_RATED", 1);
  const before = rowsFor(id).length;

  await page.goBack();
  await page.waitForTimeout(1500);
  await page.goForward();
  await page.waitForTimeout(1500);

  // The app is a single page with no routing, so history navigation should
  // land the participant back where they were rather than rewinding the study.
  const stillRunning = await page.locator(testId("screen-item-estimate")).isVisible();
  const after = rowsFor(id);
  const duplicated = new Set(after.map((r) => r.event_id)).size !== after.length;
  record(
    "the back button neither rewinds the session nor duplicates events",
    stillRunning && !duplicated && after.length >= before,
    `On the item screen after back/forward: ${stillRunning}. ` +
      `${after.length} events, all distinct: ${!duplicated}.`,
  );
});

test("double-clicking submit records one event, not two", async ({ page }) => {
  test.setTimeout(120_000);
  await reset(page);
  await consent(page);

  await expect(page.locator(testId("screen-item-estimate"))).toBeVisible();
  await page.locator(testId("initial-estimate")).click();
  // Not 50. `fill()` with the value a range input already holds fires no
  // change event, so the app never sees an answer and submit stays disabled --
  // which shows up two minutes later as a click timeout that looks like a bug
  // in the app. Asserting the button first turns that into an immediate,
  // readable failure.
  await page.locator(testId("initial-confidence")).fill("62");
  await expect(
    page.locator(testId("submit-initial")),
    "submit stayed disabled: the estimate or confidence never registered",
  ).toBeEnabled();
  await page.locator(testId("submit-initial")).click({ clickCount: 2, delay: 40 });

  await page.locator(testId("request-final")).click();
  await page.locator(testId("final-estimate")).click();
  await page.locator(testId("final-confidence")).click();
  await page.locator(testId("submit-final")).click({ clickCount: 2, delay: 40 });
  await page.locator(testId("argument-strength-4")).click({ clickCount: 2, delay: 40 });

  const id = await sessionIdOf(page);
  await waitForType(id, "ARGUMENT_RATED", 1);
  await page.waitForTimeout(4000);

  const rows = rowsFor(id);
  const finals = rows.filter((r) => r.type === "ESTIMATE_FINALIZED").length;
  const rated = rows.filter((r) => r.type === "ARGUMENT_RATED").length;
  record(
    "a double click produces one event per action",
    finals === 1 && rated === 1,
    `After double-clicking through one item: ${finals} ESTIMATE_FINALIZED, ${rated} ARGUMENT_RATED.`,
  );
});

test("ten seconds without a network loses nothing", async ({ page }) => {
  test.setTimeout(180_000);
  await reset(page);
  await consent(page);
  const id = await sessionIdOf(page);
  await waitForType(id, "ALLOCATED", 1);
  const before = rowsFor(id).length;

  await page.route("**/api/events", (route) => route.abort("failed"));
  await oneItem(page, 0);
  await page.waitForTimeout(10_000);

  const duringOutage = rowsFor(id).length;
  const held = await undelivered(page);
  await page.unroute("**/api/events");

  await waitForType(id, "ARGUMENT_RATED", 1, 60_000);
  await expect.poll(() => undelivered(page), { timeout: 60_000 }).toBe(0);

  const rows = rowsFor(id);
  const distinct = new Set(rows.map((r) => r.event_id)).size === rows.length;
  record(
    "a ten-second outage delays delivery and loses nothing",
    duringOutage === before && held > 0 && distinct,
    `Nothing reached the server during the outage (${duringOutage} rows, unchanged); ` +
      `${held} events were held in the browser; after recovery all ${rows.length} ` +
      `events are present and distinct.`,
  );
});

test("a 17-year-old is turned away before consent", async ({ page }) => {
  test.setTimeout(120_000);
  await reset(page);
  await screenOut(page, "under-18", "C1");

  const consentShown = (await page.locator(testId("screen-consent")).count()) > 0;
  const reason = await page.locator(testId("screen-screened-out")).getAttribute("data-reason");

  const id = await sessionIdOf(page);
  await waitForType(id, "SCREENED_OUT", 1);
  const types = rowsFor(id).map((r) => r.type);

  record(
    "under 18: screened out, no consent shown, no randomisation",
    !consentShown &&
      reason === "age" &&
      types.includes("SCREENED_OUT") &&
      !types.includes("CONSENT_GIVEN") &&
      !types.includes("ALLOCATED"),
    `Consent screen shown: ${consentShown}. Reason recorded: ${reason}. ` +
      `Events: ${[...new Set(types)].join(", ")}.`,
  );
});

test("English below B1 is turned away before consent", async ({ page }) => {
  test.setTimeout(120_000);
  await reset(page);
  await screenOut(page, "25-34", "A2");

  const consentShown = (await page.locator(testId("screen-consent")).count()) > 0;
  const reason = await page.locator(testId("screen-screened-out")).getAttribute("data-reason");

  const id = await sessionIdOf(page);
  await waitForType(id, "SCREENED_OUT", 1);
  const types = rowsFor(id).map((r) => r.type);

  record(
    "CEFR A2: screened out, no consent shown, no randomisation",
    !consentShown &&
      reason === "language" &&
      !types.includes("CONSENT_GIVEN") &&
      !types.includes("ALLOCATED"),
    `Consent screen shown: ${consentShown}. Reason recorded: ${reason}. ` +
      `Events: ${[...new Set(types)].join(", ")}.`,
  );
});

test.afterAll(() => {
  const all = storedRows();
  mkdirSync(dirname(RESULTS), { recursive: true });
  writeFileSync(
    RESULTS,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        full_runs: FULL_RUNS,
        total_rows: all.length,
        sessions: new Set(all.map((r) => r.session_id)).size,
        checks,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  const failed = checks.filter((c) => c.status === "FAIL");
  // Reported, not thrown: the file has to be written either way, and
  // render-pilot-validation.ts is what turns a FAIL into a visible verdict.
  console.log(
    failed.length === 0
      ? `All ${checks.length} browser checks passed.`
      : `${failed.length} of ${checks.length} browser checks FAILED.`,
  );
});
