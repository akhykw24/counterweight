import { expect, test, type Page } from "@playwright/test";
import { rmSync } from "node:fs";
import {
  EVENT_LOG,
  resetParticipant,
  rowsFor,
  sessionIdOf,
  waitForRows,
  waitForType,
} from "./event-log.js";

/**
 * The participant-to-server path (spec v2 section 3, section 6).
 *
 * The gap this closes
 * -------------------
 * Every other end-to-end test asserted the write-ahead log in IndexedDB and
 * stopped there. That proves the browser recorded the session; it proves
 * nothing about anybody receiving it. Until the dev server mounted an ingest
 * endpoint, `pnpm dev` answered 404 to every batch, the log kept everything
 * and retried forever, and the study looked entirely healthy from the outside.
 * The offline-first design made the most important failure in the system
 * invisible.
 *
 * So this file asserts the other half: a participant's events reach a server
 * and are stored there, in order, exactly once, with the schema honoured. It
 * is also the only place that reads the write-ahead log directly, because the
 * one thing the log is the right source for is proving it holds events while
 * the network is down.
 *
 * It runs against the file-backed development store, not Supabase. What it can
 * prove is that the client, the schema and the handler agree -- which is the
 * part that breaks. What it cannot prove is that a cloud project is configured;
 * that is a deployment fact, and docs/DEPLOY.md covers checking it.
 */

const testId = (id: string) => `[data-testid="${id}"]`;

test.beforeAll(() => {
  // A fresh log per run, so a stale file cannot make a broken endpoint look
  // like a working one.
  rmSync(EVENT_LOG, { force: true });
});

test.beforeEach(async ({ page }) => {
  await resetParticipant(page);
});

async function consentAndAllocate(page: Page): Promise<void> {
  await page.locator(testId("age-35+")).click();
  await page.locator(testId("cefr-B2")).click();
  await page.locator(testId("study-language-english")).click();
  await page.locator(testId("training-no")).click();
  await page.locator(testId("submit-eligibility")).click();
  await page.locator(testId("confirm-adult")).click();
  await page.locator(testId("give-consent")).click();
  await page.locator(testId("allocate")).click();
}

test("a participant's events reach the server, not just their own browser", async ({ page }) => {
  test.setTimeout(60_000);

  await consentAndAllocate(page);
  await expect(page.locator(testId("screen-item-estimate"))).toBeVisible();

  const id = await sessionIdOf(page);
  const rows = await waitForRows(id, 3);

  const types = rows.map((row) => row.type);
  expect(types).toContain("SESSION_STARTED");
  expect(types).toContain("CONSENT_GIVEN");
  expect(types).toContain("ALLOCATED");

  // The allocation is the row the analysis keys everything else off. If it
  // arrives without a condition, the study has no independent variable.
  const allocated = rows.find((row) => row.type === "ALLOCATED")!;
  expect(["warm", "neutral"]).toContain(allocated.payload["condition"]);
  expect(allocated.payload["cefr"]).toBe("B2");
});

test("a dropped connection loses nothing: the log holds, then delivers", async ({ page }) => {
  test.setTimeout(90_000);

  // This is the guarantee section 6 exists for, and the only test that puts
  // both halves together. The first version of this test compared the server's
  // rows against the browser's write-ahead log and found the log empty --
  // correctly, because delivered events are removed from it. So the thing to
  // assert is the transition: held while offline, delivered when the network
  // returns, and nothing left behind either way.
  await consentAndAllocate(page);
  await expect(page.locator(testId("screen-item-estimate"))).toBeVisible();

  const id = await sessionIdOf(page);
  await waitForRows(id, 3);
  const beforeOutage = rowsFor(id).length;

  await page.route("**/api/events", (route) => route.abort("failed"));

  // One item's worth of work with no network at all.
  await page.locator(testId("initial-estimate")).click();
  await page.locator(testId("initial-confidence")).fill("55");
  await page.locator(testId("submit-initial")).click();
  await expect(page.locator(testId("advice"))).toBeVisible();
  await page.locator(testId("request-final")).click();
  await page.locator(testId("final-estimate")).click();
  await page.locator(testId("final-confidence")).click();
  await page.locator(testId("submit-final")).click();
  await page.locator(testId("argument-strength-5")).click();
  await page.waitForTimeout(5_000);

  // The participant noticed nothing, and the server received nothing.
  await expect(page.locator(testId("screen-item-estimate"))).toBeVisible();
  expect(rowsFor(id).length).toBe(beforeOutage);

  const heldOffline = await page.evaluate(async () => {
    const records = await new Promise<{ event: { type: string } }[]>((resolve, reject) => {
      const request = indexedDB.open("eiai-telemetry");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const tx = request.result.transaction("events", "readonly");
        const all = tx.objectStore("events").getAll();
        all.onsuccess = () => resolve(all.result);
        all.onerror = () => reject(all.error);
      };
    });
    return records.map((record) => record.event.type);
  });
  expect(heldOffline).toContain("ESTIMATE_FINALIZED");
  expect(heldOffline).toContain("ARGUMENT_RATED");

  await page.unroute("**/api/events");

  // Everything the outage held now arrives, and arrives once.
  await expect
    .poll(() => rowsFor(id).filter((row) => row.type === "ARGUMENT_RATED").length, {
      timeout: 30_000,
      message: "events held during the outage never reached the server",
    })
    .toBe(1);

  const delivered = rowsFor(id);
  expect(delivered.map((row) => row.type)).toContain("ESTIMATE_FINALIZED");
  expect(new Set(delivered.map((row) => row.event_id)).size).toBe(delivered.length);
});

