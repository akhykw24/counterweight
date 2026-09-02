# Implementation status against the specification

**Audited:** 2026-09-02 · **Commit:** `28ae248` · **Branch:** `study3-materials`
**Specification audited against:** [`docs/STUDY3_SPEC_v3.md`](STUDY3_SPEC_v3.md), with the
science core and item bank carried over from [`docs/STUDY3_SPEC_v2.md`](STUDY3_SPEC_v2.md).
**Full test output:** [`docs/audit/test-output-2026-09-02.txt`](audit/test-output-2026-09-02.txt)

No code was changed during this audit.

> **This audit is against the CURRENT specification (v3), not the planned v2 redesign.**
> The 14-day roadmap moves the study to adults-only, English-only, two CEFR strata and a
> 6/6 item split. That decision has not been applied to the specification or the code yet;
> it is scheduled as its own task. Auditing against a specification that does not exist
> would mark almost every row `missing` for the reason "not decided yet", which is not
> useful. Rows affected by the planned redesign are flagged **[v2-pending]**.

## Test run summary

| Gate | Result |
|---|---|
| TypeScript typecheck (libraries + app) | pass |
| Unit / property (fast-check) / model-based / golden-file — vitest | 252 passed, 15 files |
| Pipeline tests — pytest | 12 passed |
| Data-dictionary drift | up to date |
| Content equivalence across conditions | 2047 checks, confirmed |
| Stimulus manifest integrity | 12 files match the committed manifest |
| Allocation sequence freshness | current (384 assignments, seed 20260817) |
| Parameter recovery | all planted effects recovered within interval |
| Reproducibility gate (projections) | byte-for-byte from 62,352 events |
| Specification curve | 48 specifications, no errors |
| Playwright end-to-end | 8 passed |
| Simulator / real-app bridge | shapes agree across 14 event types |

Nothing is skipped, disabled or marked `.only`.

---

## Requirements

### §1 Science core

