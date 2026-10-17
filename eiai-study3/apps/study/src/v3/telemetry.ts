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

// ---------------------------------------------------------------------------
// Allocation: the next slot of the committed sequence, from the server
// ---------------------------------------------------------------------------

export interface SlotRequest {
  sessionId: string;
  englishBand: "B1-B2" | "C1-C2-native";
  runMode: "live" | "test";
}

export interface ServerSlot {
  cell: CellName;
  index: number;
}

export type AllocateSlot = (request: SlotRequest) => Promise<ServerSlot>;

/** The sequence for this stratum is used up. Retrying cannot help. */
export class SlotsExhaustedError extends Error {
  constructor() {
    super("allocation sequence exhausted");
    this.name = "SlotsExhaustedError";
  }
}

const ALLOCATE_ENDPOINT =
  (import.meta.env["VITE_ALLOCATE_ENDPOINT"] as string | undefined) ?? "/api/allocate";

export function httpAllocate(endpoint = ALLOCATE_ENDPOINT, fetchImpl: typeof fetch = fetch): AllocateSlot {
  return async ({ sessionId, englishBand, runMode }) => {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, english_band: englishBand, run_mode: runMode }),
    });
    if (response.status === 409) throw new SlotsExhaustedError();
    if (!response.ok) throw new Error(`allocate responded ${response.status}`);
    const body = (await response.json()) as { cell: unknown; sequence_index: unknown };
    if (!v3.isCell(body.cell) || typeof body.sequence_index !== "number") {
      throw new Error(`allocate returned an unusable slot: ${JSON.stringify(body)}`);
    }
    return { cell: body.cell, index: body.sequence_index };
  };
}

/**
 * Asks until it gets an answer. A dropped connection must not cost a
 * participant their place: the request is idempotent per session, so asking
 * again returns the same slot, never a second one.
 */
export async function claimSlot(
  allocateSlot: AllocateSlot,
  request: SlotRequest,
  options: { stillWanted?: () => boolean; wait?: (ms: number) => Promise<void> } = {},
): Promise<ServerSlot> {
  const wait = options.wait ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await allocateSlot(request);
    } catch (error) {
      if (error instanceof SlotsExhaustedError) throw error;
      if (options.stillWanted && !options.stillWanted()) throw error;
      await wait(Math.min(15_000, 1000 * 2 ** attempt));
    }
  }
}
