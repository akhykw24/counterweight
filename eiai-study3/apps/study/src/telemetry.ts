import {
  createTelemetry,
  httpTransport,
  hadCompletedSession,
  loadResume,
  runModeFromSearch,
  markCompleted,
  saveSnapshot,
  startSession,
} from "@eiai/telemetry";
import type { RunMode } from "@eiai/telemetry";
import manifest from "../../../materials/manifest.json";

/**
 * App-side telemetry wiring.
 *
 * `Recorder` is deliberately the narrowest possible surface. The App calls
 * `record(type, payload)` and nothing else, so tests can pass a no-op and the
 * durability machinery never runs in jsdom.
 */

export interface Recorder {
  record(type: string, payload: Record<string, unknown>): void;
}

export const noopRecorder: Recorder = { record: () => {} };

export const APP_VERSION = "0.1.0";
export const STIMULI_MANIFEST_HASH = manifest.manifest_sha256;

export interface Bootstrap {
  recorder: Recorder;
  sessionId: string;
  resumed: boolean;
  repeatSession: boolean;
  runMode: RunMode;
  snapshot: unknown | null;
  flush: () => Promise<unknown>;
  persist: (snapshot: unknown) => void;
  complete: () => void;
}

const INGEST_ENDPOINT =
  (import.meta.env["VITE_INGEST_ENDPOINT"] as string | undefined) ?? "/api/events";

export async function bootstrap(): Promise<Bootstrap> {
  const existing = loadResume();
  const resumed = existing !== null;
  // Read before startSession, which clears the completion marker. This is the
  // only moment the browser still holds evidence of an earlier finished
  // session (exclusion criterion 5).
  const repeatSession = hadCompletedSession();
  const sessionId = existing?.sessionId ?? crypto.randomUUID();

  if (!resumed) startSession(sessionId);

  // Read once, at the start, from the link the participant opened. Held for
  // the life of the session so a mid-session navigation cannot change what
  // kind of run this is.
  const runMode = runModeFromSearch(globalThis.location?.search ?? "");

  const telemetry = await createTelemetry({
    sessionId,
    runMode,
    transport: httpTransport(INGEST_ENDPOINT),
    // Failures are expected in a classroom and are not the participant's
    // problem; the WAL holds everything until the network returns.
    onError: () => {},
  });

  // A closing tab is the most likely moment to lose the tail of a session.
  globalThis.addEventListener?.("pagehide", () => {
    void telemetry.flush();
  });

  return {
    recorder: {
      record: (type, payload) => {
        void telemetry.record(type, payload);
      },
    },
    sessionId,
    resumed,
    repeatSession,
    runMode,
    snapshot: existing?.snapshot ?? null,
    flush: () => telemetry.flush(),
    persist: saveSnapshot,
    complete: markCompleted,
  };
}
