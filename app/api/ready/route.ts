import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseTopics } from "@/lib/topics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type ReadyStatus = "green" | "amber" | "red" | "none";

type TopicAgg = {
  sessions: number;
  indexSum: number;
  indexCount: number;
  solo: { score: number; at: number } | null;
  retention: { score: number; at: number } | null;
  lastActivity: number;
};

/**
 * Per-topic readiness: latest solo score, latest retention score, average
 * Independence Index, and a traffic light. Green ONLY when solo >= 0.7 AND a
 * retention re-check exists at >= 0.5 — "you did it without the AI and it stuck".
 */
export async function GET() {
  try {
    const sessions = await prisma.session.findMany({
      where: { topics: { not: null } },
      include: {
        metric: true,
        checkpoints: { where: { completedAt: { not: null } } },
      },
    });

    const byTopic = new Map<string, TopicAgg>();
    for (const s of sessions) {
      const topics = parseTopics(s.topics);
      if (topics.length === 0) continue;

      for (const topic of topics) {
        const agg = byTopic.get(topic) ?? {
          sessions: 0,
          indexSum: 0,
          indexCount: 0,
          solo: null,
          retention: null,
          lastActivity: 0,
        };
        agg.sessions += 1;
        agg.lastActivity = Math.max(agg.lastActivity, s.startedAt.getTime());
        if (s.metric && s.metric.turnsScored > 0) {
          agg.indexSum += s.metric.independenceIndex;
          agg.indexCount += 1;
        }
        for (const c of s.checkpoints) {
          if (c.score === null || c.completedAt === null) continue;
          const entry = { score: c.score, at: c.completedAt.getTime() };
          if (c.kind === "immediate") {
            if (!agg.solo || entry.at > agg.solo.at) agg.solo = entry;
          } else if (c.kind === "retention") {
            if (!agg.retention || entry.at > agg.retention.at)
              agg.retention = entry;
          }
        }
        byTopic.set(topic, agg);
      }
    }

    const rows = [...byTopic.entries()]
      .map(([topic, a]) => {
        const solo = a.solo?.score ?? null;
        const retention = a.retention?.score ?? null;
        let status: ReadyStatus;
        if (solo === null) status = "none";
        else if (solo >= 0.7 && retention !== null && retention >= 0.5)
          status = "green";
        else if (solo < 0.5) status = "red";
        else status = "amber";
        return {
          topic,
          sessions: a.sessions,
          soloScore: solo,
          retentionScore: retention,
          indexAvg:
            a.indexCount > 0 ? Math.round(a.indexSum / a.indexCount) : null,
          status,
          lastActivity: a.lastActivity,
        };
      })
      .sort((x, y) => y.lastActivity - x.lastActivity);

    return NextResponse.json({ rows });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load readiness.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
