import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Per-session trend data, oldest to newest: Independence Index plus the
 * session's solo checkpoint score and its latest retention score ("what
 * stuck"). Only sessions with at least one scored turn are included.
 * (No user auth yet — returns all sessions; research mode scopes per participant.)
 */
export async function GET() {
  try {
    const sessions = await prisma.session.findMany({
      where: { metric: { turnsScored: { gt: 0 } } },
      include: {
        metric: true,
        checkpoints: { where: { completedAt: { not: null } } },
      },
      orderBy: { startedAt: "asc" },
      take: 100,
    });

    const latestOf = (list: { completedAt: Date | null; score: number | null }[]) =>
      list
        .filter((c) => c.score !== null)
        .sort(
          (a, b) =>
            (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0)
        )[0]?.score ?? null;

    const points = sessions.map((s, i) => ({
      session: i + 1,
      id: s.id,
      startedAt: s.startedAt,
      independenceIndex: s.metric?.independenceIndex ?? 0,
      turnsScored: s.metric?.turnsScored ?? 0,
      soloScore: latestOf(s.checkpoints.filter((c) => c.kind === "immediate")),
      retentionScore: latestOf(
        s.checkpoints.filter((c) => c.kind === "retention")
      ),
    }));

    return NextResponse.json({ points });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load trends.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
