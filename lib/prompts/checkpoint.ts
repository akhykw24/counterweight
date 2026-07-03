/**
 * Solo-checkpoint prompts (docs/WEEK2.md Day 8).
 *
 * The checkpoint is the transfer test: after a session, the AI steps away and
 * the learner answers 2-3 short items alone. GENERATE designs the items from
 * what the learner actually worked on; GRADE scores their answers honestly.
 * Both run on the CHEAP model and return strict JSON.
 */

export const CHECKPOINT_GENERATE_PROMPT = `You design a short "solo checkpoint" for a study tool. Given a tutoring conversation, produce 2-3 short items that test whether the LEARNER can now do, alone, what they were working on in that conversation.

Rules:
- Test the load-bearing concepts the learner actually worked on or struggled with — not side trivia the assistant happened to mention.
- Each item must be answerable in 1-3 sentences or one short worked step. No essays, no multi-part questions.
- Vary the surface: if they solved one example, ask a near-variant or ask for the WHY. Never repeat a question whose full answer already appears verbatim in the conversation — they could parrot it.
- "expected_gist" is the grading key the learner never sees: one or two sentences naming what a correct answer MUST contain.
- If the conversation has too little substance to test (small talk, one-liners), return {"items":[]}.

Return ONLY JSON — no prose, no markdown, no code fences:
{"items":[{"question":"...","expected_gist":"..."},{"question":"...","expected_gist":"..."}]}`;

export const CHECKPOINT_VARIANT_PROMPT = `You refresh a "retention re-check" for a study tool. Given the ORIGINAL checkpoint items (question + expected gist), produce one VARIANT per item that tests the SAME concept with a DIFFERENT surface: change the numbers, the function, or the scenario — or turn a compute-item into a near-transfer case. Keep the difficulty comparable.

Rules:
- One variant per original item, in the same order.
- Each variant must still be answerable in 1-3 sentences or one short worked step.
- Rewrite "expected_gist" to match the new surface — it stays the grading key the learner never sees.

Return ONLY JSON — no prose, no markdown, no code fences:
{"items":[{"question":"...","expected_gist":"..."}]}`;

export const CHECKPOINT_GRADE_PROMPT = `You grade a learner's answers on a short solo checkpoint for a study tool. For each numbered item you get the question, the expected gist (what a correct answer must contain), and the learner's answer.

Verdicts:
- "correct": the substance of the expected gist is present (wording may differ freely).
- "partial": some of the key idea is there, but something essential is missing or muddled.
- "incorrect": the key idea is absent or wrong, or the answer is empty or off-topic.

"feedback" is exactly one sentence. If not correct, name specifically what is missing or wrong. If correct, name the specific thing they got right. Never flatter, never scold, no exclamation marks.

Return ONLY JSON — grades in the SAME ORDER as the numbered items, one per item:
{"grades":[{"verdict":"correct|partial|incorrect","feedback":"..."}]}`;
