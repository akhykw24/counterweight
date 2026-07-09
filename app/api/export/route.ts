import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { latestCompletedScore } from "@/lib/checkpoint";
import { parseTopics } from "@/lib/topics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Row = {
  participantId: string;
  condition: string;
  topics: string;
  offloadRatio: number;
  verificationRate: number;
  caveRate: number;
  acceptanceLatency: number;
  independenceIndex: number;
  soloScore: number | string;
  retentionScore: number | string;
  turnCount: number;
  probeCount: number;
  cavedCount: number;
  startedAt: string;
  endedAt: string;
};

const HEADERS: (keyof Row)[] = [
  "participantId",
  "condition",
  "topics",
  "offloadRatio",
  "verificationRate",
  "caveRate",
  "acceptanceLatency",
  "independenceIndex",
  "soloScore",
  "retentionScore",
  "turnCount",
  "probeCount",
  "cavedCount",
  "startedAt",
  "endedAt",
];

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Export sessions, one row per session (those with at least one turn).
 * `?format=json` returns JSON; otherwise a downloadable CSV.
 */
export async function GET(req: Request) {
  const format =
    new URL(req.url).searchParams.get("format") === "json" ? "json" : "csv";

  try {
    const sessions = await prisma.session.findMany({
      include: {
        metric: true,
        probes: true,
        checkpoints: { where: { completedAt: { not: null } } },
        _count: { select: { turns: true } },
      },
      orderBy: { startedAt: "asc" },
    });

    const rows: Row[] = sessions
      .filter((s) => s._count.turns > 0)
      .map((s) => ({
        participantId: s.participantId ?? "",
        condition: s.condition,
        topics: parseTopics(s.topics).join("; "),
        offloadRatio: s.metric?.offloadRatio ?? 0,
        verificationRate: s.metric?.verificationRate ?? 0,
        caveRate: s.metric?.caveRate ?? 0,
        acceptanceLatency: s.metric?.acceptanceLatency ?? 0,
        independenceIndex: s.metric?.independenceIndex ?? 0,
        soloScore: latestCompletedScore(s.checkpoints, "immediate") ?? "",
        retentionScore: latestCompletedScore(s.checkpoints, "retention") ?? "",
        turnCount: s._count.turns,
        probeCount: s.probes.length,
        cavedCount: s.probes.filter((p) => p.caved === true).length,
        startedAt: s.startedAt.toISOString(),
        endedAt: s.endedAt ? s.endedAt.toISOString() : "",
      }));

    if (format === "json") {
      return NextResponse.json({ rows });
    }

    const csv = [
      HEADERS.join(","),
      ...rows.map((r) => HEADERS.map((h) => csvCell(r[h])).join(",")),
    ].join("\n");

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="counterweight-export.csv"',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to export.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
