import { NextResponse } from "next/server";
import type OpenAI from "openai";
import { prisma } from "@/lib/db";
import { getClient, getModel } from "@/lib/models";
import { REFLECTION_PROMPT } from "@/lib/prompts/reflection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * End-of-session reflection. Loads the session metrics + a trend vs. the same
 * user's previous scored sessions, asks the PERSONA model to reflect, marks the
 * session ended, and returns the reflection text.
 */
export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const sessionId = params.id;
  try {
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: { metric: true },
    });
    if (!session) {
      return NextResponse.json({ error: "Session not found." }, { status: 404 });
    }

    const metric = session.metric;
    if (!metric || metric.turnsScored === 0) {
      return NextResponse.json({
        reflection:
          "We didn't get far enough this session for a meaningful reflection. Come back after a few more turns and I'll have something useful to say about how you worked.",
      });
    }

    // Trend: Independence Index of this user's previous scored sessions.
    const previous = await prisma.session.findMany({
      where: {
        userId: session.userId,
        startedAt: { lt: session.startedAt },
        metric: { turnsScored: { gt: 0 } },
      },
      include: { metric: true },
      orderBy: { startedAt: "asc" },
      take: 8,
    });
    const prevIndices = previous
      .map((s) => s.metric?.independenceIndex)
      .filter((x): x is number => typeof x === "number");

    const trendLine =
      prevIndices.length > 0
        ? `Independence Index of recent past sessions (oldest to newest): [${prevIndices.join(", ")}]. This session: ${metric.independenceIndex}.`
        : `This is the first session with data, so there is no trend yet. This session's Independence Index: ${metric.independenceIndex}.`;

    const dataMessage =
      `Session metrics:\n` +
      `- Independence Index: ${metric.independenceIndex} / 100\n` +
      `- Offload ratio: ${metric.offloadRatio} (share of turns you asked the AI to produce the answer)\n` +
      `- Verification rate: ${metric.verificationRate} (share of turns you checked or pushed on a claim)\n` +
      `- Cave rate: ${metric.caveRate} (share of turns you dropped your own view to agree with the AI)\n` +
      `- Acceptance latency: ${metric.acceptanceLatency}s average (how long before you responded)\n` +
      `- Turns scored: ${metric.turnsScored}\n\n` +
      `${trendLine}\n\nWrite the reflection now.`;

    const client = getClient("persona");
    // gemini-2.5-flash is a thinking model and reasoning tokens count against
    // max_tokens — left on, they eat the whole budget and truncate the visible
    // reflection. The reflection just summarizes metrics, so disable thinking
    // ("reasoning_effort":"none" — a Gemini OpenAI-compat param the SDK type
    // doesn't model, hence the cast).
    const completion = await client.chat.completions.create({
      model: getModel("persona"),
      max_tokens: 1024,
      reasoning_effort: "none",
      messages: [
        { role: "system", content: REFLECTION_PROMPT },
        { role: "user", content: dataMessage },
      ],
    } as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming);
    const reflection = completion.choices?.[0]?.message?.content?.trim() ?? "";

    // Mark the session ended.
    await prisma.session.update({
      where: { id: sessionId },
      data: { endedAt: new Date() },
    });

    return NextResponse.json({
      reflection,
      independenceIndex: metric.independenceIndex,
      trend: [...prevIndices, metric.independenceIndex],
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to generate a reflection.";
    console.error("[reflect] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
