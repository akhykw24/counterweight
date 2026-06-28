import { NextRequest, NextResponse } from "next/server";
import type OpenAI from "openai";
import { getClient, getModel } from "@/lib/models";
import { assemblePersona } from "@/lib/assemblePrompt";
import { classifyTurn, type HistoryMessage } from "@/lib/classify";
import { judgeTurn } from "@/lib/judge";
import { computeMetrics } from "@/lib/metrics";
import { prisma } from "@/lib/db";
import type { Mode } from "@/lib/prompts/modes";

// LLM + DB calls must run on the Node runtime (server-side only) — never expose keys.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type IncomingMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

// Below this confidence the classifier isn't trusted; default to ENGAGED.
const CONFIDENCE_FLOOR = 0.6;

/**
 * Score the user turn with the telemetry judge and refresh the session metrics.
 * Fired WITHOUT awaiting so it never blocks the reply to the user.
 */
async function scoreAndUpdate(opts: {
  userTurnId: string;
  sessionId: string;
  aiPrev: string;
  userContent: string;
}) {
  try {
    const scores = await judgeTurn(opts.aiPrev, opts.userContent);
    await prisma.turn.update({
      where: { id: opts.userTurnId },
      data: {
        reasoningDepth: scores.reasoning_depth,
        askedToProduce: scores.asked_to_produce,
        verifiedClaim: scores.verified_claim,
        concededToAi: scores.conceded_to_ai,
      },
    });

    const turns = await prisma.turn.findMany({
      where: { sessionId: opts.sessionId },
      orderBy: { index: "asc" },
    });
    const m = computeMetrics(turns);
    await prisma.metric.upsert({
      where: { sessionId: opts.sessionId },
      create: { sessionId: opts.sessionId, ...m },
      update: { ...m },
    });
  } catch (err) {
    console.error(
      "[scoreAndUpdate] error:",
      err instanceof Error ? err.message : err
    );
  }
}

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

  const b = body as { messages?: unknown; sessionId?: unknown };
  if (!Array.isArray(b?.messages) || b.messages.length === 0) {
    return NextResponse.json(
      { error: "Body must include a non-empty `messages` array." },
      { status: 400 }
    );
  }

  // Keep only well-formed user/assistant turns; we supply the system prompt.
  const history: HistoryMessage[] = (b.messages as IncomingMessage[])
    .filter(
      (m) =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string"
    )
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  // Locate the latest user message — that's what we classify, persist, and judge.
  let lastUserIdx = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "user") {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx === -1) {
    return NextResponse.json(
      { error: "No user message to respond to." },
      { status: 400 }
    );
  }
  const userMessage = history[lastUserIdx].content;
  const aiPrev =
    lastUserIdx > 0 && history[lastUserIdx - 1].role === "assistant"
      ? history[lastUserIdx - 1].content
      : "";

  try {
    // 1) Resolve or create the session (the first message starts one).
    const incomingSessionId =
      typeof b.sessionId === "string" ? b.sessionId : null;
    let session = incomingSessionId
      ? await prisma.session.findUnique({ where: { id: incomingSessionId } })
      : null;
    if (!session) session = await prisma.session.create({ data: {} });
    const sessionId = session.id;

    // 2) Persist the user turn, recording acceptance latency since the last AI turn.
    const turnCount = await prisma.turn.count({ where: { sessionId } });
    const lastAiTurn = await prisma.turn.findFirst({
      where: { sessionId, role: "assistant" },
      orderBy: { index: "desc" },
    });
    const latencyMs = lastAiTurn
      ? Date.now() - lastAiTurn.createdAt.getTime()
      : null;
    const userTurn = await prisma.turn.create({
      data: {
        sessionId,
        index: turnCount,
        role: "user",
        content: userMessage,
        latencyMs,
      },
    });

    // 3) Classify how they're working, then route the mode.
    const classification = await classifyTurn(
      history.slice(0, lastUserIdx),
      userMessage
    );
    const confidence = classification.confidence;
    const mode: Mode =
      confidence < CONFIDENCE_FLOOR ? "ENGAGED" : classification.mode;

    // 4) Generate the persona reply with the active mode block.
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

    // 5) Persist the AI turn with its mode + confidence.
    await prisma.turn.create({
      data: {
        sessionId,
        index: turnCount + 1,
        role: "assistant",
        content: reply,
        mode,
        confidence,
      },
    });

    // 6) Judge the user turn + refresh metrics, without blocking the reply.
    void scoreAndUpdate({
      userTurnId: userTurn.id,
      sessionId,
      aiPrev,
      userContent: userMessage,
    });

    return NextResponse.json({ reply, mode, confidence, sessionId });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to generate a reply.";
    console.error("[/api/chat] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
