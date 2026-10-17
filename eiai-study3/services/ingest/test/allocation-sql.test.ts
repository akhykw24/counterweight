import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

/**
 * The SQL the researcher pastes into Supabase, run on a real Postgres.
 *
 * PGlite is Postgres compiled to WebAssembly, so these are the actual
 * statements -- the plpgsql function, SKIP LOCKED, the conflict handling --
 * executed by the actual engine, not a reading of them. All four migrations
 * are applied in order, as they are in production.
 */

const SQL_DIR = resolve(process.cwd(), "services/ingest/sql");
const migration = (name: string) => readFileSync(resolve(SQL_DIR, name), "utf8");
const allocation = JSON.parse(readFileSync(resolve(process.cwd(), "materials/allocation-v3.json"), "utf8")) as {
  sequence: Record<string, string[]>;
  test_sequence: Record<string, string[]>;
};

let db: PGlite;

async function fresh(): Promise<PGlite> {
  const pg = new PGlite();
  // Supabase's roles, so the grants and revokes in the migrations mean something.
  await pg.exec("create role anon; create role authenticated; create role service_role;");
  for (const name of ["001_events.sql", "002_v3_envelope.sql", "003_run_mode.sql", "004_v3_allocation.sql"]) {
    await pg.exec(migration(name));
  }
  return pg;
}

async function claim(session: string, stratum: string): Promise<{ idx: number; cell: string }> {
  const result = await db.query<{ idx: number; cell: string }>("select * from public.claim_v3_slot($1, $2)", [
    session,
    stratum,
  ]);
  expect(result.rows).toHaveLength(1);
  return result.rows[0]!;
}

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

beforeEach(async () => {
  db = await fresh();
});

describe("the allocation table as loaded", () => {
  it("holds both main strata and both test strata, nothing claimed", async () => {
    const status = await db.query<{ stratum: string; claimed: number; total: number }>(
      "select stratum, claimed::int, total::int from public.v3_allocation_status()",
    );
    expect(status.rows).toEqual([
      { stratum: "B1-B2", claimed: 0, total: 400 },
      { stratum: "C1-C2-native", claimed: 0, total: 400 },
      { stratum: "test:B1-B2", claimed: 0, total: 200 },
      { stratum: "test:C1-C2-native", claimed: 0, total: 200 },
    ]);
  });

  it("is exactly the committed sequence", async () => {
    const rows = await db.query<{ stratum: string; idx: number; cell: string }>(
      "select stratum, idx, cell from public.v3_allocation_slots order by stratum, idx",
    );
    const expected = { ...allocation.sequence, ...allocation.test_sequence };
    for (const [stratum, cells] of Object.entries(expected)) {
      expect(rows.rows.filter((r) => r.stratum === stratum).map((r) => r.cell)).toEqual(cells);
    }
  });
});

describe("claim_v3_slot", () => {
  it("hands out slots in sequence order: the first four people get all four cells", async () => {
    const got = [];
    for (let n = 1; n <= 4; n += 1) got.push(await claim(uuid(n), "B1-B2"));
    expect(got.map((g) => g.idx)).toEqual([0, 1, 2, 3]);
    expect(got.map((g) => g.cell)).toEqual(allocation.sequence["B1-B2"]!.slice(0, 4));
    expect(new Set(got.map((g) => g.cell)).size).toBe(4);
  });

  it("gives a session that asks again the slot it already holds, and uses no new one", async () => {
    const first = await claim(uuid(1), "B1-B2");
    const again = await claim(uuid(1), "B1-B2");
    expect(again).toEqual(first);
    expect((await claim(uuid(2), "B1-B2")).idx).toBe(1);
  });

  it("never gives one session two slots, even if it later reports another stratum", async () => {
    const first = await claim(uuid(1), "B1-B2");
    expect(await claim(uuid(1), "C1-C2-native")).toEqual(first);
    expect((await claim(uuid(2), "C1-C2-native")).idx).toBe(0);
  });

  it("keeps the strata, and the test sequence, independent", async () => {
    await claim(uuid(1), "B1-B2");
    await claim(uuid(2), "B1-B2");
    expect((await claim(uuid(3), "C1-C2-native")).idx).toBe(0);
    expect((await claim(uuid(4), "test:B1-B2")).cell).toBe(allocation.test_sequence["test:B1-B2"]![0]);
    const status = await db.query<{ stratum: string; claimed: number }>(
      "select stratum, claimed::int from public.v3_allocation_status()",
    );
    expect(Object.fromEntries(status.rows.map((r) => [r.stratum, r.claimed]))).toEqual({
      "B1-B2": 2,
      "C1-C2-native": 1,
      "test:B1-B2": 1,
      "test:C1-C2-native": 0,
    });
  });

  it("gives many concurrent requests distinct slots", async () => {
    const results = await Promise.all(Array.from({ length: 40 }, (_, i) => claim(uuid(100 + i), "B1-B2")));
    const indices = results.map((r) => r.idx).sort((a, b) => a - b);
    expect(indices).toEqual(Array.from({ length: 40 }, (_, i) => i));
  });

  it("stops loudly when a stratum runs out, and says so", async () => {
    for (let n = 0; n < 200; n += 1) await claim(uuid(1000 + n), "test:C1-C2-native");
    await expect(claim(uuid(5000), "test:C1-C2-native")).rejects.toThrow(/exhausted/);
  });

  it("refuses a stratum that does not exist rather than inventing a cell", async () => {
    await expect(claim(uuid(1), "en:adult")).rejects.toThrow(/exhausted/);
  });
});

describe("running 004 again", () => {
  it("keeps every existing claim", async () => {
    const before = await claim(uuid(1), "B1-B2");
    await claim(uuid(2), "B1-B2");
    await db.exec(migration("004_v3_allocation.sql"));
    expect(await claim(uuid(1), "B1-B2")).toEqual(before);
    expect((await claim(uuid(3), "B1-B2")).idx).toBe(2);
  });

  it("refuses to run over a table that holds a different sequence", async () => {
    const committed = allocation.sequence["B1-B2"]![0]!;
    const other = ["EI-A", "EI-B", "Neutral-A", "Neutral-B"].find((c) => c !== committed)!;
    await db.query("update public.v3_allocation_slots set cell = $1 where stratum = 'B1-B2' and idx = 0", [other]);
    await expect(db.exec(migration("004_v3_allocation.sql"))).rejects.toThrow(/different sequence/);
  });
});

describe("access", () => {
  it("lets only the service role claim slots or read the status", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await expect(db.query("select * from public.claim_v3_slot($1, $2)", [uuid(1), "B1-B2"])).rejects.toThrow(
        /permission denied/,
      );
      await expect(db.query("select * from public.v3_allocation_status()")).rejects.toThrow(/permission denied/);
      await expect(db.query("select * from public.v3_allocation_slots")).rejects.toThrow(/permission denied/);
      await db.exec("reset role");
    }
    await db.exec("set role service_role");
    expect((await db.query("select * from public.claim_v3_slot($1, $2)", [uuid(1), "B1-B2"])).rows).toHaveLength(1);
    await db.exec("reset role");
  });
});
