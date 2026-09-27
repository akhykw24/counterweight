-- run_mode on a table that was created before it existed.
--
-- 001_events.sql declares run_mode, but it does so inside
-- `create table if not exists`, which does nothing to a table that is already
-- there. The production table predates the column, so from the deploy that
-- started sending run_mode (26 September 2026) every insert failed with
-- PGRST204 "Could not find the 'run_mode' column", and the ingest function
-- answered 503 to every batch.
--
-- Nullable, with no default, on purpose. ADD COLUMN ... DEFAULT 'live' would
-- stamp every existing row -- smoke rows, test sessions, anything from before
-- -- as live data, and the append-only trigger rightly forbids fixing that
-- afterwards. NULL says what is true of those rows: they predate the marking.
-- pipeline/exclusions.py refuses a row whose run mode it does not know, so an
-- unmarked row cannot slip into an analysis unnoticed. Every row written from
-- now on carries a value, because the ingest function always sends one.
--
-- Paste into Supabase -> SQL Editor -> Run. Safe to run twice.

alter table public.events add column if not exists run_mode text;

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'events_run_mode_valid') then
        alter table public.events
            add constraint events_run_mode_valid
            check (run_mode is null or run_mode in ('live', 'pilot', 'test'));
    end if;
end;
$$;

create index if not exists events_run_mode_idx on public.events (run_mode);

notify pgrst, 'reload schema';

-- Check: every column the ingest function writes must be listed here.
select column_name
from information_schema.columns
where table_schema = 'public' and table_name = 'events'
order by ordinal_position;
