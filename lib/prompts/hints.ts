/**
 * Hint ladder (docs/WEEK2.md Day 10) — escalating, bounded help for STUCK mode.
 *
 * Each level is injected into the persona for the ONE reply answering a hint
 * request (via assemblePersona's extra block, like the probe instruction).
 * The ladder never produces the learner's exact answer:
 *   L1 concept cue -> L2 first step -> L3 worked SIMILAR example.
 */

export type HintLevel = 1 | 2 | 3;

export const HINT_LABELS: Record<HintLevel, string> = {
  1: "concept cue",
  2: "first step",
  3: "worked example",
};

const LEVEL_RULES: Record<HintLevel, string> = {
  1: `LEVEL 1 — CONCEPT CUE ONLY. In one or two sentences, name the concept, principle, or idea they should be thinking about. Do NOT apply it to their problem, do NOT give steps, formulas filled with their numbers, or any part of the answer.`,
  2: `LEVEL 2 — FIRST STEP ONLY. Show only the first concrete move on THEIR problem: set it up, write the opening line, or name the substitution — then STOP before carrying it anywhere. No intermediate results, no second step.`,
  3: `LEVEL 3 — WORKED SIMILAR EXAMPLE. Pick a DIFFERENT example (change the numbers, the function, or the scenario), work that one through completely, then tell them to apply the same pattern to their own problem. Never work their exact problem, and never state its final answer.`,
};

/** The instruction injected for the single reply answering a hint request. */
export function buildHintInstruction(level: HintLevel): string {
  return `HINT REQUEST — THIS REPLY ONLY. The learner explicitly asked for a level-${level} hint (${HINT_LABELS[level]}). Give exactly that much help and no more.

${LEVEL_RULES[level]}

Whatever the level: never produce the full solution to their actual problem. End with one short line handing the next move back to them — no lecture about hint-taking.`;
}
