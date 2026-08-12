import type { StudyEvent } from "@eiai/schema";

/**
 * Batched delivery to the ingest service, with exponential backoff.
 *
 * A transport either resolves (the server has the batch) or throws (it does
 * not). There is no partial-success return, on purpose: the caller acknowledges
 * the whole batch or none of it, so an ambiguous result can only ever cost a
 * redelivery, never a dropped event.
 */

export type Transport = (events: readonly StudyEvent[]) => Promise<void>;

export class TransportError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    /** False for 4xx other than 408/429: retrying a malformed batch forever helps nobody. */
    readonly retryable = true,
  ) {
    super(message);
    this.name = "TransportError";
  }
}

export interface BackoffOptions {
  baseMs?: number;
  maxMs?: number;
  /** Multiplied into the delay as [1-jitter, 1+jitter]. Spreads a reconnecting classroom. */
  jitter?: number;
  random?: () => number;
}

export function backoffDelay(attempt: number, options: BackoffOptions = {}): number {
  const { baseMs = 1000, maxMs = 30_000, jitter = 0.25, random = Math.random } = options;
  const exponential = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  const spread = 1 + (random() * 2 - 1) * jitter;
  return Math.max(0, Math.round(exponential * spread));
}

export function httpTransport(endpoint: string, fetchImpl: typeof fetch = fetch): Transport {
  return async (events) => {
    let response: Response;
    try {
      response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ events }),
        keepalive: events.length <= 20,
      });
    } catch (cause) {
      // Offline, DNS failure, connection reset. Always worth retrying.
      throw new TransportError(`network failure: ${String(cause)}`, undefined, true);
    }

    if (response.ok) return;

    // 408 and 429 are transient; other 4xx mean the batch itself is wrong and
    // will still be wrong in thirty seconds.
    const retryable =
      response.status >= 500 || response.status === 408 || response.status === 429;
    throw new TransportError(
      `ingest responded ${response.status}`,
      response.status,
      retryable,
    );
  };
}
