import type { Session } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getClient, getModel } from "@/lib/models";
import { extractJsonObject } from "@/lib/json";
import { PROBE_GEN_PROMPT } from "@/lib/prompts/probe";
import type { Mode } from "@/lib/prompts/modes";
import type { HistoryMessage } from "@/lib/classify";

export type ProbeSpec = { wrongClaim: string; correctAnswer: string };

// Scheduler knobs (docs/SPEC.md §6.4, authored).
const MAX_PROBES_PER_SESSION = 2;
const ENGAGED_TURNS_BETWEEN_PROBES = 3;

/**
 * Decide whether to fire a sycophancy probe this turn, and if so generate the
 * confident-but-wrong claim. Rules:
 *  - only while ENGAGED (so the learner has a position to defend; this also
 *    means never in DISTRESSED/STUCK/OUTSOURCING),
 *  - never while already awaiting a cave evaluation,
 *  - cap of 2 probes per session,
 *  - at least 3 engaged exchanges since the last probe.
 * Returns null when no probe should fire (also on any generation failure).
 */
export async function maybeFireProbe(
  session: Session,
  mode: Mode,
  history: HistoryMessage[]
): Promise<ProbeSpec | null> {
  if (mode !== "ENGAGED") return null;
  if (session.awaitingCaveEval) return null;

  const probeCount = await prisma.probe.count({
    where: { sessionId: session.id },
  });
  if (probeCount >= MAX_PROBES_PER_SESSION) return null;

  // Count engaged exchanges since the last probe (or from the start).
  let sinceIndex = -1;
  if (probeCount > 0) {
    const lastProbe = await prisma.probe.findFirst({
      where: { sessionId: session.id },
      orderBy: { firedAt: "desc" },
    });
    if (lastProbe?.turnId) {
      const t = await prisma.turn.findUnique({
        where: { id: lastProbe.turnId },
      });
      if (t) sinceIndex = t.index;
    }
  }
  const engagedSince = await prisma.turn.count({
    where: {
      sessionId: session.id,
      role: "assistant",
      mode: "ENGAGED",
      index: { gt: sinceIndex },
    },
  });
  if (engagedSince < ENGAGED_TURNS_BETWEEN_PROBES) return null;

  // Eligible — generate a contextual false claim + its correction.
  try {
    const transcript = history
      .slice(-8)
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n");
    const client = getClient("cheap");
    const completion = await client.chat.completions.create({
      model: getModel("cheap"),
      max_tokens: 300,
      temperature: 0.4,
      messages: [
        { role: "system", content: PROBE_GEN_PROMPT },
        {
          role: "user",
          content: `Conversation so far:\n${transcript}\n\nProduce the probe JSON now.`,
        },
      ],
    });
    const parsed = extractJsonObject(
      completion.choices?.[0]?.message?.content ?? ""
    );
    if (!parsed || typeof parsed !== "object") return null;
    const o = parsed as Record<string, unknown>;
    const wrongClaim =
      typeof o.wrong_claim === "string" ? o.wrong_claim.trim() : "";
    const correctAnswer =
      typeof o.correct_answer === "string" ? o.correct_answer.trim() : "";
    if (!wrongClaim) return null;
    return { wrongClaim, correctAnswer };
  } catch (err) {
    console.error(
      "[maybeFireProbe] generation error:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/**
 * The debrief message shown on the turn AFTER a probe. Deterministic so it
 * always names the test, the correct answer, and why resisting matters.
 */
export function buildDebrief(
  wrongClaim: string,
  correctAnswer: string,
  caved: boolean
): string {
  const reaction = caved
    ? "And just now, you went along with it. No shame in that — it's genuinely hard to push back on something said with confidence. But that's exactly the moment worth catching: when an answer arrives sounding sure, treat it as a cue to slow down and ask for the reasoning."
    : "And just now, you didn't simply take my word for it — you held your ground. That's exactly the instinct that protects you from confident, wrong sources.";
  const correction = correctAnswer
    ? `\n\nThe accurate version: ${correctAnswer}`
    : "";
  return `Quick pause — that was a test. A moment ago I confidently claimed: "${wrongClaim}". That was deliberately wrong.${correction}\n\n${reaction}\n\nWhy this matters: an AI (me included) can state false things with complete confidence. The skill that protects you isn't knowing every fact — it's keeping your own reasoning in the loop: asking "how do you know?", checking against what you already understand, and not folding just because the other side sounds certain.`;
}
