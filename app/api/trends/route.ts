import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Independence Index across sessions, oldest to newest. Only sessions with at
 * least one scored turn are included so the trend line is meaningful.
 * (No user auth yet — returns all sessions; Day 6 scopes this per participant.)
 */
export async function GET() {
  try {
    const sessions = await prisma.session.findMany({
      where: { metric: { turnsScored: { gt: 0 } } },
      include: { metric: true },
      orderBy: { startedAt: "asc" },
      take: 100,
    });

    const points = sessions.map((s, i) => ({
      session: i + 1,
      id: s.id,
      startedAt: s.startedAt,
      independenceIndex: s.metric?.independenceIndex ?? 0,
      turnsScored: s.metric?.turnsScored ?? 0,
    }));

    return NextResponse.json({ points });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load trends.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
