import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ensureCheckpointItems } from "@/lib/checkpoint";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Open a checkpoint for answering. Retention re-checks are created without
 * items; on first open this generates same-concept variants from the parent's
 * items (one cheap-model call). Returns only ids + questions — the grading key
 * stays server-side.
 */
export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const existing = await prisma.checkpoint.findUnique({
      where: { id: params.id },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "Checkpoint not found." },
        { status: 404 }
      );
    }
    if (existing.completedAt) {
      return NextResponse.json(
        { error: "This re-check is already completed." },
        { status: 409 }
      );
    }

    const checkpoint = await ensureCheckpointItems(existing.id);
    if (!checkpoint || checkpoint.items.length === 0) {
      return NextResponse.json(
        { error: "Could not prepare this re-check — its source items are missing." },
        { status: 422 }
      );
    }

    if (!checkpoint.startedAt) {
      await prisma.checkpoint.update({
        where: { id: checkpoint.id },
        data: { startedAt: new Date() },
      });
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
      err instanceof Error ? err.message : "Failed to start the re-check.";
    console.error("[checkpoint start] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
