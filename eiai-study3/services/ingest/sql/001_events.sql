-- Study 3 event log (STUDY3_SPEC_v3.md section 3).
--
-- One append-only table. Every analytic table in the paper is a projection
-- computed by replaying this, so the guarantee that matters is that a row,
-- once written, is never altered.
--
-- Insert-only is enforced three times over, because "the table is insert-only"
-- is a claim in the paper's transparency section and should not rest on the
-- application layer alone:
--   1. the ingest service has no update or delete code path
--   2. UPDATE and DELETE are revoked from every client role
--   3. a trigger raises on UPDATE or DELETE regardless of who attempts it
--
-- Apply with:  psql "$DATABASE_URL" -f services/ingest/sql/001_events.sql

create table if not exists public.events (
    event_id    uuid        primary key,
    session_id  uuid        not null,
    seq         integer     not null check (seq >= 0),
    client_ts   timestamptz not null,
    type        text        not null,
    payload     jsonb       not null,
    -- Which kind of run produced this. Only 'live' enters the analysed sample;
    -- the pilot and any test run are removed by pipeline/exclusions.py before
    -- a single statistic is computed. Carried on every row rather than on one
    -- opening event, so a session cannot lose its mark and read as live.
    run_mode    text        not null default 'live'
                            check (run_mode in ('live', 'pilot', 'test')),
    -- Server clock. Client clocks are not trustworthy; `seq` establishes order
    -- within a session and this establishes arrival order across them.
    received_at timestamptz not null default now(),

    -- A session cannot have two events at the same position. Catches a client
    -- that reuses sequence numbers after a bad resume, which would otherwise
    -- silently corrupt every ordered projection.
    constraint events_session_seq_unique unique (session_id, seq)
);

comment on table public.events is
    'Append-only event log. Never updated, never deleted. Projections are computed by pipeline/replay.py.';
comment on column public.events.seq is
    'Monotonic within session_id, assigned by the client write-ahead log.';
comment on column public.events.event_id is
    'Idempotency key. Client delivery is at-least-once; duplicates reconcile here.';

create index if not exists events_session_seq_idx on public.events (session_id, seq);
create index if not exists events_type_idx        on public.events (type);
create index if not exists events_run_mode_idx    on public.events (run_mode);
create index if not exists events_received_at_idx on public.events (received_at);

-- ---------------------------------------------------------------------------
-- Immutability
-- ---------------------------------------------------------------------------

create or replace function public.events_reject_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception
        'public.events is append-only; % is not permitted', tg_op
        using hint = 'Correct a bad event by appending a corrective one, never by editing history.';
end;
$$;

drop trigger if exists events_no_update on public.events;
create trigger events_no_update
    before update on public.events
    for each row execute function public.events_reject_mutation();

drop trigger if exists events_no_delete on public.events;
create trigger events_no_delete
    before delete on public.events
    for each row execute function public.events_reject_mutation();

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

alter table public.events enable row level security;

-- The browser never talks to this table directly; only the serverless ingest
-- function does, with the service key. No policy is granted to anon or
-- authenticated, so RLS denies them everything by default.
revoke all on public.events from anon, authenticated;

-- Exports for analysis go through a dedicated read-only role rather than the
-- service key, so a compromised ingest credential cannot read the corpus back
-- out. Create the role separately and grant it here.
do $$
begin
    if exists (select 1 from pg_roles where rolname = 'eiai_analyst') then
        grant select on public.events to eiai_analyst;
    end if;
end;
$$;
