# Implementation status against the specification

**Audited:** 2026-09-04 · **Branch:** `study3-materials`
**Specification audited against:** [`docs/spec/v2/STUDY3_SPEC.md`](spec/v2/STUDY3_SPEC.md)
**Full test output:** [`docs/audit/test-output-2026-09-04.txt`](audit/test-output-2026-09-04.txt)

This supersedes the audit of 2026-09-02, which was written against v3 of the
old specification while v2's adults-only, English-only redesign was still
pending. The redesign is now applied to the code, so every row below describes
v2 and nothing is flagged `v2-pending`.

## Test run summary

Thirteen gates, all passing. Nothing is skipped, disabled or marked `.only`.

| Gate | Result |
|---|---|
| TypeScript typecheck (libraries + app) | pass |
| Unit / property (fast-check) / model-based / golden-file — vitest | 273 passed, 20 files |
| Pipeline — pytest | 88 passed |
| Data-dictionary drift | up to date |
| Stimulus manifest integrity | 4 files match the committed manifest |
| Allocation sequence freshness | current (192 assignments across 2 strata, seed 20260817) |
| Content equivalence across conditions | 2047 checks, confirmed |
| Reproducibility gate (projections) | byte-for-byte from 66,614 events |
| Parameter recovery | all planted effects recovered within interval |
| Participant exclusions | applied and counted per criterion |
| Specification curve | 48 specifications, no errors |
| Playwright end-to-end | 7 passed |
| Simulator / real-app bridge | shapes agree across 15 event types |

---

## §1 Science core

