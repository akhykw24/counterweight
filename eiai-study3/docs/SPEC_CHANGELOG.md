# Specification changelog

Every change from v1 to v2, as **was → became → why**. No code was changed.

## A note on numbering

The repository already contained `docs/STUDY3_SPEC_v2.md` and
`docs/STUDY3_SPEC_v3.md`. Those are earlier drafts of the *same* design, and
`v3` was the active source of truth. The `v1` / `v2` under `docs/spec/` is a
**new** numbering that starts with this decision:

| Directory | Contents |
|---|---|
| `docs/spec/v1/` | the design as audited on 2026-09-02 — a frozen copy of `STUDY3_SPEC_v3.md`, plus `STUDY3_SPEC_v2.md` as the science core it carries over. Hashes recorded in `docs/spec/v1/README.md`; never edited |
| `docs/spec/v2/` | this version: adults only, English only, stratified by English proficiency |

The old `docs/STUDY3_SPEC_v*.md` files are left where they are so that existing
links and the audit in `docs/STATUS.md` keep resolving.

---

## 1. Participants

| | |
|---|---|
| **Was** | Ages 14+, in four bands (14–15, 16–17, 18–24, 25+). Minors routed to a separate assent flow after out-of-band parental consent. |
| **Became** | **18 and over only.** Age asked before the consent screen. Anyone under 18 sees a courteous exit; nothing personal is stored, only a `SCREENED_OUT` event with reason `age`. Bands are now 18–24, 25–34, 35+. |
| **Why** | Researcher decision. Removes the parental-consent logistics, the ethics burden of minors, and a whole branch of the state machine. |

| | |
|---|---|
| **Was** | Dual consent flow: parental consent plus assent for minors, standard consent for adults. |
| **Became** | Single adult informed-consent flow, behind a screening gate. |
| **Why** | Follows directly from 18+. |

## 2. Language

| | |
|---|---|
| **Was** | Three languages (English, Russian, Kazakh). 12 items × 3 languages × 4 variants = 144 responses + 432 follow-up branches. |
| **Became** | **English only.** 12 items × 4 variants = 48 responses + 144 follow-up branches. Russian and Kazakh sets move to `archive/` — retained for provenance, excluded from the active manifest. |
| **Why** | Researcher decision. Removes the translation-validity risk entirely: back-translation, reconciliation and native-speaker verification of two languages were the largest outstanding human task, and a translation that shifted argument strength would have been indistinguishable from the effect under study. |

## 3. English-proficiency screening — new

| | |
|---|---|
| **Was** | Not present. |
| **Became** | Self-reported CEFR level (A1–C2) plus the language of the participant's study or work, asked before consent. **Threshold B1.** Below it: courteous exit and a `SCREENED_OUT` event with reason `language`. |
| **Why** | English-only introduces a new confound in place of the one it removes. A participant who cannot read a strong argument as strong shows a flat discrimination score for reasons that have nothing to do with warmth — which is precisely the alternative explanation this study exists to rule out. Screening bounds it; stratification and the covariate measure what remains. |

## 4. Stratification

| | |
|---|---|
| **Was** | Six strata: language × age group (`kk:minor`, `kk:adult`, `ru:minor`, `ru:adult`, `en:minor`, `en:adult`). |
| **Became** | **Two strata: `B1-B2` and `C1-C2/native`.** Block randomisation into EI / Neutral within each. **Number and names live in a configuration file, not in code.** |
| **Why** | Language and age no longer vary, so those strata are empty by construction. Proficiency is now the variable most likely to correlate with the dependent variable, which is what stratification is for. The configuration requirement is a direct consequence of the audit: strata are currently hard-coded in three places (`packages/schema/src/primitives.ts`, `packages/fsm/src/session.ts`, `pipeline/allocation.py`), so changing their number is a code change. |

| | |
|---|---|
| **Was** | 384 committed assignments, 64 per stratum across six strata. |
| **Became** | At least **96 per stratum** (24 blocks of 4). |
| **Why** | Two strata will not fill evenly, and the hard cap is 160. Sixty-four per stratum could not cover the cap in whichever stratum recruits faster. |

## 5. Analysis

| | |
|---|---|
| **Was** | No covariate. |
| **Became** | **CEFR band enters the primary model as a covariate**, plus a **pre-specified sensitivity analysis excluding B1 participants**, reported alongside the primary result whether or not it agrees. |
| **Why** | The residual comprehension risk after screening. Pre-specifying the sensitivity analysis is what stops it becoming a post-hoc rescue. |

| | |
|---|---|
| **Was** | Not present. |
| **Became** | **Jackknife over items** — the interaction re-estimated twelve times, each dropping one item; all twelve reported. |
| **Why** | Two items per design cell is thin, which v1 already conceded. A conclusion that survives only with one particular item retained is a conclusion about that item. |

| | |
|---|---|
| **Was** | "exclusions per funnel, analyzed both ways" — the only stated criterion. |
| **Became** | **Five explicit criteria (§8.6)**: non-completion; trials under 5 seconds from reveal to submit on 7 or more of 12; invariant responding; attention check (**not used**, with the reason stated); repeat participation within a browser. Counted and reported per criterion. |
| **Why** | The audit found only funnel-belief and resumed-session exclusions implemented, both as multiverse axes. An unstated exclusion rule applied after seeing the data is a researcher degree of freedom. The 5-second floor is derived rather than picked: the advice body is 60–90 words, so at 400 wpm — fast for a second language — reading takes 9–13 seconds. Five seconds does not identify fast reading, it identifies not reading. |

