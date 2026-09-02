# Study 3 — Specification v3

**Emotional Warmth as a Peripheral Cue: Processing-Route Displacement in Human–AI Epistemic Interaction**

Supersedes v2. The science is unchanged from v2 (ELM interaction design, five-component EI architecture, deterministic register FSM, verified item bank). v3 adds: a production-grade event-sourced architecture, model-based testing, offline-resilient capture, simulation-based pipeline validation, Bayesian sequential design, and multiverse analysis. It also adds a tiered build plan so ambition cannot kill the project.

**Rule that governs everything in this document:** *anything that must be captured at collection time outranks anything that can be computed later.* You can add a fancier analysis in month two. You cannot retroactively capture a scroll event from a participant who left in week three. Build capture first, analysis second.

---

## 0. Two audiences, two scorecards

| Audience | What they reward | What they ignore |
|---|---|---|
| JEI reviewers | Pre-registration, manipulation checks, honest power, clean causal logic | Your repo structure |
| CS admissions | Architecture you can *defend in conversation*, testing discipline, reproducibility engineering | p-values |

Every component below is tagged with who it serves. If you cannot explain a component in two sentences to an interviewer, do not build it — copied sophistication reads worse than absent sophistication.

---

## 1. Science core (frozen from v2 — do not touch)

- **Design:** mixed 2 (emotional style: warm/neutral, between) × 2 (justification quality: strong/weak, within)
- **Primary hypothesis:** style × quality interaction on Weight of Advice — warmth flattens sensitivity to argument quality (peripheral-route displacement, Petty & Cacioppo ELM)
- **EI manipulation:** five named components — Mayer–Salovey branches 1–4 plus linguistic convergence (Communication Accommodation Theory) — each double-coded by two raters, Cohen's κ ≥ 0.60 per component or the stimulus is regenerated
- **Register FSM:** participant's initial confidence selects among three pre-generated response registers (LOW < 40, MODERATE 40–70, HIGH > 70); warm condition branches, neutral does not (adaptivity is constitutive of the EI construct)
- **Stimuli:** 12 items × 3 languages × (3 warm states + 1 neutral) = 144 responses + 432 follow-up branches, pre-generated, hand-verified, frozen
- **Checks:** perceived-warmth manipulation check per language; perceived-competence control check (must NOT differ); funneled suspicion probe; full debrief with corrections and sources
- **Consent:** dual flow (parental consent + assent for minors; standard consent for adults); telemetry named explicitly
- **N:** 120 target, stratified by language × age group, seeded block randomization

### Verified item bank (carry over verbatim from v2)

| # | Question | True value | Source | AI advice | Error? | Just. |
|---|---|---|---|---|---|---|
| 1 | Maximum depth of the Challenger Deep (m) | 10,935 (±6, 95% CI) | Greenaway et al. 2021, *Deep-Sea Res. I* | 10,935 | — | Strong |
| 2 | % of ocean floor mapped to modern standards | 28.7% (Apr 2026 — **re-verify at launch**) | Seabed 2030 / GEBCO | 28.7% | — | Weak |
| 3 | Longest recorded sperm whale dive (min) | ~90 (117 recorded, 1969) | Natural History Museum, London | **35** | **YES** | Weak |
| 4 | Depth at which sunlight becomes undetectable (m) | ~1,000 | NOAA Ocean Exploration | 1,000 | — | Strong |
| 5 | Max black smoker vent fluid temp (°C) | ~400 (EPR endmember ~390±5) | NHM; PNAS 2025 | **150** | **YES** | Strong |
| 6 | Max recorded total length, giant squid (m) | ~13 | Smithsonian Ocean | 13 | — | Strong |
| 7 | Deepest confirmed sperm whale dive (m) | ~2,250 | NOAA Fisheries | 2,250 | — | Weak |
| 8 | Described deep-sea anglerfish species | ~170 | Pietsch, *Oceanic Anglerfishes* | 170 | — | Strong |
| 9 | Max lifespan, *Lamellibrachia luymesi* (yr) | ~250 | Cordes et al. 2005, *PLoS Biology* | **40** | **YES** | Weak |
| 10 | Photic zone lower boundary (m) | ~200 | NOAA | 200 | — | Strong |
| 11 | Deepest confirmed fish observation (m) | ~8,336 (snailfish, 2022) — **verify yourself, unconfirmed by me** | UWA / Univ. of Tokyo | **3,900** | **YES** | Strong |
| 12 | Ambient temperature at 4,000 m (°C) | ~2 | NOAA | 2 | — | Strong |

