import type { z } from "zod";
import {
  Allocated,
  ConfidenceSet,
  ConsentGiven,
  ScreenedOut,
  EstimateChanged,
  EstimateFinalized,
  EventBatch,
  FollowupSelected,
  FunnelResponse,
  ItemPresented,
  ArgumentRated,
  QuestionnaireAnswered,
  ResponseRevealed,
  ResponseScrolled,
  PilotFeedback,
  SessionCompleted,
  SessionStarted,
  SessionWithdrawn,
  VerifyClicked,
  WindowBlurred,
  WindowFocused,
} from "./events.js";
import {
  AgeBand,
  AgeGroup,
  AgeScreenAnswer,
  Condition,
  CefrLevel,
  ScreenedOutReason,
  StudyWorkLanguage,
  EstimatePhase,
  FollowupId,
  FunnelStage,
  JustificationQuality,
  Language,
  QuestionnaireScale,
  RegisterState,
  Stratum,
} from "./primitives.js";
import { GeneratorMode } from "./stimuli.js";
import {
  ItemBank,
  ItemRole,
  ItemTopic,
  QualityAssignment,
  ItemRecord,
  JustificationPair,
  StimulusFile,
  StimulusManifest,
  StimulusResponse,
} from "./stimuli.js";
import {
  Covariates,
  FunnelProbe,
  PerceivedCompetenceScale,
  PerceivedWarmthScale,
  QuestionnaireResponse,
  TrustScale,
} from "./questionnaire.js";
import { IngestBatch } from "./ingest.js";
import {
  AllocationMethod,
  Cell,
  ChoiceRole,
  EnglishBand,
  EnglishLevel,
  ExplanationList,
  ExplanationVersion,
  QuestionnaireInstrument,
  StudyLanguageV3,
  Tone,
  V3Allocation,
  V3ArgQualityRating,
  V3AttentionCheck,
  V3ConsentGiven,
  V3DebriefViewed,
  V3FunnelAnswer,
  V3LessonItem,
  V3MissionAnswer,
  V3PilotFeedback,
  V3PlanGenerated,
  V3QuestionnaireItem,
  V3QuizRating,
  V3ScreenViewed,
  V3ScreenedOut,
  V3ScreeningAnswered,
  V3SessionCompleted,
  V3SessionStarted,
  V3ScreenedOutReason,
  V3WithdrawalRequested,
} from "./v3.js";

/**
 * The single enumeration of every schema that appears in the data dictionary.
 *
 * `docs/DATA_DICTIONARY.md` is generated from this list, so the dictionary
 * cannot drift from what the ingest service actually validates. One definition,
 * three consumers: compile-time types, runtime validation, generated docs.
 */

export interface RegistryEntry {
  readonly name: string;
  readonly schema: z.ZodType;
  readonly emittedBy?: string;
}

export interface RegistrySection {
  readonly title: string;
  readonly blurb: string;
  readonly entries: readonly RegistryEntry[];
}

