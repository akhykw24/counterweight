# Data Dictionary

**Generated file — do not edit by hand.** Produced from the Zod schemas in `packages/schema/src` by `pnpm codegen`. CI runs `pnpm codegen:check` and fails the build if this file drifts from the schemas, so the dictionary printed in the paper's appendix cannot disagree with what the ingest service actually validated.

No field anywhere in this document holds personally identifying information. Age is captured as a band at source, never as an exact number.

## Contents

- [Events](#events)
- [Events (v3, Mars Mission Training)](#events-v3-mars-mission-training-)
- [Transport](#transport)
- [Item bank and stimuli](#item-bank-and-stimuli)
- [Questionnaire](#questionnaire)
- [Enumerations](#enumerations)

## Event envelope

Every event carries the same four envelope fields in addition to its `type` and `payload`.

| Field | Type | Description |
|---|---|---|
| `event_id` | string(uuid) | Idempotency key. The ingest service dedupes on this, so at-least-once delivery is safe. |
| `session_id` | string(uuid) | The only participant identifier that exists. |
| `seq` | integer | Monotonic within a session. Establishes order independently of clock skew. |
| `client_ts` | string(date-time) | Client clock. Untrusted for ordering; used for wall-clock reporting only. |

v3 events add two more:

| Field | Type | Description |
|---|---|---|
| `participant_id` | string(uuid) | Per-browser identifier kept across sessions. Detects repeat participation; linked to no person. |
| `cell` | string, nullable | EI-A, EI-B, Neutral-A or Neutral-B. Null before allocation. |

## Events

The append-only log. Every analytic table is a projection computed by replaying these. A measure absent here cannot be recovered after collection.

#### `SESSION_STARTED`

First load, and again on resume after a crash. The manifest hash pins which frozen stimulus set this participant actually saw.

*Emitted when:* first load, and on resume

Envelope fields are omitted; see [Event envelope](#event-envelope).

| Field | Type | Req. | Constraints | Description |
|---|---|---|---|---|
| `run_mode` | `live` \| `pilot` \| `test` | yes |  | live = the real study; pilot = a pilot participant; test = a throwaway run. Only `live` enters the analysed sample; pipeline/exclusions.py removes the others before any statistic is computed. |
| `type` | `"SESSION_STARTED"` | yes |  |  |
| `payload.app_version` | string | yes | minLen 1 | Build identifier of the study app. |
| `payload.stimuli_manifest_hash` | string | yes | pattern `^[a-f0-9]{64}$` | SHA-256 of the stimulus manifest in force for this session. Lets you prove post hoc that stimuli were unaltered. |
| `payload.viewport` | object | yes |  | Viewport in CSS pixels. Scroll-depth measures are only interpretable relative to this. |
| `payload.viewport.width` | integer | yes | > 0 |  |
| `payload.viewport.height` | integer | yes | > 0 |  |
| `payload.resumed` | boolean | yes |  | True when continuing an interrupted session. Pre-registered as an exclusion candidate. |
| `payload.repeat_session` | boolean | yes |  | True when this browser already held a completed session, i.e. the same person is starting a second time. Exclusion criterion 5. Detectable only within a browser; a repeat from another device is undetectable without an identifier the no-PII rule forbids. |

#### `SCREENED_OUT`

A visitor was turned away before consent. This is the only event such a session produces: no age band, no answers, no allocation. It exists so screening counts can be reported in the participant-flow diagram without storing anything about the person.

*Emitted when:* eligibility screening gate

Envelope fields are omitted; see [Event envelope](#event-envelope).

| Field | Type | Req. | Constraints | Description |
|---|---|---|---|---|
| `run_mode` | `live` \| `pilot` \| `test` | yes |  | live = the real study; pilot = a pilot participant; test = a throwaway run. Only `live` enters the analysed sample; pipeline/exclusions.py removes the others before any statistic is computed. |
| `type` | `"SCREENED_OUT"` | yes |  |  |
| `payload.reason` | `age` \| `language` \| `prior_training` | yes |  | Why a visitor was turned away before consent. This is the ONLY thing a screened-out visitor contributes: no age, no answers, no session (spec v2 §3). It exists so the participant-flow diagram can report screening counts. |

#### `CONSENT_GIVEN`

Adult informed consent. Carries no flow discriminator: v2 admits adults only, so there is one flow and naming it would only invite the literal to drift from the participant.

*Emitted when:* consent screen

Envelope fields are omitted; see [Event envelope](#event-envelope).

| Field | Type | Req. | Constraints | Description |
|---|---|---|---|---|
| `run_mode` | `live` \| `pilot` \| `test` | yes |  | live = the real study; pilot = a pilot participant; test = a throwaway run. Only `live` enters the analysed sample; pipeline/exclusions.py removes the others before any statistic is computed. |
| `type` | `"CONSENT_GIVEN"` | yes |  |  |

#### `ALLOCATED`

Condition assignment, drawn from the pre-computed seeded sequence so the allocation list is auditable after the fact.

*Emitted when:* after eligibility

Envelope fields are omitted; see [Event envelope](#event-envelope).

| Field | Type | Req. | Constraints | Description |
|---|---|---|---|---|
| `run_mode` | `live` \| `pilot` \| `test` | yes |  | live = the real study; pilot = a pilot participant; test = a throwaway run. Only `live` enters the analysed sample; pipeline/exclusions.py removes the others before any statistic is computed. |
| `type` | `"ALLOCATED"` | yes |  |  |
| `payload.condition` | `warm` \| `neutral` | yes |  | Between-subjects emotional style condition. |
| `payload.stratum` | string | yes | minLen 1 | Randomisation stratum id, drawn from materials/strata.json. Two under spec v2: B1-B2 and C1-C2/native. |
| `payload.cefr` | `A1` \| `A2` \| `B1` \| `B2` \| `C1` \| `C2` | yes |  | Self-reported CEFR English level. Recorded alongside the stratum it determined, because the stratum cannot answer the questions section 8.1 pre-registers: B1 and B2 share a stratum, so a sensitivity analysis excluding B1 is impossible from the stratum alone. |
| `payload.allocation_seq` | integer | yes | >= 0 | Index into the committed allocation sequence. |

#### `ITEM_PRESENTED`

Item screen mounted. Start of the reaction-time clock for this trial.

*Emitted when:* item screen mount

Envelope fields are omitted; see [Event envelope](#event-envelope).

| Field | Type | Req. | Constraints | Description |
|---|---|---|---|---|
| `run_mode` | `live` \| `pilot` \| `test` | yes |  | live = the real study; pilot = a pilot participant; test = a throwaway run. Only `live` enters the analysed sample; pipeline/exclusions.py removes the others before any statistic is computed. |
| `type` | `"ITEM_PRESENTED"` | yes |  |  |
| `payload.item_id` | string | yes | pattern `^item_(0[1-9]\|1[0-2])$` | Item bank identifier, item_01 through item_12. |
| `payload.position` | integer | yes | >= 1, <= 12 | Presentation position, 1-12. Order is randomized per participant. |

#### `ESTIMATE_CHANGED`

Every intermediate estimate value, not just the submitted one. This is what makes trajectory analysis possible and it cannot be reconstructed later.

*Emitted when:* every slider or keystroke change

Envelope fields are omitted; see [Event envelope](#event-envelope).

| Field | Type | Req. | Constraints | Description |
|---|---|---|---|---|
| `run_mode` | `live` \| `pilot` \| `test` | yes |  | live = the real study; pilot = a pilot participant; test = a throwaway run. Only `live` enters the analysed sample; pipeline/exclusions.py removes the others before any statistic is computed. |
| `type` | `"ESTIMATE_CHANGED"` | yes |  |  |
| `payload.item_id` | string | yes | pattern `^item_(0[1-9]\|1[0-2])$` | Item bank identifier, item_01 through item_12. |
| `payload.phase` | `initial` \| `final` | yes |  | Whether an estimate or confidence reading was taken before or after the AI response. |
| `payload.value` | number | yes |  | A numeric estimate in the item's own unit. Unbounded — participants may enter any finite value. |
| `payload.ms_since_present` | integer | yes | >= 0 | Elapsed milliseconds. |

#### `CONFIDENCE_SET`

Confidence reading. The initial-phase value is the input to the register function.

*Emitted when:* confidence input

Envelope fields are omitted; see [Event envelope](#event-envelope).

| Field | Type | Req. | Constraints | Description |
|---|---|---|---|---|
| `run_mode` | `live` \| `pilot` \| `test` | yes |  | live = the real study; pilot = a pilot participant; test = a throwaway run. Only `live` enters the analysed sample; pipeline/exclusions.py removes the others before any statistic is computed. |
| `type` | `"CONFIDENCE_SET"` | yes |  |  |
| `payload.item_id` | string | yes | pattern `^item_(0[1-9]\|1[0-2])$` | Item bank identifier, item_01 through item_12. |
| `payload.phase` | `initial` \| `final` | yes |  | Whether an estimate or confidence reading was taken before or after the AI response. |
| `payload.value` | number | yes | >= 0, <= 100 | Self-reported confidence, 0-100. Feeds the register function. |

#### `RESPONSE_REVEALED`

AI reply shown. Records which frozen stimulus was served and, in the warm condition, which register the FSM entered.

*Emitted when:* AI reply shown

Envelope fields are omitted; see [Event envelope](#event-envelope).

| Field | Type | Req. | Constraints | Description |
|---|---|---|---|---|
| `run_mode` | `live` \| `pilot` \| `test` | yes |  | live = the real study; pilot = a pilot participant; test = a throwaway run. Only `live` enters the analysed sample; pipeline/exclusions.py removes the others before any statistic is computed. |
| `type` | `"RESPONSE_REVEALED"` | yes |  |  |
| `payload.item_id` | string | yes | pattern `^item_(0[1-9]\|1[0-2])$` | Item bank identifier, item_01 through item_12. |
| `payload.response_id` | string | yes | pattern `^[a-z]{2}_(warm\|neutral)_(low\|moderate\|high\|na)_item_(0[1-9]\|1[0-2])$` | Frozen stimulus identifier: {lang}_{condition}_{register}_{item}. Resolves to exactly one hash-manifested response file. |
| `payload.register_state` | `LOW` \| `MODERATE` \| `HIGH` \| null | yes |  | Null in the neutral condition, which does not branch — non-branching is constitutive of the neutral control, not an oversight. |

#### `RESPONSE_SCROLLED`

Deepest scroll reached within the AI reply. Mediator variable for H4: if warm-condition participants never scroll to the justification, peripheral-route processing is caught in the act.

*Emitted when:* scroll within reply

Envelope fields are omitted; see [Event envelope](#event-envelope).

| Field | Type | Req. | Constraints | Description |
|---|---|---|---|---|
| `run_mode` | `live` \| `pilot` \| `test` | yes |  | live = the real study; pilot = a pilot participant; test = a throwaway run. Only `live` enters the analysed sample; pipeline/exclusions.py removes the others before any statistic is computed. |
| `type` | `"RESPONSE_SCROLLED"` | yes |  |  |
| `payload.item_id` | string | yes | pattern `^item_(0[1-9]\|1[0-2])$` | Item bank identifier, item_01 through item_12. |
| `payload.max_scroll_fraction` | number | yes | >= 0, <= 1 | Deepest fraction of the AI response scrolled into view. 1.0 means the justification was at least displayed. |

#### `FOLLOWUP_SELECTED`

One of three fixed follow-ups tapped. Selecting 'challenge' is a behavioural vigilance measure in its own right.

*Emitted when:* follow-up tap

Envelope fields are omitted; see [Event envelope](#event-envelope).

| Field | Type | Req. | Constraints | Description |
|---|---|---|---|---|
| `run_mode` | `live` \| `pilot` \| `test` | yes |  | live = the real study; pilot = a pilot participant; test = a throwaway run. Only `live` enters the analysed sample; pipeline/exclusions.py removes the others before any statistic is computed. |
| `type` | `"FOLLOWUP_SELECTED"` | yes |  |  |
| `payload.item_id` | string | yes | pattern `^item_(0[1-9]\|1[0-2])$` | Item bank identifier, item_01 through item_12. |
| `payload.followup_id` | `measurement` \| `certainty` \| `challenge` | yes |  | Fixed follow-up options. 'challenge' ("I think that might be wrong") is itself a behavioural measure. |
| `payload.ms_since_reveal` | integer | yes | >= 0 | Elapsed milliseconds. |

#### `VERIFY_CLICKED`

The 'check this claim' button. Opens nothing; records verification intent only.

*Emitted when:* "check this claim"

Envelope fields are omitted; see [Event envelope](#event-envelope).

| Field | Type | Req. | Constraints | Description |
|---|---|---|---|---|
| `run_mode` | `live` \| `pilot` \| `test` | yes |  | live = the real study; pilot = a pilot participant; test = a throwaway run. Only `live` enters the analysed sample; pipeline/exclusions.py removes the others before any statistic is computed. |
| `type` | `"VERIFY_CLICKED"` | yes |  |  |
| `payload.item_id` | string | yes | pattern `^item_(0[1-9]\|1[0-2])$` | Item bank identifier, item_01 through item_12. |
| `payload.ms_since_reveal` | integer | yes | >= 0 | Elapsed milliseconds. |

#### `WINDOW_BLURRED`

Tab or window lost focus. Proxy for external verification. Behavioural monitoring — must be named explicitly in the consent form.

*Emitted when:* tab switch away

Envelope fields are omitted; see [Event envelope](#event-envelope).

| Field | Type | Req. | Constraints | Description |
|---|---|---|---|---|
| `run_mode` | `live` \| `pilot` \| `test` | yes |  | live = the real study; pilot = a pilot participant; test = a throwaway run. Only `live` enters the analysed sample; pipeline/exclusions.py removes the others before any statistic is computed. |
| `type` | `"WINDOW_BLURRED"` | yes |  |  |
| `payload.item_id` | string \| null | yes |  | Item on screen at blur, or null outside the item loop. |
| `payload.ms_since_session_start` | integer | yes | >= 0 | Elapsed milliseconds. |

#### `WINDOW_FOCUSED`

Focus returned. Paired with the preceding blur to give an away-duration.

*Emitted when:* tab switch back

Envelope fields are omitted; see [Event envelope](#event-envelope).

| Field | Type | Req. | Constraints | Description |
|---|---|---|---|---|
| `run_mode` | `live` \| `pilot` \| `test` | yes |  | live = the real study; pilot = a pilot participant; test = a throwaway run. Only `live` enters the analysed sample; pipeline/exclusions.py removes the others before any statistic is computed. |
| `type` | `"WINDOW_FOCUSED"` | yes |  |  |
| `payload.item_id` | string \| null | yes |  |  |
| `payload.ms_since_session_start` | integer | yes | >= 0 | Elapsed milliseconds. |
| `payload.away_duration_ms` | integer | yes | >= 0 | Elapsed milliseconds. |

#### `ESTIMATE_FINALIZED`

Final estimate submitted for a trial. Numerator of Weight of Advice.

*Emitted when:* submit

Envelope fields are omitted; see [Event envelope](#event-envelope).

| Field | Type | Req. | Constraints | Description |
|---|---|---|---|---|
| `run_mode` | `live` \| `pilot` \| `test` | yes |  | live = the real study; pilot = a pilot participant; test = a throwaway run. Only `live` enters the analysed sample; pipeline/exclusions.py removes the others before any statistic is computed. |
| `type` | `"ESTIMATE_FINALIZED"` | yes |  |  |
| `payload.item_id` | string | yes | pattern `^item_(0[1-9]\|1[0-2])$` | Item bank identifier, item_01 through item_12. |
| `payload.value` | number | yes |  | A numeric estimate in the item's own unit. Unbounded — participants may enter any finite value. |
| `payload.revision_count` | integer | yes | >= 0 | Number of ESTIMATE_CHANGED events in the final phase before submit. Indexes uncertainty in the revision itself. |
| `payload.ms_since_reveal` | integer | yes | >= 0 | Elapsed milliseconds. |

#### `ARGUMENT_RATED`

Perceived strength of the argument in the advice, asked once per item immediately after the revised estimate. The manipulation check for the within-subjects factor: without it a null interaction cannot be told apart from strong and weak arguments that did not read differently. Recorded AFTER the estimate so that rating cannot influence what it is meant to explain -- the event order in the log is what shows this.

*Emitted when:* after the revised estimate

Envelope fields are omitted; see [Event envelope](#event-envelope).

| Field | Type | Req. | Constraints | Description |
|---|---|---|---|---|
| `run_mode` | `live` \| `pilot` \| `test` | yes |  | live = the real study; pilot = a pilot participant; test = a throwaway run. Only `live` enters the analysed sample; pipeline/exclusions.py removes the others before any statistic is computed. |
| `type` | `"ARGUMENT_RATED"` | yes |  |  |
| `payload.item_id` | string | yes | pattern `^item_(0[1-9]\|1[0-2])$` | Item bank identifier, item_01 through item_12. |
| `payload.perceived_strength` | integer | yes | >= 1, <= 7 | 1 = very weak, 7 = very strong. |

#### `QUESTIONNAIRE_ANSWERED`

One questionnaire item. Emitted per item rather than per scale so partial completion is still analysable.

*Emitted when:* each questionnaire item

Envelope fields are omitted; see [Event envelope](#event-envelope).

| Field | Type | Req. | Constraints | Description |
|---|---|---|---|---|
| `run_mode` | `live` \| `pilot` \| `test` | yes |  | live = the real study; pilot = a pilot participant; test = a throwaway run. Only `live` enters the analysed sample; pipeline/exclusions.py removes the others before any statistic is computed. |
| `type` | `"QUESTIONNAIRE_ANSWERED"` | yes |  |  |
| `payload.scale` | `warmth` \| `competence` \| `trust` \| `covariates` | yes |  | Which questionnaire instrument an answer belongs to. |
| `payload.question_id` | string | yes | minLen 1 | Stable question identifier, e.g. warmth_01. |
| `payload.value` | integer \| string | yes |  | Likert integer, or a string for categorical covariates such as age band. |

#### `FUNNEL_RESPONSE`

Funnelled suspicion probe. Free text at stages 'purpose' and 'anomaly'; the 'belief' stage is a three-way choice.

*Emitted when:* suspicion probe

Envelope fields are omitted; see [Event envelope](#event-envelope).

| Field | Type | Req. | Constraints | Description |
|---|---|---|---|---|
| `run_mode` | `live` \| `pilot` \| `test` | yes |  | live = the real study; pilot = a pilot participant; test = a throwaway run. Only `live` enters the analysed sample; pipeline/exclusions.py removes the others before any statistic is computed. |
| `type` | `"FUNNEL_RESPONSE"` | yes |  |  |
| `payload.stage` | `purpose` \| `anomaly` \| `belief` | yes |  | Funnelled suspicion probe stage, administered in this order without backtracking. |
| `payload.text` | string | yes |  | Verbatim free-text response, or the selected option at the belief stage. |

#### `SESSION_COMPLETED`

Participant reached the debrief and finished.

*Emitted when:* debrief reached

Envelope fields are omitted; see [Event envelope](#event-envelope).

| Field | Type | Req. | Constraints | Description |
|---|---|---|---|---|
| `run_mode` | `live` \| `pilot` \| `test` | yes |  | live = the real study; pilot = a pilot participant; test = a throwaway run. Only `live` enters the analysed sample; pipeline/exclusions.py removes the others before any statistic is computed. |
| `type` | `"SESSION_COMPLETED"` | yes |  |  |
| `payload.total_duration_ms` | integer | yes | >= 0 | Elapsed milliseconds. |

#### `PILOT_FEEDBACK`

Optional usability feedback, asked only in a pilot run and only after the session is already complete. Never part of the analysed study: these rows carry run_mode 'pilot' or 'test' and are removed before any statistic is computed.

*Emitted when:* pilot runs only, after the session is complete

Envelope fields are omitted; see [Event envelope](#event-envelope).

| Field | Type | Req. | Constraints | Description |
|---|---|---|---|---|
| `run_mode` | `live` \| `pilot` \| `test` | yes |  | live = the real study; pilot = a pilot participant; test = a throwaway run. Only `live` enters the analysed sample; pipeline/exclusions.py removes the others before any statistic is computed. |
| `type` | `"PILOT_FEEDBACK"` | yes |  |  |
| `payload.question` | `clarity` \| `duration` \| `purpose_guess` | yes |  | Which of the three closing questions this answers. |
| `payload.text` | string | yes | minLen 1 | Verbatim answer. Blank answers are not recorded at all, so an empty string never appears. |

#### `SESSION_WITHDRAWN`

Withdrawal, reachable from every screen. Events already logged still count up to this point unless the participant requests deletion.

*Emitted when:* withdrawal, from any screen

Envelope fields are omitted; see [Event envelope](#event-envelope).

| Field | Type | Req. | Constraints | Description |
|---|---|---|---|---|
| `run_mode` | `live` \| `pilot` \| `test` | yes |  | live = the real study; pilot = a pilot participant; test = a throwaway run. Only `live` enters the analysed sample; pipeline/exclusions.py removes the others before any statistic is computed. |
| `type` | `"SESSION_WITHDRAWN"` | yes |  |  |
| `payload.reason` | string \| null | yes |  | Optional free-text reason. Null when the participant declined to give one. |
| `payload.at_state` | string | yes | minLen 1 | Statechart state the participant withdrew from. |

## Events (v3, Mars Mission Training)

The v3 family (docs/spec/v3/SPEC.md). Lower-case type names keep it apart from the deep-sea events above. The envelope adds `participant_id` and `cell`; see [Event envelope](#event-envelope).

#### `session_started`

First load of a session, and again on every resume.

*Emitted when:* first load, and on resume

Envelope fields are omitted; see [Event envelope](#event-envelope).

| Field | Type | Req. | Constraints | Description |
|---|---|---|---|---|
| `run_mode` | `live` \| `pilot` \| `test` | yes |  | live = the real study; pilot = a pilot participant; test = a throwaway run. Only `live` enters the analysed sample; pipeline/exclusions.py removes the others before any statistic is computed. |
| `type` | `"session_started"` | yes |  |  |
| `payload.study_version` | `"v3"` | yes |  |  |
| `payload.app_version` | string | yes |  |  |
| `payload.stimuli_manifest_hash` | string | yes | pattern `^[a-f0-9]{64}$` | Lowercase hex SHA-256 digest. |
| `payload.viewport` | object | yes |  |  |
| `payload.viewport.width` | integer | yes | > 0 |  |
| `payload.viewport.height` | integer | yes | > 0 |  |
| `payload.resumed` | boolean | yes |  |  |
| `payload.repeat_session` | boolean | yes |  | This browser already completed a session. |
| `payload.pilot_participant` | integer \| null | yes |  | `p=N` from a numbered pilot link. |
| `payload.requested_cell` | `EI-A` \| `EI-B` \| `Neutral-A` \| `Neutral-B` \| null | yes |  | `cell=` on the link. Honoured only in test runs. |

#### `consent_given`

Both consent boxes ticked and Start pressed.

*Emitted when:* consent screen (E1)

Envelope fields are omitted; see [Event envelope](#event-envelope).

| Field | Type | Req. | Constraints | Description |
|---|---|---|---|---|
| `run_mode` | `live` \| `pilot` \| `test` | yes |  | live = the real study; pilot = a pilot participant; test = a throwaway run. Only `live` enters the analysed sample; pipeline/exclusions.py removes the others before any statistic is computed. |
| `type` | `"consent_given"` | yes |  |  |
| `payload.pilot_notice_shown` | boolean | yes |  |  |

#### `screening_answered`

Screening S1-S3, for an admitted participant only. S1 asks for the age as a number, as the approved instrument words it; only its band is stored. The exact age decides eligibility in the browser and goes no further -- the project holds no exact ages (the privacy invariant in packages/schema/test/events.test.ts). Nothing about age is stored for anyone turned away.

*Emitted when:* screening S1-S3 (E2)

Envelope fields are omitted; see [Event envelope](#event-envelope).

| Field | Type | Req. | Constraints | Description |
|---|---|---|---|---|
| `run_mode` | `live` \| `pilot` \| `test` | yes |  | live = the real study; pilot = a pilot participant; test = a throwaway run. Only `live` enters the analysed sample; pipeline/exclusions.py removes the others before any statistic is computed. |
| `type` | `"screening_answered"` | yes |  |  |
| `payload.age_band` | `18-24` \| `25-34` \| `35+` | yes |  | Coarsened age of an ADMITTED participant. Recorded as a band at source; an exact age is never collected. Bands below 18 do not appear because the study does not admit anyone under 18 and does not store an age for someone it turns away. |
| `payload.english_level` | `A1-A2` \| `B1` \| `B2` \| `C1` \| `C2-native` | yes |  | Self-reported English reading level (screening S2). A1-A2 is screened out. |
| `payload.study_language` | `English` \| `Russian` \| `Kazakh` \| `Other` | yes |  | Main language of the participant's studies or work (screening S3). Covariate only. |

#### `screened_out`

Visitor turned away at screening. Nothing is allocated for them.

*Emitted when:* under 18, or English A1-A2

Envelope fields are omitted; see [Event envelope](#event-envelope).

| Field | Type | Req. | Constraints | Description |
|---|---|---|---|---|
| `run_mode` | `live` \| `pilot` \| `test` | yes |  | live = the real study; pilot = a pilot participant; test = a throwaway run. Only `live` enters the analysed sample; pipeline/exclusions.py removes the others before any statistic is computed. |
| `type` | `"screened_out"` | yes |  |  |
| `payload.reason` | `age` \| `language` | yes |  | Why a visitor was turned away. |

#### `allocation`

Cell assigned, after screening and the pre-measures.

*Emitted when:* after the pre-measures

Envelope fields are omitted; see [Event envelope](#event-envelope).

| Field | Type | Req. | Constraints | Description |
|---|---|---|---|---|
| `run_mode` | `live` \| `pilot` \| `test` | yes |  | live = the real study; pilot = a pilot participant; test = a throwaway run. Only `live` enters the analysed sample; pipeline/exclusions.py removes the others before any statistic is computed. |
| `type` | `"allocation"` | yes |  |  |
| `payload.cell` | `EI-A` \| `EI-B` \| `Neutral-A` \| `Neutral-B` | yes |  | Between-participants cell: tone x counterbalancing list. |
| `payload.tone` | `EI` \| `Neutral` | yes |  | Tutor tone, between participants. |
| `payload.list` | `A` \| `B` | yes |  | Counterbalancing list. A: odd claims strong, even weak. B: the reverse. |
| `payload.method` | `pilot_rotation` \| `forced_test` \| `main_sequence` \| `test_sequence` | yes |  | pilot_rotation: position in the pilot rotation. forced_test: `cell=` on a test link. main_sequence: the next slot of the committed main-study sequence, handed out by the server (the single public link). test_sequence: the same, from the separate test sequence. |
| `payload.pilot_position` | integer \| null | yes |  | 1-based position in the pilot sequence. |
| `payload.english_band` | `B1-B2` \| `C1-C2-native` | yes |  | English level grouped for the main study's strata. Recorded in the pilot, not stratified on. |
| `payload.sequence_index` | integer \| null | no |  | 0-based slot in the committed sequence of the participant's stratum, for main_sequence and test_sequence; null otherwise. Absent on pilot events recorded before it existed. |

#### `plan_generated`

Every per-participant random order, drawn once from a seed and logged in full.

*Emitted when:* immediately after allocation

Envelope fields are omitted; see [Event envelope](#event-envelope).

| Field | Type | Req. | Constraints | Description |
|---|---|---|---|---|
| `run_mode` | `live` \| `pilot` \| `test` | yes |  | live = the real study; pilot = a pilot participant; test = a throwaway run. Only `live` enters the analysed sample; pipeline/exclusions.py removes the others before any statistic is computed. |
| `type` | `"plan_generated"` | yes |  |  |
| `payload.seed` | integer | yes | >= 0 |  |
| `payload.lesson_order` | string[][] | yes | minItems 3, maxItems 3 |  |
| `payload.task_order` | string[][] | yes | minItems 3, maxItems 3 |  |
| `payload.attention_position` | integer | yes | >= 1, <= 5 | Position of the attention check among module 2's five mission screens. |
| `payload.option_order` | object | yes |  |  |
| `payload.quiz_order` | string[] | yes | minItems 16, maxItems 16 |  |
| `payload.quality_items` | string[] | yes | minItems 4, maxItems 4 |  |

#### `screen_viewed`

A screen was shown. Times modules and the session.

*Emitted when:* every screen

Envelope fields are omitted; see [Event envelope](#event-envelope).

| Field | Type | Req. | Constraints | Description |
|---|---|---|---|---|
| `run_mode` | `live` \| `pilot` \| `test` | yes |  | live = the real study; pilot = a pilot participant; test = a throwaway run. Only `live` enters the analysed sample; pipeline/exclusions.py removes the others before any statistic is computed. |
| `type` | `"screen_viewed"` | yes |  |  |
| `payload.screen` | string | yes |  |  |
| `payload.module` | integer \| null | yes |  |  |

#### `lesson_item`

One lesson message read; logged on Continue.

*Emitted when:* Continue under a lesson message

Envelope fields are omitted; see [Event envelope](#event-envelope).

| Field | Type | Req. | Constraints | Description |
|---|---|---|---|---|
| `run_mode` | `live` \| `pilot` \| `test` | yes |  | live = the real study; pilot = a pilot participant; test = a throwaway run. Only `live` enters the analysed sample; pipeline/exclusions.py removes the others before any statistic is computed. |
| `type` | `"lesson_item"` | yes |  |  |
| `payload.module` | integer | yes | >= 1, <= 3 | Training module, 1 to 3. |
| `payload.claim_id` | string | yes | pattern `^claim_(0[1-9]\|1[0-2])$` | claim_01 to claim_12. |
| `payload.version` | `strong` \| `weak` | yes |  | Within-participant explanation quality. |
| `payload.order_position` | integer | yes | >= 1, <= 4 |  |
| `payload.dwell_ms` | integer | yes | >= 0 | From the message appearing to Continue. |

#### `mission_answer`

A mission task answered; logged on Next.

*Emitted when:* Next on a mission task

Envelope fields are omitted; see [Event envelope](#event-envelope).

| Field | Type | Req. | Constraints | Description |
|---|---|---|---|---|
| `run_mode` | `live` \| `pilot` \| `test` | yes |  | live = the real study; pilot = a pilot participant; test = a throwaway run. Only `live` enters the analysed sample; pipeline/exclusions.py removes the others before any statistic is computed. |
| `type` | `"mission_answer"` | yes |  |  |
| `payload.module` | integer | yes | >= 1, <= 3 | Training module, 1 to 3. |
| `payload.task_id` | string | yes |  |  |
| `payload.claim_id` | string | yes | pattern `^claim_(0[1-9]\|1[0-2])$` | claim_01 to claim_12. |
| `payload.version` | `strong` \| `weak` | yes |  | How this claim was explained in the lesson. |
| `payload.choice_role` | `lesson` \| `intuitive` \| `distractor` | yes |  | What a mission option represents. Never shown to participants. |
| `payload.option_order` | `lesson` \| `intuitive` \| `distractor`[] | yes | minItems 3, maxItems 3 | Roles in the order the options were shown. |
| `payload.order_position` | integer | yes | >= 1, <= 4 |  |
| `payload.confidence` | integer | yes | >= 1, <= 4 | How sure are you? 1 Guessing, 2 Somewhat sure, 3 Sure, 4 Very sure. |
| `payload.rt_ms` | integer | yes | >= 0 | From the task appearing to Next. |

#### `attention_check`

The systems check in module 2.

*Emitted when:* systems check, module 2

Envelope fields are omitted; see [Event envelope](#event-envelope).

| Field | Type | Req. | Constraints | Description |
|---|---|---|---|---|
| `run_mode` | `live` \| `pilot` \| `test` | yes |  | live = the real study; pilot = a pilot participant; test = a throwaway run. Only `live` enters the analysed sample; pipeline/exclusions.py removes the others before any statistic is computed. |
| `type` | `"attention_check"` | yes |  |  |
| `payload.passed` | boolean | yes |  |  |
| `payload.choice` | string | yes |  |  |
| `payload.position` | integer | yes | >= 1, <= 5 |  |
| `payload.rt_ms` | integer | yes | >= 0 | Milliseconds, measured on the client. |

#### `quiz_rating`

One final-quiz statement rated.

*Emitted when:* final quiz (D3)

Envelope fields are omitted; see [Event envelope](#event-envelope).

| Field | Type | Req. | Constraints | Description |
|---|---|---|---|---|
| `run_mode` | `live` \| `pilot` \| `test` | yes |  | live = the real study; pilot = a pilot participant; test = a throwaway run. Only `live` enters the analysed sample; pipeline/exclusions.py removes the others before any statistic is computed. |
| `type` | `"quiz_rating"` | yes |  |  |
| `payload.item_id` | string | yes |  |  |
| `payload.claim_id` | string \| null | yes |  |  |
| `payload.version` | `strong` \| `weak` \| null | yes |  | How the claim was explained; null for fillers. |
| `payload.is_filler` | boolean | yes |  |  |
| `payload.rating` | integer | yes | >= 1, <= 7 | A 1-7 rating. |
| `payload.position` | integer | yes | >= 1, <= 16 |  |

#### `questionnaire_item`

One questionnaire answer.

*Emitted when:* P1-P6, E4, NCS-6, D1-D4

Envelope fields are omitted; see [Event envelope](#event-envelope).

| Field | Type | Req. | Constraints | Description |
|---|---|---|---|---|
| `run_mode` | `live` \| `pilot` \| `test` | yes |  | live = the real study; pilot = a pilot participant; test = a throwaway run. Only `live` enters the analysed sample; pipeline/exclusions.py removes the others before any statistic is computed. |
| `type` | `"questionnaire_item"` | yes |  |  |
| `payload.instrument` | `pre` \| `trust` \| `tutor` \| `ncs6` \| `demographics` | yes |  | Which questionnaire an item belongs to: P1-P3 (and P4-P6 in the pilot), trust: P4-P6 after the funnel, T/R/E, NCS-6, D1-D4. |
| `payload.item_id` | string | yes |  |  |
| `payload.value` | integer \| string | yes |  |  |

#### `funnel_answer`

One awareness-funnel answer. Empty text is recorded as empty.

*Emitted when:* awareness funnel F1-F4 (E5)

Envelope fields are omitted; see [Event envelope](#event-envelope).

| Field | Type | Req. | Constraints | Description |
|---|---|---|---|---|
| `run_mode` | `live` \| `pilot` \| `test` | yes |  | live = the real study; pilot = a pilot participant; test = a throwaway run. Only `live` enters the analysed sample; pipeline/exclusions.py removes the others before any statistic is computed. |
| `type` | `"funnel_answer"` | yes |  |  |
| `payload.item_id` | string | yes | pattern `^F[1-9]$` | F1-F4 in the pilot; F1-F5 from v3.1, where F4 asks about Nova's way of speaking and F5 is the closed question about hearing of the study beforehand. |
| `payload.text` | string | yes | maxLen 5000 |  |

#### `arg_quality_rating`

Explanation-quality check (E6).

*Emitted when:* explanation-quality check (E6)

Envelope fields are omitted; see [Event envelope](#event-envelope).

| Field | Type | Req. | Constraints | Description |
|---|---|---|---|---|
| `run_mode` | `live` \| `pilot` \| `test` | yes |  | live = the real study; pilot = a pilot participant; test = a throwaway run. Only `live` enters the analysed sample; pipeline/exclusions.py removes the others before any statistic is computed. |
| `type` | `"arg_quality_rating"` | yes |  |  |
| `payload.claim_id` | string | yes | pattern `^claim_(0[1-9]\|1[0-2])$` | claim_01 to claim_12. |
| `payload.version` | `strong` \| `weak` | yes |  | Within-participant explanation quality. |
| `payload.rating` | integer | yes | >= 1, <= 7 | A 1-7 rating. |
| `payload.position` | integer | yes | >= 1, <= 4 |  |

#### `pilot_feedback`

Pilot runs only. Blank answers record nothing.

*Emitted when:* pilot runs only (E9)

Envelope fields are omitted; see [Event envelope](#event-envelope).

| Field | Type | Req. | Constraints | Description |
|---|---|---|---|---|
| `run_mode` | `live` \| `pilot` \| `test` | yes |  | live = the real study; pilot = a pilot participant; test = a throwaway run. Only `live` enters the analysed sample; pipeline/exclusions.py removes the others before any statistic is computed. |
| `type` | `"pilot_feedback"` | yes |  |  |
| `payload.item_id` | `PF1` \| `PF2` \| `PF3` | yes |  |  |
| `payload.text` | string | yes | minLen 1, maxLen 5000 |  |

#### `session_completed`

Everything is answered; the debrief follows.

*Emitted when:* before the debrief

Envelope fields are omitted; see [Event envelope](#event-envelope).

| Field | Type | Req. | Constraints | Description |
|---|---|---|---|---|
| `run_mode` | `live` \| `pilot` \| `test` | yes |  | live = the real study; pilot = a pilot participant; test = a throwaway run. Only `live` enters the analysed sample; pipeline/exclusions.py removes the others before any statistic is computed. |
| `type` | `"session_completed"` | yes |  |  |
| `payload.total_duration_ms` | integer | yes | >= 0 | Milliseconds, measured on the client. |
| `payload.score` | integer | yes | >= 0, <= 12 | Mission tasks answered with the lesson option. |

#### `debrief_viewed`

The debrief was shown.

*Emitted when:* debrief shown (E10)

Envelope fields are omitted; see [Event envelope](#event-envelope).

| Field | Type | Req. | Constraints | Description |
|---|---|---|---|---|
| `run_mode` | `live` \| `pilot` \| `test` | yes |  | live = the real study; pilot = a pilot participant; test = a throwaway run. Only `live` enters the analysed sample; pipeline/exclusions.py removes the others before any statistic is computed. |
| `type` | `"debrief_viewed"` | yes |  |  |
| `payload.score` | integer | yes | >= 0, <= 12 |  |

#### `withdrawal_requested`

Remove my data. Every export and script drops the participant entirely.

*Emitted when:* Remove my data

Envelope fields are omitted; see [Event envelope](#event-envelope).

| Field | Type | Req. | Constraints | Description |
|---|---|---|---|---|
| `run_mode` | `live` \| `pilot` \| `test` | yes |  | live = the real study; pilot = a pilot participant; test = a throwaway run. Only `live` enters the analysed sample; pipeline/exclusions.py removes the others before any statistic is computed. |
| `type` | `"withdrawal_requested"` | yes |  |  |
| `payload.at_screen` | string | yes |  |  |

## Transport

What the client sends to the ingest service.

#### `EventBatch`

A batch of events flushed from the client write-ahead log. Idempotent on event_id, so retries are safe.

| Field | Type | Req. | Constraints | Description |
|---|---|---|---|---|
| `events` | any[] | yes | minItems 1, maxItems 500 |  |

#### `IngestBatch`

A batch of events flushed from the client write-ahead log, from either study family. Idempotent on event_id.

| Field | Type | Req. | Constraints | Description |
|---|---|---|---|---|
| `events` | any[] | yes | minItems 1, maxItems 500 |  |

## Item bank and stimuli

materials/items.json and the frozen response set. Hash-manifested before collection opens so alteration is detectable.

#### `ItemBank`

materials/items.json in full. Validated in CI, so a malformed bank fails the build rather than a pilot.

| Field | Type | Req. | Constraints | Description |
|---|---|---|---|---|
| `schema_version` | string | yes | minLen 1 |  |
| `study` | `"eiai-study3"` | yes |  |  |
| `source_spec` | string | yes | minLen 1 |  |
| `compiled_at` | string(date) | yes | pattern `^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))$` |  |
| `design` | object | yes |  |  |
| `design.languages` | `en`[] | yes | minItems 1 |  |
| `design.conditions` | `warm` \| `neutral`[] | yes | minItems 1 |  |
| `design.registers` | `LOW` \| `MODERATE` \| `HIGH`[] | yes | minItems 1 |  |
| `design.register_thresholds` | object | yes |  |  |
| `design.register_thresholds.low_below` | number | yes |  |  |
| `design.register_thresholds.high_above` | number | yes |  |  |
| `design.item_order_randomised_per_participant` | boolean | yes |  |  |
| `design.error_item_ids` | string[] | yes |  |  |
| `translation_status` | object | yes |  |  |
| `translation_status.en` | string | yes | minLen 1 |  |
| `translation_status.ru` | string | yes | minLen 1 |  |
| `translation_status.kk` | string | yes | minLen 1 |  |
| `translation_status.note` | string | yes | minLen 1 |  |
| `items` | object[] | yes | minItems 12, maxItems 12 |  |
| `review_required` | object[] | yes |  |  |

#### `ItemRecord`

One item bank entry.

| Field | Type | Req. | Constraints | Description |
|---|---|---|---|---|
| `id` | string | yes | pattern `^item_(0[1-9]\|1[0-2])$` | Item bank identifier, item_01 through item_12. |
| `index` | integer | yes | >= 1, <= 12 | Canonical item number from the spec table. |
| `question` | object | yes |  | Question stem per language. Non-English stems are drafts until back-translation clears. |
| `question.en` | string | yes | minLen 1 |  |
| `question.ru` | string | yes | minLen 1 |  |
| `question.kk` | string | yes | minLen 1 |  |
| `unit` | object | yes |  | Unit of the numeric answer. |
| `unit.symbol` | string | yes | minLen 1 |  |
| `unit.en` | string | yes | minLen 1 |  |
| `unit.ru` | string | yes | minLen 1 |  |
| `unit.kk` | string | yes | minLen 1 |  |
| `true_value` | number | yes |  | Best documented value, used for the debrief and the WOA denominator guard. |
| `true_value_note` | string \| null | yes |  | Precision, CI, or scope qualification on the true value. |
| `advice_value` | number | yes |  | The value the AI states. Differs from truth on error items. |
| `is_error` | boolean | yes |  |  |
| `topic` | `bathymetry` \| `diving_physiology` \| `optics` \| `hydrothermal` \| `taxonomy` \| `life_history` \| `physical_oceanography` | yes |  | Sub-domain of deep-sea biology the item asks about. A classification of the question stems, not a property carried by the cited sources. Exists so that topic diversity within each justification-quality cell is machine-checkable: a cell drawn entirely from one sub-domain would confound justification quality with subject-matter familiarity. |
| `plausible_answer_range` | [number, number] | yes |  | Sanity bounds for the estimate input. Not a correctness check. |
| `justifications` | object | yes |  | Word-count-matched justification pair. Only reasoning quality varies; no factual content differs. |
| `justifications.strong` | object | yes |  | Method-referencing and in principle checkable. Names how the figure was obtained. |
| `justifications.strong.text` | string | yes | minLen 1 |  |
| `justifications.strong.word_count` | integer | yes | > 0 |  |
| `justifications.weak` | object | yes |  | Circular appeal to consensus. Fluent, contentless, and adds no support for the claim. |
| `justifications.weak.text` | string | yes | minLen 1 |  |
| `justifications.weak.word_count` | integer | yes | > 0 |  |
| `sources` | object[] | yes | minItems 1 |  |
| `volatile` | boolean | yes |  | True when the value moves over time and must be re-verified immediately before launch. |
| `flags` | object[] | yes |  |  |

#### `QualityAssignment`

materials/quality_assignment.json. The single source of truth for justification-quality allocation; the item bank carries neither the quality nor the design cell.

| Field | Type | Req. | Constraints | Description |
|---|---|---|---|---|
| `schema_version` | string | yes | minLen 1 |  |
| `study` | `"eiai-study3"` | yes |  |  |
| `source` | string | yes | minLen 1 |  |
| `note` | string | yes | minLen 1 |  |
| `roles` | object | yes |  |  |
| `roles.analysed` | string | yes | minLen 1 |  |
| `roles.filler` | string | yes | minLen 1 |  |
| `assignment` | object | yes |  |  |

#### `JustificationPair`

Word-count-matched justification pair. Only reasoning quality varies; no factual content differs.

| Field | Type | Req. | Constraints | Description |
|---|---|---|---|---|
| `strong` | object | yes |  | Method-referencing and in principle checkable. Names how the figure was obtained. |
| `strong.text` | string | yes | minLen 1 |  |
| `strong.word_count` | integer | yes | > 0 |  |
| `weak` | object | yes |  | Circular appeal to consensus. Fluent, contentless, and adds no support for the claim. |
| `weak.text` | string | yes | minLen 1 |  |
| `weak.word_count` | integer | yes | > 0 |  |

#### `StimulusFile`

One materials/responses/{lang}_{condition}_{state}.json file. Carries no timestamp: its bytes must be stable across runs or the hash manifest means nothing.

| Field | Type | Req. | Constraints | Description |
|---|---|---|---|---|
| `meta` | object | yes |  |  |
| `meta.schema_version` | string | yes | minLen 1 |  |
| `meta.study` | `"eiai-study3"` | yes |  |  |
| `meta.language` | `en` | yes |  | Active study language. English only under spec v2; the Russian and Kazakh sets are in archive/ and are not in the active manifest, so nothing can serve them. |
| `meta.condition` | `warm` \| `neutral` | yes |  | Between-subjects emotional style condition. |
| `meta.register_state` | `LOW` \| `MODERATE` \| `HIGH` \| null | yes |  |  |
| `meta.generator` | string | yes | minLen 1 |  |
| `meta.generator_version` | string | yes | minLen 1 |  |
| `meta.generator_mode` | `live_api` \| `offline_placeholder` | yes |  | How a stimulus set was produced. Placeholder sets are structurally valid but must never be fielded. Was 'anthropic_api', which named the wrong thing: generation runs against whichever OpenAI-compatible provider is configured, and the provider is recorded separately. |
| `meta.provider` | string | yes | minLen 1 | Which configured provider served the generation. Recorded because the model id alone is ambiguous: 'openai/gpt-oss-120b' is served by Groq and reads as though it came from OpenAI. |
| `meta.model` | string | yes | minLen 1 |  |
| `meta.placeholder` | boolean | yes |  |  |
| `meta.prompt_hashes` | object | yes |  |  |
| `meta.translation_status` | string | yes | minLen 1 |  |
| `meta.human_verification` | object | yes |  |  |
| `meta.human_verification.content_equivalence_checked` | boolean | yes |  |  |
| `meta.human_verification.component_coding_completed` | boolean | yes |  |  |
| `meta.human_verification.back_translation_completed` | boolean | yes |  |  |
| `meta.human_verification.native_speaker_verified` | boolean | yes |  |  |
| `responses` | object[] | yes | minItems 12, maxItems 12 |  |

#### `StimulusResponse`

One frozen, hash-manifested stimulus.

| Field | Type | Req. | Constraints | Description |
|---|---|---|---|---|
| `response_id` | string | yes | pattern `^[a-z]{2}_(warm\|neutral)_(low\|moderate\|high\|na)_item_(0[1-9]\|1[0-2])$` | Frozen stimulus identifier: {lang}_{condition}_{register}_{item}. Resolves to exactly one hash-manifested response file. |
| `item_id` | string | yes | pattern `^item_(0[1-9]\|1[0-2])$` | Item bank identifier, item_01 through item_12. |
| `language` | `en` | yes |  | Active study language. English only under spec v2; the Russian and Kazakh sets are in archive/ and are not in the active manifest, so nothing can serve them. |
| `condition` | `warm` \| `neutral` | yes |  | Between-subjects emotional style condition. |
| `register_state` | `LOW` \| `MODERATE` \| `HIGH` \| null | yes |  | Null for the neutral condition, which does not branch. |
| `body` | string | yes | minLen 1 | The AI reply as displayed, excluding the justification sentence. |
| `justification_quality` | `strong` \| `weak` | yes |  | Within-subjects justification quality factor. Strong = method-referencing; weak = circular appeal to consensus. |
| `justification_text` | string | yes | minLen 1 | Rendered once per (language, item) and reused across all four condition variants, so it is byte-identical across conditions by construction. Displayed as its own element because scroll depth on it is the H4 mediator. |
| `followups` | object | yes |  | Pre-written replies to the three fixed follow-ups. The challenge reply must hold the stated value in both conditions. |
| `followups.measurement` | string | yes | minLen 1 |  |
| `followups.certainty` | string | yes | minLen 1 |  |
| `followups.challenge` | string | yes | minLen 1 |  |
| `placeholder` | boolean | yes |  | True for offline-generated placeholders. Guards against a placeholder set reaching participants. |
| `sha256` | string | yes | pattern `^[a-f0-9]{64}$` | Digest over body + justification + the three follow-ups. |
| `validation` | object | yes |  | Generation-time validation result, retained as provenance. |
| `validation.ok` | boolean | yes |  |  |
| `validation.errors` | string[] | yes |  |  |
| `validation.warnings` | string[] | yes |  |  |
| `attempts_used` | integer | yes | >= 0 |  |

#### `StimulusManifest`

Committed before collection opens. CI recomputes it and fails on any drift.

| Field | Type | Req. | Constraints | Description |
|---|---|---|---|---|
| `generated_at` | string(date-time) | yes | pattern `^(?:(?:\d\d[2468][048]\|\d\d[13579][26]\|\d\d0[48]\|[02468][048]00\|[13579][26]00)-02-29\|\d{4}-(?:(?:0[13578]\|1[02])-(?:0[1-9]\|[12]\d\|3[01])\|(?:0[469]\|11)-(?:0[1-9]\|[12]\d\|30)\|(?:02)-(?:0[1-9]\|1\d\|2[0-8])))T(?:(?:[01]\d\|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z))$` |  |
| `generator_version` | string | yes | minLen 1 |  |
| `generator_mode` | `live_api` \| `offline_placeholder` | yes |  | How a stimulus set was produced. Placeholder sets are structurally valid but must never be fielded. Was 'anthropic_api', which named the wrong thing: generation runs against whichever OpenAI-compatible provider is configured, and the provider is recorded separately. |
| `provider` | string | yes | minLen 1 |  |
| `model` | string | yes | minLen 1 |  |
| `launch_ready` | boolean | yes |  | True only when the stimuli are real AND a person has confirmed reading them. The loader refuses to serve a set with this false. Two conditions rather than one: it was previously computed from the placeholder flag alone, so it would have flipped to true the moment generation replaced the placeholders, with nobody having read a sentence. |
| `hand_verified` | boolean | yes |  | Whether materials/hand_verification.json records an approval of exactly this manifest_sha256. Regenerating any cell changes the digest and lapses the approval, because it no longer describes the texts on disk. |
| `items_file_sha256` | string | yes | pattern `^[a-f0-9]{64}$` | Lowercase hex SHA-256 digest. |
| `manifest_sha256` | string | yes | pattern `^[a-f0-9]{64}$` | Digest over the sorted per-file digests. This is what SESSION_STARTED records. |
| `files` | object[] | yes |  |  |

## Questionnaire

Manipulation check, control check, trust, covariates, and the funnelled suspicion probe.

#### `QuestionnaireResponse`

A complete questionnaire submission, assembled by replay from QUESTIONNAIRE_ANSWERED and FUNNEL_RESPONSE events.

| Field | Type | Req. | Constraints | Description |
|---|---|---|---|---|
| `warmth` | object | yes |  | Manipulation check, 5 items. Analysed within each language group separately, never pooled silently. |
| `warmth.warmth_01` | integer | yes | >= 1, <= 7 | Seven-point Likert response. |
| `warmth.warmth_02` | integer | yes | >= 1, <= 7 | Seven-point Likert response. |
| `warmth.warmth_03` | integer | yes | >= 1, <= 7 | Seven-point Likert response. |
| `warmth.warmth_04` | integer | yes | >= 1, <= 7 | Seven-point Likert response. |
| `warmth.warmth_05` | integer | yes | >= 1, <= 7 | Seven-point Likert response. |
| `competence` | object | yes |  | Control check, 4 items. Should NOT differ by condition. Reported either way. |
| `competence.competence_01` | integer | yes | >= 1, <= 7 | Seven-point Likert response. |
| `competence.competence_02` | integer | yes | >= 1, <= 7 | Seven-point Likert response. |
| `competence.competence_03` | integer | yes | >= 1, <= 7 | Seven-point Likert response. |
| `competence.competence_04` | integer | yes | >= 1, <= 7 | Seven-point Likert response. |
| `trust` | object | yes |  | Trust in the assistant, 4 items. H5 predicts warm > neutral. |
| `trust.trust_01` | integer | yes | >= 1, <= 7 | Seven-point Likert response. |
| `trust.trust_02` | integer | yes | >= 1, <= 7 | Seven-point Likert response. |
| `trust.trust_03` | integer | yes | >= 1, <= 7 | Seven-point Likert response. |
| `trust.trust_04` | integer | yes | >= 1, <= 7 | Seven-point Likert response. |
| `covariates` | object | yes |  | Covariates for the ANCOVA model. |
| `covariates.age_band` | `18-24` \| `25-34` \| `35+` | yes |  | Coarsened age of an ADMITTED participant. Recorded as a band at source; an exact age is never collected. Bands below 18 do not appear because the study does not admit anyone under 18 and does not store an age for someone it turns away. |
| `covariates.gender` | `female` \| `male` \| `other` \| `prefer_not_to_say` | yes |  |  |
| `covariates.primary_language` | `en` | yes |  | Active study language. English only under spec v2; the Russian and Kazakh sets are in archive/ and are not in the active manifest, so nothing can serve them. |
| `covariates.ai_usage_frequency` | integer | yes | >= 1, <= 5 | Self-reported frequency of AI assistant use. |
| `covariates.prior_knowledge_marine_biology` | integer | yes | >= 1, <= 7 | Self-rated prior knowledge. Screening excludes formal training. |
| `funnel` | object | yes |  | Funnelled suspicion probe, administered in order without backtracking. |
| `funnel.purpose` | string | yes |  | "What do you think this study was about?" — free text. |
| `funnel.anomaly` | string | yes |  | "Did anything about the assistant's answers seem unusual?" — free text. |
| `funnel.belief` | `yes` \| `no` \| `unsure` | yes |  | "Did you believe all of the assistant's answers were accurate?" |

#### `PerceivedWarmthScale`

Manipulation check, 5 items. Analysed within each language group separately, never pooled silently.

| Field | Type | Req. | Constraints | Description |
|---|---|---|---|---|
| `warmth_01` | integer | yes | >= 1, <= 7 | Seven-point Likert response. |
| `warmth_02` | integer | yes | >= 1, <= 7 | Seven-point Likert response. |
| `warmth_03` | integer | yes | >= 1, <= 7 | Seven-point Likert response. |
| `warmth_04` | integer | yes | >= 1, <= 7 | Seven-point Likert response. |
| `warmth_05` | integer | yes | >= 1, <= 7 | Seven-point Likert response. |

#### `PerceivedCompetenceScale`

Control check, 4 items. Should NOT differ by condition. Reported either way.

| Field | Type | Req. | Constraints | Description |
|---|---|---|---|---|
| `competence_01` | integer | yes | >= 1, <= 7 | Seven-point Likert response. |
| `competence_02` | integer | yes | >= 1, <= 7 | Seven-point Likert response. |
| `competence_03` | integer | yes | >= 1, <= 7 | Seven-point Likert response. |
| `competence_04` | integer | yes | >= 1, <= 7 | Seven-point Likert response. |

#### `TrustScale`

Trust in the assistant, 4 items. H5 predicts warm > neutral.

| Field | Type | Req. | Constraints | Description |
|---|---|---|---|---|
| `trust_01` | integer | yes | >= 1, <= 7 | Seven-point Likert response. |
| `trust_02` | integer | yes | >= 1, <= 7 | Seven-point Likert response. |
| `trust_03` | integer | yes | >= 1, <= 7 | Seven-point Likert response. |
| `trust_04` | integer | yes | >= 1, <= 7 | Seven-point Likert response. |

#### `Covariates`

Covariates for the ANCOVA model.

| Field | Type | Req. | Constraints | Description |
|---|---|---|---|---|
| `age_band` | `18-24` \| `25-34` \| `35+` | yes |  | Coarsened age of an ADMITTED participant. Recorded as a band at source; an exact age is never collected. Bands below 18 do not appear because the study does not admit anyone under 18 and does not store an age for someone it turns away. |
| `gender` | `female` \| `male` \| `other` \| `prefer_not_to_say` | yes |  |  |
| `primary_language` | `en` | yes |  | Active study language. English only under spec v2; the Russian and Kazakh sets are in archive/ and are not in the active manifest, so nothing can serve them. |
| `ai_usage_frequency` | integer | yes | >= 1, <= 5 | Self-reported frequency of AI assistant use. |
| `prior_knowledge_marine_biology` | integer | yes | >= 1, <= 7 | Self-rated prior knowledge. Screening excludes formal training. |

#### `FunnelProbe`

Funnelled suspicion probe, administered in order without backtracking.

| Field | Type | Req. | Constraints | Description |
|---|---|---|---|---|
| `purpose` | string | yes |  | "What do you think this study was about?" — free text. |
| `anomaly` | string | yes |  | "Did anything about the assistant's answers seem unusual?" — free text. |
| `belief` | `yes` \| `no` \| `unsure` | yes |  | "Did you believe all of the assistant's answers were accurate?" |

## Enumerations

| Enumeration | Values | Meaning |
|---|---|---|
| `Language` | `en` | Active study language. English only under spec v2; the Russian and Kazakh sets are in archive/ and are not in the active manifest, so nothing can serve them. |
| `Condition` | `warm`, `neutral` | Between-subjects emotional style condition. |
| `RegisterState` | `LOW`, `MODERATE`, `HIGH` | Register selected by initial confidence (LOW < 40, MODERATE 40-70, HIGH > 70). Warm condition only; neutral does not branch. |
| `JustificationQuality` | `strong`, `weak` | Within-subjects justification quality factor. Strong = method-referencing; weak = circular appeal to consensus. |
| `AgeGroup` | `adult` | Age group of an admitted participant. Only adults are admitted (spec v2 §1), so this has one value; it is kept as an enum because the stratum key is still built from it. |
| `AgeScreenAnswer` | `under-18`, `18-24`, `25-34`, `35+` | What the eligibility screen offers. Wider than AgeBand by exactly one option, because the screen has to let someone say they are under 18 in order to turn them away. 'under-18' is never stored: it routes to the screening exit and the session records only the reason. |
| `AgeBand` | `18-24`, `25-34`, `35+` | Coarsened age of an ADMITTED participant. Recorded as a band at source; an exact age is never collected. Bands below 18 do not appear because the study does not admit anyone under 18 and does not store an age for someone it turns away. |
| `Stratum` | string | Randomisation stratum id, drawn from materials/strata.json. Two under spec v2: B1-B2 and C1-C2/native. |
| `ScreenedOutReason` | `age`, `language`, `prior_training` | Why a visitor was turned away before consent. This is the ONLY thing a screened-out visitor contributes: no age, no answers, no session (spec v2 §3). It exists so the participant-flow diagram can report screening counts. |
| `CefrLevel` | `A1`, `A2`, `B1`, `B2`, `C1`, `C2` | Self-reported Common European Framework level for English. Self-report, not a test: it is a screening instrument and a covariate, and the paper says so. |
| `StudyWorkLanguage` | `english`, `other` | Whether the participant's study or work is conducted in English. A covariate that characterises the sample, NOT a gate: someone who reads English well but works in another language is still admitted. |
| `EstimatePhase` | `initial`, `final` | Whether an estimate or confidence reading was taken before or after the AI response. |
| `FollowupId` | `measurement`, `certainty`, `challenge` | Fixed follow-up options. 'challenge' ("I think that might be wrong") is itself a behavioural measure. |
| `FunnelStage` | `purpose`, `anomaly`, `belief` | Funnelled suspicion probe stage, administered in this order without backtracking. |
| `QuestionnaireScale` | `warmth`, `competence`, `trust`, `covariates` | Which questionnaire instrument an answer belongs to. |
| `GeneratorMode` | `live_api`, `offline_placeholder` | How a stimulus set was produced. Placeholder sets are structurally valid but must never be fielded. Was 'anthropic_api', which named the wrong thing: generation runs against whichever OpenAI-compatible provider is configured, and the provider is recorded separately. |
| `ItemRole` | `analysed`, `filler` | Whether an item enters the justification-quality contrast, or exists only to keep planted errors at 33% of twelve rather than 50% of eight. |
| `ItemTopic` | `bathymetry`, `diving_physiology`, `optics`, `hydrothermal`, `taxonomy`, `life_history`, `physical_oceanography` | Sub-domain of deep-sea biology the item asks about. A classification of the question stems, not a property carried by the cited sources. Exists so that topic diversity within each justification-quality cell is machine-checkable: a cell drawn entirely from one sub-domain would confound justification quality with subject-matter familiarity. |
| `Tone (v3)` | `EI`, `Neutral` | Tutor tone, between participants. |
| `ExplanationList (v3)` | `A`, `B` | Counterbalancing list. A: odd claims strong, even weak. B: the reverse. |
| `Cell (v3)` | `EI-A`, `EI-B`, `Neutral-A`, `Neutral-B` | Between-participants cell: tone x counterbalancing list. |
| `ExplanationVersion (v3)` | `strong`, `weak` | Within-participant explanation quality. |
| `ChoiceRole (v3)` | `lesson`, `intuitive`, `distractor` | What a mission option represents. Never shown to participants. |
| `EnglishLevel (v3)` | `A1-A2`, `B1`, `B2`, `C1`, `C2-native` | Self-reported English reading level (screening S2). A1-A2 is screened out. |
| `EnglishBand (v3)` | `B1-B2`, `C1-C2-native` | English level grouped for the main study's strata. Recorded in the pilot, not stratified on. |
| `StudyLanguage (v3)` | `English`, `Russian`, `Kazakh`, `Other` | Main language of the participant's studies or work (screening S3). Covariate only. |
| `ScreenedOutReason (v3)` | `age`, `language` | Why a visitor was turned away. |
| `AllocationMethod (v3)` | `pilot_rotation`, `forced_test`, `main_sequence`, `test_sequence` | pilot_rotation: position in the pilot rotation. forced_test: `cell=` on a test link. main_sequence: the next slot of the committed main-study sequence, handed out by the server (the single public link). test_sequence: the same, from the separate test sequence. |
| `QuestionnaireInstrument (v3)` | `pre`, `trust`, `tutor`, `ncs6`, `demographics` | Which questionnaire an item belongs to: P1-P3 (and P4-P6 in the pilot), trust: P4-P6 after the funnel, T/R/E, NCS-6, D1-D4. |
