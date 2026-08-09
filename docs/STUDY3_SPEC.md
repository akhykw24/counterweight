# Study 3 — Specification

**Emotionally Intelligent AI and Epistemic Vigilance: A Randomized Controlled Experiment**

Version 1.0 — build brief and methods source document.

---

## 1. Design

Two-arm, between-subjects randomized controlled experiment using a Judge–Advisor System (JAS) paradigm.

| | |
|---|---|
| **Independent variable** | Chatbot emotional style (2 levels: Emotionally Intelligent vs. Neutral) |
| **Factual content** | Held constant across conditions — identical numeric claims, identical hedging |
| **Task** | 8 numeric estimation items on deep-sea marine biology |
| **Planted errors** | 3 of 8 AI responses contain substantially incorrect values |
| **Session length** | ~15 minutes |
| **Languages** | Kazakh, Russian, English |
| **Target N** | 120 (60 per condition), stratified across language and age group |

### Why deep-sea marine biology

- **Low prior knowledge** across participants — errors cannot be caught from memory alone, forcing genuine epistemic vigilance rather than recall.
- **Objectively verifiable** — every item has a documented value.
- **Emotionally neutral** — an emotionally charged topic would confound the emotional-style manipulation.
- **No cultural bias** across the three language groups.

### Why pre-generated responses

Responses are generated once, verified by hand for content equivalence across conditions, and frozen into the app as JSON. This:

1. Eliminates the strongest reviewer objection — *"the conditions may have differed in factual content, not only emotional style."*
2. Removes the API key from client-side code.
3. Makes the study fully reproducible from the repository.

The generation pipeline (`scripts/generate.py`) is a reportable paper artifact, not throwaway code.

---

## 2. Participants and consent

### Eligibility
- Age 14+
- Fluent in at least one of Kazakh, Russian, or English
- No formal training in marine biology or oceanography (screening item)

### Two consent flows

**Under 18:**
1. Parental/guardian consent form distributed and returned *before* the session (separate document, not in-app)
2. Participant assent screen in-app, plain language, with explicit right to stop at any point
3. Session code entered in-app links the participant to a returned parental form without collecting a name

**18 and over:**
1. Single in-app informed consent screen

### Deception disclosure
Participants are told the study concerns "how people interact with AI assistants." They are **not** told some AI answers are wrong. This is minimal-risk deception and requires:
- A **funneled debriefing** at the end (see §7.5)
- Full disclosure of the planted errors, with correct values supplied
- An explicit post-debrief withdrawal option

State this in the pre-registration. Reviewers will look for it.

---

## 3. Randomization

Stratified block randomization, seeded and reproducible.

- **Strata:** language (3) × age group (minor / adult) = 6 strata
- **Block size:** 4 within stratum
- **Seed:** fixed integer, committed to the repository before data collection begins
- Assignment happens **client-side from a pre-computed sequence** served by the backend, so the allocation list is auditable after the fact

Item presentation order is randomized per participant. Error-item positions are **not** randomized — they are fixed at items 2, 5, and 7 so that position effects are constant across participants.

---

## 4. Item bank

Numeric estimation items. Each participant gives an initial estimate, receives AI advice, then gives a final estimate.

| # | Question | True value | AI advice | Error? |
|---|---|---|---|---|
| 1 | Maximum depth of the Challenger Deep (metres) | ~10,935 | ~10,900 | — |
| 2 | Percentage of the ocean floor mapped at high resolution | ~26% | **~80%** | **YES** |
| 3 | Longest recorded sperm whale dive (minutes) | ~90 | ~90 | — |
| 4 | Maximum recorded total length of a giant squid (metres) | ~13 | ~13 | — |
| 5 | Maximum temperature of hydrothermal vent fluid (°C) | ~400 | **~150** | **YES** |
| 6 | Depth at which sunlight becomes undetectable (metres) | ~1,000 | ~1,000 | — |
| 7 | Estimated maximum lifespan of a giant tube worm (years) | ~250 | **~40** | **YES** |
| 8 | Number of described deep-sea anglerfish species | ~170 | ~170 | — |

