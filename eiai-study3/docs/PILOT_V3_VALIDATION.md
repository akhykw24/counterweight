# Pre-pilot validation — v3

**Verdict: PASS** — 24 of 24 checks passed.

**Launch: ready** — no placeholder remains in participant-facing text.

Run 2026-10-29 13:18:21 UTC against the local dev server and the real ingest handler: 21 complete sessions (20 on a desktop screen, 5 per cell, plus one on a phone-sized screen) and the failure scenarios — 34 sessions and 2899 events in total. Every link used `test=true`, so none of it can ever be analysed.

## Checks

| | Check | Detail |
|---|---|---|
| **PASS** | 20 complete sessions, 5 in each cell | Sessions per cell: EI-A 5, Neutral-B 5, EI-B 5, Neutral-A 5. |
| **PASS** | every event the browser recorded was acknowledged by the server | The write-ahead log was empty at the end of every session: nothing left undelivered. |
| **PASS** | a reload mid-lesson resumes on the same message and duplicates nothing | Lesson positions recorded: [1,2,3,4]; events before the reload kept: true; 23 events, all distinct. |
| **PASS** | a reload mid-task returns to the same task and records it once | Task before reload T4, after T4; answers for it: 1; mission answers so far: 2. |
| **PASS** | the back button neither leaves nor rewinds the study | Same task on screen after Back: true. 23 events, all distinct. |
| **PASS** | a double click on Continue or Next records one event | After double-clicking every Continue and two Nexts: 4 lesson items, 2 mission answers. |
| **PASS** | ten seconds without a network while saving loses nothing | During 19 s offline the server stayed at 21 rows while the browser held 4; after recovery 27 rows, sequence contiguous: true, all distinct. |
| **PASS** | age 17: screened out for age, no allocation, no age stored | Events: session_started, screen_viewed, consent_given, screen_viewed, screened_out, screen_viewed. |
| **PASS** | English A1-A2: screened out for language, no allocation | Events: session_started, screen_viewed, consent_given, screen_viewed, screened_out, screen_viewed. |
| **PASS** | a complete session works on a phone-sized screen (Pixel 5, 393 px) | Completed: true. Horizontal scrolling on: no screen. |
| **PASS** | one link: four people starting together get four different cells, from the sequence | Cells: Neutral-B, EI-A, Neutral-A, EI-B; slots 0, 1, 2, 3; each cell matches its slot in the committed test sequence: true. |
| **PASS** | a lost connection while the slot is handed out: the participant waits, then gets exactly one slot | Waiting screen shown during 10 s offline: true; allocation events afterwards: 1. |
| **PASS** | a reload while waiting for a slot: one session, one slot, one allocation | Slots held by this session: 1 (test:C1-C2-native #0); allocation events: 1. |
| **PASS** | each complete session: 12 lesson items, 12 mission answers, 1 attention check, 16 quiz ratings | All 21 complete sessions. |
| **PASS** | strong and weak versions match the cell's list in every event | List A: odd claims strong; list B: even claims strong. No exceptions. |
| **PASS** | every event carries the cell from allocation onwards, and none before | Checked on every row of every complete session. |
| **PASS** | no event was stored twice | 2899 rows, 2899 distinct event ids. |
| **PASS** | no event was lost: sequence numbers are contiguous in every session | 34 sessions checked; 2899 distinct (session, seq) pairs. |
| **PASS** | every row is marked as a test run | run_mode values: test. |
| **PASS** | pilot links show the feedback questions and record the answers | 21 of 21 complete sessions carry pilot_feedback. |
| **PASS** | the v3 stimuli match the approved texts and the manifest | v3 stimuli match the approved source; 10 files match the manifest.   manifest_sha256 2a2540dd2f3825269685dc4ca5145535a81b848e5f94b14a2b32301c0a2d5b83 |
| **PASS** | every recorded event conforms to the event schema | 2899 rows from 1 log. Every row conforms to the event schema (deep-sea or v3). |
| **PASS** | the export runs on this data (long CSV, wide CSV, JSON) | 2899 events, 34 sessions -> results/validation_v3   excluded as withdrawn: 0 session(s) |
| **PASS** | the pilot summary runs on this data | 32 participant(s), 21 completed -> results\validation_v3\SUMMARY.md |

## How to repeat this

```bash
pnpm validate:v3          # drives a real browser (about 15 minutes)
pnpm validate:v3:render   # rewrites this file from the run
```

No retries: a delivery check that passes on a second attempt has answered the opposite question.