---

## 2. Architecture overview *(CS audience)*

Monorepo, pnpm workspaces, TypeScript strict everywhere.

```
eiai-study3/
├── apps/
│   ├── study/                  # participant-facing React + Vite SPA
│   └── dashboard/              # (Tier 3) recruitment monitor, read-only
├── services/
│   └── ingest/                 # single serverless function: append events
├── packages/
│   ├── schema/                 # Zod schemas = single source of truth
│   ├── fsm/                    # session statechart + register function
│   ├── telemetry/              # event capture, buffering, WAL, sync
│   └── stimuli/                # frozen responses + loader + hash check
├── pipeline/
│   ├── generate.py             # stimulus generation (one-time)
│   ├── verify_equivalence.py   # numeric + hedge parity across conditions
│   ├── hash_manifest.py        # SHA-256 manifest, committed pre-launch
│   ├── replay.py               # event log → tidy analytic tables
│   ├── analysis.py             # confirmatory: ANOVA, contrasts, BF
│   ├── multiverse.py           # specification-curve analysis
│   ├── simulate.py             # bot policies + parameter recovery
│   └── figures.py
├── e2e/                        # Playwright: human flows + simulation bots
├── .github/workflows/ci.yml    # typecheck → unit → property → e2e → repro gate
├── Dockerfile                  # pinned analysis environment
├── Makefile                    # `make paper` regenerates every number
└── docs/
    ├── STUDY3_SPEC_v3.md
    ├── preregistration.md
    ├── DATA_DICTIONARY.md      # auto-generated from packages/schema
    └── adr/                    # architecture decision records, 1 page each
```

### Architecture Decision Records

Every non-obvious choice gets a one-page ADR: context, decision, alternatives rejected, consequences. Write them as you go (ADR-001 event sourcing, ADR-002 frozen stimuli vs. live API, ADR-003 statechart session flow, ADR-004 offline WAL). This is professional practice, it is cheap, and it is *exactly* the artifact that lets you answer "why did you build it this way?" in an interview with receipts.

---

## 3. Event-sourced data model *(both audiences — the centerpiece)*

### The decision

Do not store "one row per participant-item." Store an **append-only event log** — every meaningful thing that happens in a session, in order, immutably. All analytic tables are **projections** computed by replaying the log.

### Why this is scientifically superior, not just fashionable

1. **You can derive measures you didn't think of yet.** Mid-analysis you realize revision-velocity matters? It's already in the log. A row-per-item schema would have discarded it forever.
2. **Auditability.** Any number in the paper traces back through `replay.py` to raw immutable events. Nothing is hand-edited.
3. **Telemetry becomes natural.** Scrolls, blurs, and estimate changes are just events like any other, not bolted-on extra columns.
4. **Crash resilience.** A participant whose browser dies at item 9 still contributes items 1–8 — the events already shipped.

### Event taxonomy

| Event | Payload | Emitted when |
|---|---|---|
| `SESSION_STARTED` | app version, stimuli manifest hash, locale, viewport | first load |
| `CONSENT_GIVEN` / `ASSENT_GIVEN` | flow type, timestamp | consent screens |
| `ALLOCATED` | condition, stratum, allocation seq no. | after eligibility |
| `ITEM_PRESENTED` | item_id, position | item screen mount |
| `ESTIMATE_CHANGED` | item_id, value, ms since present | every slider/keystroke change |
| `CONFIDENCE_SET` | item_id, value, phase (initial/final) | confidence input |
| `RESPONSE_REVEALED` | item_id, register state, response_id | AI reply shown |
| `RESPONSE_SCROLLED` | item_id, max scroll fraction | scroll within reply |
| `FOLLOWUP_SELECTED` | item_id, followup_id | follow-up tap |
| `VERIFY_CLICKED` | item_id | "check this claim" |
| `WINDOW_BLURRED` / `WINDOW_FOCUSED` | ms timestamps | tab switch |
| `ESTIMATE_FINALIZED` | item_id, value, revision count | submit |
| `QUESTIONNAIRE_ANSWERED` | scale, item, value | each questionnaire item |
| `FUNNEL_RESPONSE` | stage, free text | suspicion probe |
| `SESSION_COMPLETED` / `SESSION_WITHDRAWN` | reason if withdrawn | end states |

