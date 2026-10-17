import { expect, test } from "@playwright/test";
import {
  MISSION_OR_AFTER,
  afterModules,
  consentAndScreen,
  drained,
  fullSession,
  lesson,
  mission,
  missionStep,
  nova,
  open,
  preMeasures,
  sessionIdOf,
  tid,
  undelivered,
} from "./driver";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Pre-pilot validation for v3 (brief, step 6).
 *
 * Real browser, real dev server, the real ingest handler writing to
 * data/dev-events.jsonl. Every run uses test=true, so nothing written here can
 * ever be analysed.
 *
 *   - 20 complete sessions, 5 in each cell (forced with cell=), four browsers
 *     at a time;
 *   - a reload mid-lesson, a reload mid-task, the back button, a double click
 *     on Next, ten seconds without a network while saving, age 17, English
 *     A1-A2, and a complete session on a phone-sized screen.
 *
 * Results go to data/pilot-v3-validation.json; scripts/render-pilot-v3-
 * validation.ts adds the manifest, export and summary checks and writes
 * docs/PILOT_V3_VALIDATION.md. No retries: a delivery check that passes on a
 * second attempt has answered the opposite question.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EVENT_LOG = resolve(ROOT, "data", "dev-events.jsonl");
const DEV_SLOTS = resolve(ROOT, "data", "dev-slots.json");
const ALLOCATION = JSON.parse(readFileSync(resolve(ROOT, "materials", "allocation-v3.json"), "utf8")) as {
  test_sequence: Record<string, string[]>;
};
const RESULTS = resolve(ROOT, "data", "pilot-v3-validation.json");

const CELLS = ["EI-A", "Neutral-B", "EI-B", "Neutral-A"] as const;
type Cell = (typeof CELLS)[number];
const RUNS_PER_CELL = 5;

interface Row {
  event_id: string;
  session_id: string;
  participant_id: string | null;
  seq: number;
  client_ts: string;
  run_mode: string;
  cell: string | null;
  type: string;
  payload: Record<string, unknown>;
}

interface Check {
  name: string;
  status: "PASS" | "FAIL";
  detail: string;
}

const checks: Check[] = [];
const fullSessions: { id: string; cell: Cell; mobile: boolean }[] = [];

function record(name: string, ok: boolean, detail: string): void {
  checks.push({ name, status: ok ? "PASS" : "FAIL", detail });
}

const rows = (): Row[] =>
  existsSync(EVENT_LOG)
    ? readFileSync(EVENT_LOG, "utf8")
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as Row)
    : [];
const rowsFor = (id: string) => rows().filter((r) => r.session_id === id).sort((a, b) => a.seq - b.seq);
const countOf = (rs: Row[], type: string) => rs.filter((r) => r.type === type).length;


function versionFor(list: "A" | "B", claimId: string): "strong" | "weak" {
  const odd = Number(claimId.slice(-2)) % 2 === 1;
  return (list === "A") === odd ? "strong" : "weak";
}

// ---------------------------------------------------------------------------
// Driving the study
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  rmSync(EVENT_LOG, { force: true });
  // The dev server re-reads its slot claims on every request, so removing the
  // file starts the test sequence from slot 0 for this run.
  rmSync(DEV_SLOTS, { force: true });
  checks.length = 0;
});

test.afterAll(() => {
  mkdirSync(dirname(RESULTS), { recursive: true });
  const all = rows();
  writeFileSync(
    RESULTS,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        full_runs: fullSessions.length,
        sessions: new Set(all.map((r) => r.session_id)).size,
        total_rows: all.length,
        checks,
      },
      null,
      2,
    ) + "\n",
  );
});

test("twenty complete sessions, five in each cell", async ({ browser }) => {
  test.setTimeout(40 * 60 * 1000);
  const notDrained: string[] = [];
  for (let round = 0; round < RUNS_PER_CELL; round += 1) {
    await Promise.all(
      CELLS.map(async (cell) => {
        const { context, page } = await open(browser, `test=true&pilot=true&cell=${cell}`);
        const id = await fullSession(page);
        if (!(await drained(page))) notDrained.push(id);
        fullSessions.push({ id, cell, mobile: false });
        await context.close();
      }),
    );
  }

  const byCell = Object.fromEntries(CELLS.map((c) => [c, fullSessions.filter((s) => s.cell === c).length]));
  record(
    "20 complete sessions, 5 in each cell",
    fullSessions.length === 20 && CELLS.every((c) => byCell[c] === 5),
    `Sessions per cell: ${CELLS.map((c) => `${c} ${byCell[c]}`).join(", ")}.`,
  );
  record(
    "every event the browser recorded was acknowledged by the server",
    notDrained.length === 0,
    notDrained.length === 0
      ? "The write-ahead log was empty at the end of every session: nothing left undelivered."
      : `Still holding events: ${notDrained.join(", ")}`,
  );
});

