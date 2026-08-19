# eiai-study3

**Emotional Warmth as a Peripheral Cue: Processing-Route Displacement in Human–AI Epistemic Interaction**

Mixed 2 (emotional style: warm/neutral, between) × 2 (justification quality: strong/weak, within) experiment.
The primary hypothesis is the **interaction**: warmth flattens sensitivity to argument quality.

Specification: [`docs/STUDY3_SPEC_v3.md`](docs/STUDY3_SPEC_v3.md).

---

## Status

Days 1-5 of the seven-day build (`STUDY3_SPEC_v3.md` §10) are complete.

| Day | Deliverable | State |
|---|---|---|
| 1 | Monorepo scaffold, `packages/schema`, verified `items.json`, justification pairs | **done** |
| 2 | Register function + property tests; `generate.py` → 144 stimuli; equivalence checks; hash manifest | **done** (stimuli are placeholders — see below) |
| 3 | Statechart + model-based tests; consent flows; item screen | **done** |
| 4 | Telemetry package; IndexedDB WAL; ingest service | **done** |
| 5 | Follow-ups, verify button, questionnaire, funnel, debrief; i18n | **done** |
| 6 | Simulation bots + parameter recovery | **done** (exposed and fixed the allocation stub — see below) |
| 7 | `replay.py`, `analysis.py`, multiverse, Docker, CI repro gate, `make paper` | **done** |

## Commands

```bash
make install             # dependencies + Playwright's Chromium
make paper               # clean clone -> paper/results.pdf from bot data
make repro               # every generated artefact regenerates identically

pnpm install
pnpm verify              # everything CI runs
pnpm typecheck
pnpm test                # unit + property + golden-file
pnpm codegen             # regenerate docs/DATA_DICTIONARY.md from the Zod schemas

# stimulus pipeline (Python, no extra deps for offline mode)
python pipeline/generate.py --offline    # deterministic placeholders, no API key
python pipeline/generate.py              # real generation; needs GEMINI_API_KEY in .env
python pipeline/generate.py --provider groq   # or any OpenAI-compatible provider
pnpm stimuli:equivalence                 # content equivalence across conditions
pnpm stimuli:manifest                    # rebuild materials/manifest.json
pnpm coding:export                       # blinded kappa coding sheets for 2 raters
pnpm coding:score                        # Cohen's kappa per component

# end to end in a real browser (needs `pnpm exec playwright install chromium` once)
pnpm e2e

# run the participant app
pnpm --dir apps/study dev                # http://localhost:5173

# simulation and analysis (days 6-7)
pnpm allocation                          # regenerate the seeded allocation sequence
pnpm recover                             # simulate -> replay -> parameter recovery
pnpm multiverse                          # 48-specification curve
pnpm e2e:bots                            # bot policies through the real browser
pnpm bridge                              # simulated and real event streams agree
```

## Layout

```
eiai-study3/
├── packages/
│   ├── schema/       source of truth: Zod schemas -> types, validation, data dictionary
│   ├── fsm/          (day 3) session statechart + register function
│   ├── telemetry/    event capture, IndexedDB WAL, batched sync, resume
│   └── stimuli/      (day 2) frozen responses + loader + hash check
├── apps/study/       (day 3) participant-facing React + Vite SPA
├── services/ingest/  single append-only serverless endpoint + SQL migration
├── pipeline/         (day 2+) generation, verification, replay, analysis
├── e2e/              Playwright happy-path; day 6 adds the simulation bots
├── materials/        item bank; frozen stimuli and hash manifest land here
└── docs/             spec, ADRs, generated data dictionary
```

## The one rule

From §0 of the spec: **anything that must be captured at collection time outranks
anything that can be computed later.** A fancier analysis can be added in month
two. A scroll event from a participant who left in week three cannot.

That is why `packages/schema` is Day 1 and the analysis pipeline is Day 7.

## Days 6-7 notes

