# v3 links and URL parameters

The study reads four URL parameters, once, when a session starts. A resumed
session keeps the values it started with, whatever the link says later.

| Parameter | Values | Effect |
|---|---|---|
| `pilot` | `true` only | Every event is marked `run_mode = pilot`. The consent screen shows the pilot notice (E1) and the three feedback questions (E9) appear before the debrief. |
| `test` | `true` only | Every event is marked `run_mode = test`. Test runs are never analysed. Wins over `pilot` when both are present. |
| `p` | 1, 2, 3 … | Position in the pilot rotation EI-A, Neutral-B, EI-B, Neutral-A (then round again). |
| `cell` | `EI-A`, `EI-B`, `Neutral-A`, `Neutral-B` | Forces the cell. **Honoured only with `test=true`**; ignored otherwise, so a forwarded test link cannot let anyone pick a condition. |

Only the exact string `true` counts: `pilot=1`, `pilot=yes` or a bare `pilot`
are treated as absent.

## The main study: one link

```
https://counterweight-pearl.vercel.app/
```

A link with neither `pilot=true` nor `test=true` is the main study
(`run_mode = live`). After screening and the pre-measures the browser asks
`/api/allocate` for the next slot of the committed sequence
(docs/allocation-v3-precommit.txt): permuted blocks of four within the two
English-level strata, handed out one at a time by the database, the same slot
again for a session that asks twice. `cell=` and `p=` are ignored on it.

`?test=true` without `cell=` rehearses exactly that link, from a separate test
sequence, so it never uses a participant's slot. `GET /api/allocate` reports
how many slots each stratum has used.

`VITE_V3_LIVE=closed` at build time shuts the main link ("This study is not
open yet.") without affecting pilot or test links.

## Pilot links (one per participant)

```
https://counterweight-pearl.vercel.app/?pilot=true&p=1   -> EI-A
https://counterweight-pearl.vercel.app/?pilot=true&p=2   -> Neutral-B
https://counterweight-pearl.vercel.app/?pilot=true&p=3   -> EI-B
https://counterweight-pearl.vercel.app/?pilot=true&p=4   -> Neutral-A
https://counterweight-pearl.vercel.app/?pilot=true&p=5   -> EI-A
```

The rotation counts only people who pass screening. Someone screened out never
reaches allocation, so their number is simply given to the next person.

## Test links (to look at each version; never analysed)

```
https://counterweight-pearl.vercel.app/?test=true&pilot=true&cell=EI-A
https://counterweight-pearl.vercel.app/?test=true&pilot=true&cell=EI-B
https://counterweight-pearl.vercel.app/?test=true&pilot=true&cell=Neutral-A
https://counterweight-pearl.vercel.app/?test=true&pilot=true&cell=Neutral-B
```

`pilot=true` is included so the preview shows exactly what a pilot participant
sees (the notice and the feedback questions); `test=true` still marks every
event as a test.

A browser resumes its unfinished session. To start again from the beginning
in the same browser, open the link in a private window.
