import { NextRequest, NextResponse } from "next/server";
import type OpenAI from "openai";
import { getClient, getModel } from "@/lib/models";
import { BASE_PERSONA } from "@/lib/prompts/persona";

// LLM calls must run on the Node runtime (server-side only) — never expose keys.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type IncomingMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

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
  const history: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = (
    messages as IncomingMessage[]
  )
    .filter(
      (m) =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string"
    )
    .map((m) => ({ role: m.role, content: m.content }));

  if (history.length === 0) {
    return NextResponse.json(
      { error: "No valid user/assistant messages were provided." },
      { status: 400 }
    );
  }

  try {
    const client = getClient("persona");
    const completion = await client.chat.completions.create({
      model: getModel("persona"),
      max_tokens: 1024,
      messages: [{ role: "system", content: BASE_PERSONA }, ...history],
    });

    const reply = completion.choices?.[0]?.message?.content?.trim() ?? "";
    return NextResponse.json({ reply });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to generate a reply.";
    console.error("[/api/chat] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
