# eiai-study3

**Emotional Warmth as a Peripheral Cue: Processing-Route Displacement in Human–AI Epistemic Interaction**

Mixed 2 (emotional style: warm/neutral, between) × 2 (justification quality: strong/weak, within) experiment.
The primary hypothesis is the **interaction**: warmth flattens sensitivity to argument quality.

Specification: [`docs/STUDY3_SPEC_v3.md`](docs/STUDY3_SPEC_v3.md).

---

## Status

Days 1-3 of the seven-day build (`STUDY3_SPEC_v3.md` §10) are complete.

| Day | Deliverable | State |
|---|---|---|
| 1 | Monorepo scaffold, `packages/schema`, verified `items.json`, justification pairs | **done** |
| 2 | Register function + property tests; `generate.py` → 144 stimuli; equivalence checks; hash manifest | **done** (stimuli are placeholders — see below) |
| 3 | Statechart + model-based tests; consent flows; item screen | **done** |
| 4 | Telemetry package; IndexedDB WAL; ingest service | not started |
| 5 | Follow-ups, verify button, questionnaire, funnel, debrief; i18n | not started |
| 6 | Simulation bots + parameter recovery | not started |
| 7 | `replay.py`, `analysis.py`, multiverse, Docker, CI repro gate, `make paper` | not started |

## Commands

```bash
pnpm install
pnpm verify              # everything CI runs
pnpm typecheck
pnpm test                # unit + property + golden-file
pnpm codegen             # regenerate docs/DATA_DICTIONARY.md from the Zod schemas

# stimulus pipeline (Python, no extra deps for offline mode)
python pipeline/generate.py --offline    # deterministic placeholders, no API key
python pipeline/generate.py              # real generation; needs ANTHROPIC_API_KEY
pnpm stimuli:equivalence                 # content equivalence across conditions
pnpm stimuli:manifest                    # rebuild materials/manifest.json
pnpm coding:export                       # blinded kappa coding sheets for 2 raters
pnpm coding:score                        # Cohen's kappa per component

# run the participant app
pnpm --dir apps/study dev                # http://localhost:5173
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

## Day 3 notes

- **Model-based coverage is stated precisely, not as "every path".**
  `getSimplePaths()` does not terminate usefully here: estimate and confidence
  are self-transitions in two phases and withdrawal is reachable from
  everywhere, so simple-path enumeration explodes. The suite covers every
  reachable screen, withdrawal from every screen, and both consent arms end to
  end — 46 generated paths driven against the real DOM. See ADR-003.
- **The spec names `@xstate/test`; that package is stale** at 0.5.1 (XState v4
  era). Model-based testing moved into `@xstate/graph` for v5. Same technique,
  current package.
- **A participant-blocking slider defect was found by hand, not by the model
  suite.** A range input always shows a thumb somewhere. If the participant
  agreed with that resting position, no `change` event fired, the machine never
  received their estimate, and Continue stayed disabled with nothing on screen
  explaining why. Now committed on pointer and key release too, with a
  regression test. The model suite passed straight through it, because
  generated paths always send a value that differs from the default — worth
  remembering about what generated tests can and cannot see.
- **Open methodological question: the estimate slider anchors everyone at its
  midpoint.** `WOA = (final - initial) / (advice - initial)`, so a shared
  starting position biases the denominator of the primary DV. A free numeric
  input would remove the anchor. The spec says "slider", so this has not been
  changed unilaterally — but it should be settled before pre-registration.
- Vite is configured with an empty inline postcss config. Without it, Vite
  walks up and applies the **counterweight** repo's `postcss.config.js` and
  Tailwind config to this app's stylesheet.
- Questionnaire, funnel and debrief are stub screens so the statechart's later
  states are reachable now. Their content is day 5.
- `apps/study/src/events.ts` is an in-memory event recorder with a deliberately
  narrow interface. Day 4 swaps it for `@eiai/telemetry` without touching call
  sites. Nothing leaves the tab yet, because there is no ingest endpoint yet.

## Day 2 notes

- **The committed stimuli are offline placeholders.** There is no
  `ANTHROPIC_API_KEY` in this environment, so `generate.py --offline` produced
  144 structurally valid placeholder responses instead. They exist so the rest
  of the chain — equivalence, manifest, golden-file test, coding sheets — could
  be built and proven. `materials/manifest.json` records `launch_ready: false`,
  every response carries `"placeholder": true`, and
  `assertLaunchReady()` throws. Re-run `python pipeline/generate.py` with a key
  before piloting; nothing else changes.
- **Justifications are rendered once per (language, item)** and reused across
  all four condition variants, so they are byte-identical across warm and
  neutral by construction rather than by inspection. That is the property
  `verify_equivalence.py` asserts and the reviewer objection it answers.
- **Coding sheets are blinded.** Rows are shuffled with a committed seed and the
  condition is withheld; the unblinding key is written separately. A rater who
  can see "warm" in the row codes warmth, and the resulting kappa measures
  nothing.
- WOA and the projection property tests from §5 are deliberately **not** here.
  WOA belongs with the analysis in Python (`replay.py`, day 7); implementing it
  in TypeScript as well would mean two implementations of the primary DV.

## Day 1 notes

- `materials/items.json` carries eight open review flags (`review_required`).
  None block the build; all must be resolved before pre-registration.
  Item 11's snailfish record — which the spec explicitly refused to vouch for —
  was independently verified and is confirmed at 8,336 m.
- Kazakh and Russian question stems are **machine drafts**. §11's back-translation,
  reconciliation log, and native-speaker verification have not happened. Do not
  collect data against them.
- `docs/DATA_DICTIONARY.md` is generated. Edit the schemas, not the markdown.
