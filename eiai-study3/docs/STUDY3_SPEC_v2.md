# Study 3 — Specification v2

**Emotional Warmth as a Peripheral Cue: An Experimental Test of Processing-Route Displacement in Human–AI Epistemic Interaction**

Supersedes v1. Changes: theoretical grounding in the Elaboration Likelihood Model, mixed 2×2 design, five-component psychological architecture for the EI manipulation, deterministic emotional state machine, verified item bank, process telemetry, reproducibility layer.

---

## 1. What changed and why

v1 tested **whether** emotional warmth reduces epistemic vigilance. That is a descriptive finding. A reviewer's first question will be *"through what mechanism?"* — and *"people trusted the nice one more"* is not a mechanism, it is a restatement.

v2 tests **why**, using an established dual-process account.

### Theoretical frame — Elaboration Likelihood Model (Petty & Cacioppo, 1986)

The ELM distinguishes two routes to persuasion:

- **Central route** — effortful scrutiny of argument quality. Attitude change tracks how good the reasoning actually is.
- **Peripheral route** — reliance on cues external to the argument: source likeability, attractiveness, confidence, warmth. Attitude change tracks the cue, not the reasoning.

**Core claim of this study:** emotional warmth in an AI system functions as a peripheral cue, displacing central-route processing of the AI's factual claims. The observable signature of this displacement is *insensitivity to argument quality*.

This is directly testable, and the test is the classic ELM design: **manipulate argument quality and look for the interaction.**

### The prediction that carries the paper

| | Weak justification | Strong justification |
|---|---|---|
| **Neutral AI** | Low advice-taking | High advice-taking |
| **Warm AI** | High advice-taking | High advice-taking |

Participants in the **neutral** condition should *discriminate* — accepting well-justified claims and resisting poorly-justified ones. Participants in the **warm** condition should show *flattened* discrimination, because they are processing the source rather than the argument.

The **style × justification-quality interaction** is the primary hypothesis. Not the main effect.

This connects directly to the "premature epistemic closure" construct from your expert interviews: closure is what it looks like from the outside when central-route processing stops early.

---

## 2. Design

Mixed 2 × 2 factorial.

| Factor | Levels | Type |
|---|---|---|
| Emotional style | Warm (EI) / Neutral | **Between**-subjects |
| Justification quality | Strong / Weak | **Within**-subjects |

Making justification quality within-subjects is a deliberate power decision. A fully between-subjects 2×2 at N=120 gives 30 per cell, which is badly underpowered for an interaction. With justification quality varied within participants, each person serves as their own control and the interaction test becomes tractable at your achievable sample size.

| | |
|---|---|
| Items | 12 numeric estimation items, deep-sea marine biology |
| Planted errors | 4 of 12 (33% — high enough to matter, low enough to avoid arousing suspicion) |
| Session length | ~20 minutes |
| Languages | Kazakh, Russian, English |
| Target N | 120 (60 per style condition) |

### Item allocation

| Cell | n items | Item IDs |
|---|---|---|
| Error × Weak justification | 2 | 3, 9 |
| Error × Strong justification | 2 | 5, 11 |
| Correct × Weak justification | 2 | 2, 7 |
| Correct × Strong justification | 2 | 4, 10 |
| Correct filler (strong) | 4 | 1, 6, 8, 12 |

Two items per critical cell is thin for internal reliability. Report Cronbach's α across the cell items and state this as a limitation. Do not silently pretend it is not thin.

---

## 3. Verified item bank

Every value below was checked against a citable source. **Re-verify the volatile ones immediately before launch** — item 2 in particular moves annually.

