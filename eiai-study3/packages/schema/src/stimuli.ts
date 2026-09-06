import { z } from "zod";
import {
  Condition,
  ItemId,
  JustificationQuality,
  Language,
  RegisterState,
  ResponseId,
  Sha256,
} from "./primitives.js";

/**
 * The item bank and the frozen stimulus set.
 *
 * Stimuli are generated once, hand-verified, hashed, and committed before
 * collection opens (STUDY3_SPEC_v3.md sections 1 and 5). Serving a response is
 * a lookup, never a generation.
 */

export const SourceRecord = z
  .strictObject({
    citation: z.string().min(1).describe("Full citation as it will appear in the appendix."),
    url: z.url().describe("Resolvable link to the source."),
    supports: z.string().min(1).describe("What specifically this source establishes."),
    verified_on: z.iso.date().describe("Date the claim was checked against the source."),
    independently_verified: z
      .boolean()
      .describe("True when checked against the primary source directly rather than carried over from the spec."),
  })
  .describe("One citable source backing an item's true value.");

export const ItemFlag = z
  .strictObject({
    severity: z.enum(["low", "medium", "high"]),
    kind: z.string().min(1),
    detail: z.string().min(1),
    impact: z.string().min(1).describe("What this does to the analysis if left unresolved."),
    action: z.string().min(1).describe("The concrete fix."),
  })
  .describe("An unresolved methodological problem with an item. Must be empty for every item before pre-registration.");

export const Justification = z
  .strictObject({
    text: z.string().min(1),
    word_count: z.int().positive(),
  })
  .describe("One justification variant attached to an AI response.");

export const JustificationPair = z
  .strictObject({
    strong: Justification.describe(
      "Method-referencing and in principle checkable. Names how the figure was obtained.",
    ),
    weak: Justification.describe(
      "Circular appeal to consensus. Fluent, contentless, and adds no support for the claim.",
    ),
  })
  .refine((pair) => Math.abs(pair.strong.word_count - pair.weak.word_count) <= 2, {
    message:
      "Strong and weak justifications must be word-count matched within 2 words, or length confounds justification quality.",
  })
  .describe("Word-count-matched justification pair. Only reasoning quality varies; no factual content differs.");

export const ItemTopic = z
  .enum([
    "bathymetry",
    "diving_physiology",
    "optics",
    "hydrothermal",
    "taxonomy",
    "life_history",
    "physical_oceanography",
  ])
  .describe("Sub-domain of deep-sea biology the item asks about. A classification of the question stems, not a property carried by the cited sources. Exists so that topic diversity within each justification-quality cell is machine-checkable: a cell drawn entirely from one sub-domain would confound justification quality with subject-matter familiarity.");

export const DesignCell = z
  .enum([
    "error_weak",
    "error_strong",
    "correct_weak",
    "correct_strong",
    "correct_filler",
  ])
  .describe("Cell in the 2x2 item allocation (STUDY3_SPEC_v2.md section 2).");

export const ItemRecord = z
  .strictObject({
    id: ItemId,
    index: z.int().min(1).max(12).describe("Canonical item number from the spec table."),
    question: z
      .strictObject({
        en: z.string().min(1),
        ru: z.string().min(1),
        kk: z.string().min(1),
      })
      .describe("Question stem per language. Non-English stems are drafts until back-translation clears."),
    unit: z
      .strictObject({
        symbol: z.string().min(1),
        en: z.string().min(1),
        ru: z.string().min(1),
        kk: z.string().min(1),
      })
      .describe("Unit of the numeric answer."),
    true_value: z.number().finite().describe("Best documented value, used for the debrief and the WOA denominator guard."),
    true_value_note: z.string().nullable().describe("Precision, CI, or scope qualification on the true value."),
    advice_value: z.number().finite().describe("The value the AI states. Differs from truth on error items."),
    is_error: z.boolean(),
    topic: ItemTopic,
    // Justification quality and analysed/filler role deliberately do NOT live
    // here. They are in materials/quality_assignment.json, so that reassigning
    // an item is a config edit plus a stimulus regeneration rather than a bank
    // edit, and so that design_cell can be derived instead of stored — a stored
    // cell can contradict the assignment, and that contradiction survives review
    // because each file looks correct on its own.
    plausible_answer_range: z
      .tuple([z.number(), z.number()])
      .describe("Sanity bounds for the estimate input. Not a correctness check."),
    justifications: JustificationPair,
    sources: z.array(SourceRecord).min(1),
    volatile: z.boolean().describe("True when the value moves over time and must be re-verified immediately before launch."),
    flags: z.array(ItemFlag),
  })
  .describe("One item bank entry.");

