import { z } from "zod";
import { AgeBand, ClientTimestamp, EventId, RunMode, Seq, SessionId, Sha256 } from "./primitives.js";

/**
 * The v3 event taxonomy: Mars Mission Training (docs/spec/v3/SPEC.md).
 *
 * A separate family from the deep-sea events rather than an extension of
 * them. The two designs share almost no measures, and the v2 pilot's data is
 * still on the server; a v3 event that validated as a v2 one, or the reverse,
 * would let a projection read one study's rows as the other's. Lower-case
 * type names keep the two families visibly apart in every export.
 *
 * Every event carries the participant, the session, the kind of run and --
 * from allocation onwards -- the cell, so no row has to be joined to another
 * before it can be interpreted.
 */

// ---------------------------------------------------------------------------
// Vocabularies
// ---------------------------------------------------------------------------

export const Tone = z.enum(["EI", "Neutral"]).describe("Tutor tone, between participants.");
export const ExplanationList = z
  .enum(["A", "B"])
  .describe("Counterbalancing list. A: odd claims strong, even weak. B: the reverse.");
export const Cell = z
  .enum(["EI-A", "EI-B", "Neutral-A", "Neutral-B"])
  .describe("Between-participants cell: tone x counterbalancing list.");
export const ExplanationVersion = z.enum(["strong", "weak"]).describe("Within-participant explanation quality.");
export const ChoiceRole = z
  .enum(["lesson", "intuitive", "distractor"])
  .describe("What a mission option represents. Never shown to participants.");
export const ClaimId = z
  .string()
  .regex(/^claim_(0[1-9]|1[0-2])$/)
  .describe("claim_01 to claim_12.");
export const Module = z.int().min(1).max(3).describe("Training module, 1 to 3.");
export const EnglishLevel = z
  .enum(["A1-A2", "B1", "B2", "C1", "C2-native"])
  .describe("Self-reported English reading level (screening S2). A1-A2 is screened out.");
export const EnglishBand = z
  .enum(["B1-B2", "C1-C2-native"])
  .describe("English level grouped for the main study's strata. Recorded in the pilot, not stratified on.");
export const StudyLanguageV3 = z
  .enum(["English", "Russian", "Kazakh", "Other"])
  .describe("Main language of the participant's studies or work (screening S3). Covariate only.");
export const V3ScreenedOutReason = z.enum(["age", "language"]).describe("Why a visitor was turned away.");
export const AllocationMethod = z
  .enum(["pilot_rotation", "forced_test", "main_sequence", "test_sequence"])
  .describe(
    "pilot_rotation: position in the pilot rotation. forced_test: `cell=` on a test link. main_sequence: the next slot of the committed main-study sequence, handed out by the server (the single public link). test_sequence: the same, from the separate test sequence.",
  );
export const QuestionnaireInstrument = z
  .enum(["pre", "trust", "tutor", "ncs6", "demographics"])
  .describe("Which questionnaire an item belongs to: P1-P3 (and P4-P6 in the pilot), trust: P4-P6 after the funnel, T/R/E, NCS-6, D1-D4.");
export const Confidence4 = z.int().min(1).max(4).describe("How sure are you? 1 Guessing, 2 Somewhat sure, 3 Sure, 4 Very sure.");
export const Rating7 = z.int().min(1).max(7).describe("A 1-7 rating.");
export const Milliseconds = z.int().nonnegative().describe("Milliseconds, measured on the client.");

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

export const v3EnvelopeShape = {
  event_id: EventId,
  session_id: SessionId,
  participant_id: z
    .uuid()
    .describe("Per-browser identifier, kept across sessions in local storage. Detects repeat participation; not linked to any person."),
  seq: Seq,
  client_ts: ClientTimestamp,
  run_mode: RunMode,
  cell: Cell.nullable().describe("The participant's cell. Null before allocation."),
} as const;

