-- One row per person who got a version but did not finish the v3 main study.
-- Paste into Supabase -> SQL Editor -> Run. Reads only; changes nothing.
--
--   last_screen        where they were last seen
--   position_of_task   if that was a mission task: which task of the module it
--                      was for them (1 = the first task they met after the lesson)
--   tasks_answered     mission tasks answered before stopping
--   lessons_read       lesson messages read
--   avg_read_seconds   average time on a lesson message
--   minutes_in         from the first event to the last
--   screen_width       width of their screen in pixels (under 500 is a phone)
with started as (
    select session_id, (payload->'viewport'->>'width')::int as width
    from public.events
    where run_mode = 'live' and type = 'session_started'
),
last_screen as (
    select distinct on (session_id) session_id, payload->>'screen' as screen
    from public.events
    where run_mode = 'live' and type = 'screen_viewed'
    order by session_id, seq desc
),
plans as (
    select session_id, payload->'task_order' as task_order
    from public.events
    where run_mode = 'live' and type = 'plan_generated'
),
per_session as (
    select session_id,
           bool_or(type = 'allocation')                                        as allocated,
           bool_or(type = 'session_completed')                                 as finished,
           max(cell)                                                           as version,
           count(*) filter (where type = 'mission_answer')                     as tasks_answered,
           count(*) filter (where type = 'lesson_item')                        as lessons_read,
           round(avg((payload->>'dwell_ms')::numeric) filter (where type = 'lesson_item') / 1000, 1)
                                                                               as avg_read_seconds,
           round(extract(epoch from max(client_ts) - min(client_ts)) / 60, 1)  as minutes_in,
           min(client_ts)                                                      as started_at
    from public.events
    where run_mode = 'live'
    group by session_id
)
select p.started_at,
       p.version,
       l.screen                                                             as last_screen,
       case when l.screen like 'mission:%' then
           (select o.n from jsonb_array_elements_text(
                pl.task_order -> (split_part(l.screen, ':', 2)::int - 1)) with ordinality as o(task, n)
            where o.task = split_part(l.screen, ':', 3))
       end                                                                  as position_of_task,
       p.tasks_answered,
       p.lessons_read,
       p.avg_read_seconds,
       p.minutes_in,
       s.width                                                              as screen_width
from per_session p
left join last_screen l using (session_id)
left join started s using (session_id)
left join plans pl using (session_id)
where p.allocated and not p.finished
order by p.started_at;
