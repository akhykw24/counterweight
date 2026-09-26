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
    title: "Transport",
    blurb: "What the client sends to the ingest service.",
    entries: [{ name: "EventBatch", schema: EventBatch }],
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
];