Every event carries `session_id` (UUID), monotonically increasing `seq`, client timestamp, and event UUID (idempotency key). No names, no emails, no PII anywhere in the log. Age is recorded as a **band** at source (14–15, 16–17, 18–24, 25+), never as an exact number — you cannot leak what you never collected.

### Ingest service

One serverless function. Accepts a batch of events, validates against the shared Zod schema, rejects anything malformed, appends to a single `events` table (Supabase/Postgres, `jsonb` payload). Idempotent on event UUID, so retries are safe. The function has no update or delete path — the table is insert-only at the API level. That single sentence is worth saying in the paper's transparency section.

### Projections

`pipeline/replay.py` reads the log and emits tidy tables: `trials.csv` (one row per participant-item with WOA, RTs, scroll depth, revision count), `participants.csv`, `questionnaire.csv`, `transitions.csv` (FSM trace). Projections are pure functions of the log — delete the CSVs, rerun, get byte-identical output.

---

## 4. Typed end-to-end with generated documentation *(CS audience)*

`packages/schema` defines every event, questionnaire item, and stimulus record as a Zod schema. From this single source:

- The client gets compile-time types (`z.infer`)
- The ingest service gets runtime validation
- A codegen step emits `docs/DATA_DICTIONARY.md` — the data dictionary that goes in the paper's appendix, generated from code so it *cannot* drift from what was actually collected

One definition, three consumers. That is the whole argument for the pattern, and you should be able to say it exactly that fast.

---

## 5. Session flow as a statechart, with model-based testing *(CS audience)*

The session flow (eligibility → consent/assent fork → allocation → 12 items → questionnaire → funnel → debrief → done, with withdrawal reachable from everywhere) is an XState statechart.

The register selection, by contrast, stays a **pure function** `register(confidence: number) → LOW | MODERATE | HIGH`. Do not model it in XState. Knowing which tool *not* to use is the judgment interviewers probe for: statecharts earn their complexity on flows with history and guards; a total function over [0,100] needs four lines and a property test.

### Testing discipline

- **Property-based tests (fast-check)** on the pure core: `register` is total over [0,100]; WOA is invariant under affine rescaling of units; clamping never produces NaN; projection of a shuffled-then-sorted log equals projection of the ordered log.
- **Model-based tests (@xstate/test)** on the statechart: the test generator walks every reachable path through the session machine — including withdrawal from every screen and the minor/adult consent fork — and asserts UI invariants at each state. You get path coverage you could never hand-write.
- **Golden-file test** on stimuli: recompute SHA-256 of every frozen response file and diff against the committed manifest. CI fails if a single byte of stimulus changed after pre-registration.

A study about a state machine, whose state machine is itself verified by model-based test generation, is a genuinely elegant thing to put in front of a CS reader.

---

## 6. Offline-first capture *(both audiences)*

School wifi will drop mid-session. Plan for it.

- Events are written first to a **write-ahead log in IndexedDB**, then flushed to the ingest service in batches with exponential backoff.
- Unflushed events survive reload; a resume token (session UUID in localStorage) lets a participant continue after a crash at the exact item where they stopped.
- `SESSION_STARTED` on resume carries a `resumed: true` flag so you can analyze (and if pre-registered, exclude) interrupted sessions transparently.

This is the difference between losing 8% of your sample to connectivity and losing none, and it is a concrete distributed-systems story you can tell: client-side durability, idempotent delivery, at-least-once semantics reconciled by event UUID.

---

## 7. Simulation-based pipeline validation *(both audiences — do not skip this)*

Before any human sees the study, run **synthetic participants** through the *real deployed app* via Playwright bots, then check that the analysis pipeline recovers what you planted.

### Bot policies

| Bot | Behaviour | What it plants |
|---|---|---|
| `SimCentral` | Reads justifications (long dwell, full scroll), adjusts toward advice ∝ justification quality | Positive discrimination score |
| `SimPeripheral` | Skims (short dwell, partial scroll), adjusts toward advice uniformly, more in warm condition | Flat discrimination, style main effect |
| `SimRandom` | Noise | Null everything |

