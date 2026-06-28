import { getClient, getModel } from "@/lib/models";
import { JUDGE_PROMPT } from "@/lib/prompts/judge";
import { extractJsonObject } from "@/lib/json";

export type JudgeScores = {
  reasoning_depth: number; // 0..2
  asked_to_produce: boolean;
  verified_claim: boolean;
  conceded_to_ai: boolean;
};

/** Neutral default: assume no offload/verify/concede and no reasoning shown. */
const FALLBACK: JudgeScores = {
  reasoning_depth: 0,
  asked_to_produce: false,
  verified_claim: false,
  conceded_to_ai: false,
};

function coerce(obj: unknown): JudgeScores {
  if (!obj || typeof obj !== "object") return { ...FALLBACK };
  const o = obj as Record<string, unknown>;

  let depth =
    typeof o.reasoning_depth === "number" ? Math.round(o.reasoning_depth) : 0;
  if (!Number.isFinite(depth)) depth = 0;
  depth = Math.min(2, Math.max(0, depth));

  return {
    reasoning_depth: depth,
    asked_to_produce: o.asked_to_produce === true,
    verified_claim: o.verified_claim === true,
    conceded_to_ai: o.conceded_to_ai === true,
  };
}

/**
 * Score a single user turn given the assistant's previous message.
 * Calls the CHEAP model with the telemetry-judge prompt and parses defensively.
 * Never throws — returns the neutral fallback on any failure.
 */
export async function judgeTurn(
  aiPrev: string,
  userTurn: string
): Promise<JudgeScores> {
  try {
    const client = getClient("cheap");
    const model = getModel("cheap");

    const userContent =
      `Assistant's previous message:\n"""${aiPrev || "(none)"}"""\n\n` +
      `Learner's reply to score:\n"""${userTurn}"""\n\nReturn ONLY the JSON object.`;

    const completion = await client.chat.completions.create({
      model,
      max_tokens: 200,
      temperature: 0,
      messages: [
        { role: "system", content: JUDGE_PROMPT },
        { role: "user", content: userContent },
      ],
    });

    const raw = completion.choices?.[0]?.message?.content ?? "";
    const parsed = extractJsonObject(raw);
    if (parsed == null) return { ...FALLBACK };
    return coerce(parsed);
  } catch (err) {
    console.error(
      "[judgeTurn] error:",
      err instanceof Error ? err.message : err
    );
    return { ...FALLBACK };
  }
}
