# ADR-004: Client-side write-ahead log, at-least-once delivery

**Status:** accepted, Day 4
**Embodied in:** `packages/telemetry`, `services/ingest`, `services/ingest/sql/001_events.sql`

## Context

Collection happens in schools. The wifi drops. The obvious design — POST each
event as it happens, and hope — loses every event generated during an outage,
and there is no way to notice afterwards that anything is missing: the log
simply has a hole where a participant's item 7 should be.

The governing rule in §0 is that anything captured at collection time outranks
anything computable later. A dropped scroll event is not recoverable in month
two.

## Decision

Events are written to an IndexedDB **write-ahead log first**, and only then
attempted over the network. A record is deleted from the WAL **after** the
server acknowledges it, never before. Delivery is therefore at-least-once, and
duplicates are reconciled at the ingest service by `event_id`, which is
generated once at append time and never changes across retries.

Sequence numbers are assigned inside the same IndexedDB transaction that writes
the event, so two concurrent appends cannot collide and the counter survives a
reload. Position within the session is kept separately, as a persisted
statechart snapshot in `localStorage`, so a participant returns to the item they
were on rather than to the start.

## Alternatives rejected

**Fire-and-forget POST per event.** Rejected: loses everything generated
offline, silently.

**Buffer in memory, flush on `beforeunload`.** Rejected: a crashed tab, a killed
browser and a flat battery all skip that handler, and it is exactly the tail of
a session — the questionnaire and the funnel probe — that would be lost.

**Acknowledge optimistically, then retry in the background.** Rejected: any
failure after the optimistic delete is permanent loss, and it would be
undetectable.

**Service worker with Background Sync.** Rejected as premature: it buys delivery
after the tab closes, at the cost of a second execution context, a registration
lifecycle, and a much harder testing story. The WAL already guarantees the data
survives; Background Sync only makes it arrive sooner. Revisit if pilot data
shows sessions abandoned mid-outage.

## Consequences

Good:

- Zero event loss across an offline stretch plus a reload, asserted directly in
  `packages/telemetry/test/durability.test.ts` rather than argued for.
- The ingest service can be dumb: validate, insert, ignore conflicts. All the
  retry intelligence lives on the client, where the failure actually is.
- Batching falls out naturally, so a classroom of thirty does not open thirty
  requests per participant per item.
- Backoff is jittered, so a room that reconnects at once does not stampede.

Costs, accepted:

- IndexedDB is unavailable in some hardened and private-mode configurations.
  The WAL open would throw there; this is not yet handled and is listed in the
  day 4 notes.
- At-least-once means the server must be idempotent forever, not just during
  collection. Enforced by a primary key, a unique `(session_id, seq)`
  constraint, and triggers that reject UPDATE and DELETE outright.
- Resuming re-emits `RESPONSE_REVEALED` for the item on screen, so an item can
  carry more than one. That is deliberate — reaction time is measured from the
  showing the participant actually acted on — but it means projections must
  reduce on the last reveal per (session, item), not assume a single one.
- A batch the server will never accept (a 4xx that is not 408/429) is kept in
  the WAL and retried no further, rather than being discarded or retried in a
  loop. That needs a human to notice, so the pilot must check `pending()`.
