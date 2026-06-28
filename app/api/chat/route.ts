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
import { maybeFireProbe, buildDebrief } from "@/lib/probe";
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
 * blocks the reply (used for ordinary turns).
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
    // Resolve or create the session (the first message starts one).
    const incomingSessionId =
      typeof b.sessionId === "string" ? b.sessionId : null;
    let session = incomingSessionId
      ? await prisma.session.findUnique({ where: { id: incomingSessionId } })
      : null;
    if (!session) session = await prisma.session.create({ data: {} });
    const sessionId = session.id;

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

    // 1) SAFETY GATE — runs before classification on every message.
    const safety = await runSafetyGate(userMessage);

    // 2) POST-PROBE TURN — resolve the open probe and debrief.
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

      // Crisis takes precedence even mid-probe (the probe is already resolved).
      if (safety.category === "crisis") {
        await prisma.turn.create({
          data: {
            sessionId,
            index: aiIndex,
            role: "assistant",
            content: CRISIS_RESPONSE,
            mode: "SAFETY",
          },
        });
        return NextResponse.json({
          reply: CRISIS_RESPONSE,
          mode: "SAFETY",
          confidence: 1,
          sessionId,
        });
      }

      const debrief = buildDebrief(
        openProbe?.wrongClaim ?? "",
        openProbe?.correctAnswer ?? "",
        caved
      );
      await prisma.turn.create({
        data: {
          sessionId,
          index: aiIndex,
          role: "assistant",
          content: debrief,
          mode: "DEBRIEF",
        },
      });
      return NextResponse.json({
        reply: debrief,
        mode: "DEBRIEF",
        confidence: 1,
        sessionId,
      });
    }

    // 3) CRISIS — bypass everything with a supportive reply. No gating/probing/judging.
    if (safety.category === "crisis") {
      await prisma.turn.create({
        data: {
          sessionId,
          index: aiIndex,
          role: "assistant",
          content: CRISIS_RESPONSE,
          mode: "SAFETY",
        },
      });
      return NextResponse.json({
        reply: CRISIS_RESPONSE,
        mode: "SAFETY",
        confidence: 1,
        sessionId,
      });
    }

    // 4) Determine the mode. Academic-integrity asks skip the classifier and are
    //    redirected via OUTSOURCING (never produce the gradeable deliverable).
    let mode: Mode;
    let confidence: number;
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
        confidence < CONFIDENCE_FLOOR ? "ENGAGED" : classification.mode;
    }

    // 5) Probe scheduler (never for integrity; maybeFireProbe enforces the rest).
    const probeSpec =
      safety.category === "integrity"
        ? null
        : await maybeFireProbe(session, mode, history);

    // 6) Generate the persona reply (with the probe instruction if firing).
    const systemPrompt = assemblePersona(
      mode,
      probeSpec ? buildProbeInstruction(probeSpec.wrongClaim) : undefined
    );
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

    // 7) Persist the AI turn.
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

    // 8) If a probe fired, record it and flag the session to evaluate caving next turn.
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

    // 9) Judge this user turn + refresh metrics, without blocking the reply.
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
