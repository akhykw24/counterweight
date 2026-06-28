import { BASE_PERSONA } from "@/lib/prompts/persona";
import { MODE_BLOCKS, type Mode } from "@/lib/prompts/modes";

const PLACEHOLDER = "{{ACTIVE_MODE_BLOCK}}";

/**
 * Returns BASE_PERSONA with the active mode's behaviour block injected where the
 * persona expects {{ACTIVE_MODE_BLOCK}}. Falls back to appending the block if
 * the placeholder is ever missing, so the mode is never silently dropped.
 */
export function assemblePersona(mode: Mode): string {
  const block = MODE_BLOCKS[mode] ?? MODE_BLOCKS.ENGAGED;
  if (BASE_PERSONA.includes(PLACEHOLDER)) {
    return BASE_PERSONA.replace(PLACEHOLDER, block);
  }
  return `${BASE_PERSONA}\n\n${block}`;
}
