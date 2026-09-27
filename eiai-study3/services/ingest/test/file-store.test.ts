/**
 * The development event store.
 *
 * Its job is to make the participant-to-server path runnable without a cloud
 * account, so the tests that matter are the ones proving it behaves like the
 * real table where a client bug would show up -- and the one proving it can
 * never become the real table.
 */

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProductionUseError, createFileStore, readEventRows } from "../src/file-store.js";
import type { EventRow } from "../src/handler.js";

let directory: string;
let path: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "eiai-store-"));
  path = join(directory, "events.jsonl");
});

const ORIGINAL_NODE_ENV = process.env["NODE_ENV"];

afterEach(() => {
  if (ORIGINAL_NODE_ENV === undefined) delete process.env["NODE_ENV"];
  else process.env["NODE_ENV"] = ORIGINAL_NODE_ENV;
});

function row(over: Partial<EventRow> = {}): EventRow {
  return {
    event_id: "11111111-1111-4111-8111-111111111111",
    session_id: "22222222-2222-4222-8222-222222222222",
    seq: 1,
    client_ts: "2026-09-04T10:00:00.000Z",
    run_mode: "live",
    type: "SESSION_STARTED",
    payload: { app_version: "0.1.0" },
    participant_id: null,
    cell: null,
    ...over,
  } as EventRow;
}

describe("writing", () => {
  it("appends every row and reports how many it wrote", async () => {
    const store = createFileStore(path);
    const written = await store.insert([row(), row({ event_id: "a", seq: 2 })]);

    expect(written).toBe(2);
    expect(readEventRows(path)).toHaveLength(2);
  });

  it("creates the directory rather than failing on a fresh clone", async () => {
    const nested = join(directory, "deep", "deeper", "events.jsonl");
    const store = createFileStore(nested);
    await store.insert([row()]);
    expect(readEventRows(nested)).toHaveLength(1);
  });

  it("writes nothing for an empty batch", async () => {
    const store = createFileStore(path);
    expect(await store.insert([])).toBe(0);
  });
});

describe("idempotency, which is what at-least-once delivery rests on", () => {
  it("ignores an event_id it already holds", async () => {
    const store = createFileStore(path);
    await store.insert([row()]);
    const second = await store.insert([row()]);

    expect(second).toBe(0);
    expect(readEventRows(path)).toHaveLength(1);
  });

  it("never overwrites a stored event, even when the payload differs", async () => {
    // A client retrying with a mutated payload must not be able to rewrite
    // history. The first write wins, exactly as ON CONFLICT DO NOTHING.
    const store = createFileStore(path);
    await store.insert([row({ payload: { app_version: "first" } })]);
    await store.insert([row({ payload: { app_version: "second" } })]);

    const stored = readEventRows(path);
    expect(stored).toHaveLength(1);
    expect((stored[0]!.payload as { app_version: string }).app_version).toBe("first");
  });

  it("stays idempotent across a restart, because the browser will retry", async () => {
    // The dev server restarts constantly. The participant's write-ahead log
    // does not know that and will resend anything it has not had acknowledged.
    const first = createFileStore(path);
    await first.insert([row()]);

    const afterRestart = createFileStore(path);
    expect(await afterRestart.insert([row()])).toBe(0);
    expect(readEventRows(path)).toHaveLength(1);
  });
});

describe("the constraints the real table enforces", () => {
  it("rejects a second event at the same position in a session", async () => {
    // events_session_seq_unique. A client that reuses sequence numbers after a
    // bad resume corrupts every ordered projection, so this has to fail loudly
    // in development rather than only in production.
    const store = createFileStore(path);
    await store.insert([row({ event_id: "a", seq: 7 })]);

    await expect(store.insert([row({ event_id: "b", seq: 7 })])).rejects.toThrow(/seq 7/);
  });

  it("allows the same seq in a different session", async () => {
    const store = createFileStore(path);
    await store.insert([row({ event_id: "a", seq: 1 })]);
    const other = await store.insert([
      row({ event_id: "b", seq: 1, session_id: "33333333-3333-4333-8333-333333333333" }),
    ]);
    expect(other).toBe(1);
  });

  it("throws rather than half-writing, so the batch stays in the client's log", async () => {
    const store = createFileStore(path);
    await store.insert([row({ event_id: "a", seq: 1 })]);

    await expect(
      store.insert([row({ event_id: "b", seq: 2 }), row({ event_id: "c", seq: 1 })]),
    ).rejects.toThrow();

    // The handler turns this into a 503 and the client retries the whole batch.
    // What must not happen is the batch being silently accepted in part.
    const stored = readEventRows(path);
    expect(stored.some((r) => r.event_id === "c")).toBe(false);
  });
});

describe("it cannot become the production store", () => {
  it("refuses to start when NODE_ENV is production", () => {
    // No durability, no backups, no access control. If this ever ran as the
    // real ingest, a participant's data would sit in a file on a serverless
    // filesystem that is discarded between invocations -- collected, then lost,
    // with a 200 telling the browser it was safe to forget them.
    process.env["NODE_ENV"] = "production";
    expect(() => createFileStore(path)).toThrow(ProductionUseError);
  });

  it("names the alternative rather than just refusing", () => {
    process.env["NODE_ENV"] = "production";
    try {
      createFileStore(path);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(String(error)).toContain("SUPABASE_URL");
    }
  });
});

describe("reading back", () => {
  it("returns nothing for a file that does not exist yet", () => {
    expect(readEventRows(join(directory, "absent.jsonl"))).toEqual([]);
  });

  it("tolerates a trailing newline", () => {
    writeFileSync(path, JSON.stringify(row()) + "\n\n", "utf8");
    expect(readEventRows(path)).toHaveLength(1);
  });

  it("round-trips what was written", async () => {
    const store = createFileStore(path);
    await store.insert([row()]);
    expect(readEventRows(path)[0]).toEqual(row());
    expect(readFileSync(path, "utf8").endsWith("\n")).toBe(true);
  });
});