Run 60 of each through both conditions. Then `pipeline/analysis.py` must recover: SimCentral > SimPeripheral discrimination, the planted style effect, and null for SimRandom — with the planted effect sizes inside the recovered CIs.

If recovery fails, your pipeline has a bug that would have silently poisoned two months of real data. Finding it on bots costs one evening. This technique (parameter recovery / simulation-based calibration) is standard in serious computational labs and almost unheard of at school level; it is simultaneously your end-to-end test suite, your load test, and your power analysis by simulation.

---

## 8. Analysis stack *(science audience, with two CS-flavored upgrades)*

### 8.1 Confirmatory (pre-registered, unchanged in spirit from v2)

- H1: style × justification-quality interaction on WOA, mixed ANOVA, partial η², 95% CI
- H2: style main effect on the vigilance composite
- H3: discrimination score (WOA_strong − WOA_weak per participant), warm < neutral, Welch t
- H4: scroll-depth mediation of H1, bootstrapped indirect effect, 5,000 resamples
- H5: trust, warm > neutral
- Holm–Bonferroni across secondaries; exclusions per funnel, analyzed both ways

### 8.2 Bayesian sequential design *(new — and it actively helps your deadline)*

Alongside the frequentist tests, compute a **Bayes factor** on H3 (the discrimination contrast — which *is* the interaction expressed as one number), default Cauchy prior r = 0.707.

Pre-register a **sequential stopping rule**: first look at N = 60, then every +20 participants; stop when BF₁₀ > 6 (evidence for) or < 1/6 (evidence against), hard cap N = 160. Sequential Bayes factors, unlike sequential p-values, do not inflate error rates when the looks are pre-registered — cite Schönbrodt & Wagenmakers' Bayes Factor Design Analysis.

Practical consequence: if the effect is real and medium-sized, you may legitimately stop at 80 participants instead of grinding to 120 on a two-month clock. Rigor that buys you time.

### 8.3 Multiverse / specification-curve analysis *(new — cheap, honest, senior)*

Your pipeline contains arbitrary choices: WOA clamp range {[0,1] vs [−0.5,1.5]}, denominator threshold {1%, 5%, 10%}, suspicious-participant handling {include, exclude}, RT outlier rule {none, 3-MAD trim}. That is up to 48 defensible specifications.

`pipeline/multiverse.py` runs **all of them** and plots the specification curve: effect estimate ± CI for every specification, sorted. If the interaction survives across the curve, no reviewer can suggest you fished for the one specification that worked. It is a for-loop wearing a very good suit, and it signals methodological seniority far beyond its implementation cost.

### 8.4 Process dynamics *(exploratory — clearly labeled as such)*

- **Estimate-trajectory analysis:** you already log every intermediate slider value. Compute per-trial attraction dynamics toward the advice value — dwell time near the advice, overshoot, velocity of revision. This is 1-D process tracing in the mouse-tracking tradition (Freeman) using data the event log captures for free.
- **RT modeling:** confirmatory RT claim = log-RT linear mixed model. As exploratory garnish only, condition-level EZ-diffusion estimates (drift rate, boundary separation) with bootstrap CIs — the prediction being that warmth lowers boundary separation (less caution). With 12 trials per person you cannot fit per-participant diffusion models; say so plainly rather than pretending otherwise. An honest sentence about a method's limits impresses more than an overfit model.

---

## 9. Things that look advanced and would actually hurt you *(read before adding anything)*

- **Live LLM chat instead of frozen stimuli.** Destroys experimental control, unreproducible, API key exposure. The FSM already gives you adaptivity with determinism — that trade-off is ADR-002 and a talking point, not a weakness.
- **A third experimental arm.** N=120 across three arms guts your power. The 2×2 with a within factor is the efficient design; adding arms is how studies become uninterpretable.
- **Item Response Theory on 12 items.** Misapplied sophistication; a reviewer who knows IRT will wince.
- **Differential privacy on N=120.** The noise would swamp your effect. For the public dataset, do a **k-anonymity check** instead: if any released stratum cell contains fewer than 5 people, coarsen the stratum labels before release. Right-sized privacy engineering is more impressive than buzzword privacy engineering.