| # | Question | True value | Source | AI advice | Error? | Just. |
|---|---|---|---|---|---|---|
| 1 | Maximum depth of the Challenger Deep (m) | 10,935 (±6, 95% CI) | Greenaway et al. 2021, *Deep Sea Res. I* | 10,935 | — | Strong |
| 2 | % of ocean floor mapped to modern standards | 28.7% (Apr 2026) | Seabed 2030 / Nippon Foundation–GEBCO | 28.7% | — | Weak |
| 3 | Longest recorded sperm whale dive (min) | ~90 (117 min recorded 1969) | Natural History Museum, London | **35** | **YES** | Weak |
| 4 | Depth at which sunlight becomes undetectable (m) | ~1,000 | NOAA Ocean Exploration | 1,000 | — | Strong |
| 5 | Max black smoker vent fluid temperature (°C) | ~400 (EPR endmember ~390±5) | Natural History Museum; PNAS 2025 | **150** | **YES** | Strong |
| 6 | Max recorded total length, giant squid (m) | ~13 | Smithsonian Ocean | 13 | — | Strong |
| 7 | Deepest confirmed sperm whale dive depth (m) | ~2,250 | NOAA Fisheries | 2,250 | — | Weak |
| 8 | Number of described deep-sea anglerfish species | ~170 | Pietsch, *Oceanic Anglerfishes* | 170 | — | Strong |
| 9 | Max lifespan, *Lamellibrachia luymesi* (yr) | ~250 | Cordes et al. 2005, *PLoS Biology* | **40** | **YES** | Weak |
| 10 | Depth of the photic zone lower boundary (m) | ~200 | NOAA | 200 | — | Strong |
| 11 | Deepest confirmed fish observation (m) | ~8,336 (snailfish, 2022) | Univ. of Western Australia / Tokyo | **3,900** | **YES** | Strong |
| 12 | Ambient deep-ocean temperature at 4,000 m (°C) | ~2 | NOAA | 2 | — | Strong |

**Verify item 11 yourself** — I have not independently confirmed the snailfish depth record and you should not take it from me on trust. That instruction is not decorative: a study about epistemic vigilance whose own item bank was accepted uncritically from an AI would be a genuinely embarrassing thing for a reviewer to notice.

### Error calibration

Each planted error is a **large downward** deviation. Downward-only errors are deliberate: mixing direction would confound error detection with anchoring direction. Note this as a design constraint and a limitation — you are testing detection of *understatement*, not of error in general.

### Justification-quality manipulation

Attached to every AI response. Matched for word count. Contains **no additional factual content** — only reasoning quality varies.

**Strong** (method-referencing, verifiable):
> This figure comes from pressure-referenced altimeter transects taken by crewed submersible, cross-checked against independent ship-based sonar mapping of the same site.

**Weak** (circular, appeal to consensus):
> This figure is widely cited and is the number generally given when this question comes up, so it is the standard accepted answer.

Both are ~30 words. Both sound fluent. Only one actually supports the claim. That asymmetry is the entire within-subjects manipulation.

---

## 4. Psychological architecture of the EI manipulation

"Be warm" is not a construct. The EI condition is built from **five named components**, each independently specifiable, independently codable, and independently reportable.

### Component 1 — Emotion perception *(Mayer & Salovey four-branch model, branch 1)*
Explicitly names the affective state the participant has signalled through their confidence rating.
> *"It sounds like you're not too sure about this one."*

### Component 2 — Emotion facilitation of thought *(branch 2)*
Reframes the participant's uncertainty as epistemically useful rather than as a deficit.
> *"That hesitation is actually a good instinct here — this is genuinely hard to pin down."*

### Component 3 — Emotion understanding *(branch 3)*
Attributes a cause to the participant's state, demonstrating a model of their mind.
> *"Most people underestimate this one, because our intuitions are calibrated to shallow water."*

### Component 4 — Emotion regulation *(branch 4)*
Actively modulates the participant's affective state toward comfort. **This is what makes the state machine in §5 theoretically required rather than decorative** — regulation is by definition responsive, so a non-adaptive system cannot instantiate branch 4.

### Component 5 — Linguistic convergence *(Communication Accommodation Theory, Giles)*
Mirrors the participant's register and hedging density. Operationalized through the state machine.

### Supporting frames
- **Stereotype Content Model** (Fiske et al.) — warmth and competence are orthogonal dimensions of social judgement. You manipulate warmth and hold competence constant. This is precisely why §7.4's competence control check is mandatory, not optional.
- **CASA / Computers Are Social Actors** (Reeves & Nass) — the theoretical warrant for expecting social responses to a machine at all. Cite this when a reviewer asks why any of this should apply to software.
- **Epistemic vigilance** (Sperber et al., 2010) — your dependent-variable framework: trust calibration and source monitoring as evolved cognitive machinery.

### Component validation — do this, most student papers don't

Two independent raters code every generated response for presence/absence of each of the five components. Report **Cohen's κ** per component. Any component with κ < 0.60 gets rewritten and regenerated before launch.

This converts "we told the model to be warm and assume it worked" into a measured, reported property of your stimuli. It is the single cheapest credibility upgrade available to you.

---

## 5. The deterministic emotional state machine

This is the novel engineering contribution and the thing that will read as genuine CS work rather than prompt-wrangling.

### The problem it solves

Emotional attunement is inherently *responsive* — component 4 (regulation) and component 5 (convergence) cannot exist in a system that says the same thing to everyone. But live API calls destroy experimental control: non-deterministic outputs mean no two participants receive the same stimulus, and the study becomes unreplicable.

