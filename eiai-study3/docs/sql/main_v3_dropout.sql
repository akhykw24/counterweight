-- Where people who started the v3 main study stopped.
-- Paste into Supabase -> SQL Editor -> Run. Reads only; changes nothing.
--
-- One row per screen: how many allocated, unfinished sessions were last seen
-- there, and when the most recent of them was. Screen names:
--   intro, lesson:<module>:<message>, mission:<module>:<task>,
--   transition:after_m1 / after_m2 / end, quiz:<page>, funnel:<F1..F5>,
--   tutor:<page>, quality, trust, demographics, debrief.
-- A session whose last activity is recent may simply still be in progress.
with last_screen as (
    select distinct on (session_id)
           session_id, payload->>'screen' as screen, client_ts
    from public.events
    where run_mode = 'live' and type = 'screen_viewed'
    order by session_id, seq desc
),
allocated as (
    select distinct session_id from public.events
    where run_mode = 'live' and type = 'allocation'
),
finished as (
    select distinct session_id from public.events
    where run_mode = 'live' and type = 'session_completed'
)
select l.screen,
       count(*)          as people,
       max(l.client_ts)  as most_recent
from last_screen l
where l.session_id in (select session_id from allocated)
  and l.session_id not in (select session_id from finished)
group by l.screen
order by people desc, l.screen;