test("a reload in the middle of a lesson resumes on the same message", async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  const { context, page } = await open(browser, "test=true&cell=EI-B");
  await consentAndScreen(page);
  const id = await sessionIdOf(page);
  await preMeasures(page);
  await nova(page);
  for (const n of [1, 2]) {
    await expect(page.locator(tid(`lesson-message-${n}`))).toBeVisible();
    await page.locator(tid("lesson-continue")).click();
    if (n < 2) await expect(page.locator(tid(`lesson-message-${n + 1}`))).toBeAttached();
  }
  await expect.poll(() => countOf(rowsFor(id), "lesson_item"), { timeout: 30_000 }).toBe(2);
  const before = rowsFor(id).map((r) => r.event_id);

  await page.reload();
  await expect(page.locator(tid("screen-lesson"))).toBeVisible();
  await lesson(page, 3);
  await expect(page.locator(MISSION_OR_AFTER).first()).toBeVisible();
  const ok = await drained(page);
  const after = rowsFor(id);
  const positions = after.filter((r) => r.type === "lesson_item").map((r) => r.payload["order_position"]);
  const kept = before.every((e) => after.some((r) => r.event_id === e));
  record(
    "a reload mid-lesson resumes on the same message and duplicates nothing",
    ok && kept && JSON.stringify(positions) === "[1,2,3,4]" && new Set(after.map((r) => r.event_id)).size === after.length,
    `Lesson positions recorded: ${JSON.stringify(positions)}; events before the reload kept: ${kept}; ${after.length} events, all distinct.`,
  );
  await context.close();
});

test("a reload in the middle of a mission task keeps the task", async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  const { context, page } = await open(browser, "test=true&cell=Neutral-A");
  await consentAndScreen(page);
  const id = await sessionIdOf(page);
  await preMeasures(page);
  await nova(page);
  await lesson(page);
  await missionStep(page);
  const task = await page.locator(tid("screen-mission-task")).getAttribute("data-task");
  await page.locator(tid("option-2")).click(); // chosen, not submitted
  await page.reload();
  const sameTask = await page.locator(tid("screen-mission-task")).getAttribute("data-task");
  await missionStep(page, 2);
  const ok = await drained(page);
  const answers = rowsFor(id).filter((r) => r.type === "mission_answer");
  const forTask = answers.filter((r) => r.payload["task_id"] === task).length;
  record(
    "a reload mid-task returns to the same task and records it once",
    ok && sameTask === task && forTask === 1 && answers.length === 2,
    `Task before reload ${task}, after ${sameTask}; answers for it: ${forTask}; mission answers so far: ${answers.length}.`,
  );
  await context.close();
});

test("the browser's back button neither leaves nor rewinds the study", async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  const { context, page } = await open(browser, "test=true&cell=EI-A");
  await consentAndScreen(page);
  const id = await sessionIdOf(page);
  await preMeasures(page);
  await nova(page);
  await lesson(page);
  const task = await page.locator(tid("screen-mission-task")).getAttribute("data-task");
  const before = rowsFor(id).length;
  await page.goBack().catch(() => undefined);
  await page.waitForTimeout(1500);
  const stillThere = await page.locator(`[data-task="${task}"]`).isVisible();
  await page.goForward().catch(() => undefined);
  await page.waitForTimeout(1000);
  await missionStep(page);
  const ok = await drained(page);
  const after = rowsFor(id);
  record(
    "the back button neither leaves nor rewinds the study",
    ok && stillThere && after.length > before && new Set(after.map((r) => r.event_id)).size === after.length,
    `Same task on screen after Back: ${stillThere}. ${after.length} events, all distinct.`,
  );
  await context.close();
});

