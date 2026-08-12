import {
  createTelemetry,
  httpTransport,
  loadResume,
  markCompleted,
  saveSnapshot,
  startSession,
} from "@eiai/telemetry";
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
  snapshot: unknown | null;
  flush: () => Promise<unknown>;
  persist: (snapshot: unknown) => void;
  complete: () => void;
}

const INGEST_ENDPOINT =
  (import.meta.env["VITE_INGEST_ENDPOINT"] as string | undefined) ?? "/api/events";

/** Best-effort mapping of the browser locale onto the three study languages. */
export function initialLocale(): "kk" | "ru" | "en" {
  const tag = globalThis.navigator?.language?.slice(0, 2).toLowerCase();
  return tag === "kk" || tag === "ru" ? tag : "en";
}

export async function bootstrap(): Promise<Bootstrap> {
  const existing = loadResume();
  const resumed = existing !== null;
  const sessionId = existing?.sessionId ?? crypto.randomUUID();

  if (!resumed) startSession(sessionId);

  const telemetry = await createTelemetry({
    sessionId,
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
    snapshot: existing?.snapshot ?? null,
    flush: () => telemetry.flush(),
    persist: saveSnapshot,
    complete: markCompleted,
  };
}
