import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  gradeItems,
  scheduleRetention,
  scoreOf,
  RETENTION_MIN_SCORE,
  type Verdict,
} from "@/lib/checkpoint";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Submit checkpoint answers: grade every item (one cheap-model call for the
 * answered ones), persist verdicts + feedback, compute the Solo Score, and mark
 * the checkpoint completed. Re-submitting a completed checkpoint returns the
 * stored results instead of regrading.
 */
export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const checkpoint = await prisma.checkpoint.findUnique({
      where: { id: params.id },
      include: { items: { orderBy: { order: "asc" } } },
    });
    if (!checkpoint) {
      return NextResponse.json(
        { error: "Checkpoint not found." },
        { status: 404 }
      );
    }

    // Already graded — return the stored result (idempotent).
    if (checkpoint.completedAt) {
      return NextResponse.json({
        score: checkpoint.score ?? 0,
        items: checkpoint.items.map((it) => ({
          id: it.id,
          question: it.question,
          userAnswer: it.userAnswer ?? "",
          verdict: it.verdict,
          feedback: it.feedback,
        })),
      });
    }

    const body = (await req.json().catch(() => ({}))) as { answers?: unknown };
    const answers = new Map<string, string>();
    if (Array.isArray(body.answers)) {
      for (const a of body.answers) {
        const o = a as Record<string, unknown>;
        if (typeof o?.itemId === "string" && typeof o?.answer === "string") {
          answers.set(o.itemId, o.answer.trim());
        }
      }
    }

    // Split answered vs blank; blanks are incorrect without spending a model call.
    const answered = checkpoint.items.filter((it) => answers.get(it.id));
    const grades = await gradeItems(
      answered.map((it) => ({
        question: it.question,
        expectedGist: it.expectedGist,
        userAnswer: answers.get(it.id)!,
      }))
    );
    const gradeByItem = new Map(
      answered.map((it, i) => [it.id, grades[i]] as const)
    );

    const now = new Date();
    const verdicts: Verdict[] = [];
    const results = [];
    for (const it of checkpoint.items) {
      const answer = answers.get(it.id) ?? "";
      const grade = gradeByItem.get(it.id) ?? {
        verdict: "incorrect" as Verdict,
        feedback: "No answer given.",
      };
      verdicts.push(grade.verdict);
      await prisma.checkpointItem.update({
        where: { id: it.id },
        data: {
          userAnswer: answer,
          verdict: grade.verdict,
          feedback: grade.feedback,
        },
      });
      results.push({
        id: it.id,
        question: it.question,
        userAnswer: answer,
        verdict: grade.verdict,
        feedback: grade.feedback,
      });
    }

    const score = scoreOf(verdicts);
    await prisma.checkpoint.update({
      where: { id: checkpoint.id },
      data: {
        startedAt: checkpoint.startedAt ?? now,
        completedAt: now,
        score,
      },
    });

    // A passed IMMEDIATE checkpoint schedules its retention re-checks (+24h,
    // +72h). Retention completions never chain further — the decay curve is
    // sampled from the original session only.
    if (checkpoint.kind === "immediate" && score >= RETENTION_MIN_SCORE) {
      await scheduleRetention(checkpoint.sessionId, checkpoint.id);
    }

    return NextResponse.json({ score, items: results });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to grade the checkpoint.";
    console.error("[checkpoint submit] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
