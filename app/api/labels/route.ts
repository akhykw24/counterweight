import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getLabelRows, agreementOf, CLASSIFIER_MODES } from "@/lib/labels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** List label rows (user turn + predicted mode + human label) and agreement. */
export async function GET() {
  try {
    const rows = await getLabelRows();
    const agreement = agreementOf(rows);
    return NextResponse.json({
      // drop createdAt from the wire payload
      rows: rows.map(({ createdAt: _createdAt, ...r }) => r),
      agreement,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load labels.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Save (or clear) a human "true" mode label for one user turn. */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      turnId?: unknown;
      humanMode?: unknown;
    };
    const turnId = typeof body.turnId === "string" ? body.turnId : null;
    if (!turnId) {
      return NextResponse.json({ error: "turnId is required." }, { status: 400 });
    }

    let humanMode: string | null;
    if (body.humanMode === "" || body.humanMode == null) {
      humanMode = null; // clear the label
    } else if (
      typeof body.humanMode === "string" &&
      CLASSIFIER_MODES.includes(body.humanMode)
    ) {
      humanMode = body.humanMode;
    } else {
      return NextResponse.json(
        { error: "humanMode must be one of the four modes, or empty to clear." },
        { status: 400 }
      );
    }

    await prisma.turn.update({ where: { id: turnId }, data: { humanMode } });
    return NextResponse.json({ ok: true, turnId, humanMode });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save label.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