### The solution

A finite state machine over **pre-generated** stimuli. Adaptive in behaviour, deterministic in content, fully auditable after the fact.

```
STATE = f(initial_confidence)

  LOW_CONFIDENCE     conf < 40    → reassurance register
  MODERATE           40 ≤ conf ≤ 70 → collaborative register
  HIGH_CONFIDENCE    conf > 70    → affirming + gentle-divergence register
```

Each item × condition × language × state has one pre-generated, human-verified response. Serving is a lookup, not a generation.

### Stimulus space

| Condition | States | Items | Languages | Responses |
|---|---|---|---|---|
| Warm (EI) | 3 | 12 | 3 | 108 |
| Neutral | 1 | 12 | 3 | 36 |
| **Total** | | | | **144** |

Plus follow-up branches (§6): 144 × 3 follow-ups = 432 additional strings. Generate programmatically, verify by hand, freeze.

### Why the neutral condition does not branch

Deliberate and defensible. Adaptive emotional responsiveness is *constitutive of* the EI construct (branch 4), not an incidental feature of it. A neutral condition that adapted emotionally would not be a neutral condition. State this explicitly in the paper — a reviewer will ask, and "we thought about it and here is the theoretical reason" is a much stronger answer than silence.

### What you log

Full state-transition trace per participant: `(item_id, entry_state, response_id, timestamp)`. Publish the FSM diagram as a figure. This is genuinely the kind of artifact that makes a CS admissions reader stop and read properly.

### Integrity guarantee

SHA-256 hash every frozen response file. Commit the hash manifest to the repository **before** collection opens. You can then prove, cryptographically, that stimuli were not altered mid-study. Cheap to implement, and almost nobody at your level does it.

---

## 6. Task flow per item

1. Question presented → participant enters initial estimate + confidence (0–100)
2. **State computed** from confidence → response selected from frozen set
3. AI response displayed (factual claim + justification +, in EI condition, emotional components)
4. Optional follow-up — one of three fixed options, each with pre-written replies per condition/state:
   - *"Can you explain how that's measured?"*
   - *"How certain are you about that?"*
   - *"I think that might be wrong."* ← behavioural challenge measure
5. Optional **"check this claim"** button — logs verification intent, opens nothing
6. Final estimate + confidence
7. Next item

---

## 7. Measures

### 7.1 Primary — the interaction

Dependent variable: **Weight of Advice**

```
WOA = (final − initial) / (advice − initial)
```

Signed, clamped to [−0.5, 1.5], with items dropped where |advice − initial| < 5% of the true value (denominator instability).

**Primary test:** 2 (style, between) × 2 (justification quality, within) mixed ANOVA on WOA across error items. The **interaction term** is H1.

### 7.2 Co-primary — discrimination

```
Discrimination = WOA_strong_justification − WOA_weak_justification
```

Computed per participant. Under the ELM account, the neutral group's discrimination score is substantially positive; the warm group's approaches zero. This is the interaction expressed as a single per-person number, which makes it easy to plot and easy to explain in a viva.

Retain v1's error/correct discrimination as a **secondary** index — it rules out the "warm group is just more agreeable about everything" objection.

### 7.3 Manipulation check — mandatory, per language
Perceived warmth, 5 items, 7-point. Analysed separately within each language group. If it fails in one language, you report that and exclude or flag the group. You do not pool it in quietly.

### 7.4 Control check — perceived competence
4 items, 7-point. **Should not differ** by condition. If it does, warmth and perceived competence are confounded and your causal claim weakens considerably. Report the result either way, including if it's inconvenient.

### 7.5 Process telemetry — the novel data layer

Logged continuously, disclosed in consent:

| Signal | What it indexes |
|---|---|
| Time on AI response before any interaction | Depth of reading |
| Scroll depth within the response | Whether the justification was even seen |
| Estimate trajectory (every intermediate value, not just final) | Deliberation vs. snap revision |
| Revision count before submit | Uncertainty in the revision itself |
| Tab blur/focus events + duration | Proxy for external verification |
| Follow-up selection sequence | Active interrogation |
| Verification-button clicks | Vigilance intent |

Frame this as **implicit epistemic vigilance markers**. WOA is an outcome; telemetry captures the process that produced it. A hypothesis worth pre-registering: scroll depth on the justification text mediates the style × quality interaction. If warm-condition participants literally scroll past the reasoning, you have caught peripheral-route processing in the act.

