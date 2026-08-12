# @eiai/ingest

The single write path into the study's data.

Accepts a batch, validates every event against `@eiai/schema`, rejects anything
malformed, and inserts idempotently on `event_id`. There is no update path and
no delete path — that is a claim in the paper's transparency section, so it is
enforced in the service, in the SQL grants, and by triggers that raise on
UPDATE or DELETE regardless of who attempts them.

```
src/handler.ts   pure handler; the store is injected, so it tests without a DB
src/supabase.ts  PostgREST-backed store (ON CONFLICT DO NOTHING)
api/events.ts    deployment entry; the service key lives only here
sql/001_events.sql   table, constraints, immutability triggers, grants
```

Apply the migration with:

```bash
psql "$DATABASE_URL" -f services/ingest/sql/001_events.sql
```

Failure direction matters: if the store is unavailable the handler returns 5xx,
so the client keeps the batch in its write-ahead log and retries. Returning 2xx
would make the client delete events that were never stored.