export const schemaRegistry: readonly RegistrySection[] = [
  {
    title: "Events",
    blurb:
      "The append-only log. Every analytic table is a projection computed by replaying these. A measure absent here cannot be recovered after collection.",
    entries: [
      { name: "SESSION_STARTED", schema: SessionStarted, emittedBy: "first load, and on resume" },
      { name: "SCREENED_OUT", schema: ScreenedOut, emittedBy: "eligibility screening gate" },
      { name: "CONSENT_GIVEN", schema: ConsentGiven, emittedBy: "consent screen" },
      { name: "ALLOCATED", schema: Allocated, emittedBy: "after eligibility" },
      { name: "ITEM_PRESENTED", schema: ItemPresented, emittedBy: "item screen mount" },
      { name: "ESTIMATE_CHANGED", schema: EstimateChanged, emittedBy: "every slider or keystroke change" },
      { name: "CONFIDENCE_SET", schema: ConfidenceSet, emittedBy: "confidence input" },
      { name: "RESPONSE_REVEALED", schema: ResponseRevealed, emittedBy: "AI reply shown" },
      { name: "RESPONSE_SCROLLED", schema: ResponseScrolled, emittedBy: "scroll within reply" },
      { name: "FOLLOWUP_SELECTED", schema: FollowupSelected, emittedBy: "follow-up tap" },
      { name: "VERIFY_CLICKED", schema: VerifyClicked, emittedBy: "\"check this claim\"" },
      { name: "WINDOW_BLURRED", schema: WindowBlurred, emittedBy: "tab switch away" },
      { name: "WINDOW_FOCUSED", schema: WindowFocused, emittedBy: "tab switch back" },
      { name: "ESTIMATE_FINALIZED", schema: EstimateFinalized, emittedBy: "submit" },
      { name: "ARGUMENT_RATED", schema: ArgumentRated, emittedBy: "after the revised estimate" },
      { name: "QUESTIONNAIRE_ANSWERED", schema: QuestionnaireAnswered, emittedBy: "each questionnaire item" },
      { name: "FUNNEL_RESPONSE", schema: FunnelResponse, emittedBy: "suspicion probe" },
      { name: "SESSION_COMPLETED", schema: SessionCompleted, emittedBy: "debrief reached" },
      { name: "PILOT_FEEDBACK", schema: PilotFeedback, emittedBy: "pilot runs only, after the session is complete" },
      { name: "SESSION_WITHDRAWN", schema: SessionWithdrawn, emittedBy: "withdrawal, from any screen" },
    ],
  },
  {
    title: "Events (v3, Mars Mission Training)",
    blurb:
      "The v3 family (docs/spec/v3/SPEC.md). Lower-case type names keep it apart from the deep-sea events above. The envelope adds `participant_id` and `cell`; see [Event envelope](#event-envelope).",
    entries: [
      { name: "session_started", schema: V3SessionStarted, emittedBy: "first load, and on resume" },
      { name: "consent_given", schema: V3ConsentGiven, emittedBy: "consent screen (E1)" },
      { name: "screening_answered", schema: V3ScreeningAnswered, emittedBy: "screening S1-S3 (E2)" },
      { name: "screened_out", schema: V3ScreenedOut, emittedBy: "under 18, or English A1-A2" },
      { name: "allocation", schema: V3Allocation, emittedBy: "after the pre-measures" },
      { name: "plan_generated", schema: V3PlanGenerated, emittedBy: "immediately after allocation" },
      { name: "screen_viewed", schema: V3ScreenViewed, emittedBy: "every screen" },
      { name: "lesson_item", schema: V3LessonItem, emittedBy: "Continue under a lesson message" },
      { name: "mission_answer", schema: V3MissionAnswer, emittedBy: "Next on a mission task" },
      { name: "attention_check", schema: V3AttentionCheck, emittedBy: "systems check, module 2" },
      { name: "quiz_rating", schema: V3QuizRating, emittedBy: "final quiz (D3)" },
      { name: "questionnaire_item", schema: V3QuestionnaireItem, emittedBy: "P1-P6, E4, NCS-6, D1-D4" },
      { name: "funnel_answer", schema: V3FunnelAnswer, emittedBy: "awareness funnel F1-F4 (E5)" },
      { name: "arg_quality_rating", schema: V3ArgQualityRating, emittedBy: "explanation-quality check (E6)" },
      { name: "pilot_feedback", schema: V3PilotFeedback, emittedBy: "pilot runs only (E9)" },
      { name: "session_completed", schema: V3SessionCompleted, emittedBy: "before the debrief" },
      { name: "debrief_viewed", schema: V3DebriefViewed, emittedBy: "debrief shown (E10)" },
      { name: "withdrawal_requested", schema: V3WithdrawalRequested, emittedBy: "Remove my data" },
    ],
  },
  {
    title: "Transport",
    blurb: "What the client sends to the ingest service.",
    entries: [
      { name: "EventBatch", schema: EventBatch },
      { name: "IngestBatch", schema: IngestBatch },
    ],
  },
  {
    title: "Item bank and stimuli",
    blurb:
      "materials/items.json and the frozen response set. Hash-manifested before collection opens so alteration is detectable.",
    entries: [
      { name: "ItemBank", schema: ItemBank },
      { name: "ItemRecord", schema: ItemRecord },
      { name: "QualityAssignment", schema: QualityAssignment },
      { name: "JustificationPair", schema: JustificationPair },
      { name: "StimulusFile", schema: StimulusFile },
      { name: "StimulusResponse", schema: StimulusResponse },
      { name: "StimulusManifest", schema: StimulusManifest },
    ],
  },
  {
    title: "Questionnaire",
    blurb:
      "Manipulation check, control check, trust, covariates, and the funnelled suspicion probe.",
    entries: [
      { name: "QuestionnaireResponse", schema: QuestionnaireResponse },
      { name: "PerceivedWarmthScale", schema: PerceivedWarmthScale },
      { name: "PerceivedCompetenceScale", schema: PerceivedCompetenceScale },
      { name: "TrustScale", schema: TrustScale },
      { name: "Covariates", schema: Covariates },
      { name: "FunnelProbe", schema: FunnelProbe },
    ],
  },
];

/** Closed vocabularies, rendered as their own reference table. */
export const enumRegistry: readonly RegistryEntry[] = [
  { name: "Language", schema: Language },
  { name: "Condition", schema: Condition },
  { name: "RegisterState", schema: RegisterState },
  { name: "JustificationQuality", schema: JustificationQuality },
  { name: "AgeGroup", schema: AgeGroup },
  { name: "AgeScreenAnswer", schema: AgeScreenAnswer },
  { name: "AgeBand", schema: AgeBand },
  { name: "Stratum", schema: Stratum },
  { name: "ScreenedOutReason", schema: ScreenedOutReason },
  { name: "CefrLevel", schema: CefrLevel },
  { name: "StudyWorkLanguage", schema: StudyWorkLanguage },
  { name: "EstimatePhase", schema: EstimatePhase },
  { name: "FollowupId", schema: FollowupId },
  { name: "FunnelStage", schema: FunnelStage },
  { name: "QuestionnaireScale", schema: QuestionnaireScale },
  { name: "GeneratorMode", schema: GeneratorMode },
  { name: "ItemRole", schema: ItemRole },
  { name: "ItemTopic", schema: ItemTopic },
  { name: "Tone (v3)", schema: Tone },
  { name: "ExplanationList (v3)", schema: ExplanationList },
  { name: "Cell (v3)", schema: Cell },
  { name: "ExplanationVersion (v3)", schema: ExplanationVersion },
  { name: "ChoiceRole (v3)", schema: ChoiceRole },
  { name: "EnglishLevel (v3)", schema: EnglishLevel },
  { name: "EnglishBand (v3)", schema: EnglishBand },
  { name: "StudyLanguage (v3)", schema: StudyLanguageV3 },
  { name: "ScreenedOutReason (v3)", schema: V3ScreenedOutReason },
  { name: "AllocationMethod (v3)", schema: AllocationMethod },
  { name: "QuestionnaireInstrument (v3)", schema: QuestionnaireInstrument },
];
