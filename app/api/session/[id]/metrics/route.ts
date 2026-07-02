import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Current metrics for a session (zeros if nothing scored yet), plus the
 * session's latest completed Solo Score (null until a checkpoint is done).
 */
export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const sessionId = params.id;
  try {
    const [metric, latestCheckpoint] = await Promise.all([
      prisma.metric.findUnique({ where: { sessionId } }),
      prisma.checkpoint.findFirst({
        where: { sessionId, completedAt: { not: null } },
        orderBy: { completedAt: "desc" },
      }),
    ]);

    const soloScore = latestCheckpoint?.score ?? null;

    if (!metric) {
      return NextResponse.json({
        sessionId,
        offloadRatio: 0,
        verificationRate: 0,
        caveRate: 0,
        acceptanceLatency: 0,
        independenceIndex: 0,
        turnsScored: 0,
        soloScore,
      });
    }

    return NextResponse.json({
      sessionId,
      offloadRatio: metric.offloadRatio,
      verificationRate: metric.verificationRate,
      caveRate: metric.caveRate,
      acceptanceLatency: metric.acceptanceLatency,
      independenceIndex: metric.independenceIndex,
      turnsScored: metric.turnsScored,
      soloScore,
      updatedAt: metric.updatedAt,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load metrics.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