test("a double click records one answer", async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  const { context, page } = await open(browser, "test=true&cell=Neutral-B");
  await consentAndScreen(page);
  const id = await sessionIdOf(page);
  await preMeasures(page);
  await nova(page);
  for (let n = 1; n <= 4; n += 1) {
    await expect(page.locator(tid(`lesson-message-${n}`))).toBeVisible();
    await page.locator(tid("lesson-continue")).click({ clickCount: 2, delay: 30 });
    if (n < 4) await expect(page.locator(tid(`lesson-message-${n + 1}`))).toBeAttached();
  }
  await missionStep(page, 1, 2);
  await missionStep(page, 1, 2);
  const ok = await drained(page);
  await page.waitForTimeout(2000);
  const rs = rowsFor(id);
  const lessons = countOf(rs, "lesson_item");
  const answers = countOf(rs, "mission_answer") + countOf(rs, "attention_check");
  record(
    "a double click on Continue or Next records one event",
    ok && lessons === 4 && answers === 2,
    `After double-clicking every Continue and two Nexts: ${lessons} lesson items, ${answers} mission answers.`,
  );
  await context.close();
});

test("ten seconds without a network while saving loses nothing", async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  const { context, page } = await open(browser, "test=true&cell=EI-B");
  await consentAndScreen(page);
  const id = await sessionIdOf(page);
  await preMeasures(page);
  await nova(page);
  await lesson(page);
  await expect.poll(() => countOf(rowsFor(id), "lesson_item"), { timeout: 30_000 }).toBe(4);

  await context.route("**/api/events", (route) => route.abort("internetdisconnected"));
  await missionStep(page);
  await missionStep(page);
  const outageStarted = Date.now();
  const serverDuring = rowsFor(id).length;
  await page.waitForTimeout(10_000);
  const held = await undelivered(page);
  const serverAfterTen = rowsFor(id).length;
  await context.unroute("**/api/events");
  await missionStep(page);
  const ok = await drained(page);
  const rs = rowsFor(id);
  const contiguous = rs.every((r, i) => r.seq === i);
  record(
    "ten seconds without a network while saving loses nothing",
    ok && held > 0 && serverAfterTen === serverDuring && countOf(rs, "mission_answer") + countOf(rs, "attention_check") === 3 && contiguous &&
      new Set(rs.map((r) => r.event_id)).size === rs.length,
    `During ${Math.round((Date.now() - outageStarted) / 1000)} s offline the server stayed at ${serverDuring} rows while the browser held ${held}; ` +
      `after recovery ${rs.length} rows, sequence contiguous: ${contiguous}, all distinct.`,
  );
  await context.close();
});

test("age 17 is turned away before consent is used, with nothing allocated", async ({ browser }) => {
  const { context, page } = await open(browser, "test=true&pilot=true");
  await consentAndScreen(page, "17", "C1");
  await expect(page.locator(tid("screen-ineligible"))).toBeVisible();
  const id = await sessionIdOf(page);
  await drained(page);
  const types = rowsFor(id).map((r) => r.type);
  const reason = rowsFor(id).find((r) => r.type === "screened_out")?.payload["reason"];
  record(
    "age 17: screened out for age, no allocation, no age stored",
    reason === "age" && !types.includes("allocation") && !types.includes("screening_answered"),
    `Events: ${types.join(", ")}.`,
  );
  await context.close();
});

test("English A1-A2 is turned away with nothing allocated", async ({ browser }) => {
  const { context, page } = await open(browser, "test=true&pilot=true");
  await consentAndScreen(page, "25", "A1-A2");
  await expect(page.locator(tid("screen-ineligible"))).toBeVisible();
  const id = await sessionIdOf(page);
  await drained(page);
  const types = rowsFor(id).map((r) => r.type);
  const reason = rowsFor(id).find((r) => r.type === "screened_out")?.payload["reason"];
  record(
    "English A1-A2: screened out for language, no allocation",
    reason === "language" && !types.includes("allocation"),
    `Events: ${types.join(", ")}.`,
  );
  await context.close();
});

