# Ethics package

Prepared for the ethics committee of Nazarbayev Intellectual School of Science
and Mathematics, Kokshetau.

**Study.** How people use answers from an AI assistant: an online judgement task.
**Researcher.** Prokopenko Darya Artyomovna, 12th grade — dashaprokop24@gmail.com
**Supervisor.** Rakhimbekova Saya Dissembeyevna — rakhimbekova_s@kt.nis.edu.kz

## What is in here

| File | What it answers |
|---|---|
| [`all_participant_texts.md`](all_participant_texts.md) | Everything a participant sees, in the order they see it: screening, consent, the 12 questions, all 48 assistant answers with their variant labels, the follow-up replies, the questionnaires, and the debriefing. |
| [`data_inventory.md`](data_inventory.md) | What is collected and what is not: IP, user agent, timestamps, identifiers, where the data live, and whether anyone could be re-identified. Every answer checked against the source. |
| [`generation_provenance.md`](generation_provenance.md) | Which model wrote the assistant's answers, with what settings, where the prompts are, and what the seeds do. For the Method section. |

Two of the three are generated from the running application and the frozen
materials, so they cannot drift from what participants actually see:

```bash
pnpm exec tsx scripts/export-participant-texts.ts
```

The consent and debriefing texts are additionally checked by an automated test
(`apps/study/test/ethics-document.test.tsx`) that renders the real screens and
fails if a single sentence has diverged from the approved wording.

## The state of the study as this package was prepared

| | |
|---|---|
| Stimuli | 48 responses, generated 2026-09-06, frozen under manifest `ae66848166aeb2f1…` |
| `launch_ready` | **false** — the material has not yet been read and approved by the researcher, and the application refuses to serve it until it has |
| Data collection | not started; no participant has taken part |

## Outstanding

- **Retention period.** The consent form states retention by purpose ("for as
  long as the project and its results need to be checked") rather than as a
  number of years, because no period has been set. If the committee requires a
  specific one, it can be substituted.
- **Recruitment wording.** No advertisement or invitation text exists yet. If
  the committee expects to review it, it has to be written and added here.
