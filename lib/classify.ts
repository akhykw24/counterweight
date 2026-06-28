import { getClient, getModel } from "@/lib/models";
import { CLASSIFIER_PROMPT } from "@/lib/prompts/classifier";
import { extractJsonObject } from "@/lib/json";
import type { Mode } from "@/lib/prompts/modes";

export type Classification = {
  mode: Mode;
  confidence: number;
  signals: string[];
  abstain: boolean;
};

export type HistoryMessage = { role: "user" | "assistant"; content: string };

const MODES: Mode[] = ["STUCK", "OUTSOURCING", "ENGAGED", "DISTRESSED"];

/** Default when the model errors or returns unparseable output. */
const FALLBACK: Classification = {
  mode: "ENGAGED",
  confidence: 0.5,
  signals: [],
  abstain: true,
};

/** Coerce arbitrary parsed JSON into a valid Classification. */
function coerce(obj: unknown): Classification {
  if (!obj || typeof obj !== "object") return { ...FALLBACK };
  const o = obj as Record<string, unknown>;

  const mode = MODES.includes(o.mode as Mode) ? (o.mode as Mode) : FALLBACK.mode;

  let confidence =
    typeof o.confidence === "number" ? o.confidence : FALLBACK.confidence;
  if (!Number.isFinite(confidence)) confidence = FALLBACK.confidence;
  confidence = Math.min(1, Math.max(0, confidence));

  const signals = Array.isArray(o.signals)
    ? o.signals.filter((s): s is string => typeof s === "string").slice(0, 6)
    : [];

  const abstain = typeof o.abstain === "boolean" ? o.abstain : false;

  return { mode, confidence, signals, abstain };
}

/**
 * Classify how the user is working this turn.
 * Calls the CHEAP model with the classifier prompt and parses defensively.
 * Never throws — returns the ENGAGED fallback on any failure.
 */
export async function classifyTurn(
  history: HistoryMessage[],
  userMessage: string
): Promise<Classification> {
  try {
    const client = getClient("cheap");
    const model = getModel("cheap");

    // Compact transcript of recent context (keeps the cheap call small).
    const recent = history.slice(-6);
    const transcript = recent
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n");

    const userContent =
      (transcript ? `Conversation so far:\n${transcript}\n\n` : "") +
      `Latest user message to classify:\n"""${userMessage}"""\n\nReturn ONLY the JSON object.`;

    const completion = await client.chat.completions.create({
      model,
      max_tokens: 300,
      temperature: 0,
      messages: [
        { role: "system", content: CLASSIFIER_PROMPT },
        { role: "user", content: userContent },
      ],
    });

    const raw = completion.choices?.[0]?.message?.content ?? "";
    const parsed = extractJsonObject(raw);
    if (parsed == null) return { ...FALLBACK };
    return coerce(parsed);
  } catch (err) {
    console.error(
      "[classifyTurn] error:",
      err instanceof Error ? err.message : err
    );
    return { ...FALLBACK };
  }
}
