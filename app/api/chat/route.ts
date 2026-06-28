import { NextRequest, NextResponse } from "next/server";
import type OpenAI from "openai";
import { getClient, getModel } from "@/lib/models";
import { assemblePersona } from "@/lib/assemblePrompt";
import { classifyTurn, type HistoryMessage } from "@/lib/classify";
import { judgeTurn } from "@/lib/judge";
import { computeMetrics } from "@/lib/metrics";
import { prisma } from "@/lib/db";
import type { Mode } from "@/lib/prompts/modes";
import { runSafetyGate } from "@/lib/safety";
import { CRISIS_RESPONSE } from "@/lib/prompts/safety";
import { VANILLA_PROMPT, REFUSE_PROMPT } from "@/lib/prompts/conditions";
import { maybeFireProbe, buildDebrief, type ProbeSpec } from "@/lib/probe";
import { buildProbeInstruction } from "@/lib/prompts/probe";

// LLM + DB calls must run on the Node runtime (server-side only) — never expose keys.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type IncomingMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

// Below this confidence the classifier isn't trusted; default to ENGAGED.
const CONFIDENCE_FLOOR = 0.6;

/** Recompute the four metrics + Independence Index and persist them. */
async function refreshMetrics(sessionId: string) {
  const turns = await prisma.turn.findMany({
    where: { sessionId },
    orderBy: { index: "asc" },
  });
  const m = computeMetrics(turns);
  await prisma.metric.upsert({
    where: { sessionId },
    create: { sessionId, ...m },
    update: { ...m },
  });
}

/** Persist judge scores onto a user turn. */
async function persistJudge(
  userTurnId: string,
  scores: Awaited<ReturnType<typeof judgeTurn>>
) {
  await prisma.turn.update({
    where: { id: userTurnId },
    data: {
      reasoningDepth: scores.reasoning_depth,
      askedToProduce: scores.asked_to_produce,
      verifiedClaim: scores.verified_claim,
      concededToAi: scores.conceded_to_ai,
    },
  });
}

/**
 * Judge the user turn + refresh metrics. Fired WITHOUT awaiting so it never
 * blocks the reply. Telemetry runs in every condition so the arms are comparable.
 */
