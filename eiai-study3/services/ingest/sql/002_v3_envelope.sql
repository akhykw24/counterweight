-- v3 envelope: participant and cell on every row (docs/spec/v3/SPEC.md).
--
-- Additive only. Both columns are nullable, so every deep-sea row already in
-- the table -- including the v2 pilot's -- stays exactly as it was, and the
-- append-only triggers from 001 are untouched: ADD COLUMN is DDL, not an
-- UPDATE of any row.
--
-- Must be applied BEFORE the v3 build is deployed. The ingest function writes
-- both columns on every insert; against a table without them, every insert
-- fails with a 5xx and the participant's browser holds the events and retries
-- until the columns exist. Nothing is lost, but nothing arrives either.
--
-- Apply with:  psql "$DATABASE_URL" -f services/ingest/sql/002_v3_envelope.sql
-- or paste into Supabase -> SQL Editor -> Run. Safe to run twice.

alter table public.events
    add column if not exists participant_id uuid,
    add column if not exists cell text;

do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'events_cell_valid'
    ) then
        alter table public.events
            add constraint events_cell_valid
            check (cell is null or cell in ('EI-A', 'EI-B', 'Neutral-A', 'Neutral-B'));
    end if;
end;
$$;

comment on column public.events.participant_id is
    'v3: per-browser identifier kept across sessions; detects repeat participation. Null on deep-sea rows.';
comment on column public.events.cell is
    'v3: EI-A, EI-B, Neutral-A or Neutral-B from allocation onwards. Null before allocation and on deep-sea rows.';

create index if not exists events_participant_idx on public.events (participant_id);
create index if not exists events_cell_idx        on public.events (cell);

-- PostgREST caches the table shape; without this it keeps rejecting the new
-- columns for a while after they exist.
notify pgrst, 'reload schema';
