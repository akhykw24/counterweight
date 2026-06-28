/**
 * Safety prompts (docs/SPEC.md §15 — safety / ethics).
 *
 * Authored to match design intent. The safety gate runs BEFORE classification.
 * Crisis bypasses everything with a supportive reply; academic-integrity asks
 * are redirected (handled by forcing OUTSOURCING mode in the route).
 */

/** CHEAP-model classifier: crisis vs integrity vs none. Returns strict JSON. */
export const SAFETY_PROMPT = `You are a safety gate for a study tool. Read the user's latest message and classify it into ONE category. Return ONLY JSON.

Categories:
- "crisis": signs of self-harm, suicidal thoughts, intent to hurt themselves, or severe hopelessness/despair about life itself (NOT ordinary academic stress). Err toward "crisis" if there is genuine risk to the person.
- "integrity": they are asking you to produce a gradeable deliverable they will submit as their own — e.g. "write the essay I'll hand in", "do my assignment", "give me the answers to my graded quiz". The defining feature is producing finished work to be turned in for credit.
- "none": anything else, including ordinary study help, frustration, or academic stress/overwhelm.

Return ONLY: {"category":"crisis|integrity|none"}

Examples:
"i don't want to be here anymore, nothing matters" -> {"category":"crisis"}
"write my 5-page history essay due tomorrow, I'll submit it as is" -> {"category":"integrity"}
"do my problem set for me and give the final answers" -> {"category":"integrity"}
"I have three exams tomorrow and I'm so overwhelmed, I can't do this" -> {"category":"none"}
"I'm stuck on this derivative, here's what I tried" -> {"category":"none"}
"help me understand the causes of WW1" -> {"category":"none"}`;

/**
 * Templated supportive response for the crisis path. Deterministic on purpose —
 * no model variability when it matters most. Encourages reaching out to a
 * trusted person / professional / local crisis line without gating or probing.
 */
export const CRISIS_RESPONSE = `I'm really glad you told me, and I'm sorry you're carrying this — what you're describing sounds genuinely heavy, and you don't have to face it alone.

I'm just an AI study partner, so I'm not the right kind of support for this. Please reach out to someone you trust — a friend, a family member, or someone close to you — and consider talking to a doctor, counsellor, or a crisis line or helpline in your area. If you might be in immediate danger, please contact your local emergency services right now.

You matter, and reaching out is a strong thing to do. The work will keep — right now, please take care of yourself first. I'm here whenever you're ready to come back to it.`;
