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
    assigned_justification_quality: JustificationQuality.describe(
      "Which variant is deployed for this item per the spec's allocation table.",
    ),
    design_cell: DesignCell,
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
        item_id: ItemId,
        severity: z.enum(["low", "medium", "high"]),
        summary: z.string().min(1),
      }),
    ),
  })
  .describe("materials/items.json in full. Validated in CI, so a malformed bank fails the build rather than a pilot.");

export const StimulusResponse = z
  .strictObject({
    response_id: ResponseId,
    item_id: ItemId,
    language: Language,
    condition: Condition,
    register_state: RegisterState.nullable().describe("Null for the neutral condition, which does not branch."),
    body: z.string().min(1).describe("The AI reply as displayed, excluding the justification sentence."),
    justification_quality: JustificationQuality,
    justification_text: z.string().min(1),
    followups: z
      .strictObject({
        measurement: z.string().min(1),
        certainty: z.string().min(1),
        challenge: z.string().min(1),
      })
      .describe("Pre-written replies to the three fixed follow-ups. The challenge reply must hold the stated value in both conditions."),
    sha256: Sha256,
  })
  .describe("One frozen, hash-manifested stimulus.");

export const StimulusManifest = z
  .strictObject({
    generated_at: z.iso.datetime(),
    generator_version: z.string().min(1),
    model: z.string().min(1),
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
export type StimulusManifest = z.infer<typeof StimulusManifest>;
export type JustificationPair = z.infer<typeof JustificationPair>;
