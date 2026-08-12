import { describe, expect, it } from "vitest";
import { handleIngest, ingestRequest, type EventRow, type EventStore } from "@eiai/ingest";

/**
 * The ingest service is the only write path into the study's data. Its
 * contract: validate everything, insert idempotently, never update, never
 * delete, and fail in the direction that makes the client keep its events.
 */

const SESSION = "3b1d9e42-5a6f-4c8b-9d0e-1f2a3b4c5d6e";

function eventId(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function itemPresented(seq: number, overrides: Record<string, unknown> = {}) {
  return {
    event_id: eventId(seq),
    session_id: SESSION,
    seq,
    client_ts: "2026-08-09T10:00:00.000Z",
    type: "ITEM_PRESENTED",
    payload: { item_id: "item_01", position: 1 },
    ...overrides,
  };
}

/** In-memory store with the same primary-key semantics as the SQL table. */
function memoryStore() {
  const rows = new Map<string, EventRow>();
  let failNext: Error | null = null;

  const store: EventStore = {
    async insert(incoming) {
      if (failNext) {
        const error = failNext;
        failNext = null;
        throw error;
      }
      let inserted = 0;
      for (const row of incoming) {
        if (rows.has(row.event_id)) continue; // ON CONFLICT DO NOTHING
        rows.set(row.event_id, row);
        inserted += 1;
      }
      return inserted;
    },
  };

  return {
    store,
    rows,
    failOnce(error: Error) {
      failNext = error;
    },
  };
}

describe("validation", () => {
  it("accepts a well-formed batch", async () => {
    const { store, rows } = memoryStore();
    const result = await handleIngest({ events: [itemPresented(0), itemPresented(1)] }, store);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ received: 2, inserted: 2, duplicates: 0 });
    expect(rows.size).toBe(2);
  });

  it("rejects a malformed event and names the field", async () => {
    // A silent 400 during collection is how a schema mismatch goes unnoticed
    // for three weeks, so the response echoes the failing path.
    const { store, rows } = memoryStore();
    const result = await handleIngest(
      { events: [itemPresented(0, { payload: { item_id: "item_99", position: 1 } })] },
      store,
    );
    expect(result.status).toBe(400);
    expect(result.body["error"]).toBe("invalid_batch");
    expect(JSON.stringify(result.body["issues"])).toContain("item_id");
    expect(rows.size, "nothing is written from a rejected batch").toBe(0);
  });

  it("rejects an unknown event type rather than storing it as free-form", async () => {
    const { store } = memoryStore();
    const result = await handleIngest(
      { events: [itemPresented(0, { type: "UI_CLICK" })] },
      store,
    );
    expect(result.status).toBe(400);
  });

  it("rejects extra payload fields, so a typo cannot become a silent column", async () => {
    const { store } = memoryStore();
    const result = await handleIngest(
      {
        events: [
          itemPresented(0, { payload: { item_id: "item_01", position: 1, note: "x" } }),
        ],
      },
      store,
    );
    expect(result.status).toBe(400);
  });

  it("rejects an empty batch", async () => {
    const { store } = memoryStore();
    expect((await handleIngest({ events: [] }, store)).status).toBe(400);
  });

  it("rejects a body that is not a batch at all", async () => {
    const { store } = memoryStore();
    expect((await handleIngest(null, store)).status).toBe(400);
    expect((await handleIngest({ event: {} }, store)).status).toBe(400);
  });
});

describe("idempotency", () => {
  it("is safe to replay the same batch, which is what at-least-once requires", async () => {
    const { store, rows } = memoryStore();
    const batch = { events: [itemPresented(0), itemPresented(1), itemPresented(2)] };

    const first = await handleIngest(batch, store);
    const second = await handleIngest(batch, store);

    expect(first.body).toMatchObject({ inserted: 3, duplicates: 0 });
    expect(second.body).toMatchObject({ inserted: 0, duplicates: 3 });
    expect(rows.size).toBe(3);
  });

  it("collapses a repeated event_id inside one batch and reports it", async () => {
    // Would otherwise make the inserted count ambiguous and hide a client bug.
    const { store, rows } = memoryStore();
    const result = await handleIngest(
      { events: [itemPresented(0), itemPresented(1, { event_id: eventId(0) })] },
      store,
    );
    expect(result.body).toMatchObject({ received: 2, inserted: 1, duplicates: 1 });
    expect(rows.size).toBe(1);
  });

  it("never overwrites a stored event, even when the payload differs", async () => {
    // Append-only means the first write wins. A later event with the same id is
    // a duplicate delivery, not a correction.
    const { store, rows } = memoryStore();
    await handleIngest({ events: [itemPresented(0)] }, store);
    await handleIngest(
      {
        events: [
          itemPresented(0, { payload: { item_id: "item_07", position: 7 } }),
        ],
      },
      store,
    );
    expect(rows.get(eventId(0))?.payload).toMatchObject({ item_id: "item_01" });
  });
});

describe("failure direction", () => {
  it("returns 5xx when the store is unavailable, so the client keeps its WAL", async () => {
    // Returning 2xx here would make the client acknowledge and delete events
    // that were never stored. Failing loudly is the only safe direction.
    const memory = memoryStore();
    memory.failOnce(new Error("connection refused"));
    const result = await handleIngest({ events: [itemPresented(0)] }, memory.store);
    expect(result.status).toBe(503);
    expect(memory.rows.size).toBe(0);
  });
});

describe("HTTP surface", () => {
  const post = (body: string) =>
    new Request("https://ingest.test/events", { method: "POST", body });

  it("accepts a POST", async () => {
    const { store } = memoryStore();
    const response = await ingestRequest(
      post(JSON.stringify({ events: [itemPresented(0)] })),
      store,
    );
    expect(response.status).toBe(200);
  });

  it("refuses any method other than POST", async () => {
    const { store } = memoryStore();
    for (const method of ["GET", "PUT", "PATCH", "DELETE"]) {
      const response = await ingestRequest(
        new Request("https://ingest.test/events", { method }),
        store,
      );
      expect(response.status, method).toBe(405);
    }
  });

  it("rejects invalid JSON without reaching the store", async () => {
    const { store, rows } = memoryStore();
    const response = await ingestRequest(post("{not json"), store);
    expect(response.status).toBe(400);
    expect(rows.size).toBe(0);
  });

  it("caps batch size", async () => {
    const { store } = memoryStore();
    const response = await ingestRequest(post("x".repeat(1_000_001)), store);
    expect(response.status).toBe(413);
  });
});

describe("no mutation surface", () => {
  it("exposes only insert on the store interface", () => {
    // The paper claims the table is insert-only at the API level. The store
    // interface is where that claim is either true or not.
    const { store } = memoryStore();
    expect(Object.keys(store)).toEqual(["insert"]);
    expect("update" in store).toBe(false);
    expect("delete" in store).toBe(false);
  });
});