function defineV3<TType extends string, TShape extends z.ZodRawShape>(
  type: TType,
  description: string,
  payload: TShape,
) {
  return z
    .strictObject({
      ...v3EnvelopeShape,
      type: z.literal(type),
      payload: z.strictObject(payload),
    })
    .describe(description);
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export const V3SessionStarted = defineV3(
  "session_started",
  "First load of a session, and again on every resume.",
  {
    study_version: z.literal("v3"),
    app_version: z.string(),
    stimuli_manifest_hash: Sha256,
    viewport: z.strictObject({ width: z.int().positive(), height: z.int().positive() }),
    resumed: z.boolean(),
    repeat_session: z.boolean().describe("This browser already completed a session."),
    pilot_participant: z.int().positive().nullable().describe("`p=N` from a numbered pilot link."),
    requested_cell: Cell.nullable().describe("`cell=` on the link. Honoured only in test runs."),
  },
);

export const V3ConsentGiven = defineV3("consent_given", "Both consent boxes ticked and Start pressed.", {
  pilot_notice_shown: z.boolean(),
});

export const V3ScreeningAnswered = defineV3(
  "screening_answered",
  "Screening S1-S3, for an admitted participant only. S1 asks for the age as a number, as the approved instrument words it; only its band is stored. The exact age decides eligibility in the browser and goes no further -- the project holds no exact ages (the privacy invariant in packages/schema/test/events.test.ts). Nothing about age is stored for anyone turned away.",
  {
    age_band: AgeBand,
    english_level: EnglishLevel,
    study_language: StudyLanguageV3,
  },
);

export const V3ScreenedOut = defineV3(
  "screened_out",
  "Visitor turned away at screening. Nothing is allocated for them.",
  { reason: V3ScreenedOutReason },
);

export const V3Allocation = defineV3("allocation", "Cell assigned, after screening and the pre-measures.", {
  cell: Cell,
  tone: Tone,
  list: ExplanationList,
  method: AllocationMethod,
  pilot_position: z.int().positive().nullable().describe("1-based position in the pilot sequence."),
  english_band: EnglishBand,
  sequence_index: z
    .int()
    .nonnegative()
    .nullable()
    .optional()
    .describe(
      "0-based slot in the committed sequence of the participant's stratum, for main_sequence and test_sequence; null otherwise. Absent on pilot events recorded before it existed.",
    ),
});

export const V3PlanGenerated = defineV3(
  "plan_generated",
  "Every per-participant random order, drawn once from a seed and logged in full.",
  {
    seed: z.int().nonnegative(),
    lesson_order: z.array(z.array(ClaimId).length(4)).length(3),
    task_order: z.array(z.array(z.string()).length(4)).length(3),
    attention_position: z.int().min(1).max(5).describe("Position of the attention check among module 2's five mission screens."),
    option_order: z.record(z.string(), z.array(ChoiceRole).length(3)),
    quiz_order: z.array(z.string()).length(16),
    quality_items: z.array(ClaimId).length(4),
  },
);

export const V3ScreenViewed = defineV3("screen_viewed", "A screen was shown. Times modules and the session.", {
  screen: z.string(),
  module: Module.nullable(),
});

export const V3LessonItem = defineV3("lesson_item", "One lesson message read; logged on Continue.", {
  module: Module,
  claim_id: ClaimId,
  version: ExplanationVersion,
  order_position: z.int().min(1).max(4),
  dwell_ms: Milliseconds.describe("From the message appearing to Continue."),
});

export const V3MissionAnswer = defineV3("mission_answer", "A mission task answered; logged on Next.", {
  module: Module,
  task_id: z.string(),
  claim_id: ClaimId,
  version: ExplanationVersion.describe("How this claim was explained in the lesson."),
  choice_role: ChoiceRole,
  option_order: z.array(ChoiceRole).length(3).describe("Roles in the order the options were shown."),
  order_position: z.int().min(1).max(4),
  confidence: Confidence4,
  rt_ms: Milliseconds.describe("From the task appearing to Next."),
});

export const V3AttentionCheck = defineV3("attention_check", "The systems check in module 2.", {
  passed: z.boolean(),
  choice: z.string(),
  position: z.int().min(1).max(5),
  rt_ms: Milliseconds,
});

export const V3QuizRating = defineV3("quiz_rating", "One final-quiz statement rated.", {
  item_id: z.string(),
  claim_id: ClaimId.nullable(),
  version: ExplanationVersion.nullable().describe("How the claim was explained; null for fillers."),
  is_filler: z.boolean(),
  rating: Rating7,
  position: z.int().min(1).max(16),
});

export const V3QuestionnaireItem = defineV3("questionnaire_item", "One questionnaire answer.", {
  instrument: QuestionnaireInstrument,
  item_id: z.string(),
  value: z.union([z.int(), z.string()]),
});

export const V3FunnelAnswer = defineV3("funnel_answer", "One awareness-funnel answer. Empty text is recorded as empty.", {
  item_id: z.enum(["F1", "F2", "F3", "F4"]),
  text: z.string().max(5000),
});

export const V3ArgQualityRating = defineV3("arg_quality_rating", "Explanation-quality check (E6).", {
  claim_id: ClaimId,
  version: ExplanationVersion,
  rating: Rating7,
  position: z.int().min(1).max(4),
});

export const V3PilotFeedback = defineV3("pilot_feedback", "Pilot runs only. Blank answers record nothing.", {
  item_id: z.enum(["PF1", "PF2", "PF3"]),
  text: z.string().min(1).max(5000),
});

export const V3SessionCompleted = defineV3("session_completed", "Everything is answered; the debrief follows.", {
  total_duration_ms: Milliseconds,
  score: z.int().min(0).max(12).describe("Mission tasks answered with the lesson option."),
});

export const V3DebriefViewed = defineV3("debrief_viewed", "The debrief was shown.", {
  score: z.int().min(0).max(12),
});

export const V3WithdrawalRequested = defineV3(
  "withdrawal_requested",
  "Remove my data. Every export and script drops the participant entirely.",
  { at_screen: z.string() },
);

export const v3EventSchemas = [
  V3SessionStarted,
  V3ConsentGiven,
  V3ScreeningAnswered,
  V3ScreenedOut,
  V3Allocation,
  V3PlanGenerated,
  V3ScreenViewed,
  V3LessonItem,
  V3MissionAnswer,
  V3AttentionCheck,
  V3QuizRating,
  V3QuestionnaireItem,
  V3FunnelAnswer,
  V3ArgQualityRating,
  V3PilotFeedback,
  V3SessionCompleted,
  V3DebriefViewed,
  V3WithdrawalRequested,
] as const;

export const V3Event = z.discriminatedUnion("type", [...v3EventSchemas]);

export type V3Event = z.infer<typeof V3Event>;
export type V3EventType = V3Event["type"];
export type CellName = z.infer<typeof Cell>;
export type ToneName = z.infer<typeof Tone>;
export type ListName = z.infer<typeof ExplanationList>;
export type VersionName = z.infer<typeof ExplanationVersion>;
export type RoleName = z.infer<typeof ChoiceRole>;
