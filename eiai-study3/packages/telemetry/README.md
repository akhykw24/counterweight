# @eiai/telemetry

Offline-first event capture. School wifi drops; the data does not.

- **`wal.ts`** — IndexedDB write-ahead log. Every event is durable locally
  *before* any network attempt, and is deleted only once the server has
  acknowledged it. Sequence numbers are assigned inside the same transaction
  that writes the event, so they cannot collide and they survive a reload.
- **`transport.ts`** — batched POST with exponential backoff and jitter.
  Distinguishes retryable failures from a batch the server will never accept.
- **`resume.ts`** — session id plus persisted statechart snapshot in
  `localStorage`, so a participant returns to the item they were on.
- **`recorder.ts`** — the API the app uses: `record(type, payload)`, which
  resolves on durability, not on delivery.

Delivery is at-least-once; duplicates reconcile at the ingest service by event
UUID. Rationale and rejected alternatives:
[ADR-004](../../docs/adr/ADR-004-offline-write-ahead-log.md).

The guarantee is asserted in `test/durability.test.ts`: record while offline,
discard the instance to simulate a reload, restore the network, and every event
arrives exactly once and in order.
