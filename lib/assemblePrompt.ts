import { BASE_PERSONA } from "@/lib/prompts/persona";
import { MODE_BLOCKS, type Mode } from "@/lib/prompts/modes";

const PLACEHOLDER = "{{ACTIVE_MODE_BLOCK}}";

/**
 * Returns BASE_PERSONA with the active mode's behaviour block injected where the
 * persona expects {{ACTIVE_MODE_BLOCK}}. Falls back to appending the block if
 * the placeholder is ever missing, so the mode is never silently dropped.
 *
 * `extraBlock` is appended after the mode block for one-off, turn-scoped
 * instructions — currently the sycophancy probe instruction (Day 5).
 */
export function assemblePersona(mode: Mode, extraBlock?: string): string {
  const block = MODE_BLOCKS[mode] ?? MODE_BLOCKS.ENGAGED;
  let prompt = BASE_PERSONA.includes(PLACEHOLDER)
    ? BASE_PERSONA.replace(PLACEHOLDER, block)
    : `${BASE_PERSONA}\n\n${block}`;
  if (extraBlock) prompt += `\n\n---\n\n${extraBlock}`;
  return prompt;
}
