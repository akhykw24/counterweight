// Relative, not the "@eiai/schema" package name, and that is deliberate.
//
// Vercel's Edge Function bundler refused the deployment with
//
//     The Edge Function "api/events" is referencing unsupported modules:
//     - services/ingest/src/handler.js: @eiai/schema
//
// It had already followed this file; the one thing it could not inline was the
// bare specifier, which resolves through a pnpm workspace symlink into a
// package whose entry point is TypeScript source. A relative path is a file the
// bundler can simply read, so the whole chain becomes self-contained.
//
// Nothing else changes: same module, same types, and vite/vitest resolve it
// identically. It is the only workspace import in this service, so the cost is
// one path here rather than a build step or a compiled artefact to keep in sync.
import { IngestBatch, type IngestEvent } from "../../../packages/schema/src/index.js";

/**
 * The single write endpoint (STUDY3_SPEC_v3.md section 3).
 *
 * Accepts a batch of events, validates every one against the shared Zod
 * schema, rejects anything malformed, and appends to an insert-only table.
 * Idempotent on event_id, so client retries are safe.
 *
 * There is no update path and no delete path anywhere in this service. That is
 * one sentence in the paper's transparency section and it has to be literally
 * true, so it is enforced here, in the SQL grants, and by a trigger.
 */

export interface EventRow {
  event_id: string;
  session_id: string;
  seq: number;
  client_ts: string;
  type: string;
  payload: unknown;
  run_mode: string;
  /** v3 envelope. Null for deep-sea events, which predate both. */
  participant_id: string | null;
  cell: string | null;
}

export interface EventStore {
  /** Inserts, ignoring rows whose event_id already exists. Returns rows actually written. */
  insert(rows: readonly EventRow[]): Promise<number>;
}

export interface IngestResult {
  status: number;
  body: Record<string, unknown>;
}

export const MAX_BATCH_BYTES = 1_000_000;

function toRow(event: IngestEvent): EventRow {
  const { event_id, session_id, seq, client_ts, type, payload, run_mode } =
    event as IngestEvent & { payload: unknown; run_mode: string };
  // Always present, null when absent: PostgREST requires every row in one
  // insert to carry the same keys, and a batch never mixes the two families
  // anyway -- but nothing should depend on that for correctness.
  const v3 = event as Partial<{ participant_id: string; cell: string | null }>;
  return {
    event_id,
    session_id,
    seq,
    client_ts,
    type,
    payload,
    run_mode,
    participant_id: v3.participant_id ?? null,
    cell: v3.cell ?? null,
  };
}

export async function handleIngest(
  body: unknown,
  store: EventStore,
): Promise<IngestResult> {
  const parsed = IngestBatch.safeParse(body);

  if (!parsed.success) {
    // Echo the issues. A client that is sending malformed events needs to know
    // which field, and a silent 400 during collection is how you discover a
    // schema mismatch three weeks in.
    return {
      status: 400,
      body: {
        error: "invalid_batch",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
    };
  }

  const events = parsed.data.events;

  // A batch that repeats an event_id would make the "inserted" count ambiguous
  // and hide a client bug. Collapse and report it.
  const seen = new Set<string>();
  const rows: EventRow[] = [];
  let duplicatesInBatch = 0;
  for (const event of events) {
    if (seen.has(event.event_id)) {
      duplicatesInBatch += 1;
      continue;
    }
    seen.add(event.event_id);
    rows.push(toRow(event));
  }

  let inserted: number;
  try {
    inserted = await store.insert(rows);
  } catch (error) {
    // 5xx so the client keeps the batch in its WAL and retries.
    return {
      status: 503,
      body: { error: "store_unavailable", detail: String(error) },
    };
  }

  return {
    status: 200,
    body: {
      received: events.length,
      inserted,
      duplicates: rows.length - inserted + duplicatesInBatch,
    },
  };
}

/** Web-standard Request/Response wrapper, for any fetch-style runtime. */
export async function ingestRequest(request: Request, store: EventStore): Promise<Response> {
  if (request.method !== "POST") {
    return json(405, { error: "method_not_allowed" });
  }

  const raw = await request.text();
  if (raw.length > MAX_BATCH_BYTES) {
    return json(413, { error: "batch_too_large", limit: MAX_BATCH_BYTES });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: "invalid_json" });
  }

  const result = await handleIngest(body, store);
  return json(result.status, result.body);
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
