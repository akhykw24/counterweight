# Architecture Decision Records

One page per non-obvious choice: context, decision, alternatives rejected,
consequences. Written as the decision is made, not reconstructed afterwards.

The point is not documentation for its own sake. It is that "why did you build
it this way?" is answerable with receipts, including the options that were
considered and dropped.

| ADR | Decision | Day |
|---|---|---|
| [001](ADR-001-event-sourcing.md) | Append-only event log, not one row per participant-item | 1 |
| [002](ADR-002-frozen-stimuli.md) | Pre-generated hash-manifested stimuli, not live LLM calls | 1 |
| 003 | Session flow as a statechart; register stays a pure function | 3 |
| 004 | Offline write-ahead log in IndexedDB, at-least-once delivery | 4 |
