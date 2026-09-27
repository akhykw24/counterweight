import type { StudyEvent } from "@eiai/schema";
import { openWal, type Wal } from "./wal.js";
import { backoffDelay, TransportError, type BackoffOptions, type Transport } from "./transport.js";
import type { RunMode } from "./run-mode.js";

/**
 * The capture API the app talks to.
 *
 * `record()` resolves once the event is durable in the WAL, not once it has
 * been delivered. Callers do not await delivery, and must not: the network is
 * not on the participant's critical path.
 */

export interface TelemetryOptions {
  sessionId: string;
  transport: Transport;
  /** Which kind of run this is. Defaults to `live`: a forgotten flag must
   *  never mark real data as disposable. */
  runMode?: RunMode;
  /** Events per POST. */
  batchSize?: number;
  /** Idle interval between flush attempts while the queue is non-empty. */
  flushIntervalMs?: number;
  backoff?: BackoffOptions;
  wal?: Wal;
  now?: () => Date;
  uuid?: () => string;
  onError?: (error: unknown) => void;
}

export interface Telemetry {
  /**
   * `envelope` adds fields beside event_id/session_id/seq/client_ts/run_mode:
   * the v3 family carries participant_id and cell on every event. The caller
   * passes them per event because the cell changes mid-session, at allocation.
   */
  record(
    type: string,
    payload: Record<string, unknown>,
    envelope?: Record<string, unknown>,
  ): Promise<void>;
  /** Attempts one delivery pass. Returns how many events were acknowledged. */
  flush(): Promise<number>;
  pending(): Promise<number>;
  /** Best-effort final flush, e.g. from a pagehide handler. */
  stop(): Promise<void>;
}

export async function createTelemetry(options: TelemetryOptions): Promise<Telemetry> {
  const {
    sessionId,
    transport,
    batchSize = 25,
    flushIntervalMs = 3000,
    backoff = {},
    now = () => new Date(),
    uuid = () => crypto.randomUUID(),
    onError = () => {},
  } = options;

  const runMode = options.runMode ?? "live";
  const wal = options.wal ?? (await openWal(sessionId));

  let timer: ReturnType<typeof setTimeout> | null = null;
  let flushing = false;
  let attempt = 0;
  let stopped = false;

  function schedule(delayMs: number): void {
    if (stopped || timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, delayMs);
    // Never hold a Node process (or a test run) open on a retry timer.
    (timer as unknown as { unref?: () => void }).unref?.();
  }

  async function flush(): Promise<number> {
    if (flushing || stopped) return 0;
    flushing = true;
    try {
      const batch = await wal.peek(batchSize);
      if (batch.length === 0) {
        attempt = 0;
        return 0;
      }

      try {
        await transport(batch.map((record) => record.event));
      } catch (error) {
        onError(error);
        // A non-retryable batch would otherwise block every event behind it
        // forever. Keep it in the WAL and stop hammering; a human has to look.
        if (error instanceof TransportError && !error.retryable) return 0;
        attempt += 1;
        schedule(backoffDelay(attempt, backoff));
        return 0;
      }

      // Acknowledge only after the server has the batch. Doing this before the
      // POST would turn any failure into permanent data loss.
      await wal.ack(batch.map((record) => record.seq));
      attempt = 0;

      if ((await wal.pending()) > 0) schedule(0);
      return batch.length;
    } finally {
      flushing = false;
    }
  }

  return {
    async record(type, payload, envelope = {}) {
      await wal.append((seq) => ({
        // Spread first, so nothing passed here can overwrite the identity,
        // order or run mode this recorder is responsible for.
        ...envelope,
        event_id: uuid(),
        session_id: sessionId,
        seq,
        client_ts: now().toISOString(),
        // Stamped here rather than at the call site: every event gets it,
        // including ones added later by somebody who never read this file.
        run_mode: runMode,
        type,
        payload,
      }) as unknown as StudyEvent);
      schedule(flushIntervalMs);
    },

    flush,

    pending: () => wal.pending(),

    async stop() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      await flush();
      stopped = true;
    },
  };
}