test("a reload does not duplicate events server-side", async ({ page }) => {
  test.setTimeout(60_000);

  // At-least-once delivery means the browser may resend anything it has not
  // had acknowledged. Idempotency on event_id is what stops that becoming
  // duplicate rows, and a duplicated ESTIMATE_FINALIZED would silently double
  // a participant's weight in every projection.
  await consentAndAllocate(page);
  await expect(page.locator(testId("screen-item-estimate"))).toBeVisible();

  const id = await sessionIdOf(page);
  await waitForRows(id, 3);

  await page.reload();
  await expect(page.locator(testId("screen-item-estimate"))).toBeVisible();
  await page.waitForTimeout(5_000);

  const ids = rowsFor(id).map((row) => row.event_id);
  expect(new Set(ids).size).toBe(ids.length);

  // And no two events at the same position, which is the other constraint the
  // real table carries.
  const positions = rowsFor(id).map((row) => row.seq);
  expect(new Set(positions).size).toBe(positions.length);
});

test("a full session arrives complete, item by item", async ({ page }) => {
  test.setTimeout(180_000);

  await consentAndAllocate(page);

  for (let i = 0; i < 12; i += 1) {
    await expect(page.locator(testId("screen-item-estimate"))).toBeVisible();
    await page.locator(testId("initial-estimate")).click();
    await page.locator(testId("initial-confidence")).fill(String(i < 6 ? 30 : 80));
    await page.locator(testId("submit-initial")).click();
    await page.locator(testId("request-final")).click();
    await page.locator(testId("final-estimate")).click();
    await page.locator(testId("final-confidence")).click();
    await page.locator(testId("submit-final")).click();
    await page.locator(testId("argument-strength-4")).click();
  }

  await expect(page.locator(testId("screen-questionnaire"))).toBeVisible();

  const id = await sessionIdOf(page);
  // Poll the measure itself, not a row total: a total is reached partway
  // through the last flush, which made this fail at nine items and look like a
  // dropped-event bug rather than an impatient test.
  await waitForType(id, "ARGUMENT_RATED", 12);

  const rows = rowsFor(id);
  const count = (type: string) => rows.filter((row) => row.type === type).length;
  expect(count("ITEM_PRESENTED")).toBe(12);
  expect(count("ESTIMATE_FINALIZED")).toBe(12);
  expect(count("ARGUMENT_RATED")).toBe(12);

  // Nothing was dropped in the middle. A batch-boundary bug produces a gap,
  // and a count alone would miss it: twelve of each could still be twelve
  // wrong ones if events elsewhere in the stream went missing.
  //
  // Contiguity is the assertion, not the starting value. The browser numbers
  // from 0 and pipeline/simulate.py numbers from 1; the schema allows either
  // (`check (seq >= 0)`) and nothing computes on the absolute number -- seq
  // orders events within a session and does no more than that.
  const positions = rows.map((row) => row.seq);
  for (let i = 1; i < positions.length; i += 1) {
    expect(positions[i], `gap in the sequence before position ${positions[i]}`).toBe(
      positions[i - 1]! + 1,
    );
  }
});

test("the server refuses an event the schema does not recognise", async ({ page }) => {
  // The rejection path matters as much as the happy one: a client sending
  // something malformed must be told, not quietly accepted into the corpus.
  const response = await page.request.post("/api/events", {
    data: {
      events: [
        {
          event_id: "44444444-4444-4444-8444-444444444444",
          session_id: "55555555-5555-4555-8555-555555555555",
          seq: 1,
          client_ts: "2026-09-04T10:00:00.000Z",
          type: "NOT_A_REAL_EVENT",
          payload: {},
        },
      ],
    },
  });

  expect(response.status()).toBe(400);
  expect(await response.json()).toMatchObject({ error: "invalid_batch" });
});