| # | Requirement | Status | Implemented in | Test that proves it | Comment |
|---|---|---|---|---|---|
| 1.1 | Mixed 2 (style) × 2 (justification quality) design | **done** | `materials/quality_assignment.json` | `packages/schema/test/design-constraints.test.ts` | Displayed set is 6 strong / 6 weak. The analysed 2×2 is 4 strong / 4 weak with equal advice accuracy in both cells; the other four are correct strong-justification fillers. See "Decisions taken" #1. |
| 1.2 | Primary hypothesis = style × quality interaction on WoA | **done** | `pipeline/analysis.py` (`mixed_anova_interaction`, `welch`) | `pipeline/tests/test_design_contrast.py` | The report asserts `F = t²`, so H1 and H3 cannot disagree silently. |
| 1.3 | EI manipulation, five named components, κ ≥ 0.60 per component | **tooling done, data pending** | `pipeline/verify_components.py` | audit output §3 exercises the module | Blinded export and Cohen's κ implemented, floor enforced. No rater data exist yet, so no κ has been computed. Human work — see "Needs you" #1. |
| 1.4 | Register FSM: LOW < 40, MODERATE 40–70, HIGH > 70 | **done** | `packages/fsm/src/register.ts` | `packages/fsm/test/register.test.ts` (fast-check) | Throws outside [0,100] rather than clamping. |
| 1.5 | Warm branches by confidence, neutral does not | **done** | `packages/fsm/src/register.ts` (`registerFor`) | `packages/stimuli/test/golden.test.ts` | The non-branching is asserted, not incidental. |
| 1.6 | 12 items × (3 warm registers + 1 neutral) = 48 responses | **done** | `materials/responses/*.json` (4 files × 12 items) | `packages/stimuli/test/golden.test.ts` | Structurally complete. Content is placeholder — see 1.7. |
| 1.7 | Stimuli pre-generated, hand-verified, frozen | **generated, awaiting your reading** | `pipeline/generate.py`, `pipeline/hash_manifest.py`, `pipeline/hand_verification.py` | `pipeline/tests/test_launch_gate.py`; `packages/stimuli/test/golden.test.ts`; `python pipeline/hash_manifest.py --check` | 48 real responses generated 2026-09-05 (Groq / gpt-oss-120b), equivalence confirmed over 683 checks, manifest `ae668481...`. `launch_ready` is **false** and stays false until someone records having read them: `python pipeline/hash_manifest.py --confirm-verified "Your Name"`. See [`docs/DEPLOY.md`](DEPLOY.md) §4. |
| 1.8 | Perceived-warmth manipulation check (must differ) | **done** | `pipeline/analysis.py` (`manipulation_checks`) | `pipeline/tests/test_manipulation_checks.py` | Directional: warm must read as warmer, not merely different. Printed above the hypothesis tests. |
| 1.9 | Perceived-competence control check (must NOT differ) | **done** | `pipeline/analysis.py` (`manipulation_checks`) | `pipeline/tests/test_manipulation_checks.py` | Judged by BF₀₁ ≥ 3 with at least 20 per arm, not by p > .05 — a p-based control is easiest to pass with a sample too small to say anything. |
| 1.10 | Per-item perceived argument strength, after the revised estimate | **done** | `packages/fsm/src/session.ts` (`task.rate`), `apps/study/src/screens.tsx` | `apps/study/test/argument-rating.test.tsx` | One event per item, no skip transition; a structural test asserts the state handles nothing but `RATE_ARGUMENT`. |
| 1.11 | Funnelled suspicion probe | **done** | `apps/study/src/screens-end.tsx` (`FunnelScreen`) | `e2e/happy-path.spec.ts` | Three screens, forward-only. |
| 1.12 | Full debrief with corrections and sources | **done** | `apps/study/src/screens-end.tsx` (`DebriefScreen`) | `apps/study/test/end-screens.test.tsx` | Corrections and citations come from the item bank. A test asserts no state but `debrief` targets `done`. See "Needs you" #3. |
| 1.13 | Eligibility: 18+, CEFR B1+, no formal training, asked before consent | **done** | `packages/fsm/src/session.ts` (screening gate) | `packages/fsm/test/session.test.ts`, `e2e/happy-path.spec.ts` | Three separate exits, each with a reason. Only `SCREENED_OUT` is recorded; nothing identifies the visitor. |
| 1.14 | Single adult informed-consent flow, telemetry named | **done** | `apps/study/src/screens.tsx` (`ConsentScreen`) | `apps/study/test/end-screens.test.tsx` | `CONSENT_GIVEN` carries no flow discriminator: there is one flow, and naming it would be a literal that could drift from the participant. |
| 1.15 | N = 126 target, hard cap 160, stratified, seeded block randomisation | **done** | `pipeline/power.py`, `pipeline/allocation.py` | `pipeline/tests/test_strata_config.py`; `python pipeline/allocation.py --check` | Sequence pre-committed by SHA-256 in `docs/allocation-precommit.txt`. |
| 1.16 | Two strata (`B1-B2`, `C1-C2/native`), named in configuration not code | **done** | `materials/strata.json`, `pipeline/strata.py`, `apps/study/src/strata.ts` | `pipeline/tests/test_strata_config.py` | A three-stratum config is proven to work with no code change. `packages/schema/test/no-hardcoded-branching.test.ts` scans the app for stratum literals. |

## §3–§7 Architecture