test("a complete session on a phone-sized screen", async ({ browser }) => {
  test.setTimeout(10 * 60 * 1000);
  const { context, page } = await open(browser, "test=true&pilot=true&cell=Neutral-A", true);
  const overflow: string[] = [];
  const checkWidth = async (where: string) => {
    const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (wide) overflow.push(where);
  };
  await checkWidth("consent");
  await consentAndScreen(page);
  const id = await sessionIdOf(page);
  await checkWidth("pre-measures");
  await preMeasures(page);
  await nova(page);
  await lesson(page);
  await checkWidth("mission");
  await mission(page);
  await nova(page);
  for (const module of [2, 3]) {
    await lesson(page);
    await mission(page);
    await nova(page);
    void module;
  }
  await checkWidth("quiz");
  await afterModules(page, true);
  await checkWidth("debrief");
  const ok = await drained(page);
  fullSessions.push({ id, cell: "Neutral-A", mobile: true });
  const rs = rowsFor(id);
  record(
    "a complete session works on a phone-sized screen (Pixel 5, 393 px)",
    ok && countOf(rs, "session_completed") === 1 && overflow.length === 0,
    `Completed: ${countOf(rs, "session_completed") === 1}. Horizontal scrolling on: ${overflow.join(", ") || "no screen"}.`,
  );
  await context.close();
});

test("one link: four people at once get four different cells, in sequence order", async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  // ?test=true with no cell= and no number is the rehearsal of the single
  // public link: the same code path, the same endpoint, the separate test
  // sequence. All four report English B2, so all four share one stratum.
  const results = await Promise.all(
    [0, 1, 2, 3].map(async () => {
      const { context, page } = await open(browser, "test=true");
      await consentAndScreen(page);
      const id = await sessionIdOf(page);
      await preMeasures(page);
      await expect(page.locator(tid("screen-intro"))).toBeVisible({ timeout: 30_000 });
      await drained(page);
      await context.close();
      return id;
    }),
  );
  const allocations = results.map((id) => rowsFor(id).find((r) => r.type === "allocation")!);
  const cells = allocations.map((a) => String(a.payload["cell"]));
  const indices = allocations.map((a) => Number(a.payload["sequence_index"])).sort((a, b) => a - b);
  const methods = new Set(allocations.map((a) => a.payload["method"]));
  const expected = ALLOCATION.test_sequence["test:B1-B2"]!;
  const matches = allocations.every((a) => expected[Number(a.payload["sequence_index"])] === a.payload["cell"]);
  record(
    "one link: four people starting together get four different cells, from the sequence",
    new Set(cells).size === 4 && JSON.stringify(indices) === "[0,1,2,3]" && matches && methods.size === 1 && methods.has("test_sequence"),
    `Cells: ${cells.join(", ")}; slots ${indices.join(", ")}; each cell matches its slot in the committed test sequence: ${matches}.`,
  );
});

test("a lost connection while a slot is being handed out costs nothing", async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  const { context, page } = await open(browser, "test=true");
  await consentAndScreen(page);
  const id = await sessionIdOf(page);
  await context.route("**/api/allocate", (route) => route.abort("internetdisconnected"));
  await preMeasures(page);
  await expect(page.locator(tid("screen-allocating"))).toBeVisible();
  await page.waitForTimeout(10_000);
  const stillWaiting = await page.locator(tid("screen-allocating")).isVisible();
  await context.unroute("**/api/allocate");
  await expect(page.locator(tid("screen-intro"))).toBeVisible({ timeout: 30_000 });
  await drained(page);
  const allocations = rowsFor(id).filter((r) => r.type === "allocation");
  record(
    "a lost connection while the slot is handed out: the participant waits, then gets exactly one slot",
    stillWaiting && allocations.length === 1,
    `Waiting screen shown during 10 s offline: ${stillWaiting}; allocation events afterwards: ${allocations.length}.`,
  );
  await context.close();
});