**Error calibration:** each planted error is large enough to be detectable through verification but plausible enough not to be absurd on its face. Verify each true value against a citable source and record the source in `materials/items.json` — you will need these for the debriefing and the appendix.

---

## 5. System prompts

Used in `scripts/generate.py` to produce the frozen response sets. Both prompts are reported verbatim in the paper appendix.

### Shared constraint block (prepended to both)

```
You are answering a factual question about deep-sea marine biology for a
research participant.

You MUST state exactly this numeric value as your answer: {VALUE}
You MUST include exactly these supporting details: {DETAILS}
You MUST express confidence at this level: {HEDGE_LEVEL}
  - "high"     -> state the value directly, no qualifiers
  - "moderate" -> use one qualifier such as "approximately" or "around"

Do not add facts beyond those specified. Do not add caveats beyond the
specified hedge level. Do not invite the participant to verify the claim.
Response length: 60-90 words.
```

The hedging constraint is essential. If the warm condition hedged less than the neutral condition, perceived confidence would confound the emotional manipulation.

### Condition A — Emotionally Intelligent

```
Your communication style is emotionally attuned and warm.

- Acknowledge the participant's effort or reasoning before answering
- Validate any uncertainty they express as reasonable
- Use encouraging, personal language ("that's a really good instinct",
  "I can see why that would be confusing")
- Mirror the participant's tone
- Close with a warm, collaborative remark

Never let warmth alter the factual content, the numeric value, or the
hedge level specified above.
```

### Condition B — Neutral

```
Your communication style is neutral and informational.

- Answer directly, with no preamble
- Use no evaluative language about the participant or their reasoning
- Use no affective, encouraging, or personal language
- Use no rapport-building openings or closings
- Plain declarative sentences only
```

### Follow-up decision tree

Free-form chat cannot be pre-generated. Instead, after each AI response the participant may select one of three fixed follow-ups, each with a pre-written reply in both conditions:

1. *"Can you explain how that's measured?"*
2. *"How certain are you about that?"*
3. *"I thought it was different from that."*

Follow-up **3** is a behavioural measure in itself — log every selection.

---

## 6. Measures

### 6.1 Primary DV — epistemic vigilance composite

Standardize and average these four components:

**(a) Weight of Advice on error items**

```
WOA = |final − initial| / |advice − initial|
```

Computed per item, averaged across the 3 error items. **Lower = more vigilant.** Clamp to [0, 1]; drop items where |advice − initial| < 5% of the true value (denominator instability).

**(b) Discrimination score**

```
Discrimination = WOA_correct_items − WOA_error_items
```

This is important. It separates genuine vigilance from general stubbornness. A participant who ignores all advice scores low on WOA_error but also low on discrimination. A well-calibrated participant defers on correct advice and resists incorrect advice. **Report this as a co-primary outcome** — it directly preempts the objection that the effect is just differential agreeableness.

**(c) Verification behaviour** — count of clicks on the "check this claim" button (available on every item, logs item ID and timestamp; opens nothing, simply records intent).

**(d) Challenge rate** — proportion of items on which follow-up 3 was selected.

### 6.2 Secondary outcomes
- Confidence change on error items (initial → final)
- Confidence calibration: Brier-style score across all 8 items
- Time-to-final-answer per item (milliseconds, logged)

### 6.3 Manipulation check — mandatory

Perceived warmth, 5 items, 7-point Likert. Sample items: *"The assistant seemed to care about my experience"*, *"The assistant responded to how I was feeling."*

Analyse **per language group separately**. If the manipulation fails in one language, you report that honestly and exclude or flag that group — you do not pool it in silently.

### 6.4 Control check — perceived competence

4 items, 7-point Likert. This **should not** differ between conditions. If it does, warmth and perceived competence are confounded and your causal claim weakens. Report it either way.

---

## 7. Post-interaction questionnaire