| # | Requirement | Status | Implemented in | Test that proves it | Comment |
|---|---|---|---|---|---|
| 3.1 | Append-only event log, immutable, replayable | **done** | `packages/schema/src/events.ts` (19 event types) | `packages/schema/test/events.test.ts` | Every payload field carries a description; the data dictionary is generated from them. |
| 3.2 | Ingest service, idempotent on `event_id` | **done** | `services/ingest/src` | `services/ingest/test`, `e2e/ingest.spec.ts` | At-least-once delivery reconciled by event UUID. `pnpm dev` mounts the production handler over a file-backed store, so the participant-to-server path runs and is tested with no cloud account. |
| 3.4 | The events actually reach a server | **done** | `api/events.ts`, `vercel.json`, `services/ingest/sql/001_events.sql` | `e2e/ingest.spec.ts` (5 tests, including a mid-session outage); `scripts/verify-ingest.mjs --write` against the deployment | Deployed 2026-09-05. App at `counterweight-pearl.vercel.app`, ingest function live, Supabase table created with its immutability triggers. The round trip is proven: a row was written and a re-send stored nothing. |
| 3.3 | Projections are pure functions of the log | **done** | `pipeline/replay.py` | `python pipeline/replay.py --check` | Reprojection is byte-identical from 66,614 events. |
| 4.1 | Typed end to end, documentation generated from the schemas | **done** | `packages/schema`, `packages/schema/scripts/generate-data-dictionary.ts` | `pnpm codegen:check` | 248 documented fields; drift fails CI. |
| 5.1 | Session flow as a statechart | **done** | `packages/fsm/src/session.ts` | `packages/fsm/test/session.test.ts` | Register selection is deliberately a pure function, not a state. |
| 5.2 | Model-based tests walk every reachable path | **done** | `apps/study/test/session.model.test.tsx` | same | Includes withdrawal from every screen and every screening exit. |
| 5.3 | Golden-file test on stimuli | **done** | `packages/stimuli/test/golden.test.ts` | same | SHA-256 of every frozen file against the committed manifest. |
| 6.1 | Write-ahead log in IndexedDB, survives reload | **done** | `packages/telemetry/src/wal.ts` | `packages/telemetry/test/durability.test.ts`, `e2e/happy-path.spec.ts` | Reload mid-session resumes on the same item and loses nothing. |
| 6.2 | Resume token, `resumed: true` on `SESSION_STARTED` | **done** | `packages/telemetry/src/resume.ts` | `packages/telemetry/test/repeat-session.test.ts` | Also carries `repeat_session`, which exclusion criterion 5 needs. |
| 7.1 | Simulation bots with known ground truth | **done** | `pipeline/simulate.py` | `pipeline/analysis.py --recover` | All planted effects recovered within interval. |
| 7.2 | Browser bots bridge the simulator to the real app | **done** | `e2e/bots.spec.ts`, `pipeline/verify_bridge.py` | `python pipeline/verify_bridge.py` | Shapes agree across 15 event types. |

## §8 Analysis stack

| # | Requirement | Status | Implemented in | Test that proves it | Comment |
|---|---|---|---|---|---|
| 8.1a | H1–H5 with Holm–Bonferroni across secondaries | **done** | `pipeline/analysis.py` | `pipeline/tests/test_design_contrast.py` | Quality contrast restricted to analysed items; a missing `role` column raises rather than falling back. |
| 8.1b | CEFR band as a covariate in the primary model | **done** | `pipeline/analysis.py` (`adjusted_discrimination`) | `pipeline/tests/test_confirmatory_extras.py` | Indicators, not a number: the CEFR scale is ordinal. A fixture that confounds proficiency with arm proves the adjustment removes it. |
| 8.1c | Pre-specified sensitivity analysis excluding B1 | **done** | `pipeline/analysis.py` (`sensitivity_excluding_b1`) | `pipeline/tests/test_confirmatory_extras.py` | Required recording the CEFR level itself: B1 and B2 share a stratum, so this was previously impossible to run after collection. |
| 8.1d | Jackknife over items | **done** | `pipeline/analysis.py` (`jackknife_over_items`) | `pipeline/tests/test_confirmatory_extras.py` | Eight estimates, not twelve — dropping a filler cannot move a contrast it was never in. |
| 8.2 | Bayes factor on H3 and the sequential stopping rule | **done** | `pipeline/analysis.py`, `pipeline/sequential.py` | `pipeline/tests/test_sequential.py` | JZS BF (Rouder 2009) integrated in log space. The look schedule is code: a BF of 500 between looks returns CONTINUE. |
| 8.3 | Multiverse / specification curve | **done** | `pipeline/multiverse.py` | audit output §11 | 48 specifications, curve plotted. |
| 8.4 | Process dynamics (estimate trajectories, EZ-diffusion) | **not built** | — | — | Labelled *exploratory* in the specification, and §9 warns against adding what looks advanced. The intermediate slider values are logged, so this remains available post-collection. See "Needs you" #4. |
| 8.5 | Target N and its stated assumptions | **done** | `pipeline/power.py` | audit output | Assumptions printed alongside the number rather than buried. |
| 8.6 | Participant exclusion criteria, per criterion, both ways | **done** | `pipeline/exclusions.py` | `pipeline/tests/test_exclusions.py` | One test per criterion plus threshold boundaries. Criterion 4 is present and deliberately never applied. Missing input raises. |
| 8.7 | Slot accounting: reservation, consumption, release, exhaustion | **done** | `pipeline/slots.py`, `apps/study/src/allocation.ts` | `pipeline/tests/test_slots.py`, `apps/study/test/allocation.test.ts` | Release is derived from the log, never performed, so a crashed browser needs no cleanup path. |

