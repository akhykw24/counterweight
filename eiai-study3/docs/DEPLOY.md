# Deployment

Two things have to be running before anyone takes part: somewhere for the study
app to live, and somewhere for the events to land. This is the order to do them
in, and how to tell whether each one actually worked.

## Why this needs checking rather than assuming

The client is offline-first. If the ingest endpoint is missing, misconfigured,
or pointed at a database it cannot write to, the participant's browser keeps
everything in its write-ahead log and retries silently. The session completes
normally, the participant sees nothing wrong, and you see nothing wrong. You
find out weeks later, when there is no data.

That is why every step below ends with a command that either prints `ok` or
tells you what is broken. Do not skip them, and do not recruit until
`verify-ingest` passes with `--write`.

---

## 0. Before you start

You need accounts on two services. Both have free tiers sufficient for this
study. Create them yourself — the credentials must never pass through a chat
transcript or a file in this repository.

- **Supabase** (the database) — <https://supabase.com>
- **Vercel** (hosting for the app and the ingest function) — <https://vercel.com>

Any host that runs a fetch-style serverless function works; Vercel is what
`vercel.json` and `api/events.ts` are written for.

---

## 1. The database

**1.1** Create a Supabase project. Note the region — pick one near your
participants, not near you.

**1.2** Open the SQL editor and run the contents of
[`services/ingest/sql/001_events.sql`](../services/ingest/sql/001_events.sql).
It creates one append-only table with its constraints, its immutability
triggers and its grants.

Or, with `psql` installed and the connection string from Supabase's settings:

```bash
psql "$DATABASE_URL" -f services/ingest/sql/001_events.sql
```

**1.3** Confirm the table refuses to be edited. In the SQL editor:

```sql
insert into public.events (event_id, session_id, seq, client_ts, type, payload)
values (gen_random_uuid(), gen_random_uuid(), 0, now(), 'SESSION_STARTED', '{}');
update public.events set type = 'CHANGED' where type = 'SESSION_STARTED';
```

The `update` must fail with *"public.events is append-only"*. If it succeeds,
the triggers did not install and the transparency claim in the paper is not
true. Delete the test row is **not** possible either, by design — that is the
point. Note its `event_id` if you want to exclude it later; a row with no
`SESSION_COMPLETED` is dropped by exclusion criterion 1 anyway.

**1.4** From project settings, copy the **project URL** and the **service role
key**. The service role key bypasses row-level security, which is exactly why
it lives only in the server environment and never in the app.

---

## 2. The app and the ingest function

They deploy together, as one project, so the app can post to `/api/events` on
its own origin with no cross-origin configuration and no endpoint to keep in
sync.

**2.1** Import the Git repository into Vercel.

**2.2** Set **Root Directory** to `eiai-study3`. The repository root holds a
different project; without this the build picks up the wrong one.

Everything else comes from [`vercel.json`](../vercel.json): install with pnpm,
build `apps/study`, serve `apps/study/dist`, and expose `api/events.ts` as a
function.

**2.3** Add the environment variables, for the Production environment:

| Name | Value |
|---|---|
| `SUPABASE_URL` | the project URL from 1.4 |
| `SUPABASE_SERVICE_KEY` | the service role key from 1.4 |

[`.env.example`](../.env.example) lists these with the same notes. Do not add
`VITE_INGEST_ENDPOINT`: the default is the same origin, which is what you want.

**2.4** Deploy.

---

## 3. Prove it works

```bash
node scripts/verify-ingest.mjs https://your-deployment-url
```

Read-only. Writes nothing. It checks that the endpoint answers, that it is
running this repository's handler, that the store is configured, and that
schema validation is live.

Then, once:

```bash
node scripts/verify-ingest.mjs https://your-deployment-url --write
```

This appends a single row and immediately re-sends it, which proves both the
database round-trip and that duplicate delivery is safely ignored. The row has
a fixed identity (`00000000-0000-4000-8000-000000000001`) and no
`SESSION_COMPLETED`, so exclusion criterion 1 drops it from every analysis
without anyone having to remember it is there.

**Do not recruit until this prints `All checks passed. Participants' data will
reach the database.`**

Finally, take the study yourself, end to end, on the deployed URL. Then check
in Supabase:

```sql
select type, count(*) from public.events group by type order by 2 desc;
```

You should see `ITEM_PRESENTED`, `ESTIMATE_FINALIZED` and `ARGUMENT_RATED` at
twelve each.

---

## Running it locally

`pnpm --dir apps/study dev` serves the app at <http://localhost:5173> **and**
mounts a working `/api/events` backed by a file at `data/dev-events.jsonl`.
No account, no database, no configuration.

```bash
node scripts/verify-ingest.mjs --write     # against localhost
pnpm exec playwright test e2e/ingest.spec.ts
```

That file store is development-only and refuses to start when `NODE_ENV` is
`production`: it has no durability, no backups and no access control, so it
must never be the thing a participant's data lands in.

---

## Getting the data out

Analysis reads a JSONL export, not the database directly. From Supabase's SQL
editor, run and download as JSON:

```sql
select event_id, session_id, seq, client_ts, type, payload
from public.events
order by session_id, seq;
```

Save it as `data/events.jsonl` (one object per line), then:

```bash
python pipeline/replay.py --events data/events.jsonl --out data/tables
python pipeline/exclusions.py --tables data/tables
python pipeline/analysis.py --tables data/tables --exclusions
```

The SQL file provides an `eiai_analyst` role for exactly this, so exports do
not need the service key. Create it in Supabase and re-run the migration to
grant it `select`.

---

## What is still not automated

Nothing here is checked by CI, because CI has no credentials and should not
have any. `verify-ingest.mjs` is the substitute: it is run by a person against
a real deployment, and it is itself tested against the local dev server on
every end-to-end run.