export const ItemBank = z
  .strictObject({
    schema_version: z.string().min(1),
    study: z.literal("eiai-study3"),
    source_spec: z.string().min(1),
    compiled_at: z.iso.date(),
    design: z.strictObject({
      languages: z.array(Language).min(1),
      conditions: z.array(Condition).min(1),
      registers: z.array(RegisterState).min(1),
      register_thresholds: z.strictObject({
        low_below: z.number(),
        high_above: z.number(),
      }),
      item_order_randomised_per_participant: z.boolean(),
      error_item_ids: z.array(ItemId),
    }),
    translation_status: z.strictObject({
      en: z.string().min(1),
      ru: z.string().min(1),
      kk: z.string().min(1),
      note: z.string().min(1),
    }),
    items: z.array(ItemRecord).length(12),
    review_required: z.array(
      z.strictObject({
        item_id: ItemId.nullable().describe(
          "The item the finding concerns, or null when it concerns the bank as a whole — an imbalance across items belongs to no single one, and pinning it to an arbitrary item would misfile it.",
        ),
        severity: z.enum(["low", "medium", "high"]),
        summary: z.string().min(1),
      }),
    ),
  })
  .describe("materials/items.json in full. Validated in CI, so a malformed bank fails the build rather than a pilot.");

export const ItemRole = z
  .enum(["analysed", "filler"])
  .describe("Whether an item enters the justification-quality contrast, or exists only to keep planted errors at 33% of twelve rather than 50% of eight.");

export const QualityAssignmentEntry = z
  .strictObject({
    quality: JustificationQuality,
    role: ItemRole,
  })
  .describe("Which justification an item carries, and whether it is analysed.");

export const QualityAssignment = z
  .strictObject({
    schema_version: z.string().min(1),
    study: z.literal("eiai-study3"),
    source: z.string().min(1),
    note: z.string().min(1),
    roles: z.strictObject({
      analysed: z.string().min(1),
      filler: z.string().min(1),
    }),
    assignment: z.record(ItemId, QualityAssignmentEntry),
  })
  .describe("materials/quality_assignment.json. The single source of truth for justification-quality allocation; the item bank carries neither the quality nor the design cell.");

/** design_cell, derived. Deriving it is what stops it disagreeing with the assignment. */
export function designCellFor(
  isError: boolean,
  quality: z.infer<typeof JustificationQuality>,
  role: z.infer<typeof ItemRole>,
): z.infer<typeof DesignCell> {
  if (role === "filler") return "correct_filler";
  return `${isError ? "error" : "correct"}_${quality}` as z.infer<typeof DesignCell>;
}

/**
 * The bank with its assignment merged in, mirroring `_common.load_items()` on
 * the Python side. Kept as a pure function over already-parsed data so both
 * languages agree on what an "item" is without either owning file IO.
 */
export function withQualityAssignment(
  bank: z.infer<typeof ItemBank>,
  assignment: z.infer<typeof QualityAssignment>,
): (z.infer<typeof ItemRecord> & {
  assigned_justification_quality: z.infer<typeof JustificationQuality>;
  role: z.infer<typeof ItemRole>;
  design_cell: z.infer<typeof DesignCell>;
})[] {
  return bank.items.map((item) => {
    const entry = assignment.assignment[item.id];
    if (!entry) {
      throw new Error(
        `quality_assignment.json has no entry for ${item.id}. Every item must be assigned; ` +
          `a missing one would silently drop out of the design.`,
      );
    }
    return {
      ...item,
      assigned_justification_quality: entry.quality,
      role: entry.role,
      design_cell: designCellFor(item.is_error, entry.quality, entry.role),
    };
  });
}

export const GeneratorMode = z
  .enum(["live_api", "offline_placeholder"])
  .describe("How a stimulus set was produced. Placeholder sets are structurally valid but must never be fielded. Was 'anthropic_api', which named the wrong thing: generation runs against whichever OpenAI-compatible provider is configured, and the provider is recorded separately.");

