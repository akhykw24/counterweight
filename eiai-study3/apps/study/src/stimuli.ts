import type {
  Condition,
  ItemRecord,
  Language,
  RegisterState,
  StimulusResponse,
} from "@eiai/schema";
import type { SessionContext } from "@eiai/fsm";
import { registerSlug } from "@eiai/fsm";
import itemBank from "../../../materials/items.json";

/**
 * Browser-side stimulus lookup.
 *
 * `@eiai/stimuli` verifies the hash manifest with node:fs and cannot run in a
 * browser, so the frozen files are bundled here instead. The integrity check
 * therefore happens in CI (the golden-file test), not at page load — the
 * bundle is built from files that were verified, rather than verifying them
 * again on every visit.
 */

const files = import.meta.glob<{ default: { responses: StimulusResponse[] } }>(
  "../../../materials/responses/*.json",
  { eager: true },
);

const byResponseId = new Map<string, StimulusResponse>();
for (const module of Object.values(files)) {
  for (const response of module.default.responses) {
    byResponseId.set(response.response_id, response);
  }
}

export const items = itemBank.items as unknown as ItemRecord[];

export function itemById(itemId: string): ItemRecord {
  const item = items.find((candidate) => candidate.id === itemId);
  if (!item) throw new Error(`unknown item ${itemId}`);
  return item;
}

export class AllocationMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AllocationMissingError";
  }
}

/**
 * The participant's language, or a loud failure.
 *
 * Anything a participant reads as part of the task -- the question stem, the
 * advice, the debrief that discloses the planted errors -- must be in the
 * language they chose. Falling back to English would show a Kazakh participant
 * an English question and leave nothing in the log to say it happened.
 */
/**
 * The participant's self-reported CEFR level, which the screening gate has
 * already required by the time allocation happens.
 *
 * Throws rather than defaulting, for the same reason as the language: a filled
 * -in value would be indistinguishable from a real one in the log, and it would
 * land in the covariate of the primary model.
 */
export function requireCefr(context: SessionContext) {
  if (!context.cefr) {
    throw new AllocationMissingError(
      "allocation was recorded before the participant reported an English level. " +
        "The level is a covariate in the primary model; a default would be a made-up datum.",
    );
  }
  return context.cefr;
}

export function requireLanguage(context: SessionContext, what: string): Language {
  if (context.language === null) {
    throw new AllocationMissingError(
      `${what} was rendered before the participant chose a language. ` +
        `Defaulting would silently show them the wrong one.`,
    );
  }
  return context.language;
}

/**
 * The stimulus for the participant's actual allocation.
 *
 * Both call sites used to read `context.language ?? "en"` and
 * `context.condition ?? "neutral"`. Those defaults are the same defect as the
 * hard-coded `warm` / `en:adult` the bots found, and quieter: a participant
 * allocated to warm Kazakh would have been served English neutral, and
 * `RESPONSE_REVEALED` would have recorded that stimulus's own response_id --
 * internally consistent, indistinguishable in the log from a correct trial, and
 * wrong. Throwing means a statechart that ever reaches the advice screen
 * without an allocation fails loudly in the pilot instead of silently in the
 * data.
 */
export function stimulusFor(context: SessionContext, itemId: string): StimulusResponse {
  if (context.language === null || context.condition === null) {
    throw new AllocationMissingError(
      `reached the advice screen for ${itemId} without an allocation ` +
        `(language=${String(context.language)}, condition=${String(context.condition)}). ` +
        `Serving a default would put an uncontrolled stimulus in front of a participant.`,
    );
  }
  return resolveStimulus(context.language, context.condition, context.registerState, itemId);
}

export function resolveStimulus(
  language: Language,
  condition: Condition,
  registerState: RegisterState | null,
  itemId: string,
): StimulusResponse {
  const id = `${language}_${condition}_${registerSlug(registerState)}_${itemId}`;
  const response = byResponseId.get(id);
  // No fallback on purpose: an improvised stimulus is an uncontrolled one.
  if (!response) throw new Error(`no frozen stimulus for ${id}`);
  return response;
}

/**
 * The frozen stimulus with this response id.
 *
 * Exists so a test can assert against whatever the app actually served rather
 * than naming an arm itself. Allocation comes from the committed sequence, so
 * a test that hardcodes "warm" is asserting something it does not control.
 */
export function stimulusByResponseId(responseId: string): StimulusResponse {
  const response = byResponseId.get(responseId);
  if (!response) throw new Error(`no frozen stimulus with response_id ${responseId}`);
  return response;
}

export const stimulusCount = byResponseId.size;
