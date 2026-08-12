import { openDB, type IDBPDatabase } from "idb";
import type { StudyEvent } from "@eiai/schema";

/**
 * Write-ahead log in IndexedDB (STUDY3_SPEC_v3.md section 6).
 *
 * School wifi drops mid-session. Every event is durable locally *before* any
 * attempt is made to ship it, and is deleted only once the server has
 * acknowledged it. That ordering is the whole guarantee: a crash, a reload or
 * an offline stretch can cost you a network round trip, never an event.
 *
 * Delivery is at-least-once. The event UUID is generated once, at append time,
 * and never changes across retries, so the ingest service can reconcile
 * duplicates by primary key.
 */

const DB_NAME = "eiai-telemetry";
const DB_VERSION = 1;
const EVENTS = "events";
const META = "meta";

export interface WalRecord {
  /** Monotonic within a session. Assigned here, and durable across reloads. */
  seq: number;
  session_id: string;
  event: StudyEvent;
}

function seqKey(sessionId: string): string {
  return `seq:${sessionId}`;
}

async function open(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(EVENTS)) {
        const store = db.createObjectStore(EVENTS, { keyPath: "seq" });
        store.createIndex("by_session", "session_id");
      }
      if (!db.objectStoreNames.contains(META)) {
        db.createObjectStore(META);
      }
    },
  });
}

export interface Wal {
  /**
   * Assigns the next sequence number and durably stores the event.
   *
   * The sequence read, the event write and the counter bump happen in one
   * IndexedDB transaction, so two concurrent appends cannot be given the same
   * seq.
   */
  append(build: (seq: number) => StudyEvent): Promise<WalRecord>;
  /** Oldest unacknowledged records, in sequence order. */
  peek(limit: number): Promise<WalRecord[]>;
  /** Removes records the server has confirmed. Called only after a 2xx. */
  ack(seqs: readonly number[]): Promise<void>;
  pending(): Promise<number>;
  /** Everything still unshipped, oldest first. For diagnostics and tests. */
  drain(): Promise<WalRecord[]>;
  close(): Promise<void>;
}

export async function openWal(sessionId: string): Promise<Wal> {
  const db = await open();

  return {
    async append(build) {
      const tx = db.transaction([EVENTS, META], "readwrite");
      const meta = tx.objectStore(META);
      const current = ((await meta.get(seqKey(sessionId))) as number | undefined) ?? 0;
      const record: WalRecord = {
        seq: current,
        session_id: sessionId,
        event: build(current),
      };
      await tx.objectStore(EVENTS).put(record);
      await meta.put(current + 1, seqKey(sessionId));
      await tx.done;
      return record;
    },

    async peek(limit) {
      const all = (await db.getAllFromIndex(EVENTS, "by_session", sessionId)) as WalRecord[];
      return all.sort((a, b) => a.seq - b.seq).slice(0, limit);
    },

    async ack(seqs) {
      if (seqs.length === 0) return;
      const tx = db.transaction(EVENTS, "readwrite");
      const store = tx.objectStore(EVENTS);
      await Promise.all(seqs.map((seq) => store.delete(seq)));
      await tx.done;
    },

    async pending() {
      return (await db.getAllKeysFromIndex(EVENTS, "by_session", sessionId)).length;
    },

    async drain() {
      const all = (await db.getAllFromIndex(EVENTS, "by_session", sessionId)) as WalRecord[];
      return all.sort((a, b) => a.seq - b.seq);
    },

    async close() {
      db.close();
    },
  };
}

/** Test and diagnostic helper. Never called by the app. */
export async function deleteWal(): Promise<void> {
  const db = await open();
  const tx = db.transaction([EVENTS, META], "readwrite");
  await tx.objectStore(EVENTS).clear();
  await tx.objectStore(META).clear();
  await tx.done;
  db.close();
}
