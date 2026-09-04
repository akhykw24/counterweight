import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBatch, type StudyEvent } from "@eiai/schema";
import {
  TransportError,
  backoffDelay,
  createTelemetry,
  deleteWal,
  openWal,
  type Transport,
} from "@eiai/telemetry";

/**
 * The day 4 done-criterion: kill wifi mid-session, lose zero events on resume.
 *
 * Asserted rather than described. Each test drives the real WAL through
 * fake-indexeddb, so the durability path under test is the one that ships.
 */

const SESSION = "3b1d9e42-5a6f-4c8b-9d0e-1f2a3b4c5d6e";

let uuidCounter = 0;
const uuid = () => {
  uuidCounter += 1;
  return `00000000-0000-4000-8000-${String(uuidCounter).padStart(12, "0")}`;
};

/** Collects delivered batches; can be switched offline and back. */
function makeTransport() {
  const delivered: StudyEvent[] = [];
  const batches: number[] = [];
  let online = true;
  let failures = 0;

  const transport: Transport = async (events) => {
    if (!online) {
      failures += 1;
      throw new TransportError("offline", undefined, true);
    }
    batches.push(events.length);
    delivered.push(...events);
  };

  return {
    transport,
    delivered,
    batches,
    get failures() {
      return failures;
    },
    goOffline() {
      online = false;
    },
    goOnline() {
      online = true;
    },
  };
}

async function telemetryFor(transport: Transport, batchSize = 25) {
  return createTelemetry({
    sessionId: SESSION,
    transport,
    batchSize,
    // Large, so nothing auto-flushes behind the test's back. Flushes are
    // triggered explicitly here.
    flushIntervalMs: 1_000_000,
    uuid,
    onError: () => {},
  });
}

beforeEach(async () => {
  uuidCounter = 0;
  await deleteWal();
});

afterEach(async () => {
  await deleteWal();
});

