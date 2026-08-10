# services/ingest

Not built yet -- scheduled for **day 4** of the build plan (STUDY3_SPEC_v3.md section 10).

Single serverless function. Validates a batch against @eiai/schema, appends to an insert-only events table, idempotent on event UUID. No update path, no delete path.
