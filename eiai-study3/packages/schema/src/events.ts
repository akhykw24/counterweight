import { z } from "zod";
import {
  ClientTimestamp,
  Condition,
  Confidence,
  ScreenedOutReason,
  DurationMs,
  Estimate,
  EstimatePhase,
  EventId,
  FollowupId,
  FunnelStage,
  ItemId,
  Language,
  QuestionnaireScale,
  RegisterState,
  ResponseId,
  ScrollFraction,
  Seq,
  SessionId,
  Sha256,
  Stratum,
} from "./primitives.js";

/**
 * The event taxonomy (STUDY3_SPEC_v3.md section 3).
 *
 * The log is append-only and immutable. Every analytic table in the paper is a
 * projection computed by replaying these events, so a measure that is not
 * captured here cannot be recovered later. Adding an event type is cheap;
 * discovering a missing one after collection is not.
 */

/** Fields carried by every event regardless of type. */
export const eventEnvelopeShape = {
  event_id: EventId,
  session_id: SessionId,
  seq: Seq,
  client_ts: ClientTimestamp,
} as const;

export const EventEnvelope = z.strictObject(eventEnvelopeShape);

function defineEvent<TType extends string, TShape extends z.ZodRawShape>(
  type: TType,
  description: string,
  payload: TShape,
) {
  return z
    .strictObject({
      ...eventEnvelopeShape,
      type: z.literal(type),
      payload: z.strictObject(payload),
    })
    .describe(description);
}

export const SessionStarted = defineEvent(
  "SESSION_STARTED",
  "First load, and again on resume after a crash. The manifest hash pins which frozen stimulus set this participant actually saw.",
  {
    app_version: z.string().min(1).describe("Build identifier of the study app."),
    stimuli_manifest_hash: Sha256.describe(
      "SHA-256 of the stimulus manifest in force for this session. Lets you prove post hoc that stimuli were unaltered.",
    ),
    viewport: z
      .strictObject({
        width: z.int().positive(),
        height: z.int().positive(),
      })
      .describe("Viewport in CSS pixels. Scroll-depth measures are only interpretable relative to this."),
    resumed: z
      .boolean()
      .describe("True when continuing an interrupted session. Pre-registered as an exclusion candidate."),
  },
);

export const ScreenedOut = defineEvent(
  "SCREENED_OUT",
  "A visitor was turned away before consent. This is the only event such a session produces: no age band, no answers, no allocation. It exists so screening counts can be reported in the participant-flow diagram without storing anything about the person.",
  { reason: ScreenedOutReason },
);

export const ConsentGiven = defineEvent(
  "CONSENT_GIVEN",
  "Adult informed consent. Carries no flow discriminator: v2 admits adults only, so there is one flow and naming it would only invite the literal to drift from the participant.",
  {},
);

export const Allocated = defineEvent(
  "ALLOCATED",
  "Condition assignment, drawn from the pre-computed seeded sequence so the allocation list is auditable after the fact.",
  {
    condition: Condition,
    stratum: Stratum,
    allocation_seq: z.int().nonnegative().describe("Index into the committed allocation sequence."),
  },
);

export const ItemPresented = defineEvent(
  "ITEM_PRESENTED",
  "Item screen mounted. Start of the reaction-time clock for this trial.",
  {
    item_id: ItemId,
    position: z.int().min(1).max(12).describe("Presentation position, 1-12. Order is randomized per participant."),
  },
);

export const EstimateChanged = defineEvent(
  "ESTIMATE_CHANGED",
  "Every intermediate estimate value, not just the submitted one. This is what makes trajectory analysis possible and it cannot be reconstructed later.",
  {
    item_id: ItemId,
    phase: EstimatePhase,
    value: Estimate,
    ms_since_present: DurationMs,
  },
);

export const ConfidenceSet = defineEvent(
  "CONFIDENCE_SET",
  "Confidence reading. The initial-phase value is the input to the register function.",
  {
    item_id: ItemId,
    phase: EstimatePhase,
    value: Confidence,
  },
);

export const ResponseRevealed = defineEvent(
  "RESPONSE_REVEALED",
  "AI reply shown. Records which frozen stimulus was served and, in the warm condition, which register the FSM entered.",
  {
    item_id: ItemId,
    response_id: ResponseId,
    register_state: RegisterState.nullable().describe(
      "Null in the neutral condition, which does not branch — non-branching is constitutive of the neutral control, not an oversight.",
    ),
  },
);

export const ResponseScrolled = defineEvent(
  "RESPONSE_SCROLLED",
  "Deepest scroll reached within the AI reply. Mediator variable for H4: if warm-condition participants never scroll to the justification, peripheral-route processing is caught in the act.",
  {
    item_id: ItemId,
    max_scroll_fraction: ScrollFraction,
  },
);

