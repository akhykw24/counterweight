import { expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Reading a session's events back, server-side.
 *
 * Why not IndexedDB
 * -----------------
 * These tests used to read the browser's write-ahead log directly, which
 * worked only because nothing was consuming it: with no ingest endpoint, every
 * event stayed in the log forever. The log is a buffer, not an archive --
 * delivered events are removed from it, which is the whole point of it. As
 * soon as the dev server started accepting events, a test that read the log at
 * the end of a session saw only the undelivered tail.
 *
 * The server's store is the right place to assert against anyway. It is the
 * corpus the analysis will actually run on, so "the session was recorded" and
 * "the session arrived" stop being two different claims with one test between
 * them.
 *
 * The write-ahead log is still worth reading in one situation: proving it holds
 * events while the network is down. `e2e/ingest.spec.ts` does that, and it is
 * the only place that should.
 */

export const EVENT_LOG = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "data",
  "dev-events.jsonl",
);

export interface StoredRow {
  event_id: string;
  session_id: string;
  seq: number;
  client_ts: string;
  run_mode: string;
  type: string;
  payload: Record<string, unknown>;
}

export function storedRows(): StoredRow[] {
  if (!existsSync(EVENT_LOG)) return [];
  return readFileSync(EVENT_LOG, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as StoredRow);
}

/** One session's rows, in the order the client assigned them. */
export function rowsFor(sessionId: string): StoredRow[] {
  return storedRows()
    .filter((row) => row.session_id === sessionId)
    .sort((a, b) => a.seq - b.seq);
}

export function typesFor(sessionId: string): string[] {
  return rowsFor(sessionId).map((row) => row.type);
}

/** The session id the app is currently using. */
export async function sessionIdOf(page: Page): Promise<string> {
  const id = await page.evaluate(() => localStorage.getItem("eiai.session_id"));
  expect(id, "the app never wrote a session id").toBeTruthy();
  return id!;
}

/**
 * Waits until the server holds at least `count` events for this session.
 *
 * The recorder flushes on a three-second idle interval, so a test that reads
 * immediately after the last click reads too early. Polling a count is what
 * makes these assertions about delivery rather than about timing.
 */
export async function waitForRows(sessionId: string, count: number, timeout = 30_000) {
  await expect
    .poll(() => rowsFor(sessionId).length, {
      timeout,
      message: `server never received ${count} events for ${sessionId}`,
    })
    .toBeGreaterThanOrEqual(count);
  return rowsFor(sessionId);
}

/** Waits until the server holds `count` events of one type for this session. */
export async function waitForType(
  sessionId: string,
  type: string,
  count: number,
  timeout = 45_000,
) {
  await expect
    .poll(() => rowsFor(sessionId).filter((row) => row.type === type).length, {
      timeout,
      message: `server never received ${count} ${type} events for ${sessionId}`,
    })
    .toBeGreaterThanOrEqual(count);
  return rowsFor(sessionId);
}

/** Clears the browser's storage, so each test is a fresh participant. */
export async function resetParticipant(page: Page): Promise<void> {
  await page.goto("/");
  await page.evaluate(async () => {
    localStorage.clear();
    await new Promise((resolve) => {
      const request = indexedDB.deleteDatabase("eiai-telemetry");
      request.onsuccess = resolve;
      request.onerror = resolve;
      request.onblocked = resolve;
    });
  });
  await page.reload();
}