| # | Requirement | Status | Implemented in | Test that proves it | Comment |
|---|---|---|---|---|---|
| 1.1 | Mixed 2 (style) × 2 (justification quality) design | **done** | `materials/items.json`, `materials/quality_assignment.json` | `packages/schema/test/design-constraints.test.ts` | 8 analysed items, 4 strong / 4 weak, plus 4 correct fillers. See "Known issues" #1. |
| 1.2 | Primary hypothesis = style × quality interaction on WoA | **done** | `pipeline/analysis.py` (`mixed_anova_interaction`, `welch`) | `pipeline/tests/test_design_contrast.py`; recovery §10 of the test output | Report asserts `F = t²`, so H1 and H3 cannot disagree silently. |
| 1.3 | EI manipulation, five named components, κ ≥ 0.60 per component | **partial** | `pipeline/verify_components.py` (blinded export + Cohen's κ) | `docs/audit/test-output-2026-09-02.txt` §3 exercises the module; no κ has been computed | Tooling exists and enforces the floor. No rater data exist yet, so the floor has never been applied to real coding. Human work. |
| 1.4 | Register FSM: LOW < 40, MODERATE 40–70, HIGH > 70 | **done** | `packages/fsm/src/register.ts` | `packages/fsm/test/register.test.ts` (fast-check property tests) | Throws outside [0,100] rather than clamping. |
| 1.5 | Warm branches, neutral does not | **done** | `packages/fsm/src/register.ts` (`registerFor`) | `packages/stimuli/test/golden.test.ts` ("resolution by register") | Non-branching is asserted, not incidental. |
| 1.6 | 12 items × 3 languages × 4 variants = 144 responses, 432 branches | **done** | `materials/responses/*.json` (12 files) | `packages/stimuli/test/golden.test.ts` ("stimulus space") | Structurally complete. Content is placeholder — see #2. |
| 1.7 | Stimuli pre-generated, hand-verified, frozen | **partial** | `pipeline/generate.py`, `pipeline/hash_manifest.py` | `python pipeline/hash_manifest.py --check` (§6 of the output) | Frozen and hash-manifested. **Not** hand-verified and not real: `launch_ready: false`. |
| 1.8 | Perceived-warmth manipulation check | **partial** | `packages/schema/src/questionnaire.ts` (5 warmth items); scored in `pipeline/analysis.py` (`warmth_perceived`) | `packages/schema/test/questionnaire.test.ts` | The scale is collected and scored. **No test of warm vs neutral on it is computed**, so the check is not actually performed. |
| 1.9 | Perceived-competence control check (must NOT differ) | **missing** | `packages/schema/src/questionnaire.ts` collects 4 competence items | `packages/schema/test/questionnaire.test.ts` proves the items exist | `pipeline/analysis.py` never mentions competence. The control check is not computed at all. |
| 1.10 | Funnelled suspicion probe | **done** | `apps/study/src/screens-end.tsx` (`FunnelScreen`); `pipeline/replay.py` (`funnel_*` columns) | `e2e/happy-path.spec.ts`, `e2e/minor-flow.spec.ts` | Three screens, forward-only, as §11 requires. |
| 1.11 | Full debrief with corrections and sources | **done** | `apps/study/src/screens-end.tsx` (`DebriefScreen`), generated from `materials/items.json` | `e2e/happy-path.spec.ts` (all four planted errors disclosed) | Corrections are derived from the bank, not hardcoded. |
| 1.12 | Dual consent flow (parental + assent for minors; standard for adults) | **done** [v2-pending] | `packages/fsm/src/session.ts`, `apps/study/src/screens.tsx` | `e2e/minor-flow.spec.ts` (both arms walked to the debrief) | See "Known issues" #3 — the roadmap's description of this was inaccurate. |
| 1.13 | Telemetry named explicitly in consent | **done** | `apps/study/src/screens.tsx` (`ConsentScreen`) | `e2e/happy-path.spec.ts` renders the screen | Names scroll depth and tab switching. Text is the researcher's; not edited. |
| 1.14 | N = 120, stratified by language × age group, seeded block randomization | **partial** | `pipeline/allocation.py`, `materials/allocation.json` | `apps/study/test/allocation.test.ts`, `python pipeline/allocation.py --check` | Sequence is seeded, committed, block-balanced and auditable. Target N is not enforced anywhere, and the stopping rule is not implemented — see §8.2. |

### §3 Event-sourced data model

| # | Requirement | Status | Implemented in | Test that proves it | Comment |
|---|---|---|---|---|---|
| 3.1 | Append-only event log, 18 event types | **done** | `packages/schema/src/events.ts` | `packages/schema/test/events.test.ts` | Every event validated by Zod at the boundary. |
| 3.2 | Envelope: session_id, monotonic seq, client_ts, event UUID | **done** | `packages/schema/src/events.ts` (`eventEnvelopeShape`) | `apps/study/test/telemetry-events.test.tsx` | |
| 3.3 | No PII; age as a band only | **done** | `packages/schema/src/primitives.ts` (`AgeBand`) | `packages/schema/test/events.test.ts` | Exact age is never collected. |
| 3.4 | Ingest service: one function, Zod-validated, idempotent on event UUID, no update/delete path | **partial** | `services/ingest/src/handler.ts`, `services/ingest/api/events.ts`, `services/ingest/sql/001_events.sql` | `services/ingest/test/handler.test.ts` | Written and tested against an in-memory store. **Never deployed** — see Question 1 below. |
| 3.5 | Insert-only enforced at the database | **partial** | `services/ingest/sql/001_events.sql` (revoke + two triggers) | not executed against a real database | The SQL is ready to apply; no database exists to apply it to. |
| 3.6 | Projections: trials / participants / questionnaire / transitions, pure functions of the log | **done** | `pipeline/replay.py` | `python pipeline/replay.py --check` (§11 of the output) | Byte-for-byte reproducible from 62,352 events. |

### §4–§6 Typing, statechart, offline capture

| # | Requirement | Status | Implemented in | Test that proves it | Comment |
|---|---|---|---|---|---|
| 4.1 | Zod as single source of truth; generated data dictionary | **done** | `packages/schema/src/`, `packages/schema/scripts/generate-data-dictionary.ts` | `pnpm codegen:check` (§4 of the output) | 240 documented fields; drift fails the build. |
| 5.1 | Session flow as an XState statechart | **done** | `packages/fsm/src/session.ts` | `apps/study/test/session.model.test.tsx` | 46 generated paths driven against the real DOM. |
| 5.2 | Model-based testing over generated paths | **done** | `apps/study/test/session.model.test.tsx` | itself | Uses `@xstate/graph`; the spec names `@xstate/test`, which is stale at 0.5.1. |
| 6.1 | IndexedDB write-ahead log, at-least-once delivery | **done** | `packages/telemetry/src/wal.ts`, `packages/telemetry/src/transport.ts` | `packages/telemetry/test/durability.test.ts` | 22 events survive an outage plus a discarded instance. |
| 6.2 | Resume after reload with no loss | **done** | `packages/telemetry/src/resume.ts` | `e2e/happy-path.spec.ts` ("a reload mid-session resumes") | |
| 6.3 | Ack only after the server has it | **done** | `packages/telemetry/src/transport.ts` | `packages/telemetry/test/durability.test.ts` | A record leaves the WAL only on 2xx. |

### §7 Simulation-based validation

| # | Requirement | Status | Implemented in | Test that proves it | Comment |
|---|---|---|---|---|---|
| 7.1 | Three bot policies (Central / Peripheral / Random) | **done** | `pipeline/simulate.py` (`POLICIES`) | §8–§10 of the test output | Planted parameters are the answer key. |
| 7.2 | Bots run through the real deployed app via Playwright | **partial** | `e2e/bots.spec.ts` | itself (§15 of the output) | Three browser sessions establish what the app emits; the 360 sessions used for statistics are generated directly. `pipeline/verify_bridge.py` proves the two logs have the same shape, which is what licenses the fast path. |
| 7.3 | Analysis recovers the planted effects | **done** | `pipeline/analysis.py --recover` | §10 of the output; 11 checks | Bonferroni-corrected containment so a correct pipeline does not go red on an unlucky seed. |

### §8 Analysis stack

| # | Requirement | Status | Implemented in | Test that proves it | Comment |
|---|---|---|---|---|---|
| 8.1a | H1 style × quality interaction, mixed ANOVA, partial η², 95% CI | **done** | `pipeline/analysis.py` | `pipeline/tests/test_design_contrast.py` | |
| 8.1b | H2 style main effect on the vigilance composite | **done** | `pipeline/analysis.py` (`vigilance`) | §10 of the output | Composite = z-scored challenge rate, verify rate, scroll depth. |
| 8.1c | H3 discrimination score, Welch t | **done** | `pipeline/analysis.py` | §10 of the output | |
| 8.1d | H4 scroll-depth mediation, bootstrapped, 5000 resamples | **done** | `pipeline/analysis.py` (`bootstrap_mediation`) | §10 of the output | Percentile bootstrap on a·b. |
| 8.1e | H5 trust, warm > neutral | **done** | `pipeline/analysis.py` | §10 of the output | |
| 8.1f | Holm–Bonferroni across secondaries | **done** | `pipeline/analysis.py` (`holm_bonferroni`) | §10 of the output | |
| 8.1g | Exclusions per funnel, analysed both ways | **partial** | `pipeline/analysis.py` (`Specification.exclude_suspicious`) | `pipeline/multiverse.py`, §12 of the output | Exists as a multiverse axis. The explicit exclusion criteria the roadmap asks for (duration floor, identical answers, repeat participation) are **not** implemented. |
| 8.2a | Bayes factor on H3, Cauchy prior r = 0.707 | **done** | `pipeline/analysis.py` (`bayes_factor_two_sample`) | §10 of the output | JZS via numerical integration over g; verified against published values. |
| 8.2b | Sequential stopping rule (first look N = 60, +20, BF > 6 or < 1/6, cap 160) | **missing** | described in `pipeline/report.py` prose only | none | **No code computes "continue / can stop".** The rule is printed as text in the results document but never evaluated. |
| 8.3 | Multiverse, 48 specifications, specification curve | **done** | `pipeline/multiverse.py` | §12 of the output; `data/multiverse/specification_curve.png` | 2 clamps × 3 thresholds × 2 × 2 × 2. |
| 8.4 | Process dynamics (exploratory): trajectories, RT model | **missing** | `ESTIMATE_CHANGED` captures every intermediate value, so the data exist | `apps/study/test/telemetry-events.test.tsx` proves the events are recorded | The capture-time half is done, which §0 says is the half that cannot be added later. No analysis is written. |

### §2 Architecture / repository

| # | Requirement | Status | Implemented in | Test that proves it | Comment |
|---|---|---|---|---|---|
| 2.1 | pnpm monorepo, TypeScript strict everywhere | **done** | `pnpm-workspace.yaml`, `tsconfig.base.json` | `pnpm typecheck` (§1 of the output) | `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` both on. |
| 2.2 | Architecture Decision Records | **done** | `docs/adr/ADR-001…004` | reviewed in this audit | Event sourcing, frozen stimuli, statechart, WAL. |
| 2.3 | `apps/dashboard` — read-only recruitment monitor (Tier 3) | **missing** | — | — | Directory does not exist. Tier 3 in the spec, so not a v3 commitment; the roadmap needs it from Day 7. |
| 2.4 | CI gate | **done** | `.github/workflows/ci.yml` (22 steps) | the workflow itself | Includes recovery, bridge, reproducibility and the results document. |
| 2.5 | Reproducible environment / `make paper` | **done** | `Dockerfile`, `Makefile`, `pipeline/report.py` | `make paper` produces `paper/results.pdf` | PDF prints through Playwright's Chromium rather than a LaTeX toolchain. |

---

## Known issues

Each entry states what was claimed, what is actually true, and where it stands.

### 1. Item bank "8 strong / 4 weak"

**Claim:** the bank is unbalanced, 8 strong against 4 weak.

**Actually:** both descriptions are true of different things, and conflating them caused a
real bug. `STUDY3_SPEC_v2.md` §2 allocates **8 analysed items** — 2 per cell across
error × quality, so 4 strong and 4 weak — **plus 4 correct filler items carrying strong
justifications**. The fillers exist so planted errors are 33% of twelve rather than 50%
of eight, i.e. so the error rate does not itself arouse suspicion.

The "8 strong / 4 weak" figure came from `pipeline/analysis.py`, which averaged **every**
trial into the quality contrast and so counted fillers as strong. That also made the
strong side 75% accurate against the weak side's 50%, which reintroduces a base-rate
confound the design specifically avoids: a participant who discounts a weak justification
on normative grounds becomes indistinguishable from one processing peripherally, and that
distinction is exactly what H3 claims to measure.

**Status: fixed.** `pipeline/replay.py` now carries `role`/`design_cell`/`topic`; the
contrast is restricted to analysed items; a missing `role` column raises rather than
silently falling back. Guarded by `packages/schema/test/design-constraints.test.ts` and
`pipeline/tests/test_design_contrast.py`, both mutation-tested.

**Cost, stated plainly:** the correct contrast uses 4 trials per cell instead of 8 against
4, so Var(D) rises from 0.375σ² to 0.500σ² and the same power needs about **33% more
participants** (`pipeline/power.py`). The previous precision was bought with contaminated
trials.

**[v2-pending]** the roadmap moves two items strong→weak for a 6/6 split. Against the
*analysed* set that is a different change from the one described, and it interacts with
the filler count — worth re-deriving when v2 is written.

### 2. Stimulus generation: idempotency and provider abstraction

**Claim:** generation has neither.

**Status: fixed.** `pipeline/cell_cache.py` writes each cell to disk the moment it
arrives, atomically, keyed by provider **and** model. `pipeline/providers.py` puts
`LiveProvider`, `OfflineProvider` and `ManualProvider` behind one interface; hand-authored
cells are a first-class source. Proved by
`pipeline/tests/test_generation_durability.py` (8 tests, mutation-tested).

**What remains:** the committed stimuli are still offline placeholders
(`launch_ready: false`). A full run is ~455,000 tokens against a 200,000/day free-tier
budget — `pnpm stimuli:estimate` prints this before spending anything.

### 3. Consent flow "linear instead of branching"

**Claim:** the consent flow is linear.

**Actually: this is not accurate, and was not accurate before either.** The statechart has
always branched on age group (`packages/fsm/src/session.ts`, guard `isMinor`), and the
adult and minor arms lead to different screens and different events.

The real defect was narrower and worse: **no test had ever walked the minor arm to
completion.** The existing test stopped at the allocating screen, so half the consent
design had never been finished in a browser. Separately, `CONSENT_GIVEN` recorded
`flow: "adult"` as a literal, describing which screen fired rather than which participant
consented — a minor would have been filed as an adult.

**Status: fixed.** `e2e/minor-flow.spec.ts` walks both arms end to end; the flow is read
from `context.ageGroup` and throws rather than defaulting.

**[v2-pending]** the roadmap removes the minor arm entirely (18+ only).

### 4. Allocation: slot exhaustion, attrition, sequence pre-commitment

Three separate items with three different statuses.

| Item | Status | Detail |
|---|---|---|
| Sequence pre-commitment | **done** | `pipeline/allocation.py` generates 384 assignments from seed 20260817, block-balanced, written to `materials/allocation.json` with `sequence_sha256`. `--check` fails if the file no longer matches the seed, and that gate runs in CI. Verified by `apps/study/test/allocation.test.ts`, including a uniformity test on the index hash — a modulus bug that skipped half the sequence would still look random in the log. |
| Slot exhaustion | **missing** | Nothing defines what happens to participant 385. `allocate()` computes `hash mod length`, so the sequence silently wraps: two participants would draw the same slot with no record that it happened. No test covers it. |
| Attrition / slot release | **missing** | A slot is consumed at assignment. A participant who leaves before their first judgement consumes it anyway, and nothing returns it. Across three language groups this will bend the block balance. No policy, no event type, no test. |

These two gaps are the next scheduled work.

### 5. Additional gaps found during this audit

| Gap | Where | Why it matters |
|---|---|---|
| Perceived-warmth manipulation check is collected but never tested | `pipeline/analysis.py` | §1 requires the check. The scale is scored into `warmth_perceived` and then unused. If the manipulation failed, nothing in the pipeline would say so. |
| Perceived-competence control check absent entirely | `pipeline/analysis.py` (0 mentions of competence) | §1 requires competence to **not** differ. Without it, a style manipulation that also moved perceived competence would pass unnoticed — and that is a confound, not a side effect. |
| Sequential stopping rule not implemented | `pipeline/report.py` prints the rule as prose | The rule is what makes the deadline feasible. As it stands, a human would have to compute it by hand, which is precisely how unplanned peeking happens. |
| Explicit participant-exclusion criteria not implemented | `pipeline/analysis.py` | Only funnel-belief and resumed-session exclusions exist, as multiverse axes. Duration floors, identical-answer detection and repeat participation are not implemented. |
| No recruitment dashboard | `apps/` contains only `study` | Tier 3 in the spec, but the roadmap needs a blind monitor from Day 7. |
| No server-side collection deployed | see Question 1 | The largest single risk to the collection window. |

---

## Direct answers to the three questions

### 1. Is there working server-side collection, or does the log live only in the participant's browser?

**Today the log lives only in the participant's browser.**

What exists: `services/ingest/src/handler.ts` validates a batch against the shared Zod
schema and inserts rows, idempotent on `event_id`; `services/ingest/api/events.ts` is the
HTTP entry point; `services/ingest/sql/001_events.sql` creates an insert-only table with
`UPDATE`/`DELETE` revoked and two triggers that raise. `services/ingest/test/handler.test.ts`
proves the handler behaves against an in-memory store with the same primary-key semantics.

What does not exist: **any deployed instance.** There is no Supabase project, no
`vercel.json` or `netlify.toml`, no `.env.example`, and no deployment step in CI. The app
posts to `VITE_INGEST_ENDPOINT ?? "/api/events"`; with nothing serving that path every
POST fails, the write-ahead log keeps the events, and they stay in that browser's
IndexedDB forever.

The practical consequence: **if a participant ran the study today, the data would exist
only on their own device and you would have no way to retrieve it.** The offline-first
design means nothing is lost from the participant's side — but nothing arrives on yours
either. This has to be closed before any pilot, and it is the single largest risk to the
collection window.

### 2. Where are the strata defined, and can their number be changed without editing code?

**No. Changing the number of strata currently requires editing code in three places.**

| Where | What it holds |
|---|---|
| `packages/schema/src/primitives.ts:62` | `Stratum` Zod enum — six string literals, hard-coded |
| `packages/fsm/src/session.ts:114` | `stratumFor(language, ageGroup)` — builds `"{language}:{ageGroup}"` |
| `pipeline/allocation.py:53-54` | `LANGUAGES = ("kk","ru","en")`, `AGE_GROUPS = ("minor","adult")` — the cross product that generates the sequence |

`materials/allocation.json` *is* generated data, but it is generated from those constants
rather than from a configuration file. Adding or renaming a stratum means editing the Zod
enum (or every consumer fails validation), editing the generator constants, regenerating
the sequence, and rebuilding the manifest.

This matters directly for the planned redesign: moving to two CEFR strata is a code change
under the current structure, not a config change. The roadmap's Day 3 item 4 asks for
exactly this to become config-driven, and that is a genuine gap rather than an oversight.

### 3. What target n is in the power analysis and the stopping rule, and what does it depend on?

**Three different numbers exist, and they do not currently agree.**

| Source | Number | Nature |
|---|---|---|
| `STUDY3_SPEC_v3.md` §1 | **N = 120** (60 per style condition) | The pre-registered target, stated in prose |
| `STUDY3_SPEC_v3.md` §8.2 | first look at N = 60, then every +20; stop at BF₁₀ > 6 or < 1/6; **hard cap N = 160** | The stopping rule, stated in prose |
| `pipeline/power.py` | **126** (63 per arm) for d = 0.5 at 80% power, α = .05 | Computed, and the only one derived from anything |
| `materials/allocation.json` | 384 slots (64 per stratum × 6) | Capacity, deliberately generous |

**The stopping rule is not implemented.** It appears as descriptive text in
`pipeline/report.py`; no function evaluates "continue / can stop". The Bayes factor it
needs *is* computed (`bayes_factor_two_sample`), so the missing piece is the decision, not
the statistic.

**What the 126 depends on — every assumption is currently unverified:**

1. **An assumed effect size of d = 0.5.** There are no pilot data, so this is a
   convention, not an estimate. It is the single biggest lever: at d = 0.4 the requirement
   is ~200 per arm; at d = 0.6 it is ~88.
2. **The per-cell trial count.** With 4 analysed trials per quality level,
   Var(D) = 0.5σ². This is what the filler fix changed, and it raised the requirement by
   about a third.
3. **A two-sample t-test on the difference score**, normal approximation, two-tailed
   α = .05, 80% power. No covariate is modelled, so a covariate that explains variance
   would reduce the requirement below this figure.
4. **Complete data per participant.** Attrition and the denominator-threshold exclusion
   both remove trials, and neither is in the calculation.

This is recorded as a limitation in `materials/items.json` `review_required`: every power
figure rests on an assumed effect rather than an observed SD of the discrimination score
in this population. **Re-estimate SD(D) from the pilot before fixing N.**
