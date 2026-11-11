import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * docs/sql/main_v3_status.sql, the query the researcher pastes into Supabase
 * to see how many usable responses there are, run on a real Postgres against
 * sessions built to hit every exclusion once.
 */

const sql = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

let db: PGlite;
let rows: Record<string, Record<string, unknown>>;
let seq = 0;
let t = Date.parse("2026-11-10T10:00:00Z");

const uuid = () => crypto.randomUUID();

async function event(
  session: string,
  participant: string,
  type: string,
  payload: Record<string, unknown>,
  cell: string | null,
  runMode = "live",
) {
  t += 1000;
  await db.query(
    `insert into public.events (event_id, session_id, participant_id, seq, client_ts, type, payload, run_mode, cell)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [uuid(), session, participant, seq++, new Date(t).toISOString(), type, JSON.stringify(payload), runMode, cell],
  );
}

interface Spec {
  participant?: string;
  cell: string;
  finish?: boolean;
  attention?: boolean;
  distractors?: number;
  minutes?: number;
  withdraw?: boolean;
  repeatBrowser?: boolean;
  runMode?: string;
}

async function session(spec: Spec): Promise<string> {
  const s = uuid();
  const p = spec.participant ?? uuid();
  const mode = spec.runMode ?? "live";
  await event(s, p, "session_started", { repeat_session: spec.repeatBrowser ?? false }, null, mode);
  await event(s, p, "allocation", { cell: spec.cell }, spec.cell, mode);
  for (let i = 0; i < 12; i += 1) {
    const role = i < (spec.distractors ?? 0) ? "distractor" : "lesson";
    await event(s, p, "mission_answer", { choice_role: role }, spec.cell, mode);
  }
  await event(s, p, "attention_check", { passed: spec.attention ?? true }, spec.cell, mode);
  if (spec.finish ?? true) {
    await event(s, p, "session_completed", { total_duration_ms: (spec.minutes ?? 18) * 60_000 }, spec.cell, mode);
  }
  if (spec.withdraw) await event(s, p, "withdrawal_requested", { at_screen: "debrief" }, spec.cell, mode);
  return p;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role;");
  for (const name of ["001_events.sql", "002_v3_envelope.sql", "003_run_mode.sql"]) {
    await db.exec(sql(`services/ingest/sql/${name}`));
  }
  const returning = await session({ cell: "EI-A" }); // usable
  await session({ cell: "EI-A", minutes: 6 }); // usable, but under 8 minutes
  await session({ cell: "EI-B", attention: false }); // failed attention check
  await session({ cell: "EI-B", distractors: 4 }); // 4 distractors
  await session({ cell: "Neutral-A", finish: false }); // did not finish
  await session({ cell: "Neutral-A", withdraw: true }); // removed their data
  await session({ cell: "Neutral-B", participant: returning }); // second session of the first person
  await session({ cell: "Neutral-B", repeatBrowser: true }); // browser had completed before
  await session({ cell: "Neutral-B", runMode: "test" }); // a test run: ignored
  await session({ cell: "EI-A", runMode: "pilot" }); // a pilot run: ignored

  const result = await db.query<Record<string, unknown>>(sql("docs/sql/main_v3_status.sql"));
  rows = Object.fromEntries(result.rows.map((r) => [String(r["version"]), r]));
}, 120_000);

describe("main_v3_status.sql", () => {
  it("counts only live sessions, by version and in total", () => {
    expect(Object.keys(rows)).toEqual(["EI-A", "EI-B", "Neutral-A", "Neutral-B", "ALL"]);
    expect(Number(rows["ALL"]!["started"])).toBe(8);
    expect(Number(rows["ALL"]!["finished"])).toBe(7);
  });

  it("applies each exclusion, and only the decidable ones", () => {
    const all = rows["ALL"]!;
    expect(Number(all["usable"])).toBe(2);
    expect(Number(all["failed_attention"])).toBe(1);
    expect(Number(all["distractor_4_plus"])).toBe(1);
    expect(Number(all["repeat"])).toBe(2);
    expect(Number(all["removed_data"])).toBe(1);
    // Too fast has no threshold yet: shown, not excluded.
    expect(Number(all["usable_under_8_min"])).toBe(1);
    expect(Number(rows["EI-A"]!["usable"])).toBe(2);
    expect(Number(rows["Neutral-B"]!["usable"])).toBe(0);
  });

  it("keeps a returning participant's first session and drops the second", () => {
    expect(Number(rows["EI-A"]!["usable"])).toBe(2);
    expect(Number(rows["Neutral-B"]!["repeat"])).toBe(2);
  });

  it("reports the usable average time in minutes", () => {
    expect(Number(rows["ALL"]!["usable_avg_minutes"])).toBe(12);
  });
});
