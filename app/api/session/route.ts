import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONDITIONS = ["vanilla", "refuse", "effort_aware"] as const;
type Condition = (typeof CONDITIONS)[number];

/**
 * Create a research session with a participant id, consent flag, and assigned
 * condition. The chat route reads `condition` off the session to pick behaviour.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      participantId?: unknown;
      condition?: unknown;
      consent?: unknown;
    };

    let condition: string =
      typeof body.condition === "string" ? body.condition : "effort_aware";
    if (condition === "random") {
      condition = CONDITIONS[Math.floor(Math.random() * CONDITIONS.length)];
    }
    if (!CONDITIONS.includes(condition as Condition)) condition = "effort_aware";

    const participantId =
      typeof body.participantId === "string" && body.participantId.trim()
        ? body.participantId.trim()
        : null;

    const consentFlags = JSON.stringify({
      consented: body.consent === true,
      at: new Date().toISOString(),
    });

    const session = await prisma.session.create({
      data: { condition, participantId, consentFlags },
    });

    return NextResponse.json({
      sessionId: session.id,
      condition: session.condition,
      participantId,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create session.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
