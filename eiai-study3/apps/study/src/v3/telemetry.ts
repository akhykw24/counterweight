import { createTelemetry, httpTransport, resumeStore, runModeFromSearch } from "@eiai/telemetry";
import type { RunMode } from "@eiai/telemetry";
import { v3 } from "@eiai/fsm";
import type { CellName } from "@eiai/schema";

/**
 * v3 telemetry wiring. The same write-ahead log and transport as v2; its own
 * resume keys, so a browser that ran the deep-sea pilot can never restore that
 * session into this one; and two envelope fields v2 did not have.
 */

export interface V3Recorder {
  record(type: string, payload: Record<string, unknown>, envelope: Record<string, unknown>): void;
}

export const noopV3Recorder: V3Recorder = { record: () => {} };

export interface LinkParams {
  runMode: RunMode;
  /** `pilot=true` on the link: consent notice and E9. */
  pilotFlow: boolean;
  pilotParticipant: number | null;
  /** `cell=` -- read only when the run is a test. */
  requestedCell: CellName | null;
}

/**
 * Reads the link once. Only the exact string `true` counts for either flag,
 * and `cell=` is ignored unless `test=true`: a forwarded test link must never
 * let a real or pilot participant choose their own condition.
 */
export function readLink(search: string): LinkParams {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const runMode = runModeFromSearch(search);
  const rawP = params.get("p");
  const pilotParticipant = rawP !== null && /^[1-9]\d{0,3}$/.test(rawP) ? Number(rawP) : null;
  const rawCell = params.get("cell");
  const requestedCell = runMode === "test" && v3.isCell(rawCell) ? rawCell : null;
  return { runMode, pilotFlow: params.get("pilot") === "true", pilotParticipant, requestedCell };
}

export interface V3Bootstrap extends LinkParams {
  recorder: V3Recorder;
  sessionId: string;
  participantId: string;
  resumed: boolean;
  repeatSession: boolean;
  snapshot: unknown | null;
  persist: (snapshot: unknown) => void;
  complete: () => void;
  flush: () => Promise<unknown>;
}

const INGEST_ENDPOINT =
  (import.meta.env["VITE_INGEST_ENDPOINT"] as string | undefined) ?? "/api/events";

export const resume = resumeStore("eiai.v3");

export async function bootstrapV3(): Promise<V3Bootstrap> {
  const link = readLink(globalThis.location?.search ?? "");
  const existing = resume.load();
  const resumed = existing !== null;
  // Read before start(), which clears the completion marker.
  const repeatSession = resume.hadCompletedSession();
  const sessionId = existing?.sessionId ?? crypto.randomUUID();
  const participantId = resume.participantId(() => crypto.randomUUID());
  if (!resumed) resume.start(sessionId);

  const telemetry = await createTelemetry({
    sessionId,
    runMode: link.runMode,
    transport: httpTransport(INGEST_ENDPOINT),
    onError: () => {},
  });

  globalThis.addEventListener?.("pagehide", () => {
    void telemetry.flush();
  });

  return {
    ...link,
    recorder: {
      record: (type, payload, envelope) => {
        void telemetry.record(type, payload, envelope);
      },
    },
    sessionId,
    participantId,
    resumed,
    repeatSession,
    snapshot: existing?.snapshot ?? null,
    persist: resume.save,
    complete: resume.markCompleted,
    flush: () => telemetry.flush(),
  };
}