**Ethics:** tab-blur logging is behavioural monitoring and must be named explicitly in the consent form. Do not bury it. If your teacher or an ethics reviewer objects, drop it — it is the most expendable item here.

---

## 8. Reproducibility layer

The part that demonstrates CS competence rather than describing it.

- **Seeded randomization** — allocation sequence generated once, committed pre-collection, auditable post-hoc
- **Stimulus hash manifest** — SHA-256 per response file, committed before launch (§5)
- **Docker** — analysis environment pinned; `docker run` reproduces every number
- **GitHub Actions CI** — full analysis re-runs on every push; build fails if any reported statistic drifts from the committed values
- **`make paper`** — single command regenerates every figure, table, and number in Results from raw data
- **OSF pre-registration** — hypotheses, exclusions, analysis plan, and stopping rule locked before the first participant

The CI-that-fails-on-drift is the detail worth highlighting. It means the paper's numbers cannot silently diverge from the data.

---

## 9. Repository structure

```
eiai-study3/
├── docs/
│   ├── STUDY3_SPEC_v2.md
│   ├── preregistration.md
│   └── fsm_diagram.svg
├── materials/
│   ├── items.json               # bank + true values + sources + justification pairs
│   ├── prompts/
│   │   ├── shared_constraints.txt
│   │   ├── warm_components.txt  # five components, separately specified
│   │   └── neutral.txt
│   ├── responses/               # {lang}_{condition}_{state}.json
│   ├── manifest.sha256          # committed pre-launch
│   └── questionnaire/
├── scripts/
│   ├── generate.py
│   ├── verify_equivalence.py    # numeric + hedge-level parity across conditions
│   ├── verify_components.py     # five-component coding support
│   ├── hash_manifest.py
│   └── allocation.py
├── app/                         # React + Vite, static
├── api/                         # single serverless write endpoint
├── analysis/
├── .github/workflows/ci.yml
├── Dockerfile
└── Makefile
```

---

## 10. Analysis plan

Pre-register before collecting anything.

- **H1 (primary):** style × justification-quality interaction on WOA, error items. Mixed ANOVA.
- **H2:** main effect of style on the vigilance composite.
- **H3:** discrimination score, warm < neutral. Independent t-test, Welch.
- **H4:** mediation — scroll depth on justification text mediates H1. Bootstrapped indirect effect, 5,000 resamples.
- **H5:** trust ratings, warm > neutral.
- **Covariates:** language, age group, prior knowledge, AI usage frequency.
- **Effect sizes:** partial η² for ANOVA terms, Cohen's d for contrasts, 95% CI throughout.
- **Corrections:** Holm–Bonferroni across secondary outcomes.
- **Exclusions:** participants who identify the deception at funnel stage (i) or (ii). Run and report the analysis both with and without them.
- **Power:** N=120 gives ~80% power for a within-between interaction at f = 0.15. Report achieved power honestly. Do **not** test the language × condition interaction — you are underpowered and should say so in the limitations.

---

## 11. Scope warning — read this before you build

v2 is substantially more ambitious than v1. Three things multiply against each other: 12 items × 3 languages × 3 emotional states. That is 144 responses to generate, hand-verify, and double-code, in languages you will need help checking.

**If the pilot shows fatigue or the translation workload slips, cut in this order:**

1. **Drop to 8 items** (2 error, keeping justification quality crossed) — costs reliability, preserves the design
2. **Drop to 2 languages** — costs recruitment, preserves the mechanism test
3. **Drop the 3-state FSM to 2 states** — costs the CAT component, preserves adaptivity

**Do not cut in this order:** the ELM interaction, the manipulation check, the competence control, or the pre-registration. Those are load-bearing. Everything else is negotiable.

A well-executed 8-item, 2-language study with a clean mechanism test beats an over-scoped 12-item, 3-language study that runs out of time in week seven. Ambition that doesn't ship isn't ambition.

---

## 12. Build sequence

1. Verify every item value independently, especially #11 — record sources in `items.json`
2. Write the strong/weak justification pair for each item, word-count matched
3. Write the five-component warm prompt and the neutral prompt
4. `scripts/generate.py` → 144 responses
5. `scripts/verify_equivalence.py` → numeric and hedge-level parity confirmed
6. Two-rater component coding → report κ, regenerate anything below 0.60
7. `scripts/hash_manifest.py` → commit manifest
8. Build app + FSM + telemetry
9. Internal test, 3 runs per condition per state
10. Per-language pilot, n ≈ 10, manipulation check only
11. OSF pre-registration
12. Collect
13. `make paper`
