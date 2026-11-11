-- How many people have taken part in the v3 main study, and how many are usable.
-- Paste into Supabase -> SQL Editor -> Run. Reads only; changes nothing.
--
-- "usable" applies the exclusions in docs/spec/v3/SPEC.md that can be decided
-- now: finished; did not press "Remove my data"; passed the attention check;
-- chose the distractor in fewer than 4 of 12 tasks; first session of that
-- participant and not flagged as a repeat in this browser.
-- "too fast" has no threshold yet (the spec sets it from pilot data), so it is
-- shown, not applied: usable_under_8_min counts usable people who finished in
-- under 8 minutes, a provisional line to look at, not a rule.
with sessions as (
    select session_id,
           max(participant_id::text)                                    as participant,
           max(cell)                                                     as version,
           min(client_ts)                                                as started,
           bool_or(type = 'allocation')                                  as allocated,
           bool_or(type = 'session_completed')                           as completed,
           bool_or(type = 'session_started'
                   and coalesce((payload->>'repeat_session')::boolean, false)) as repeat_browser,
           bool_or(type = 'attention_check'
                   and coalesce((payload->>'passed')::boolean, false))   as attention_ok,
           count(*) filter (where type = 'mission_answer'
                            and payload->>'choice_role' = 'distractor')  as distractors,
           max((payload->>'total_duration_ms')::bigint)
               filter (where type = 'session_completed')                 as total_ms
    from public.events
    where run_mode = 'live' and participant_id is not null
    group by session_id
),
withdrawn as (
    select distinct participant_id::text as participant
    from public.events
    where run_mode = 'live' and type = 'withdrawal_requested'
),
ranked as (
    select s.*,
           row_number() over (partition by s.participant order by s.started) as nth,
           s.participant in (select w.participant from withdrawn w)          as withdrew
    from sessions s
    where s.allocated
),
judged as (
    select r.*,
           (r.completed and not r.withdrew and r.attention_ok and r.distractors < 4
            and r.nth = 1 and not r.repeat_browser) as usable
    from ranked r
)
select coalesce(version, 'ALL')                                         as version,
       count(*)                                                         as started,
       count(*) filter (where completed)                                as finished,
       count(*) filter (where usable)                                   as usable,
       count(*) filter (where completed and not attention_ok)           as failed_attention,
       count(*) filter (where completed and distractors >= 4)           as distractor_4_plus,
       count(*) filter (where nth > 1 or repeat_browser)                as repeat,
       count(*) filter (where withdrew)                                 as removed_data,
       count(*) filter (where usable and total_ms < 8 * 60 * 1000)      as usable_under_8_min,
       round(avg(total_ms) filter (where usable) / 60000.0, 1)          as usable_avg_minutes
from judged
group by rollup (version)
order by grouping(version), version;
