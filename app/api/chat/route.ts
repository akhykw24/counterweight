import { NextRequest, NextResponse } from "next/server";
import type OpenAI from "openai";
import { getClient, getModel } from "@/lib/models";
import { assemblePersona } from "@/lib/assemblePrompt";
import { classifyTurn, type HistoryMessage } from "@/lib/classify";
import type { Mode } from "@/lib/prompts/modes";

// LLM calls must run on the Node runtime (server-side only) — never expose keys.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type IncomingMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

// Below this confidence the classifier isn't trusted; default to ENGAGED.
const CONFIDENCE_FLOOR = 0.6;

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 }
    );
  }

  const messages = (body as { messages?: unknown })?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json(
      { error: "Body must include a non-empty `messages` array." },
      { status: 400 }
    );
  }

  // Keep only well-formed user/assistant turns; we supply the system prompt.
  const history: HistoryMessage[] = (messages as IncomingMessage[])
    .filter(
      (m) =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string"
    )
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  if (history.length === 0) {
    return NextResponse.json(
      { error: "No valid user/assistant messages were provided." },
      { status: 400 }
    );
  }

  // Find the latest user message — that's what we classify and route on.
  let lastUserIdx = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "user") {
      lastUserIdx = i;
      break;
    }
  }

  // Classify how the user is working, then pick the mode (low confidence -> ENGAGED).
  let mode: Mode = "ENGAGED";
  let confidence = 0.5;
  if (lastUserIdx !== -1) {
    const userMessage = history[lastUserIdx].content;
    const prior = history.slice(0, lastUserIdx);
    const classification = await classifyTurn(prior, userMessage);
    confidence = classification.confidence;
    mode =
      classification.confidence < CONFIDENCE_FLOOR
        ? "ENGAGED"
        : classification.mode;
  }

  try {
    const systemPrompt = assemblePersona(mode);
    const client = getClient("persona");

    const personaMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
      [
        { role: "system", content: systemPrompt },
        ...history.map((m) => ({ role: m.role, content: m.content })),
      ];

    const completion = await client.chat.completions.create({
      model: getModel("persona"),
      max_tokens: 1024,
      messages: personaMessages,
    });

    const reply = completion.choices?.[0]?.message?.content?.trim() ?? "";
    return NextResponse.json({ reply, mode, confidence });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to generate a reply.";
    console.error("[/api/chat] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
