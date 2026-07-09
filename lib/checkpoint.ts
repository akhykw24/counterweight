import type { Checkpoint, CheckpointItem } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getClient, getModel } from "@/lib/models";
import { extractJsonObject } from "@/lib/json";
import {
  CHECKPOINT_GENERATE_PROMPT,
  CHECKPOINT_GRADE_PROMPT,
  CHECKPOINT_VARIANT_PROMPT,
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

// Retention re-checks (Day 9): scheduled when an IMMEDIATE checkpoint completes
// at or above the passing bar; the decay curve is sampled at these offsets.
export const RETENTION_MIN_SCORE = 0.5;
export const RETENTION_OFFSETS_HOURS = [24, 72] as const;

/** Most recent completed score of a kind across a set of checkpoints. */
export function latestCompletedScore(
  checkpoints: {
    kind: string;
    completedAt: Date | null;
    score: number | null;
  }[],
  kind: "immediate" | "retention"
): number | null {
  const done = checkpoints
    .filter((c) => c.kind === kind && c.completedAt !== null && c.score !== null)
    .sort(
      (a, b) =>
        (b.completedAt as Date).getTime() - (a.completedAt as Date).getTime()
    );
  return done[0]?.score ?? null;
}

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
 * Schedule the retention re-checks for a passed immediate checkpoint: empty
 * Checkpoint rows (kind "retention") due at +24h and +72h. Items are generated
 * as variants at due time, not now — see ensureCheckpointItems.
 */
export async function scheduleRetention(
  sessionId: string,
  parentId: string
): Promise<void> {
  const now = Date.now();
  for (const hours of RETENTION_OFFSETS_HOURS) {
    await prisma.checkpoint.create({
      data: {
        sessionId,
        kind: "retention",
        parentId,
        dueAt: new Date(now + hours * 3_600_000),
      },
    });
  }
}

/** One cheap-model call producing same-concept, different-surface variants. */
async function generateVariants(
  originals: { question: string; expectedGist: string }[]
): Promise<{ question: string; expected_gist: string }[] | null> {
  try {
    const numbered = originals
      .map(
        (it, i) =>
          `Item ${i + 1}:\nQuestion: ${it.question}\nExpected gist: ${it.expectedGist}`
      )
      .join("\n\n");
    const client = getClient("cheap");
    const completion = await client.chat.completions.create({
      model: getModel("cheap"),
      max_tokens: 500,
      temperature: 0.4,
      messages: [
        { role: "system", content: CHECKPOINT_VARIANT_PROMPT },
        { role: "user", content: `${numbered}\n\nProduce the variants JSON now.` },
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
      .slice(0, originals.length);
    return items.length > 0 ? items : null;
  } catch (err) {
    console.error(
      "[generateVariants] error:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/**
 * Make sure a checkpoint has items, generating retention variants from its
 * parent's items on first open. Falls back to reusing the original items when
 * variant generation fails (unblocks the review; after 24h+ the parroting risk
 * is low). Returns null when the checkpoint doesn't exist or has no source items.
 */
export async function ensureCheckpointItems(
  checkpointId: string
): Promise<CheckpointWithItems | null> {
  const cp = await prisma.checkpoint.findUnique({
    where: { id: checkpointId },
    include: { items: { orderBy: { order: "asc" } } },
  });
  if (!cp) return null;
  if (cp.items.length > 0) return cp;
  if (!cp.parentId) return null;

  const parent = await prisma.checkpoint.findUnique({
    where: { id: cp.parentId },
    include: { items: { orderBy: { order: "asc" } } },
  });
  if (!parent || parent.items.length === 0) return null;

  let variants = await generateVariants(
    parent.items.map((it) => ({
      question: it.question,
      expectedGist: it.expectedGist,
    }))
  );
  if (!variants) {
    console.warn(
      "[ensureCheckpointItems] variant generation failed — reusing original items"
    );
    variants = parent.items.map((it) => ({
      question: it.question,
      expected_gist: it.expectedGist,
    }));
  }

  await prisma.checkpoint.update({
    where: { id: cp.id },
    data: {
      items: {
        create: variants.map((v, i) => ({
          order: i,
          question: v.question.trim(),
          expectedGist: v.expected_gist.trim(),
        })),
      },
    },
  });
  return prisma.checkpoint.findUnique({
    where: { id: cp.id },
    include: { items: { orderBy: { order: "asc" } } },
  });
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
