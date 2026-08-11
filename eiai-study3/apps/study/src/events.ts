import type { StudyEvent } from "@eiai/schema";

/**
 * Minimal in-memory event recorder.
 *
 * Day 4 replaces this with `@eiai/telemetry`: IndexedDB write-ahead log,
 * batched flush with exponential backoff, resume tokens. The interface is kept
 * deliberately narrow — `record(type, payload)` — so that swap is a change of
 * implementation and not a rewrite of every call site.
 *
 * Until then nothing leaves the tab. That is the correct behaviour for day 3:
 * there is no ingest endpoint yet, and silently dropping events would be worse
 * than obviously buffering them.
 */

type Envelope = Omit<StudyEvent, "type" | "payload">;

let seq = 0;
const buffer: unknown[] = [];

function sessionId(): string {
  const key = "eiai.session_id";
  let id = globalThis.localStorage?.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    globalThis.localStorage?.setItem(key, id);
  }
  return id;
}

export function record(type: string, payload: Record<string, unknown>): void {
  const envelope: Envelope & { type: string; payload: unknown } = {
    event_id: crypto.randomUUID(),
    session_id: sessionId(),
    seq: seq++,
    client_ts: new Date().toISOString(),
    type,
    payload,
  };
  buffer.push(envelope);
}

export function recorded(): readonly unknown[] {
  return buffer;
}

export function resetRecorder(): void {
  seq = 0;
  buffer.length = 0;
}
