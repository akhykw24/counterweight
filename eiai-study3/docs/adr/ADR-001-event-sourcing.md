# ADR-001: Store an append-only event log, not one row per participant-item

**Status:** accepted, Day 1
**Embodied in:** `packages/schema/src/events.ts`

## Context

The obvious schema for a Judge–Advisor experiment is one row per participant-item:
initial estimate, advice, final estimate, a few timings. It is easy to write, easy
to hand to a stats package, and it is what most student studies do.

It is also lossy in a way you only discover later. The row schema commits, at
design time, to the exact set of measures you will ever compute. This study's
mediator (scroll depth on the justification) and its exploratory layer (estimate
trajectories, revision velocity) are both things a row schema would have silently
discarded — and the window in which they can be captured closes the moment the
last participant leaves.

## Decision

Store every meaningful occurrence as an immutable, ordered event
(`STUDY3_SPEC_v3.md` §3). Analytic tables are **projections**: pure functions
computed by replaying the log in `pipeline/replay.py`. Nothing in the paper is
hand-edited; every number traces back through replay to a raw event.

Each event carries `event_id` (UUID, idempotency key), `session_id`, a monotonic
`seq`, and a client timestamp. Ordering comes from `seq`, not from the clock,
because client clocks are not trustworthy.

## Alternatives rejected

**One row per participant-item.** Rejected: cannot answer a question you did not
anticipate, and cannot survive a mid-session crash without bespoke work.

**Event log plus a denormalised "current state" table written in parallel.**
Rejected for a study this size: two writers means two things that can disagree,
and a disagreement between them mid-collection would be unrecoverable. Replay is
fast enough at N=120 that the cache buys nothing.

**Row schema plus a generic `extra_json` column.** Rejected: this is event
sourcing with none of the ordering, idempotency, or auditability guarantees —
the appearance of flexibility without the property that makes it useful.

## Consequences

Good:

- Measures can be derived after collection. Revision velocity was not in v1's
  design; it is already in the log.
- Auditability. The ingest service has no update and no delete path, so the
  table is insert-only at the API level. That sentence goes in the paper's
  transparency section.
- Crash resilience is natural rather than bolted on. A participant whose browser
  dies at item 9 still contributes items 1–8, because those events already
  shipped.
- Telemetry stops being special. A scroll is an event like any other.

Costs, accepted:

- Nothing is directly queryable for analysis. You must replay first. Mitigated by
  making replay a committed, tested pipeline step rather than an ad-hoc script.
- Volume is much higher than a row schema — `ESTIMATE_CHANGED` fires on every
  keystroke. At N=120 × 12 items this is still trivial.
- Schema evolution needs care. Adding an event type is safe; changing an existing
  payload's meaning is not, because old events keep the old meaning forever.