1. **Manipulation check** — perceived warmth (5 items)
2. **Control check** — perceived competence (4 items)
3. **Trust** — 4 items, 7-point ("I would rely on this assistant for factual information")
4. **Covariates** — age, gender, primary language, AI usage frequency (5-point), self-rated prior knowledge of marine biology (7-point)
5. **Funnelled suspicion probe** — administered in this order, without backtracking:
   - *"What do you think this study was about?"* (free text)
   - *"Did anything about the assistant's answers seem unusual?"* (free text)
   - *"Did you believe all of the assistant's answers were accurate?"* (yes / no / unsure)

   Participants who identify the deception at stage (i) or (ii) are flagged. Pre-register whether you exclude them; the conventional choice is to run the analysis both ways and report both.
6. **Debriefing** — full disclosure, correct values for all three planted errors with sources, withdrawal option.

---

## 8. Repository structure

```
eiai-study3/
├── docs/
│   ├── STUDY3_SPEC.md          # this file
│   └── preregistration.md
├── materials/
│   ├── items.json              # item bank + true values + sources
│   ├── prompts/                # system prompts, all conditions
│   ├── responses/              # frozen: {lang}_{condition}.json  (6 files)
│   └── questionnaire/          # 3 language versions
├── scripts/
│   ├── generate.py             # pre-generation pipeline
│   ├── verify_equivalence.py   # content-equivalence checks
│   └── allocation.py           # seeded randomization sequence
├── app/                        # React + Vite, static
├── api/                        # single serverless write endpoint
├── analysis/
│   ├── clean.py
│   ├── analysis.py             # produces every number in Results
│   └── figures.py
└── data/
    ├── raw/                    # gitignored
    └── public/                 # anonymized, released with the paper
```

**Stack:** React + Vite, deployed static to Vercel. One serverless function writes to Supabase. No API key anywhere in the client.

---

## 9. Data schema

One row per participant-item, plus one row per participant for questionnaire data.

```
participant_id      (random UUID, no PII)
condition           (A | B)
language            (kk | ru | en)
age_group           (minor | adult)
stratum
item_id
item_position       (randomized order position)
is_error_item       (bool)
initial_estimate
initial_confidence  (0-100)
advice_value
followups_selected  (array)
verification_clicks (int)
final_estimate
final_confidence    (0-100)
ms_to_initial
ms_to_final
```

---

## 10. Analysis plan

Pre-register all of this before collecting a single response.

- **H1–H5:** as specified in Part 1 of the paper
- **Primary test:** independent-samples t-test on the vigilance composite; Welch's correction by default
- **Co-primary:** t-test on discrimination score
- **Covariate model:** ANCOVA with language, age group, prior knowledge, and AI usage frequency as covariates
- **Effect sizes:** Cohen's d with 95% CI, reported for every test
- **Multiple comparisons:** Holm–Bonferroni across the secondary outcomes
- **Power:** N = 120 gives ~80% power to detect d = 0.52. Report achieved power honestly. Do **not** test the language × condition interaction — you are underpowered for it, and say so in the limitations.

---

## 11. Translation procedure

For each of Kazakh, Russian, English:

1. **Cultural adaptation, not literal translation** — warmth markers must be re-expressed in forms native to each language, not transliterated
2. **Back-translation** — a second translator renders the adapted version back to the source; discrepancies are reconciled and the reconciliation log is kept
3. **Teacher or native-speaker verification** of both conditions
4. **Per-language pilot** (n ≈ 10) with the manipulation check only, before launch

Do not proceed to full data collection until the manipulation check clears in all three languages. If it fails in one, either revise and re-pilot, or drop that language and report the decision.

---

## 12. Build sequence

1. Finalize `materials/items.json` — true values with citable sources
2. Write and run `scripts/generate.py` → 6 frozen response sets
3. Run `scripts/verify_equivalence.py` — confirm numeric values and hedge levels match across conditions
4. Build the app: consent → assignment → task → questionnaire → debrief
5. Backend endpoint + Supabase table
6. Internal test run (yourself, 3× per condition)
7. Per-language pilot, n ≈ 10
8. Pre-register on OSF — **before** live collection
9. Collect
10. Run `analysis/analysis.py`
