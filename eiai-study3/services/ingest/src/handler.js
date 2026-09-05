import { EventBatch } from "@eiai/schema";
export const MAX_BATCH_BYTES = 1_000_000;
function toRow(event) {
    const { event_id, session_id, seq, client_ts, type, payload } = event;
    return { event_id, session_id, seq, client_ts, type, payload };
}
export async function handleIngest(body, store) {
    const parsed = EventBatch.safeParse(body);
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
    const seen = new Set();
    const rows = [];
    let duplicatesInBatch = 0;
    for (const event of events) {
        if (seen.has(event.event_id)) {
            duplicatesInBatch += 1;
            continue;
        }
        seen.add(event.event_id);
        rows.push(toRow(event));
    }
    let inserted;
    try {
        inserted = await store.insert(rows);
    }
    catch (error) {
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
export async function ingestRequest(request, store) {
    if (request.method !== "POST") {
        return json(405, { error: "method_not_allowed" });
    }
    const raw = await request.text();
    if (raw.length > MAX_BATCH_BYTES) {
        return json(413, { error: "batch_too_large", limit: MAX_BATCH_BYTES });
    }
    let body;
    try {
        body = JSON.parse(raw);
    }
    catch {
        return json(400, { error: "invalid_json" });
    }
    const result = await handleIngest(body, store);
    return json(result.status, result.body);
}
function json(status, body) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
    });
}