export const FollowupSelected = defineEvent(
  "FOLLOWUP_SELECTED",
  "One of three fixed follow-ups tapped. Selecting 'challenge' is a behavioural vigilance measure in its own right.",
  {
    item_id: ItemId,
    followup_id: FollowupId,
    ms_since_reveal: DurationMs,
  },
);

export const VerifyClicked = defineEvent(
  "VERIFY_CLICKED",
  "The 'check this claim' button. Opens nothing; records verification intent only.",
  {
    item_id: ItemId,
    ms_since_reveal: DurationMs,
  },
);

export const WindowBlurred = defineEvent(
  "WINDOW_BLURRED",
  "Tab or window lost focus. Proxy for external verification. Behavioural monitoring — must be named explicitly in the consent form.",
  {
    item_id: ItemId.nullable().describe("Item on screen at blur, or null outside the item loop."),
    ms_since_session_start: DurationMs,
  },
);

export const WindowFocused = defineEvent(
  "WINDOW_FOCUSED",
  "Focus returned. Paired with the preceding blur to give an away-duration.",
  {
    item_id: ItemId.nullable(),
    ms_since_session_start: DurationMs,
    away_duration_ms: DurationMs,
  },
);

export const EstimateFinalized = defineEvent(
  "ESTIMATE_FINALIZED",
  "Final estimate submitted for a trial. Numerator of Weight of Advice.",
  {
    item_id: ItemId,
    value: Estimate,
    revision_count: z
      .int()
      .nonnegative()
      .describe("Number of ESTIMATE_CHANGED events in the final phase before submit. Indexes uncertainty in the revision itself."),
    ms_since_reveal: DurationMs,
  },
);

export const QuestionnaireAnswered = defineEvent(
  "QUESTIONNAIRE_ANSWERED",
  "One questionnaire item. Emitted per item rather than per scale so partial completion is still analysable.",
  {
    scale: QuestionnaireScale,
    question_id: z.string().min(1).describe("Stable question identifier, e.g. warmth_01."),
    value: z.union([z.int(), z.string()]).describe("Likert integer, or a string for categorical covariates such as age band."),
  },
);

export const FunnelResponse = defineEvent(
  "FUNNEL_RESPONSE",
  "Funnelled suspicion probe. Free text at stages 'purpose' and 'anomaly'; the 'belief' stage is a three-way choice.",
  {
    stage: FunnelStage,
    text: z.string().describe("Verbatim free-text response, or the selected option at the belief stage."),
  },
);

export const SessionCompleted = defineEvent(
  "SESSION_COMPLETED",
  "Participant reached the debrief and finished.",
  {
    total_duration_ms: DurationMs,
  },
);

export const SessionWithdrawn = defineEvent(
  "SESSION_WITHDRAWN",
  "Withdrawal, reachable from every screen. Events already logged still count up to this point unless the participant requests deletion.",
  {
    reason: z.string().nullable().describe("Optional free-text reason. Null when the participant declined to give one."),
    at_state: z.string().min(1).describe("Statechart state the participant withdrew from."),
  },
);

/** Every event type, in taxonomy order. */
export const eventSchemas = [
  SessionStarted,
  ScreenedOut,
  ConsentGiven,
  Allocated,
  ItemPresented,
  EstimateChanged,
  ConfidenceSet,
  ResponseRevealed,
  ResponseScrolled,
  FollowupSelected,
  VerifyClicked,
  WindowBlurred,
  WindowFocused,
  EstimateFinalized,
  QuestionnaireAnswered,
  FunnelResponse,
  SessionCompleted,
  SessionWithdrawn,
] as const;

export const StudyEvent = z.discriminatedUnion("type", [
  SessionStarted,
  ScreenedOut,
  ConsentGiven,
  Allocated,
  ItemPresented,
  EstimateChanged,
  ConfidenceSet,
  ResponseRevealed,
  ResponseScrolled,
  FollowupSelected,
  VerifyClicked,
  WindowBlurred,
  WindowFocused,
  EstimateFinalized,
  QuestionnaireAnswered,
  FunnelResponse,
  SessionCompleted,
  SessionWithdrawn,
]);

/** What the client POSTs to the ingest service. */
export const EventBatch = z
  .strictObject({
    events: z.array(StudyEvent).min(1).max(500),
  })
  .describe("A batch of events flushed from the client write-ahead log. Idempotent on event_id, so retries are safe.");

export type StudyEvent = z.infer<typeof StudyEvent>;
export type EventBatch = z.infer<typeof EventBatch>;
export type EventType = StudyEvent["type"];