describe("zero event loss across an offline stretch and a reload", () => {
  it("delivers every event exactly once, in order, after wifi returns", async () => {
    const net = makeTransport();

    // --- session running normally ---
    const before = await telemetryFor(net.transport);
    await before.record("ITEM_PRESENTED", { item_id: "item_01", position: 1 });
    await before.record("CONFIDENCE_SET", {
      item_id: "item_01",
      phase: "initial",
      value: 40,
    });
    expect(await before.flush()).toBe(2);

    // --- wifi dies mid-session ---
    net.goOffline();
    for (let i = 0; i < 20; i += 1) {
      await before.record("ESTIMATE_CHANGED", {
        item_id: "item_01",
        phase: "initial",
        value: 1000 + i,
        ms_since_present: i * 100,
      });
    }
    expect(await before.flush()).toBe(0);
    expect(await before.pending()).toBe(20);
    expect(net.delivered).toHaveLength(2);

    // --- browser dies; participant reopens the tab ---
    await before.stop();
    const after = await telemetryFor(net.transport);
    expect(await after.pending(), "WAL survived the reload").toBe(20);

    // --- wifi returns ---
    net.goOnline();
    let acked = 0;
    for (let pass = 0; pass < 5 && (await after.pending()) > 0; pass += 1) {
      acked += await after.flush();
    }

    expect(acked).toBe(20);
    expect(await after.pending()).toBe(0);
    expect(net.delivered).toHaveLength(22);

    // Exactly once, and in order.
    const ids = net.delivered.map((event) => event.event_id);
    expect(new Set(ids).size).toBe(22);
    const seqs = net.delivered.map((event) => event.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(seqs).toEqual(Array.from({ length: 22 }, (_, i) => i));
  });

  it("keeps the batch in the WAL when delivery fails part-way", async () => {
    // The ordering that matters: acknowledge only after the server has it.
    // Acking first would turn any failure into permanent loss.
    const attempts: number[] = [];
    const transport: Transport = async (events) => {
      attempts.push(events.length);
      throw new TransportError("connection reset", undefined, true);
    };

    const telemetry = await telemetryFor(transport);
    for (let i = 0; i < 5; i += 1) {
      await telemetry.record("VERIFY_CLICKED", {
        item_id: "item_02",
        ms_since_reveal: i,
      });
    }

    await telemetry.flush();
    await telemetry.flush();

    expect(attempts.length).toBeGreaterThanOrEqual(2);
    expect(await telemetry.pending()).toBe(5);
    await telemetry.stop();
  });

  it("assigns sequence numbers that survive a reload without a gap or repeat", async () => {
    const net = makeTransport();
    net.goOffline();

    const first = await telemetryFor(net.transport);
    await first.record("ITEM_PRESENTED", { item_id: "item_01", position: 1 });
    await first.record("ITEM_PRESENTED", { item_id: "item_02", position: 2 });
    await first.stop();

    const second = await telemetryFor(net.transport);
    await second.record("ITEM_PRESENTED", { item_id: "item_03", position: 3 });

    const wal = await openWal(SESSION);
    const records = await wal.drain();
    expect(records.map((record) => record.seq)).toEqual([0, 1, 2]);
    await wal.close();
    await second.stop();
  });

  it("ships events in batches rather than one request per event", async () => {
    const net = makeTransport();
    const telemetry = await telemetryFor(net.transport, 10);
    for (let i = 0; i < 25; i += 1) {
      await telemetry.record("ESTIMATE_CHANGED", {
        item_id: "item_01",
        phase: "initial",
        value: i,
        ms_since_present: i,
      });
    }

    let passes = 0;
    while ((await telemetry.pending()) > 0 && passes < 10) {
      await telemetry.flush();
      passes += 1;
    }

    expect(net.batches).toEqual([10, 10, 5]);
    expect(net.delivered).toHaveLength(25);
    await telemetry.stop();
  });
});

describe("what the client sends is what the schema accepts", () => {
  it("produces batches the ingest service will validate", async () => {
    // If this drifts, collection fails at the boundary rather than in a test.
    const net = makeTransport();
    const telemetry = await telemetryFor(net.transport);

    await telemetry.record("SESSION_STARTED", {
      app_version: "0.1.0",
      stimuli_manifest_hash: "a".repeat(64),
      viewport: { width: 1280, height: 800 },
      resumed: false,
      repeat_session: false,
    });
    await telemetry.record("ALLOCATED", {
      condition: "warm",
      cefr: "B2",
      stratum: "B1-B2",
      allocation_seq: 0,
    });
    await telemetry.flush();

    const parsed = EventBatch.safeParse({ events: net.delivered });
    if (!parsed.success) {
      throw new Error(JSON.stringify(parsed.error.issues, null, 2));
    }
    expect(parsed.success).toBe(true);
    await telemetry.stop();
  });
});

describe("backoff", () => {
  it("grows exponentially and is capped", () => {
    const fixed = { random: () => 0.5, jitter: 0 };
    expect(backoffDelay(1, fixed)).toBe(1000);
    expect(backoffDelay(2, fixed)).toBe(2000);
    expect(backoffDelay(3, fixed)).toBe(4000);
    expect(backoffDelay(20, fixed)).toBe(30_000);
  });

  it("jitters within bounds, so a reconnecting classroom does not stampede", () => {
    for (const r of [0, 0.25, 0.5, 0.75, 1]) {
      const delay = backoffDelay(3, { random: () => r, jitter: 0.25 });
      expect(delay).toBeGreaterThanOrEqual(3000);
      expect(delay).toBeLessThanOrEqual(5000);
    }
  });

  it("never returns a negative delay", () => {
    expect(backoffDelay(0, { random: () => 0 })).toBeGreaterThanOrEqual(0);
  });
});

describe("non-retryable failures", () => {
  it("stops retrying a batch the server will never accept", async () => {
    // A malformed batch retried forever would block every later event behind
    // it and hammer the endpoint. Keep it, stop, let a human look.
    const attempts = vi.fn(async () => {
      throw new TransportError("bad request", 400, false);
    });
    const telemetry = await telemetryFor(attempts as unknown as Transport);
    await telemetry.record("VERIFY_CLICKED", { item_id: "item_01", ms_since_reveal: 1 });

    await telemetry.flush();
    await telemetry.flush();

    expect(attempts).toHaveBeenCalledTimes(2);
    expect(await telemetry.pending(), "the event is kept, not discarded").toBe(1);
    await telemetry.stop();
  });
});
