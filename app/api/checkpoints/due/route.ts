import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Due, uncompleted re-checks (dueAt <= now). No cron anywhere — the chat page
 * fetches this on load. Each entry carries a hint (the first original question)
 * so the strip can say what's being re-tested.
 */
export async function GET() {
  try {
    const due = await prisma.checkpoint.findMany({
      where: { completedAt: null, dueAt: { lte: new Date() } },
      orderBy: { dueAt: "asc" },
      take: 20,
    });

    const parentIds = [
      ...new Set(due.map((d) => d.parentId).filter((p): p is string => !!p)),
    ];
    const parents = parentIds.length
      ? await prisma.checkpoint.findMany({
          where: { id: { in: parentIds } },
          include: { items: { orderBy: { order: "asc" }, take: 1 } },
        })
      : [];
    const hintByParent = new Map(
      parents.map((p) => [p.id, p.items[0]?.question ?? null])
    );

    return NextResponse.json({
      checkpoints: due.map((d) => ({
        id: d.id,
        dueAt: d.dueAt,
        kind: d.kind,
        hint: d.parentId ? (hintByParent.get(d.parentId) ?? null) : null,
      })),
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load due re-checks.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
