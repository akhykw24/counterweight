import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Current metrics for a session. Returns zeros if nothing has been scored yet. */
export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const sessionId = params.id;
  try {
    const metric = await prisma.metric.findUnique({ where: { sessionId } });

    if (!metric) {
      return NextResponse.json({
        sessionId,
        offloadRatio: 0,
        verificationRate: 0,
        caveRate: 0,
        acceptanceLatency: 0,
        independenceIndex: 0,
        turnsScored: 0,
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
      updatedAt: metric.updatedAt,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load metrics.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