- **The bots exposed the allocation stub, which is what they were for.** The
  spec says day 6 "will expose something". It exposed that `ALLOCATE` carried
  the literals `warm` and `en:adult`, with two consequences neither the unit
  suite nor the model-based suite could see: **the neutral arm was unreachable**,
  so half the design had never been walked end to end in a browser; and the
  **recorded stratum contradicted the participant's own eligibility answers**
  for anyone who was not an English-speaking adult. `pipeline/allocation.py`
  now generates a committed, seeded, block-randomised sequence and the app
  draws from it against the real stratum. The e2e run now sees both arms.
- **Assignment needs no backend, and pays for it.** The index is derived from
  the session id with FNV-1a, so anyone holding the log can recompute which
  entry a session should have drawn. The cost is that two participants can land
  on the same index, so the sequence's exact block balance holds only in
  expectation until the ingest service hands out indices. `allocation_seq` is in
  every `ALLOCATED` event either way, so realised balance is checkable rather
  than assumed. The hash is tested for uniformity, not just for returning a
  valid arm — a modulus bug that skipped half the sequence would still look
  random in the log.
- **Recovery is only worth something because of the bridge.**
  `pipeline/simulate.py` writes event streams directly, which is the only way
  to get 360 sessions in seconds — and on its own it would be testing my
  assumptions about the app rather than the app. `e2e/bots.spec.ts` walks the
  same policies through the real UI and `pipeline/verify_bridge.py` compares
  the two logs on structure: event types, payload keys, per-item shape. Deleting
  one payload key from the simulator fails it.
- **Every check was mutation-tested.** A check that cannot fail is not a check.
  Feeding the analysis a WOA computed against the true value instead of the
  advice fails 2 of 11 recovery checks — and leaves the scroll-depth and
  null-bot checks green, which is exactly right.
- **H1 and H3 are asserted to be the same number.** With two within-subject
  levels the interaction reduces to a between-groups contrast on the difference
  score, so `F = t²`. The report prints the identity check; if it ever stops
  holding, one of the two is computed wrongly.
- **`make paper` prints through Chromium, not LaTeX.** Playwright's browser is
  already a dependency for the e2e suite, so the results document goes HTML →
  PDF through it rather than adding a two-gigabyte TeX toolchain for one file.
- **Not done: `data/` is derived and gitignored.** `make paper` rebuilds all of
  it from the committed seed. Committing it would create a second source of
  truth that can drift from the first.

## Day 5 notes

- **The funnel is three screens, not one form.** The spec requires the stages be
  administered in order without backtracking, so there is deliberately no
  transition back: seeing "did anything seem unusual?" must not let a
  participant revise their more spontaneous answer to "what was this about?".
- **The debrief is generated from `materials/items.json`.** Correcting a true
  value there updates what participants are told automatically. Hardcoding the
  corrections is how someone gets told something the appendix contradicts.
- **Age band and primary language are no longer asked twice.** Both are captured
  at eligibility and carried into the questionnaire data. Re-asking twenty
  minutes later invites a contradicting answer and adds burden for nothing.
- **Each follow-up may be asked once per item.** The reply is pre-written and
  identical on a second press, so repeats would only inflate the challenge-rate
  measure. "Check this claim" is deliberately unlimited — pressing it twice is a
  real signal.
- **Russian and Kazakh are empty, not machine-filled.** §11 requires cultural
  adaptation with back-translation and native-speaker verification. A machine
  draft would look finished and silently fail the manipulation check in two of
  three language groups. `t()` falls back to English and `missingKeys()` reports
  the gap, so it is visible during the pilot rather than invisible in the data.
- **Model-based path generation needed a custom state key.** `verifyClicks` is
  an unbounded counter, so keying the graph on raw context never terminates.
  The key keeps everything a guard reads and collapses counters and answer
  values to their shape. Getting this wrong in either direction is silent: too
  much collapsing and the traversal mistakes real transitions for self-loops.

