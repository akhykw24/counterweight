# eiai-study3

**Emotional Warmth as a Peripheral Cue: Processing-Route Displacement in Human–AI Epistemic Interaction**

Mixed 2 (emotional style: warm/neutral, between) × 2 (justification quality: strong/weak, within) experiment.
The primary hypothesis is the **interaction**: warmth flattens sensitivity to argument quality.

Specification: [`docs/STUDY3_SPEC_v3.md`](docs/STUDY3_SPEC_v3.md).

---

## Status

Day 1 of the seven-day build (`STUDY3_SPEC_v3.md` §10) is complete.

| Day | Deliverable | State |
|---|---|---|
| 1 | Monorepo scaffold, `packages/schema`, verified `items.json`, justification pairs | **done** |
| 2 | Register function + property tests; `generate.py` → 144 stimuli; equivalence checks; hash manifest | not started |
| 3 | Statechart + model-based tests; consent flows; item screen | not started |
| 4 | Telemetry package; IndexedDB WAL; ingest service | not started |
| 5 | Follow-ups, verify button, questionnaire, funnel, debrief; i18n | not started |
| 6 | Simulation bots + parameter recovery | not started |
| 7 | `replay.py`, `analysis.py`, multiverse, Docker, CI repro gate, `make paper` | not started |

## Commands

```bash
pnpm install
pnpm verify        # typecheck + tests + data-dictionary drift check
pnpm typecheck
pnpm test
pnpm codegen       # regenerate docs/DATA_DICTIONARY.md from the Zod schemas
```

## Layout

```
eiai-study3/
├── packages/
│   ├── schema/       source of truth: Zod schemas -> types, validation, data dictionary
│   ├── fsm/          (day 3) session statechart + register function
│   ├── telemetry/    (day 4) event capture, IndexedDB WAL, batched sync
│   └── stimuli/      (day 2) frozen responses + loader + hash check
├── apps/study/       (day 3) participant-facing React + Vite SPA
├── services/ingest/  (day 4) single append-only serverless endpoint
├── pipeline/         (day 2+) generation, verification, replay, analysis
├── e2e/              (day 5) Playwright: human flows + simulation bots
├── materials/        item bank; frozen stimuli and hash manifest land here
└── docs/             spec, ADRs, generated data dictionary
```

## The one rule

From §0 of the spec: **anything that must be captured at collection time outranks
anything that can be computed later.** A fancier analysis can be added in month
two. A scroll event from a participant who left in week three cannot.

That is why `packages/schema` is Day 1 and the analysis pipeline is Day 7.

## Day 1 notes

- `materials/items.json` carries eight open review flags (`review_required`).
  None block the build; all must be resolved before pre-registration.
  Item 11's snailfish record — which the spec explicitly refused to vouch for —
  was independently verified and is confirmed at 8,336 m.
- Kazakh and Russian question stems are **machine drafts**. §11's back-translation,
  reconciliation log, and native-speaker verification have not happened. Do not
  collect data against them.
- `docs/DATA_DICTIONARY.md` is generated. Edit the schemas, not the markdown.
