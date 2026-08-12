import type { StudyEvent } from "@eiai/schema";
import { openWal, type Wal } from "./wal.js";
import { backoffDelay, TransportError, type BackoffOptions, type Transport } from "./transport.js";

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
  record(type: string, payload: Record<string, unknown>): Promise<void>;
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
    async record(type, payload) {
      await wal.append((seq) => ({
        event_id: uuid(),
        session_id: sessionId,
        seq,
        client_ts: now().toISOString(),
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
