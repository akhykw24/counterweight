import type {
  Condition,
  ItemRecord,
  Language,
  RegisterState,
  StimulusResponse,
} from "@eiai/schema";
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

export const stimulusCount = byResponseId.size;
