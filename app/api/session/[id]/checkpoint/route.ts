import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateCheckpoint } from "@/lib/checkpoint";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Generate (or resume) the session's solo checkpoint. Returns only item ids and
 * questions — the expectedGist grading key never leaves the server.
 */
export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const sessionId = params.id;
  try {
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
    });
    if (!session) {
      return NextResponse.json({ error: "Session not found." }, { status: 404 });
    }

    const checkpoint = await generateCheckpoint(sessionId);
    if (!checkpoint) {
      return NextResponse.json(
        {
          error:
            "Not enough conversation for a solo check yet — have a few more substantive turns first.",
        },
        { status: 422 }
      );
    }

    return NextResponse.json({
      checkpointId: checkpoint.id,
      items: checkpoint.items.map((it) => ({
        id: it.id,
        question: it.question,
      })),
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create the checkpoint.";
    console.error("[checkpoint] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