async function scoreAndUpdate(opts: {
  userTurnId: string;
  sessionId: string;
  aiPrev: string;
  userContent: string;
}) {
  try {
    const scores = await judgeTurn(opts.aiPrev, opts.userContent);
    await persistJudge(opts.userTurnId, scores);
    await refreshMetrics(opts.sessionId);
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

  const history: HistoryMessage[] = (b.messages as IncomingMessage[])
    .filter(
      (m) =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string"
    )
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

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
    // Resolve or create the session (the first message starts an effort_aware one).
    const incomingSessionId =
      typeof b.sessionId === "string" ? b.sessionId : null;
    let session = incomingSessionId
      ? await prisma.session.findUnique({ where: { id: incomingSessionId } })
      : null;
    if (!session) session = await prisma.session.create({ data: {} });
    const sessionId = session.id;
    const condition = session.condition; // "vanilla" | "refuse" | "effort_aware"

    // Persist the user turn, recording acceptance latency since the last AI turn.
    const turnCount = await prisma.turn.count({ where: { sessionId } });
    const aiIndex = turnCount + 1;
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

    // 1) SAFETY GATE — runs first in every condition (crisis is an ethical floor,
    //    not part of the experimental manipulation).
    const safety = await runSafetyGate(userMessage);

    // 2) POST-PROBE TURN — only effort_aware ever sets awaitingCaveEval.
    if (session.awaitingCaveEval) {
      const scores = await judgeTurn(aiPrev, userMessage);
      await persistJudge(userTurn.id, scores);
      const caved = scores.conceded_to_ai;

      const openProbe = await prisma.probe.findFirst({
        where: { sessionId, resolvedAt: null },
        orderBy: { firedAt: "desc" },
      });
      if (openProbe) {
        await prisma.probe.update({
          where: { id: openProbe.id },
          data: { caved, resolvedAt: new Date() },
        });
      }
      await prisma.session.update({
        where: { id: sessionId },
        data: { awaitingCaveEval: false },
      });
      await refreshMetrics(sessionId);

      if (safety.category === "crisis") {
        await prisma.turn.create({
          data: { sessionId, index: aiIndex, role: "assistant", content: CRISIS_RESPONSE, mode: "SAFETY" },
        });
        return NextResponse.json({ reply: CRISIS_RESPONSE, mode: "SAFETY", confidence: null, sessionId });
      }

      const debrief = buildDebrief(
        openProbe?.wrongClaim ?? "",
        openProbe?.correctAnswer ?? "",
        caved
      );
      await prisma.turn.create({
        data: { sessionId, index: aiIndex, role: "assistant", content: debrief, mode: "DEBRIEF" },
      });
      return NextResponse.json({ reply: debrief, mode: "DEBRIEF", confidence: null, sessionId });
    }

    // 3) CRISIS — bypass everything with a supportive reply, in every condition.
    if (safety.category === "crisis") {
      await prisma.turn.create({
        data: { sessionId, index: aiIndex, role: "assistant", content: CRISIS_RESPONSE, mode: "SAFETY" },
      });
      return NextResponse.json({ reply: CRISIS_RESPONSE, mode: "SAFETY", confidence: null, sessionId });
    }

    // 4) Pick behaviour by condition.
    let systemPrompt: string;
    let mode: string;
    let confidence: number | null;
    let probeSpec: ProbeSpec | null = null;

    if (condition === "vanilla") {
      systemPrompt = VANILLA_PROMPT;
      mode = "VANILLA";
      confidence = null;
    } else if (condition === "refuse") {
      systemPrompt = REFUSE_PROMPT;
      mode = "REFUSE";
      confidence = null;
    } else {
      // effort_aware: integrity asks skip the classifier and redirect via OUTSOURCING.
      if (safety.category === "integrity") {
        mode = "OUTSOURCING";
        confidence = 1;
      } else {
        const classification = await classifyTurn(
          history.slice(0, lastUserIdx),
          userMessage
        );
        confidence = classification.confidence;
        mode =
          classification.confidence < CONFIDENCE_FLOOR
            ? "ENGAGED"
            : classification.mode;
      }
      probeSpec =
        safety.category === "integrity"
          ? null
          : await maybeFireProbe(session, mode as Mode, history);
      systemPrompt = assemblePersona(
        mode as Mode,
        probeSpec ? buildProbeInstruction(probeSpec.wrongClaim) : undefined
      );
    }

    // 5) Generate the reply.
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

    // 6) Persist the AI turn.
    const aiTurn = await prisma.turn.create({
      data: {
        sessionId,
        index: aiIndex,
        role: "assistant",
        content: reply,
        mode,
        confidence,
        isProbe: !!probeSpec,
      },
    });

    // 7) If a probe fired, record it and flag the session for cave evaluation.
    if (probeSpec) {
      await prisma.probe.create({
        data: {
          sessionId,
          turnId: aiTurn.id,
          wrongClaim: probeSpec.wrongClaim,
          correctAnswer: probeSpec.correctAnswer,
        },
      });
      await prisma.session.update({
        where: { id: sessionId },
        data: { awaitingCaveEval: true },
      });
    }

    // 8) Judge this user turn + refresh metrics, without blocking the reply.
    void scoreAndUpdate({
      userTurnId: userTurn.id,
      sessionId,
      aiPrev,
      userContent: userMessage,
    });

    return NextResponse.json({ reply, mode, confidence, sessionId });
  } catch (err) {
    // Surface free-tier rate limits as a friendly, actionable message.
    const status = (err as { status?: number })?.status;
    const message =
      err instanceof Error ? err.message : "Failed to generate a reply.";
    if (status === 429 || /\b429\b|rate limit/i.test(message)) {
      console.warn("[/api/chat] rate limited");
      return NextResponse.json(
        {
          error:
            "The free model is rate-limited right now. Give it a moment and try again.",
        },
        { status: 429 }
      );
    }
    console.error("[/api/chat] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

