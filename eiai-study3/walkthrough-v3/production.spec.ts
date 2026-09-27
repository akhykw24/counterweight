import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drained, fullSession, open, tid } from "../validation-v3/driver";

/**
 * Brief step 8: walk the deployed study end to end as a test participant, in
 * every cell, on a computer and once on a phone-sized screen.
 *
 * What proves the data reached the database without reading it back: the
 * browser deletes an event from its write-ahead log only after the ingest
 * function answered 2xx, and the function answers 2xx only after Supabase
 * accepted the insert. An empty log at the end therefore means every event
 * of the session is in the table. The session ids are written out so the
 * rows can then be looked up in Supabase and seen marked `test`.
 */

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "data", "production-walkthrough.json");
const runs: { cell: string; screen: string; session_id: string; delivered: boolean }[] = [];

test.describe.configure({ mode: "serial" });

test.afterAll(() => {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), runs }, null, 2) + "\n");
});

for (const cell of ["EI-A", "EI-B", "Neutral-A", "Neutral-B"]) {
  test(`production, ${cell}, computer`, async ({ browser }) => {
    test.setTimeout(10 * 60 * 1000);
    const { context, page } = await open(browser, `test=true&pilot=true&cell=${cell}`);
    const id = await fullSession(page);
    await expect(page.locator(tid("debrief-score"))).toBeVisible();
    const delivered = await drained(page);
    runs.push({ cell, screen: "desktop", session_id: id, delivered });
    expect(delivered, "events still waiting in the browser: the server did not accept them").toBe(true);
    await context.close();
  });
}

test("production, Neutral-B, phone", async ({ browser }) => {
  test.setTimeout(10 * 60 * 1000);
  const { context, page } = await open(browser, "test=true&pilot=true&cell=Neutral-B", true);
  const id = await fullSession(page);
  const delivered = await drained(page);
  runs.push({ cell: "Neutral-B", screen: "phone", session_id: id, delivered });
  expect(delivered).toBe(true);
  await context.close();
});

test("production, a pilot link opens on the consent screen with the pilot notice", async ({ browser }) => {
  // test=true as well: a real pilot link opened here would leave a pilot
  // session behind in the data (the first version of this check did exactly
  // that). With both flags the page is the pilot one and every row is a test.
  const { context, page } = await open(browser, "test=true&pilot=true&p=1");
  await expect(page.locator(tid("screen-consent"))).toBeVisible();
  await expect(page.locator(tid("pilot-notice"))).toBeVisible();
  await context.close();
});
