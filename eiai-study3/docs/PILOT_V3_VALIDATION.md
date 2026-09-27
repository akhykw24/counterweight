# Pre-pilot validation — v3

**Verdict: PASS** — 22 of 22 checks passed.

**Launch: ready** — no placeholder remains in participant-facing text.

Run 2026-09-27 11:10:38 UTC against the local dev server and the real ingest handler: 21 complete sessions (20 on a desktop screen, 5 per cell, plus one on a phone-sized screen) and the failure scenarios — 28 sessions and 2777 events in total. Every link used `test=true`, so none of it can ever be analysed.

## Checks

| | Check | Detail |
|---|---|---|
| **PASS** | 20 complete sessions, 5 in each cell | Sessions per cell: EI-A 5, Neutral-B 5, EI-B 5, Neutral-A 5. |
| **PASS** | every event the browser recorded was acknowledged by the server | The write-ahead log was empty at the end of every session: nothing left undelivered. |
| **PASS** | a reload mid-lesson resumes on the same message and duplicates nothing | Lesson positions recorded: [1,2,3,4]; events before the reload kept: true; 26 events, all distinct. |
| **PASS** | a reload mid-task returns to the same task and records it once | Task before reload T3, after T3; answers for it: 1; mission answers so far: 2. |
| **PASS** | the back button neither leaves nor rewinds the study | Same task on screen after Back: true. 26 events, all distinct. |
| **PASS** | a double click on Continue or Next records one event | After double-clicking every Continue and two Nexts: 4 lesson items, 2 mission answers. |
| **PASS** | ten seconds without a network while saving loses nothing | During 14 s offline the server stayed at 24 rows while the browser held 4; after recovery 30 rows, sequence contiguous: true, all distinct. |
| **PASS** | age 17: screened out for age, no allocation, no age stored | Events: session_started, screen_viewed, consent_given, screen_viewed, screened_out, screen_viewed. |
| **PASS** | English A1-A2: screened out for language, no allocation | Events: session_started, screen_viewed, consent_given, screen_viewed, screened_out, screen_viewed. |
| **PASS** | a complete session works on a phone-sized screen (Pixel 5, 393 px) | Completed: true. Horizontal scrolling on: no screen. |
| **PASS** | a plain link shows 'not open yet' and records nothing | Rows written for this browser: 0. |
| **PASS** | each complete session: 12 lesson items, 12 mission answers, 1 attention check, 16 quiz ratings | All 21 complete sessions. |
| **PASS** | strong and weak versions match the cell's list in every event | List A: odd claims strong; list B: even claims strong. No exceptions. |
| **PASS** | every event carries the cell from allocation onwards, and none before | Checked on every row of every complete session. |
| **PASS** | no event was stored twice | 2777 rows, 2777 distinct event ids. |
| **PASS** | no event was lost: sequence numbers are contiguous in every session | 28 sessions checked; 2777 distinct (session, seq) pairs. |
| **PASS** | every row is marked as a test run | run_mode values: test. |
| **PASS** | pilot links show the feedback questions and record the answers | 21 of 21 complete sessions carry pilot_feedback. |
| **PASS** | the v3 stimuli match the approved texts and the manifest | v3 stimuli match the approved source; 10 files match the manifest.   manifest_sha256 24c80c721df3fafd2091566445f4b77e19bb5a5fd9d1fce0f67721d86c3ffa22 |
| **PASS** | every recorded event conforms to the event schema | 121 rows from 1 log. Every row conforms to the event schema (deep-sea or v3). |
| **PASS** | the export runs on this data (long CSV, wide CSV, JSON) | 0 events, 0 sessions -> results/validation_v3   excluded as withdrawn: 0 session(s) |
| **PASS** | the pilot summary runs on this data | 0 participant(s), 0 completed -> results\validation_v3\SUMMARY.md |

## How to repeat this

```bash
pnpm validate:v3          # drives a real browser (about 15 minutes)
pnpm validate:v3:render   # rewrites this file from the run
```

No retries: a delivery check that passes on a second attempt has answered the opposite question.
