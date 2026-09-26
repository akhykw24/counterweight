# Pre-pilot validation

**Verdict: PASS** — 16 of 16 checks passed.

Run 2026-09-26 10:16:38 UTC against the local server. 30 complete sessions plus six failure scenarios, 36 sessions and 3632 events in total.

Everything here used `?test=true`, so every row it wrote is marked disposable and removed by the pipeline before a statistic is computed. The validation cannot contaminate what it validates.

## What this is asking

Not whether the app works — the ordinary test suites cover that. Whether *delivery* holds up: whether an event the browser accepted always reaches the server, exactly once, in order, across reloads, double clicks and a dead network. Those are the failures that would otherwise appear as quietly missing rows weeks later, with no error anywhere.

## What the first run of this suite found

One defect, in the pipeline rather than the app. `client_ts` is an ISO 8601 string -- that is what the schema declares and what the browser sends -- but `pipeline/simulate.py` wrote it as an integer count of milliseconds, and the projection had been written against the integer it saw. Every duration therefore worked on synthetic data and raised `ValueError` on the first real session. No test caught it because every test ran on the simulator's own output.

Fixed by one parser (`epoch_ms` in `pipeline/_common.py`) used everywhere, by making the simulator emit what the browser emits, and by two new gates: `pnpm log:check` validates a log against the schema, and `pipeline/verify_bridge.py` now compares field *types* between the real and simulated logs instead of only key names.

## Checks

| | Check | Detail |
|---|---|---|
| **PASS** | 30 complete sessions reach the server | 30 of 30 sessions recorded SESSION_COMPLETED server-side. |
| **PASS** | every session delivered all twelve trials | All sessions carry twelve finalised estimates and twelve argument ratings. |
| **PASS** | no event was lost in the middle of a session | Sequence numbers are contiguous within every session. |
| **PASS** | no event was stored twice | 3570 rows, 3570 distinct event ids. |
| **PASS** | no two events share a position in a session | 3570 distinct (session, seq) pairs across 3570 rows. |
| **PASS** | every row is marked as a test run | run_mode values present: test. |
| **PASS** | a reload mid-session keeps what came before and duplicates nothing | Resumed on the same item; 22 events, all distinct. |
| **PASS** | the back button neither rewinds the session nor duplicates events | On the item screen after back/forward: true. 12 events, all distinct: true. |
| **PASS** | a double click produces one event per action | After double-clicking through one item: 1 ESTIMATE_FINALIZED, 1 ARGUMENT_RATED. |
| **PASS** | a ten-second outage delays delivery and loses nothing | Nothing reached the server during the outage (4 rows, unchanged); 8 events were held in the browser; after recovery all 12 events are present and distinct. |
| **PASS** | under 18: screened out, no consent shown, no randomisation | Consent screen shown: false. Reason recorded: age. Events: SESSION_STARTED, SCREENED_OUT. |
| **PASS** | CEFR A2: screened out, no consent shown, no randomisation | Consent screen shown: false. Reason recorded: language. Events: SESSION_STARTED, SCREENED_OUT. |
| **PASS** | the frozen stimuli are unchanged | Every stimulus file matches the committed manifest.   NOTE: manifest records launch_ready=false (stimuli not yet hand-verified). |
| **PASS** | every recorded event conforms to the schema | Every row conforms to StudyEvent. |
| **PASS** | the pipeline projects the validation data without error | replay.py completed.   -> data\validation-tables |
| **PASS** | the pipeline removes every test session before analysing | all 36 sessions removed as rehearsals: {'test': 36} |

## How to repeat this

```bash
pnpm validate:pilot     # ~20 minutes: drives a real browser
pnpm validate:render    # rewrites this file from the run
```

`validate:pilot` does not retry. A delivery check that passes on the second attempt has told you the opposite of what it was asked.

