import { prisma } from "@/lib/db";

/**
 * Validation harness helpers (docs/SPEC.md §11).
 *
 * The classifier's predicted mode is stored on the ASSISTANT turn that answered
 * a user turn (index i+1). A "label row" pairs each user turn with that
 * prediction and the human's "true" label, for classifier-vs-human agreement.
 */

// Only the four real classifier modes are validatable (excludes VANILLA, REFUSE,
// SAFETY, DEBRIEF). Note: integrity-forced OUTSOURCING is indistinguishable from
// a classified OUTSOURCING here — a minor, rare source of noise.
export const CLASSIFIER_MODES: string[] = [
  "STUCK",
  "OUTSOURCING",
  "ENGAGED",
  "DISTRESSED",
];

export type LabelRow = {
  turnId: string;
  sessionId: string;
  content: string;
  predictedMode: string;
  humanMode: string | null;
  createdAt: Date;
};

/** Pair each user turn with its classifier prediction + current human label. */
export async function getLabelRows(): Promise<LabelRow[]> {
  const turns = await prisma.turn.findMany({
    orderBy: [{ sessionId: "asc" }, { index: "asc" }],
  });

  const byKey = new Map<string, (typeof turns)[number]>();
  for (const t of turns) byKey.set(`${t.sessionId}:${t.index}`, t);

  const rows: LabelRow[] = [];
  for (const t of turns) {
    if (t.role !== "user") continue;
    const ai = byKey.get(`${t.sessionId}:${t.index + 1}`);
    const predictedMode = ai?.mode ?? null;
    if (!predictedMode || !CLASSIFIER_MODES.includes(predictedMode)) continue;
    rows.push({
      turnId: t.id,
      sessionId: t.sessionId,
      content: t.content,
      predictedMode,
      humanMode: t.humanMode ?? null,
      createdAt: t.createdAt,
    });
  }

  // Most recent first.
  rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return rows;
}

/** Agreement summary over the rows that have a human label. */
export function agreementOf(rows: LabelRow[]) {
  const labeled = rows.filter((r) => r.humanMode);
  const agreed = labeled.filter((r) => r.humanMode === r.predictedMode).length;
  const pct = labeled.length ? Math.round((100 * agreed) / labeled.length) : 0;
  return { total: rows.length, labeled: labeled.length, agreed, pct };
}
