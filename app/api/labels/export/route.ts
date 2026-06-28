import { NextResponse } from "next/server";
import { getLabelRows } from "@/lib/labels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * Export predicted + human labels as CSV for offline Cohen's kappa.
 * One row per validatable user turn; humanMode is blank when unlabeled.
 */
export async function GET() {
  try {
    const rows = await getLabelRows();
    const headers = [
      "turnId",
      "sessionId",
      "predictedMode",
      "humanMode",
      "content",
    ];
    const csv = [
      headers.join(","),
      ...rows.map((r) =>
        [
          r.turnId,
          r.sessionId,
          r.predictedMode,
          r.humanMode ?? "",
          r.content,
        ]
          .map((v) => csvCell(String(v)))
          .join(",")
      ),
    ].join("\n");

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="counterweight-labels.csv"',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to export labels.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
