/**
 * Topic tagging (docs/WEEK2.md Day 12) — one CHEAP call on session end.
 * Tags feed the readiness board, which groups sessions by what was studied.
 */
export const TOPIC_PROMPT = `You tag study sessions for a readiness board. Given a tutoring conversation, extract 1-3 short topic tags naming what the learner was actually working on.

Rules:
- Each tag is 1-3 words, lowercase, and specific enough to be useful ("chain rule", not "math"; "causes of ww1", not "history").
- Tag the learner's working topics — not concepts mentioned in passing.
- Fewer, better tags beat more. One tag is fine for a focused session.

Return ONLY JSON — no prose, no markdown, no code fences:
{"topics":["...","..."]}`;
