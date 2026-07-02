import type { Checkpoint, CheckpointItem } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getClient, getModel } from "@/lib/models";
import { extractJsonObject } from "@/lib/json";
import {
  CHECKPOINT_GENERATE_PROMPT,
  CHECKPOINT_GRADE_PROMPT,
} from "@/lib/prompts/checkpoint";

export type Verdict = "correct" | "partial" | "incorrect";

export type CheckpointWithItems = Checkpoint & { items: CheckpointItem[] };

const VERDICTS: Verdict[] = ["correct", "partial", "incorrect"];
const VERDICT_SCORE: Record<Verdict, number> = {
  correct: 1,
  partial: 0.5,
  incorrect: 0,
};

/** Grader fallback when the model output is unusable — honest, no free credit. */
const GRADE_FALLBACK = {
  verdict: "partial" as Verdict,
  feedback:
    "Automatic grading was unavailable for this item — compare your answer against the key idea yourself.",
};

// A session needs at least this many reasonably substantive user turns to test.
const MIN_SUBSTANTIVE_USER_TURNS = 2;

/** correct=1, partial=0.5, incorrect=0, averaged; 2 decimals. */
export function scoreOf(verdicts: Verdict[]): number {
  if (verdicts.length === 0) return 0;
  const sum = verdicts.reduce((a, v) => a + VERDICT_SCORE[v], 0);
  return Math.round((sum / verdicts.length) * 100) / 100;
}

/**
 * Generate a solo checkpoint (2-3 items) from what the learner worked on in a
 * session. Returns the persisted checkpoint with items, or null when the
 * session is too thin to test or generation fails. Idempotent: an existing
 * incomplete "immediate" checkpoint for the session is returned instead of
 * generating a duplicate (saves quota on retries/double-clicks).
 */
export async function generateCheckpoint(
  sessionId: string
): Promise<CheckpointWithItems | null> {
  const existing = await prisma.checkpoint.findFirst({
    where: { sessionId, kind: "immediate", completedAt: null },
    include: { items: { orderBy: { order: "asc" } } },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return existing;

  const turns = await prisma.turn.findMany({
    where: { sessionId },
    orderBy: { index: "asc" },
  });

  // Exclude probe turns (their claim is deliberately wrong — never a source of
  // checkpoint content) and safety turns. Debriefs are fine: they carry the correction.
  const usable = turns.filter((t) => !t.isProbe && t.mode !== "SAFETY");
  const substantive = usable.filter(
    (t) => t.role === "user" && t.content.trim().length >= 20
  );
  if (substantive.length < MIN_SUBSTANTIVE_USER_TURNS) return null;

  const transcript = usable
    .slice(-16)
    .map(
      (t) =>
        `${t.role === "user" ? "Learner" : "Assistant"}: ${t.content.slice(0, 500)}`
    )
    .join("\n");

  try {
    const client = getClient("cheap");
    const completion = await client.chat.completions.create({
      model: getModel("cheap"),
      max_tokens: 500,
      temperature: 0.3,
      messages: [
        { role: "system", content: CHECKPOINT_GENERATE_PROMPT },
        {
          role: "user",
          content: `Conversation:\n${transcript}\n\nProduce the checkpoint JSON now.`,
        },
      ],
    });
    const parsed = extractJsonObject(
      completion.choices?.[0]?.message?.content ?? ""
    );
    const rawItems = (parsed as { items?: unknown } | null)?.items;
    if (!Array.isArray(rawItems)) return null;

    const items = rawItems
      .filter(
        (it): it is { question: string; expected_gist: string } =>
          !!it &&
          typeof (it as Record<string, unknown>).question === "string" &&
          typeof (it as Record<string, unknown>).expected_gist === "string" &&
          (it as Record<string, unknown>).question !== "" &&
          (it as Record<string, unknown>).expected_gist !== ""
      )
      .slice(0, 3);
    if (items.length === 0) return null;

    return await prisma.checkpoint.create({
      data: {
        sessionId,
        kind: "immediate",
        items: {
          create: items.map((it, i) => ({
            order: i,
            question: it.question.trim(),
            expectedGist: it.expected_gist.trim(),
          })),
        },
      },
      include: { items: { orderBy: { order: "asc" } } },
    });
  } catch (err) {
    console.error(
      "[generateCheckpoint] error:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/**
 * Grade all answered items in ONE cheap-model call (quota-friendly). Returns
 * one {verdict, feedback} per input item, in order; falls back per item when
 * the model output is unusable. Never throws.
 */
export async function gradeItems(
  items: { question: string; expectedGist: string; userAnswer: string }[]
): Promise<{ verdict: Verdict; feedback: string }[]> {
  if (items.length === 0) return [];
  try {
    const numbered = items
      .map(
        (it, i) =>
          `Item ${i + 1}:\nQuestion: ${it.question}\nExpected gist: ${it.expectedGist}\nLearner's answer: """${it.userAnswer}"""`
      )
      .join("\n\n");

    const client = getClient("cheap");
    const completion = await client.chat.completions.create({
      model: getModel("cheap"),
      max_tokens: 400,
      temperature: 0,
      messages: [
        { role: "system", content: CHECKPOINT_GRADE_PROMPT },
        { role: "user", content: `${numbered}\n\nReturn ONLY the JSON.` },
      ],
    });
    const parsed = extractJsonObject(
      completion.choices?.[0]?.message?.content ?? ""
    );
    const grades = (parsed as { grades?: unknown } | null)?.grades;
    const list = Array.isArray(grades) ? grades : [];

    return items.map((_, i) => {
      const g = list[i] as Record<string, unknown> | undefined;
      const verdict = VERDICTS.includes(g?.verdict as Verdict)
        ? (g!.verdict as Verdict)
        : GRADE_FALLBACK.verdict;
      const feedback =
        typeof g?.feedback === "string" && g.feedback.trim()
          ? g.feedback.trim()
          : GRADE_FALLBACK.feedback;
      return { verdict, feedback };
    });
  } catch (err) {
    console.error(
      "[gradeItems] error:",
      err instanceof Error ? err.message : err
    );
    return items.map(() => ({ ...GRADE_FALLBACK }));
  }
}