---

## 10. Tiered build plan with cut lines

**Tier 0 — the study cannot run without this:** schema package, statechart flow, register function, frozen stimuli + manifest, consent flows, item screens, event capture for the core measures (estimates, confidence, reveals, follow-ups, verify clicks), ingest service, replay projections, confirmatory analysis, pre-registration.

**Tier 1 — capture-time features (cannot be added later):** full telemetry (scroll, blur, estimate trajectory), offline WAL + resume, idempotent batching. *Rank above Tier 2 because of the governing rule in §0 — collection-time capture outranks computable-later analysis.*

**Tier 2 — computable-later science:** Bayesian sequential monitoring, multiverse, simulation validation (build the bots before launch though — §7 protects data quality), trajectory dynamics.

**Tier 3 — stretch:** dashboard app, EZ-diffusion exploratory, ADR polish, demo GIF for the repo README.

**Cut order under time pressure: 3 → 2 (keep multiverse — it's an afternoon) → never 0 or 1.** And from v2, the standing scope valves remain: 12→8 items, 3→2 languages, 3→2 registers, in that order.

### Seven-day schedule

| Day | Deliverable | Done means |
|---|---|---|
| 1 | Monorepo scaffold, `packages/schema`, verified `items.json`, justification pairs | `pnpm typecheck` green; data dictionary generates |
| 2 | Register function + property tests; `generate.py` → 144 stimuli; equivalence checks; hash manifest | Golden-file test green; κ-coding sheets exported |
| 3 | Statechart + model-based tests; consent flows; item screen (slider, confidence) | Every statechart path passes; full session clickable |
| 4 | Telemetry package; IndexedDB WAL; ingest service; Supabase table | Kill wifi mid-session → zero event loss on resume |
| 5 | Follow-ups, verify button, questionnaire, funnel, debrief; i18n scaffold (EN first) | Playwright happy-path E2E green |
| 6 | Simulation bots + parameter recovery | Planted effects recovered within CI; fix whatever this exposes (it will expose something) |
| 7 | `replay.py`, `analysis.py`, multiverse skeleton, Docker, CI repro gate, `make paper` | Clean clone → `make paper` → full results PDF from bot data |

Translations, κ coding with your second rater, pilots, and pre-registration are human work in the following weeks — the app is deliberately finished *before* them so pilots test the real system.

---

## 11. The interview-defense table

For every component you keep, you own its two-sentence defense. If a line here doesn't feel like yours after building it, cut the component.

| Component | Your two sentences |
|---|---|
| Event sourcing | "Storing immutable events instead of computed rows means every measure is a replayable pure function of the raw log — I can derive new measures after collection and audit any number in the paper back to source. It also made crash-resilient capture natural: a dropped session still contributes everything up to the drop." |
| Frozen-stimulus FSM | "Emotional responsiveness is constitutive of the construct, but live generation destroys experimental control — so the participant's confidence selects among pre-generated, hash-manifested variants. Adaptive behaviour, deterministic content." |
| Model-based statechart tests | "Instead of hand-writing UI tests, the test generator walks every reachable path of the session statechart and asserts invariants per state — including withdrawal from every screen, which hand-written suites always miss." |
| Simulation validation | "Before any human participated, scripted agents with known behavioural policies ran through the deployed app, and the analysis had to recover the planted effect sizes. It's an end-to-end test of the entire design-to-inference chain." |
| Sequential Bayes | "Pre-registered Bayes-factor stopping rules let evidence, not a fixed N, end collection — which is both statistically principled and what made my deadline feasible." |
| Multiverse | "Rather than defending one analytic specification, I ran all 48 defensible ones and showed the effect survives the whole curve." |

---

## 12. First Claude Code prompt for v3

> Read docs/STUDY3_SPEC_v3.md fully. Execute Day 1 only: scaffold the pnpm monorepo per §2, implement `packages/schema` with Zod schemas for every event in §3's taxonomy plus stimulus and questionnaire records, add the codegen script that emits docs/DATA_DICTIONARY.md from the schemas, and create `materials/items.json` from the §1 table including word-count-matched strong/weak justification pairs. Set up vitest and a CI workflow running typecheck + unit tests. Do not build any UI yet. Stop and show me the data dictionary when done.
