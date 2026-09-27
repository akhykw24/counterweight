# Study 3 — Specification v3 (Mars Mission Training)

Source of truth for the v3 pilot. The section between the two rules below is
Appendix A of the researcher's v3 brief, copied verbatim; it must not be
edited here. Changes to the design go through a new version, not this file.

Not to be confused with `docs/STUDY3_SPEC_v3.md`, an older engineering
specification that predates this protocol and kept its file name. The v1 and
v2 protocols are in `docs/spec/v1/` and `docs/spec/v2/` and are unchanged.

---

**Design.** 2 (tutor tone: EI vs Neutral; between-subjects) × 2 (explanation quality: strong vs weak; within-subjects, 6 + 6) mixed design. Explanation quality is counterbalanced across two lists (A/B), giving 4 between-subjects cells: EI-A, EI-B, Neutral-A, Neutral-B.

**Cover story.** Participants test an AI tutor ("Nova") for a space-training learning game. Incomplete disclosure: tone and explanation quality are revealed only in the debriefing.

**Procedure.** Consent → screening (18+, CEFR ≥ B1) → pre-measures → 3 modules, each a lesson (4 explanations in chat format) followed by a mission (4 situational tasks) → final quiz → tutor evaluation → awareness funnel → explanation-quality check → (NCS-6) → demographics → debriefing.

**Materials.** 12 claims, all true. Strong explanations give evidence that directly supports the claim (measurement, mechanism, calculation, demonstration). Weak explanations consist only of true, on-topic statements that do not support the claim; their reasoning flaws are documented per item. Within each claim, strong and weak versions share an identical first sentence and are matched on length (±10 %), number of sentences, number of figures and named sources, and confidence. EI and neutral closing lines are identical across strong and weak versions of the same claim and contain no evidence.

**Measures.**
- Primary DV: adoption — choosing the lesson-consistent option in mission tasks.
- Secondary: confidence-weighted adoption; final-quiz truth ratings (1–7).
- Process: reading time per explanation.
- Manipulation checks: T1–T4 (tone); explanation-quality ratings (E6).
- Awareness: funnel F1–F3, coded blind to condition.
- Covariates: English level (CEFR), P1–P6.

**Hypotheses.** H1: adoption is higher after strong than after weak explanations. H2: tone × quality interaction on adoption.

**Exclusions (main study).** Incomplete; failed attention check; distractor chosen in 4 or more of 12 tasks; too fast (threshold set from pilot data); repeat participation; withdrawal after debriefing.

**Pilot.** Rotating allocation across the 4 cells, separate from main allocation. Main allocation sequence, power analysis, analysis model, multiverse and preregistration are defined after the pilot.

---

## Materials (files)

The approved texts (Appendices B–E) are held verbatim in
[`stimuli/v3/source/`](../../../stimuli/v3/source/). The app reads the
structured copies derived from them:

| File | Contents |
|---|---|
| [`stimuli/v3/explanations.json`](../../../stimuli/v3/explanations.json) | 12 claims × strong/weak explanations, technique codes, evidence type, core, flaw |
| [`stimuli/v3/tone.json`](../../../stimuli/v3/tone.json) | EI and neutral closing line per claim; the four transitions |
| [`stimuli/v3/mission.json`](../../../stimuli/v3/mission.json) | Module headings, mission tasks, attention check, confidence scale |
| [`stimuli/v3/quiz.json`](../../../stimuli/v3/quiz.json) | Final quiz: 12 claim statements and 4 fillers |
| [`stimuli/v3/instruments.json`](../../../stimuli/v3/instruments.json) | Consent, screening, pre-measures, tutor evaluation, funnel, explanation-quality check, demographics, pilot feedback, debriefing |
| [`stimuli/v3/ncs6_items.json`](../../../stimuli/v3/ncs6_items.json) | NCS-6 items (empty until added; the screen is skipped while empty) |
| [`stimuli/v3/manifest.json`](../../../stimuli/v3/manifest.json) | SHA-256 of every file above; checked by `pnpm stimuli:v3:check` |
