import { prisma } from "@/lib/db";
import { getClient, getModel } from "@/lib/models";
import { extractJsonObject } from "@/lib/json";
import { TOPIC_PROMPT } from "@/lib/prompts/topics";

/**
 * Extract and persist 1-3 topic tags for a session (one cheap call).
 * Idempotent — returns the stored tags if the session is already tagged.
 * Never throws; returns null when there's nothing to tag or the call fails.
 */
export async function tagSessionTopics(
  sessionId: string
): Promise<string[] | null> {
  try {
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
    });
    if (!session) return null;
    if (session.topics) {
      try {
        const existing = JSON.parse(session.topics);
        if (Array.isArray(existing)) return existing as string[];
      } catch {
        /* fall through and re-tag */
      }
    }

    const turns = await prisma.turn.findMany({
      where: { sessionId, mode: { not: "SAFETY" } },
      orderBy: { index: "asc" },
      take: 12,
    });
    const substantive = turns.filter((t) => t.content.trim().length >= 20);
    if (substantive.length < 2) return null;

    const transcript = substantive
      .map(
        (t) =>
          `${t.role === "user" ? "Learner" : "Assistant"}: ${t.content.slice(0, 300)}`
      )
      .join("\n");

    const client = getClient("cheap");
    const completion = await client.chat.completions.create({
      model: getModel("cheap"),
      max_tokens: 100,
      temperature: 0,
      messages: [
        { role: "system", content: TOPIC_PROMPT },
        {
          role: "user",
          content: `Conversation:\n${transcript}\n\nReturn ONLY the JSON.`,
        },
      ],
    });
    const parsed = extractJsonObject(
      completion.choices?.[0]?.message?.content ?? ""
    );
    const raw = (parsed as { topics?: unknown } | null)?.topics;
    if (!Array.isArray(raw)) return null;

    const topics = [
      ...new Set(
        raw
          .filter((t): t is string => typeof t === "string")
          .map((t) => t.trim().toLowerCase())
          .filter((t) => t.length > 0 && t.length <= 40)
      ),
    ].slice(0, 3);
    if (topics.length === 0) return null;

    await prisma.session.update({
      where: { id: sessionId },
      data: { topics: JSON.stringify(topics) },
    });
    return topics;
  } catch (err) {
    console.error(
      "[tagSessionTopics] error:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/** Parse a session's stored topics defensively. */
export function parseTopics(topics: string | null): string[] {
  if (!topics) return [];
  try {
    const arr = JSON.parse(topics);
    return Array.isArray(arr)
      ? arr.filter((t): t is string => typeof t === "string")
      : [];
  } catch {
    return [];
  }
}