## Day 4 notes

- **Zero event loss is asserted, not claimed.**
  `packages/telemetry/test/durability.test.ts` records events while offline,
  discards the telemetry instance to simulate a reload, brings the network
  back, and checks all 22 events arrive exactly once and in sequence order.
- **Ack after the server has it, never before.** A record leaves the WAL only
  on a 2xx. Acknowledging optimistically would turn any delivery failure into
  permanent, undetectable loss.
- **Insert-only is enforced three times over** — no update or delete code path
  in the service, UPDATE/DELETE revoked from every client role, and triggers
  that raise regardless of who attempts them. The paper says the table is
  append-only, so that should not rest on the application layer alone.
- **RESPONSE_REVEALED re-emits on resume, by design.** A participant who
  reloads sees the response again, so `ms_since_reveal` is measured from that
  second showing — timing across an arbitrarily long gap would inflate every
  reaction time. The cost: an item can carry more than one reveal, so
  `pipeline/replay.py` must reduce on the **last** per (session, item) rather
  than assume one. Pinned by a test so day 7 cannot get it wrong silently.
- **The advice box has a fixed height and scrolls.** If the response always
  fitted on screen, scroll depth — the H4 mediator — would be a constant.
  Identical in both conditions, and both run 60-90 words.
- **Not handled yet: IndexedDB unavailable.** Some hardened and private-mode
  browsers refuse it; the WAL open would throw. Needs a fallback (in-memory,
  with a visible warning) before piloting.
- **Allocation is still a local stub.** The `ALLOCATE` event carries a
  hard-coded warm/en:adult assignment. Wiring it to a seeded, backend-served
  sequence needs `pipeline/allocation.py`, which the spec does not schedule
  until pre-registration; it must land before the pilot.
- Supabase is not provisioned. `services/ingest/sql/001_events.sql` is ready to
  apply and the handler is tested against an in-memory store with the same
  primary-key semantics, but nothing has been run against a real database.

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

- **The committed stimuli are offline placeholders.** Real generation has been
  run end to end and works — one variant file (12 Kazakh responses) came back
  with every record valid on the first attempt — but a full set is about
  394,000 tokens against a free-tier budget of 200,000 per day, so it spans
  roughly two days. A half-generated set cannot be manifested (the twelve files
  would disagree on provenance), so the committed state stays entirely
  placeholder until a run completes. See `pipeline/README.md`. They exist so the rest
  of the chain — equivalence, manifest, golden-file test, coding sheets — could
  be built and proven. `materials/manifest.json` records `launch_ready: false`,
  every response carries `"placeholder": true`, and
  `assertLaunchReady()` throws. Re-run `python pipeline/generate.py` with a key
  before piloting; nothing else changes.
- **Generation runs against any OpenAI-compatible provider**, configured in one
  `PROVIDERS` block in `pipeline/generate.py`. Default is Groq
  (`openai/gpt-oss-120b`) reading `GROQ_API_KEY`; Gemini is one flag away but
  its free tier allows only 20 requests per day **per model** against a
  168-call run, which would mean splitting the set across models — and stimuli
  written by different models are not one frozen stimulus set. Candidates were
  tested in all three languages, which decided it: the best English writer of
  the lot returned 400 for Russian and Kazakh. See `pipeline/README.md` for the
  full selection record, including the model rejected for *passing* every
  automated check while quietly adding consensus-appeal phrasing to the body.
  A run stopped by an exhausted quota keeps everything already written —
  re-running skips finished variants instead of re-spending the quota.
- **The justification call takes the source sentence as its user turn, not the
  item's question.** It used to take the question, so the model answered rather
  than translated: on item_11 it returned the real snailfish depth. That item
  carries a planted value, so this would have leaked the true value into text
  shown identically in both conditions. Rendered justifications are now
  validated — every source justification in the bank is number-free, so the
  rule is simply that the rendering must contain no digits at all.
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
