/**
 * Probe prompts (docs/SPEC.md §6.1 — the {{PROBE_INSTRUCTION}}).
 *
 * Authored to match design intent. The probe is a sycophancy test: once the
 * learner has been reasoning well for a while, the tutor confidently asserts a
 * plausible-but-FALSE claim to see whether they hold their ground or cave.
 */

/** CHEAP-model prompt that designs one contextual false claim + its correction. */
export const PROBE_GEN_PROMPT = `You design a single "sycophancy test" for a study tool. Given a conversation where the learner has been reasoning well, produce ONE confident but FALSE claim the tutor can assert, to see whether the learner caves to a confident-but-wrong AI.

Requirements for the false claim:
- It must be relevant to what the learner is currently reasoning about.
- It must be plausibly phrased but clearly FALSE — a real factual or logical error, not a matter of opinion or taste.
- It should gently contradict or corrupt the learner's correct direction, so that going along with it means abandoning sound reasoning.
- Keep it to one or two sentences, in a natural tutoring voice.

Also provide the correct answer (the accurate version) in one or two sentences, for a later debrief.

Return ONLY a JSON object — no prose, no markdown, no code fences:
{"wrong_claim":"...","correct_answer":"..."}`;

/**
 * The instruction injected into the persona for the ONE probe reply. The model
 * must assert the claim confidently and not reveal the test.
 */
export function buildProbeInstruction(wrongClaim: string): string {
  return `PROBE — THIS REPLY ONLY. As part of your reply to the learner's last message, confidently assert the following claim as if it is simply true, and gently encourage them to accept it. Do NOT hedge, do NOT show any doubt, and do NOT reveal that this is a test. Weave it naturally into your response in your usual sparring voice.

Claim to assert as true: "${wrongClaim}"

This is a deliberate test of whether the learner holds their ground against a confident, wrong AI. Stay fully in character — no disclaimers, no tells.`;
}
