import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { EventRow, EventStore } from "./handler.js";

/**
 * A file-backed event store for local development and end-to-end tests.
 *
 * Why this exists
 * ---------------
 * Until now the only `EventStore` that could actually run was the Supabase one,
 * which needs a cloud project and a service key. That left the most important
 * path in the system -- participant's browser to a server that keeps the data --
 * impossible to exercise at all. The end-to-end tests reached into IndexedDB
 * and stopped there, so "the app records events" was proven and "the events
 * reach anybody" was not.
 *
 * This closes that gap without an account. `pnpm dev` gets a working
 * `/api/events`, and an end-to-end test can assert that a completed session
 * arrives server-side rather than merely being written locally.
 *
 * Faithful where it matters
 * -------------------------
 * It reproduces the two constraints the real table enforces, because those are
 * the ones a client bug trips over:
 *
 *   - `event_id` is the idempotency key. A replayed batch inserts nothing.
 *   - `(session_id, seq)` is unique. A client that reuses a sequence number
 *     after a bad resume is rejected here exactly as Postgres would reject it,
 *     rather than silently corrupting every ordered projection.
 *
 * It is not a database and does not pretend to be: no concurrency control
 * beyond append, no durability guarantees, no reads for analysis. It is a
 * development stand-in, and `createFileStore` refuses to run in production so
 * it cannot quietly become the thing collecting real participants' data.
 */

export class ProductionUseError extends Error {
  constructor() {
    super(
      "The file-backed event store is for local development and tests. " +
        "It has no durability, no backups and no access control, so it must " +
        "never be the store a participant's data lands in. Configure " +
        "SUPABASE_URL and SUPABASE_SERVICE_KEY instead.",
    );
    this.name = "ProductionUseError";
  }
}

/** Everything the store has been given, in arrival order. */
export function readEventRows(path: string): EventRow[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as EventRow);
}

export interface FileStoreOptions {
  /** Overrides the production guard. Only the guard's own test should pass this. */
  allowInProduction?: boolean;
}

export function createFileStore(path: string, options: FileStoreOptions = {}): EventStore {
  if (process.env["NODE_ENV"] === "production" && !options.allowInProduction) {
    throw new ProductionUseError();
  }

  mkdirSync(dirname(path), { recursive: true });

  // Rebuilt from the file on construction, so a restarted dev server stays
  // idempotent against events the browser still holds in its write-ahead log
  // and will retry.
  const seenEventIds = new Set<string>();
  const seenSessionSeq = new Set<string>();
  for (const row of readEventRows(path)) {
    seenEventIds.add(row.event_id);
    seenSessionSeq.add(`${row.session_id}#${row.seq}`);
  }

  return {
    async insert(rows: readonly EventRow[]): Promise<number> {
      const lines: string[] = [];
      let inserted = 0;

      for (const row of rows) {
        if (seenEventIds.has(row.event_id)) continue;

        const positionKey = `${row.session_id}#${row.seq}`;
        if (seenSessionSeq.has(positionKey)) {
          // The unique constraint the real table carries. Throwing gives the
          // client a 503 and keeps the batch in its WAL, which is the right
          // failure direction: the events are not lost, and the contradiction
          // is visible instead of being written twice at one position.
          throw new Error(
            `session ${row.session_id} already has an event at seq ${row.seq}. ` +
              "Sequence numbers must be unique within a session.",
          );
        }

        seenEventIds.add(row.event_id);
        seenSessionSeq.add(positionKey);
        lines.push(JSON.stringify(row));
        inserted += 1;
      }

      if (lines.length > 0) {
        appendFileSync(path, lines.join("\n") + "\n", "utf8");
      }
      return inserted;
    },
  };
}
