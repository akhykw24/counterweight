import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Row = {
  participantId: string;
  condition: string;
  offloadRatio: number;
  verificationRate: number;
  caveRate: number;
  acceptanceLatency: number;
  independenceIndex: number;
  turnCount: number;
  probeCount: number;
  cavedCount: number;
  startedAt: string;
  endedAt: string;
};

const HEADERS: (keyof Row)[] = [
  "participantId",
  "condition",
  "offloadRatio",
  "verificationRate",
  "caveRate",
  "acceptanceLatency",
  "independenceIndex",
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
        _count: { select: { turns: true } },
      },
      orderBy: { startedAt: "asc" },
    });

    const rows: Row[] = sessions
      .filter((s) => s._count.turns > 0)
      .map((s) => ({
        participantId: s.participantId ?? "",
        condition: s.condition,
        offloadRatio: s.metric?.offloadRatio ?? 0,
        verificationRate: s.metric?.verificationRate ?? 0,
        caveRate: s.metric?.caveRate ?? 0,
        acceptanceLatency: s.metric?.acceptanceLatency ?? 0,
        independenceIndex: s.metric?.independenceIndex ?? 0,
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