## 6. Target N and stopping rule

| | |
|---|---|
| **Was** | "N: 120 target" in prose, with no derivation. `pipeline/power.py` separately computed 126. |
| **Became** | **126 (63 per arm)**, with the derivation and every assumption written out in a new §8.5. |
| **Why** | The two numbers disagreed and neither was justified in the document. 126 is the one that comes from a calculation. |

| | |
|---|---|
| **Was** | — |
| **Became** | §8.5 states that the target is **unchanged** despite the redesign, and why. |
| **Why** | Three v2 changes push in opposite directions: two strata instead of six changes nothing material about the contrast's variance; the covariate reduces the requirement by (1 − R²) with R² unknown; the B1 threshold should sharpen the effect and cut noise. Lowering the target on unmeasured gains is exactly how a study ends up underpowered. The covariate's benefit is treated as headroom, not as a discount. **Re-derive from the pilot's observed SD before fixing N.** |

| | |
|---|---|
| **Was** | Sequential Bayes: first look at N = 60, every +20, stop at BF₁₀ > 6 or < 1/6, hard cap 160. |
| **Became** | **Unchanged.** |
| **Why** | Nothing in the redesign bears on it. The audit's finding that the rule is described but never implemented in code is a code gap, not a specification change. |

## 7. Manipulation checks

| | |
|---|---|
| **Was** | "perceived-warmth manipulation check per language; perceived-competence control check (must NOT differ)". |
| **Became** | Per condition rather than per language, plus a **new per-item measure: perceived argument strength, single item, 1–7, asked immediately after the revised estimate** (`ARGUMENT_RATED` event). |
| **Why** | "Per language" is meaningless with one language. The per-item measure was absent: the study manipulates argument quality within participants but never asked whether participants perceived the difference. Without it, a null interaction cannot distinguish "warmth flattened discrimination" from "the strong and weak arguments did not read differently". Placed after the revised estimate so that rating cannot influence the estimate it is meant to explain. |

## 8. Debrief

| | |
|---|---|
| **Was** | "full debrief with corrections and sources" — already specified and already implemented. |
| **Became** | **Unchanged in substance.** |
| **Why** | The requested debrief screen (purpose, two styles, strong/weak arguments, contact) already exists in v1 and in the code. No change was needed; recorded here so the absence of a change is not read as an omission. **The debrief text itself was not edited** — that is the researcher's authorship. |

## 9. Event taxonomy

| | |
|---|---|
| **Was** | `CONSENT_GIVEN` / `ASSENT_GIVEN`; `SESSION_STARTED` carried `locale`. |
| **Became** | `CONSENT_GIVEN` only. **New `SCREENED_OUT`** carrying reason (`age` \| `language` \| `prior_training`). **New `ARGUMENT_RATED`.** `locale` dropped from `SESSION_STARTED`. |
| **Why** | Assent has no flow to belong to. Screening outcomes must be counted for the participant-flow diagram, and counting them requires an event — but a screened-out person contributes that event and nothing else. `locale` was the browser's locale, not a choice, and with one study language it carries no information. |

---

## Not changed, deliberately

- **Design, hypotheses, WOA formula, register thresholds, the EI manipulation and its five components, κ ≥ 0.60 floor.** Outside the scope of this decision.
- **Every stimulus, advice, debrief and consent text.** Researcher's authorship; not edited.
- **The multiverse, its 48 specifications, and the reproducibility requirements.** Unaffected.

---

## Open: the 6 strong / 6 weak item split

**Requested but not applied, because it needs a decision that is not a formality.**

Two placeholders in the instruction — the identifiers of the two items to
relabel — were never filled in. That alone would block it. But the more
substantial problem is that the twelve items are not one undifferentiated pool,
and "6/6" does not name a single change:

| Reading | Result on the analysed 2×2 | Advice accuracy, strong vs weak |
|---|---|---|
| **Today** | 4 strong / 4 weak | 50% / 50% |
| Relabel two **fillers** as weak, keeping them fillers | 4 strong / 4 weak — unchanged | 50% / 50% — unchanged |
| Convert two fillers into **analysed** weak items | 4 strong / **6 weak** — unbalanced | 50% / **33%** — confounded |

The first reading changes what participants see (more weak arguments) without
touching the analysed contrast. The second unbalances the design and
reintroduces the base-rate confound that the filler structure exists to avoid:
with unequal accuracy across quality, a participant discounting weak
justification on normative grounds becomes indistinguishable from one persuaded
by warmth — which is the exact inference H2 makes.

A third option exists and is not in the instruction: relabel nothing. The
analysed set is already balanced 4/4 with equal base rates; the "8 strong / 4
weak" figure that motivated the request came from the analysis counting fillers
as analysed items, which the audit corrected.

**§1 of v2 is unchanged pending this decision** and carries a `[DECISION
REQUIRED]` note pointing here.