---

## Decisions taken without asking

1. **Which two items became weak (item_08 and item_12).** They stay fillers, so
   the analysed 2×2 remains 4 strong / 4 weak with equal advice accuracy in both
   cells. They add taxonomy and physical oceanography to the weak side; item_01
   (Challenger Deep) stays strong as the most checkable fact in the bank. Only
   labels moved — no stimulus text was edited, and the text hashes are unchanged.

2. **Forty-five minutes for slot release.** Flagged in the specification as not
   yet chosen. The session runs about twenty minutes, so this gives a slow
   participant more than double the intended time before anything is recycled
   underneath them, while still returning slots inside a recruitment day.

3. **BF₀₁ ≥ 3 with at least 20 per arm for the competence control check.** The
   specification says the scales must not differ but does not say how that is
   judged. A p-value above .05 would have been the obvious reading and the wrong
   one.

## Needs you

1. **κ coding.** Two raters, five components, κ ≥ 0.60 each. The export and the
   scoring exist; the raters do not.

2. **Real stimulus generation.** 48 cells, about 136,000 tokens against a
   free-tier budget of 200,000 a day — one day's budget, roughly 18 minutes of
   wall clock. (The earlier estimate of 394,000 was for three languages; v2 is
   English only.) `--dry-run` prints the cost before spending anything.
   Generation is followed by hand-verification, which is the slower half.
   Until both are done `launch_ready` stays false.

3. **The debrief does not mention the style manipulation.** It discloses every
   planted error with the correct value and a source, but not that participants
   were randomly assigned to a warm or a neutral advisor — which is the study's
   independent variable and would normally be disclosed. Writing that paragraph
   means writing debrief copy, which needs your say-so.

4. **§8.4 process dynamics.** Exploratory in the specification. The data are
   logged, so it can be added after collection without changing anything the
   participant sees. Say the word if you want it now.

5. **Deployment — done, 2026-09-05.** Kept here as the record of what it took.
   Three failures in sequence, each hiding the next: the runtime declaration
   was re-exported so Vercel's static analysis never saw it; `@types/node` sat
   in devDependencies, which Vercel prunes; and the Edge bundler could not
   inline `@eiai/schema` through the pnpm workspace symlink. All three surface
   as `FUNCTION_INVOCATION_FAILED`, which names none of them — the build log
   named the third in one line. Ask for the build log first next time.

6. **Volatile true values.** Three items carry facts that move and must be
   re-checked immediately before launch: `item_02` (28.7%, rises 1–1.5 points a
   year), `item_08` (~170 species, rises as new ones are described), `item_11`
   (8,336 m, a depth record that can be broken). `item_11` is a planted-error
   item, so its true value is what the debrief tells the participant — a stale
   number there is misinformation delivered as a correction.

7. **Ethics approval and pre-registration.** Neither is mentioned anywhere in
   the repository. Everything a pre-registration needs is already fixed in
   code: hypotheses, the stopping rule, exclusion criteria, and the allocation
   sequence digest in `docs/allocation-precommit.txt`.

8. **A pilot.** Five to ten people, after the stimuli are real. Note that a
   completed run on the production deployment enters the dataset as a
   participant and consumes a randomisation slot — see `docs/DEPLOY.md` for the
   deliberate procedure.
