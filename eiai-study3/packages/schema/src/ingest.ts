import { z } from "zod";
import { eventSchemas } from "./events.js";
import { v3EventSchemas } from "./v3.js";

/**
 * What the ingest endpoint accepts: an event from either study family.
 *
 * One discriminated union over both, not a union of the two unions. The type
 * names never overlap (deep-sea events are upper case, v3 events lower case),
 * so the discriminator picks exactly one schema and a malformed event gets that
 * schema's precise error -- `events.0.seq: too small` -- instead of a vague
 * "matched no option" that would hide which field was wrong.
 */
export const IngestEvent = z.discriminatedUnion("type", [...eventSchemas, ...v3EventSchemas]);

export const IngestBatch = z
  .strictObject({
    events: z.array(IngestEvent).min(1).max(500),
  })
  .describe("A batch of events flushed from the client write-ahead log, from either study family. Idempotent on event_id.");

export type IngestEvent = z.infer<typeof IngestEvent>;
export type IngestBatch = z.infer<typeof IngestBatch>;
