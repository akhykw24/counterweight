import { expect, test, type APIRequestContext } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drained, fullSession, open, tid } from "../validation-v3/driver";

/**
 * Walk the deployed study end to end as a test participant (brief, step 8),
 * now through the single public link.
 *
 * What proves the data reached the database without reading it back: the
 * browser deletes an event from its write-ahead log only after the ingest
 * function answered 2xx, and the function answers 2xx only after Supabase
 * accepted the insert. An empty log at the end therefore means every event
 * of the session is in the table.
 *
 * The runs use ?test=true without cell=: the rehearsal of the public link,
 * which takes its cell from the server exactly as a participant's browser
 * does, but from the separate test sequence. Not one main-study slot is used,
 * and the last check proves it.
 */

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "data", "production-walkthrough.json");
const runs: { query: string; screen: string; session_id: string; cell: string | null; delivered: boolean }[] = [];
let liveBefore: Record<string, number> = {};

test.describe.configure({ mode: "serial" });

async function status(request: APIRequestContext): Promise<Record<string, { claimed: number; total: number }>> {
  const response = await request.get("/api/allocate");
  expect(response.ok(), `GET /api/allocate answered ${response.status()}: ${await response.text()}`).toBe(true);
  const body = (await response.json()) as { strata: { stratum: string; claimed: number; total: number }[] };
  return Object.fromEntries(body.strata.map((s) => [s.stratum, { claimed: s.claimed, total: s.total }]));
}

test.beforeAll(async ({ request }) => {
  const s = await status(request);
  liveBefore = { "B1-B2": s["B1-B2"]!.claimed, "C1-C2-native": s["C1-C2-native"]!.claimed };
});

test.afterAll(() => {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), live_claimed_before: liveBefore, runs }, null, 2) + "\n");
});

test("the allocation sequence is loaded on the server", async ({ request }) => {
  const s = await status(request);
  for (const stratum of ["B1-B2", "C1-C2-native"]) expect(s[stratum]?.total).toBe(400);
  for (const stratum of ["test:B1-B2", "test:C1-C2-native"]) expect(s[stratum]?.total).toBe(200);
});

test("four people through the one link get four different cells", async ({ browser }) => {
  test.setTimeout(15 * 60 * 1000);
  for (let n = 0; n < 4; n += 1) {
    const { context, page } = await open(browser, "test=true");
    const id = await fullSession(page, false);
    await expect(page.locator(tid("debrief-score"))).toBeVisible();
    const delivered = await drained(page);
    const cell = await page.evaluate(() => {
      const raw = localStorage.getItem("eiai.v3.session_snapshot");
      return raw ? ((JSON.parse(raw) as { context?: { cell?: string } }).context?.cell ?? null) : null;
    });
    runs.push({ query: "test=true", screen: "desktop", session_id: id, cell, delivered });
    expect(delivered, "events still waiting in the browser: the server did not accept them").toBe(true);
    await context.close();
  }
  const firstFour = runs.slice(-4).map((r) => r.cell);
  expect(new Set(firstFour).size, `cells: ${firstFour.join(", ")}`).toBe(4);
});

test("the one link on a phone-sized screen", async ({ browser }) => {
  test.setTimeout(10 * 60 * 1000);
  const { context, page } = await open(browser, "test=true", true);
  const id = await fullSession(page, false);
  const delivered = await drained(page);
  runs.push({ query: "test=true", screen: "phone", session_id: id, cell: null, delivered });
  expect(delivered).toBe(true);
  await context.close();
});

test("the bare public link opens the study, and this check writes nothing", async ({ browser }) => {
  // Every request to the ingest endpoint is blocked in this browser, so the
  // events of opening the page stay in its own storage and vanish with it:
  // checking the real link must not leave a live row in the real data.
  const context = await browser.newContext();
  await context.route("**/api/events", (route) => route.abort("blockedbyclient"));
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.locator(tid("screen-consent"))).toBeVisible();
  await expect(page.locator(tid("pilot-notice"))).toHaveCount(0);
  await context.close();
});

test("no main-study slot was used by any of this", async ({ request }) => {
  const s = await status(request);
  expect({ "B1-B2": s["B1-B2"]!.claimed, "C1-C2-native": s["C1-C2-native"]!.claimed }).toEqual(liveBefore);
});
