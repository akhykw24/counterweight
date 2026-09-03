import { z } from "zod";

/**
 * Shared identifier, enum and scalar types.
 *
 * Nothing in this file may carry PII. Age is a band, never an exact number
 * (STUDY3_SPEC_v3.md section 3): you cannot leak what you never collected.
 */

export const SessionId = z
  .uuid()
  .describe("Opaque per-session UUID. The only participant identifier that exists.");

export const EventId = z
  .uuid()
  .describe("Per-event UUID. Idempotency key — the ingest service dedupes on this, so retries are safe.");

export const Seq = z
  .int()
  .nonnegative()
  .describe("Monotonically increasing sequence number within a session. Establishes order independently of clock skew.");

export const ClientTimestamp = z
  .iso
  .datetime()
  .describe("ISO 8601 client clock reading. Untrusted for ordering (use seq); useful for wall-clock reporting.");

export const ItemId = z
  .string()
  .regex(/^item_(0[1-9]|1[0-2])$/)
  .describe("Item bank identifier, item_01 through item_12.");

export const ResponseId = z
  .string()
  .regex(/^[a-z]{2}_(warm|neutral)_(low|moderate|high|na)_item_(0[1-9]|1[0-2])$/)
  .describe("Frozen stimulus identifier: {lang}_{condition}_{register}_{item}. Resolves to exactly one hash-manifested response file.");

export const Language = z
  .enum(["en"])
  .describe("Active study language. English only under spec v2; the Russian and Kazakh sets are in archive/ and are not in the active manifest, so nothing can serve them.");

export const Condition = z
  .enum(["warm", "neutral"])
  .describe("Between-subjects emotional style condition.");

export const RegisterState = z
  .enum(["LOW", "MODERATE", "HIGH"])
  .describe("Register selected by initial confidence (LOW < 40, MODERATE 40-70, HIGH > 70). Warm condition only; neutral does not branch.");

export const JustificationQuality = z
  .enum(["strong", "weak"])
  .describe("Within-subjects justification quality factor. Strong = method-referencing; weak = circular appeal to consensus.");

export const AgeGroup = z
  .enum(["adult"])
  .describe("Age group of an admitted participant. Only adults are admitted (spec v2 §1), so this has one value; it is kept as an enum because the stratum key is still built from it.");

export const AgeBand = z
  .enum(["18-24", "25-34", "35+"])
  .describe("Coarsened age of an ADMITTED participant. Recorded as a band at source; an exact age is never collected. Bands below 18 do not appear because the study does not admit anyone under 18 and does not store an age for someone it turns away.");

/**
 * The study's one language.
 *
 * Named rather than written inline so that the single place it is decided is
 * greppable, and so the literal-scan test can tell "the study language" from
 * "somebody defaulted a branch to English".
 */
export const STUDY_LANGUAGE: z.infer<typeof Language> = "en";

export const AgeScreenAnswer = z
  .enum(["under-18", "18-24", "25-34", "35+"])
  .describe("What the eligibility screen offers. Wider than AgeBand by exactly one option, because the screen has to let someone say they are under 18 in order to turn them away. 'under-18' is never stored: it routes to the screening exit and the session records only the reason.");

export const ScreenedOutReason = z
  .enum(["age", "language", "prior_training"])
  .describe("Why a visitor was turned away before consent. This is the ONLY thing a screened-out visitor contributes: no age, no answers, no session (spec v2 §3). It exists so the participant-flow diagram can report screening counts.");

export const Stratum = z
  .enum([
    "kk:minor",
    "kk:adult",
    "ru:minor",
    "ru:adult",
    "en:minor",
    "en:adult",
  ])
  .describe("Randomization stratum: language x age group. Six cells, block size 4 (STUDY3_SPEC_v3.md section 1).");

export const EstimatePhase = z
  .enum(["initial", "final"])
  .describe("Whether an estimate or confidence reading was taken before or after the AI response.");

export const FollowupId = z
  .enum(["measurement", "certainty", "challenge"])
  .describe("Fixed follow-up options. 'challenge' (\"I think that might be wrong\") is itself a behavioural measure.");

export const FunnelStage = z
  .enum(["purpose", "anomaly", "belief"])
  .describe("Funnelled suspicion probe stage, administered in this order without backtracking.");

export const QuestionnaireScale = z
  .enum(["warmth", "competence", "trust", "covariates"])
  .describe("Which questionnaire instrument an answer belongs to.");

export const Confidence = z
  .number()
  .min(0)
  .max(100)
  .describe("Self-reported confidence, 0-100. Feeds the register function.");

export const Likert7 = z
  .int()
  .min(1)
  .max(7)
  .describe("Seven-point Likert response.");

export const Likert5 = z
  .int()
  .min(1)
  .max(5)
  .describe("Five-point Likert response.");

export const Estimate = z
  .number()
  .finite()
  .describe("A numeric estimate in the item's own unit. Unbounded — participants may enter any finite value.");

export const ScrollFraction = z
  .number()
  .min(0)
  .max(1)
  .describe("Deepest fraction of the AI response scrolled into view. 1.0 means the justification was at least displayed.");

export const DurationMs = z
  .int()
  .nonnegative()
  .describe("Elapsed milliseconds.");

export const Sha256 = z
  .string()
  .regex(/^[a-f0-9]{64}$/)
  .describe("Lowercase hex SHA-256 digest.");

export type SessionId = z.infer<typeof SessionId>;
export type EventId = z.infer<typeof EventId>;
export type ItemId = z.infer<typeof ItemId>;
export type ResponseId = z.infer<typeof ResponseId>;
export type Language = z.infer<typeof Language>;
export type Condition = z.infer<typeof Condition>;
export type RegisterState = z.infer<typeof RegisterState>;
export type JustificationQuality = z.infer<typeof JustificationQuality>;
export type AgeGroup = z.infer<typeof AgeGroup>;
export type AgeScreenAnswer = z.infer<typeof AgeScreenAnswer>;
export type ScreenedOutReason = z.infer<typeof ScreenedOutReason>;
export type AgeBand = z.infer<typeof AgeBand>;
export type Stratum = z.infer<typeof Stratum>;
export type FollowupId = z.infer<typeof FollowupId>;
export type FunnelStage = z.infer<typeof FunnelStage>;
export type QuestionnaireScale = z.infer<typeof QuestionnaireScale>;
