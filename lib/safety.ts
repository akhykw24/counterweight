import { getClient, getModel } from "@/lib/models";
import { extractJsonObject } from "@/lib/json";
import { SAFETY_PROMPT } from "@/lib/prompts/safety";

export type SafetyCategory = "crisis" | "integrity" | "none";

// High-precision explicit self-harm phrases. If any match, we treat the turn as
// a crisis regardless of what the model says (a safety net for false negatives).
const CRISIS_PATTERNS =
  /\b(kill(?:ing)? myself|end(?:ing)? my life|take my (?:own )?life|want(?:ing)? to die|wanna die|don'?t want to (?:live|be alive)|hurt(?:ing)? myself|harm(?:ing)? myself|self[-\s]?harm|suicid(?:e|al)|no reason to (?:live|go on))\b/i;

/**
 * Safety gate, run BEFORE classification on each user message.
 * Returns the category so the route can bypass (crisis) or redirect (integrity).
 * Never throws — defaults to "none" so normal study help is never blocked by an
 * error (the keyword net still catches explicit crisis).
 */
export async function runSafetyGate(
  userMessage: string
): Promise<{ category: SafetyCategory }> {
  if (CRISIS_PATTERNS.test(userMessage)) return { category: "crisis" };

  try {
    const client = getClient("cheap");
    const completion = await client.chat.completions.create({
      model: getModel("cheap"),
      max_tokens: 50,
      temperature: 0,
      messages: [
        { role: "system", content: SAFETY_PROMPT },
        {
          role: "user",
          content: `Message to classify:\n"""${userMessage}"""\n\nReturn ONLY the JSON.`,
        },
      ],
    });
    const parsed = extractJsonObject(
      completion.choices?.[0]?.message?.content ?? ""
    );
    const cat = (parsed as { category?: unknown } | null)?.category;
    if (cat === "crisis" || cat === "integrity" || cat === "none") {
      return { category: cat };
    }
    return { category: "none" };
  } catch (err) {
    console.error(
      "[runSafetyGate] error:",
      err instanceof Error ? err.message : err
    );
    return { category: "none" };
  }
}