export const StimulusValidation = z
  .strictObject({
    ok: z.boolean(),
    errors: z.array(z.string()),
    warnings: z.array(z.string()),
  })
  .describe("Generation-time validation result, retained as provenance.");

export const StimulusResponse = z
  .strictObject({
    response_id: ResponseId,
    item_id: ItemId,
    language: Language,
    condition: Condition,
    register_state: RegisterState.nullable().describe("Null for the neutral condition, which does not branch."),
    body: z.string().min(1).describe("The AI reply as displayed, excluding the justification sentence."),
    justification_quality: JustificationQuality,
    justification_text: z
      .string()
      .min(1)
      .describe("Rendered once per (language, item) and reused across all four condition variants, so it is byte-identical across conditions by construction. Displayed as its own element because scroll depth on it is the H4 mediator."),
    followups: z
      .strictObject({
        measurement: z.string().min(1),
        certainty: z.string().min(1),
        challenge: z.string().min(1),
      })
      .describe("Pre-written replies to the three fixed follow-ups. The challenge reply must hold the stated value in both conditions."),
    placeholder: z
      .boolean()
      .describe("True for offline-generated placeholders. Guards against a placeholder set reaching participants."),
    sha256: Sha256.describe("Digest over body + justification + the three follow-ups."),
    validation: StimulusValidation,
    attempts_used: z.int().nonnegative(),
  })
  .describe("One frozen, hash-manifested stimulus.");

export const StimulusFile = z
  .strictObject({
    meta: z.strictObject({
      schema_version: z.string().min(1),
      study: z.literal("eiai-study3"),
      language: Language,
      condition: Condition,
      register_state: RegisterState.nullable(),
      generator: z.string().min(1),
      generator_version: z.string().min(1),
      generator_mode: GeneratorMode,
      provider: z
        .string()
        .min(1)
        .describe("Which configured provider served the generation. Recorded because the model id alone is ambiguous: 'openai/gpt-oss-120b' is served by Groq and reads as though it came from OpenAI."),
      model: z.string().min(1),
      placeholder: z.boolean(),
      prompt_hashes: z.record(z.string(), Sha256),
      translation_status: z.string().min(1),
      human_verification: z.strictObject({
        content_equivalence_checked: z.boolean(),
        component_coding_completed: z.boolean(),
        back_translation_completed: z.boolean(),
        native_speaker_verified: z.boolean(),
      }),
    }),
    responses: z.array(StimulusResponse).length(12),
  })
  .describe("One materials/responses/{lang}_{condition}_{state}.json file. Carries no timestamp: its bytes must be stable across runs or the hash manifest means nothing.");

export const StimulusManifest = z
  .strictObject({
    generated_at: z.iso.datetime(),
    generator_version: z.string().min(1),
    generator_mode: GeneratorMode,
    provider: z.string().min(1),
    model: z.string().min(1),
    launch_ready: z
      .boolean()
      .describe("True only when the stimuli are real AND a person has confirmed reading them. The loader refuses to serve a set with this false. Two conditions rather than one: it was previously computed from the placeholder flag alone, so it would have flipped to true the moment generation replaced the placeholders, with nobody having read a sentence."),
    hand_verified: z
      .boolean()
      .describe("Whether materials/hand_verification.json records an approval of exactly this manifest_sha256. Regenerating any cell changes the digest and lapses the approval, because it no longer describes the texts on disk."),
    items_file_sha256: Sha256,
    manifest_sha256: Sha256.describe("Digest over the sorted per-file digests. This is what SESSION_STARTED records."),
    files: z.array(
      z.strictObject({
        path: z.string().min(1),
        sha256: Sha256,
        response_count: z.int().positive(),
      }),
    ),
  })
  .describe("Committed before collection opens. CI recomputes it and fails on any drift.");

export type ItemRecord = z.infer<typeof ItemRecord>;
export type ItemBank = z.infer<typeof ItemBank>;
export type StimulusResponse = z.infer<typeof StimulusResponse>;
export type StimulusFile = z.infer<typeof StimulusFile>;
export type StimulusManifest = z.infer<typeof StimulusManifest>;
export type JustificationPair = z.infer<typeof JustificationPair>;
export type GeneratorMode = z.infer<typeof GeneratorMode>;
export type ItemRole = z.infer<typeof ItemRole>;
export type ItemTopic = z.infer<typeof ItemTopic>;
export type QualityAssignment = z.infer<typeof QualityAssignment>;