test("a reload while waiting for a slot does not take a second one", async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  const { context, page } = await open(browser, "test=true");
  await consentAndScreen(page, "29", "C1");
  const id = await sessionIdOf(page);
  // The first request reaches the server and claims the slot, but its answer
  // is lost: exactly the case where a careless retry would take a second slot.
  let first = true;
  await context.route("**/api/allocate", async (route) => {
    if (first) {
      first = false;
      await route.fetch();
      await route.abort("internetdisconnected");
      return;
    }
    await route.continue();
  });
  await preMeasures(page);
  await expect(page.locator(tid("screen-allocating"))).toBeVisible();
  await page.reload();
  await preMeasures(page);
  await expect(page.locator(tid("screen-intro"))).toBeVisible({ timeout: 30_000 });
  await drained(page);
  const slots = JSON.parse(readFileSync(DEV_SLOTS, "utf8")) as Record<string, { stratum: string; index: number }>;
  const held = Object.entries(slots).filter(([session]) => session === id);
  const allocation = rowsFor(id).filter((r) => r.type === "allocation");
  record(
    "a reload while waiting for a slot: one session, one slot, one allocation",
    held.length === 1 && allocation.length === 1 && allocation[0]!.payload["sequence_index"] === held[0]![1].index,
    `Slots held by this session: ${held.length} (${held.map(([, s]) => `${s.stratum} #${s.index}`).join(", ")}); allocation events: ${allocation.length}.`,
  );
  await context.close();
});

test("every complete session has the right counts, versions and cell", () => {
  const all = rows();
  const wrongCounts: string[] = [];
  const wrongVersions: string[] = [];
  const wrongCell: string[] = [];
  for (const { id, cell } of fullSessions) {
    const rs = rowsFor(id);
    const counts = ["lesson_item", "mission_answer", "attention_check", "quiz_rating"].map((t) => countOf(rs, t));
    if (JSON.stringify(counts) !== "[12,12,1,16]") wrongCounts.push(`${id.slice(0, 8)} ${counts.join("/")}`);
    const list = cell.endsWith("-A") ? "A" : "B";
    for (const r of rs) {
      const claim = r.payload["claim_id"];
      const version = r.payload["version"];
      if (typeof claim === "string" && typeof version === "string" && version !== versionFor(list, claim)) {
        wrongVersions.push(`${id.slice(0, 8)} ${r.type} ${claim}=${version}`);
      }
    }
    const allocatedAt = rs.findIndex((r) => r.type === "allocation");
    const alloc = rs[allocatedAt];
    if (!alloc || alloc.payload["cell"] !== cell) wrongCell.push(`${id.slice(0, 8)} allocated ${String(alloc?.payload["cell"])}`);
    rs.forEach((r, i) => {
      const expected = i < allocatedAt ? null : cell;
      if (r.cell !== expected) wrongCell.push(`${id.slice(0, 8)} seq ${r.seq} cell ${r.cell}`);
    });
  }
  record(
    "each complete session: 12 lesson items, 12 mission answers, 1 attention check, 16 quiz ratings",
    wrongCounts.length === 0,
    wrongCounts.length === 0 ? `All ${fullSessions.length} complete sessions.` : wrongCounts.join("; "),
  );
  record(
    "strong and weak versions match the cell's list in every event",
    wrongVersions.length === 0,
    wrongVersions.length === 0 ? "List A: odd claims strong; list B: even claims strong. No exceptions." : wrongVersions.slice(0, 10).join("; "),
  );
  record(
    "every event carries the cell from allocation onwards, and none before",
    wrongCell.length === 0,
    wrongCell.length === 0 ? "Checked on every row of every complete session." : wrongCell.slice(0, 10).join("; "),
  );

  const ids = new Set(all.map((r) => r.event_id));
  const positions = new Set(all.map((r) => `${r.session_id}#${r.seq}`));
  record("no event was stored twice", ids.size === all.length, `${all.length} rows, ${ids.size} distinct event ids.`);
  record(
    "no event was lost: sequence numbers are contiguous in every session",
    [...new Set(all.map((r) => r.session_id))].every((s) => rowsFor(s).every((r, i) => r.seq === i)) && positions.size === all.length,
    `${new Set(all.map((r) => r.session_id)).size} sessions checked; ${positions.size} distinct (session, seq) pairs.`,
  );
  const modes = new Set(all.map((r) => r.run_mode));
  record("every row is marked as a test run", modes.size === 1 && modes.has("test"), `run_mode values: ${[...modes].join(", ")}.`);
  const feedback = fullSessions.filter(({ id }) => countOf(rowsFor(id), "pilot_feedback") > 0).length;
  record(
    "pilot links show the feedback questions and record the answers",
    feedback === fullSessions.length,
    `${feedback} of ${fullSessions.length} complete sessions carry pilot_feedback.`,
  );
});
