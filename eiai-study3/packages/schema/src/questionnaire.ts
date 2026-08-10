import { z } from "zod";
import { AgeBand, Language, Likert5, Likert7, QuestionnaireScale } from "./primitives.js";

/**
 * Post-interaction questionnaire (STUDY3_SPEC_v2.md sections 7.3, 7.4).
 *
 * The warmth scale is the manipulation check and is analysed per language
 * separately. The competence scale is the control check and must NOT differ by
 * condition; if it does, warmth and competence are confounded.
 */

export const QuestionDefinition = z
  .strictObject({
    id: z.string().min(1),
    scale: QuestionnaireScale,
    text_en: z.string().min(1),
    response_type: z.enum(["likert7", "likert5", "age_band", "language", "free_text", "choice"]),
    reverse_scored: z.boolean(),
  })
  .describe("One questionnaire item definition. The instrument is data, not hard-coded UI.");

export const PerceivedWarmthScale = z
  .strictObject({
    warmth_01: Likert7,
    warmth_02: Likert7,
    warmth_03: Likert7,
    warmth_04: Likert7,
    warmth_05: Likert7,
  })
  .describe("Manipulation check, 5 items. Analysed within each language group separately, never pooled silently.");

export const PerceivedCompetenceScale = z
  .strictObject({
    competence_01: Likert7,
    competence_02: Likert7,
    competence_03: Likert7,
    competence_04: Likert7,
  })
  .describe("Control check, 4 items. Should NOT differ by condition. Reported either way.");

export const TrustScale = z
  .strictObject({
    trust_01: Likert7,
    trust_02: Likert7,
    trust_03: Likert7,
    trust_04: Likert7,
  })
  .describe("Trust in the assistant, 4 items. H5 predicts warm > neutral.");

export const Covariates = z
  .strictObject({
    age_band: AgeBand,
    gender: z.enum(["female", "male", "other", "prefer_not_to_say"]),
    primary_language: Language,
    ai_usage_frequency: Likert5.describe("Self-reported frequency of AI assistant use."),
    prior_knowledge_marine_biology: Likert7.describe("Self-rated prior knowledge. Screening excludes formal training."),
  })
  .describe("Covariates for the ANCOVA model.");

export const FunnelProbe = z
  .strictObject({
    purpose: z.string().describe("\"What do you think this study was about?\" — free text."),
    anomaly: z.string().describe("\"Did anything about the assistant's answers seem unusual?\" — free text."),
    belief: z.enum(["yes", "no", "unsure"]).describe("\"Did you believe all of the assistant's answers were accurate?\""),
  })
  .describe("Funnelled suspicion probe, administered in order without backtracking.");

export const QuestionnaireResponse = z
  .strictObject({
    warmth: PerceivedWarmthScale,
    competence: PerceivedCompetenceScale,
    trust: TrustScale,
    covariates: Covariates,
    funnel: FunnelProbe,
  })
  .describe("A complete questionnaire submission, assembled by replay from QUESTIONNAIRE_ANSWERED and FUNNEL_RESPONSE events.");

/** The instrument itself. English source text; translations follow section 11. */
export const questionnaireDefinition: readonly z.infer<typeof QuestionDefinition>[] = [
  { id: "warmth_01", scale: "warmth", text_en: "The assistant seemed to care about my experience.", response_type: "likert7", reverse_scored: false },
  { id: "warmth_02", scale: "warmth", text_en: "The assistant responded to how I was feeling.", response_type: "likert7", reverse_scored: false },
  { id: "warmth_03", scale: "warmth", text_en: "The assistant came across as warm.", response_type: "likert7", reverse_scored: false },
  { id: "warmth_04", scale: "warmth", text_en: "The assistant felt impersonal.", response_type: "likert7", reverse_scored: true },
  { id: "warmth_05", scale: "warmth", text_en: "The assistant seemed to understand where I was coming from.", response_type: "likert7", reverse_scored: false },

  { id: "competence_01", scale: "competence", text_en: "The assistant seemed knowledgeable.", response_type: "likert7", reverse_scored: false },
  { id: "competence_02", scale: "competence", text_en: "The assistant seemed competent.", response_type: "likert7", reverse_scored: false },
  { id: "competence_03", scale: "competence", text_en: "The assistant's answers seemed well informed.", response_type: "likert7", reverse_scored: false },
  { id: "competence_04", scale: "competence", text_en: "The assistant seemed unreliable.", response_type: "likert7", reverse_scored: true },

  { id: "trust_01", scale: "trust", text_en: "I would rely on this assistant for factual information.", response_type: "likert7", reverse_scored: false },
  { id: "trust_02", scale: "trust", text_en: "I would recommend this assistant to a friend.", response_type: "likert7", reverse_scored: false },
  { id: "trust_03", scale: "trust", text_en: "I would double-check what this assistant told me.", response_type: "likert7", reverse_scored: true },
  { id: "trust_04", scale: "trust", text_en: "I trust this assistant's answers.", response_type: "likert7", reverse_scored: false },

  { id: "cov_age_band", scale: "covariates", text_en: "Which age group are you in?", response_type: "age_band", reverse_scored: false },
  { id: "cov_gender", scale: "covariates", text_en: "How do you describe your gender?", response_type: "choice", reverse_scored: false },
  { id: "cov_primary_language", scale: "covariates", text_en: "What is your primary language?", response_type: "language", reverse_scored: false },
  { id: "cov_ai_usage", scale: "covariates", text_en: "How often do you use AI assistants?", response_type: "likert5", reverse_scored: false },
  { id: "cov_prior_knowledge", scale: "covariates", text_en: "How would you rate your prior knowledge of marine biology?", response_type: "likert7", reverse_scored: false },
] as const;

export type QuestionDefinition = z.infer<typeof QuestionDefinition>;
export type QuestionnaireResponse = z.infer<typeof QuestionnaireResponse>;
