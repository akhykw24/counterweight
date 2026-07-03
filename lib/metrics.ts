import type { Turn } from "@prisma/client";

/**
 * The four behavioural metrics (docs/SPEC.md §7) plus the composite Independence
 * Index. These are behavioural signals only — never a "critical thinking score".
 *
 * The literal §7 formula/weights aren't in the playbook, so they're authored
 * here and exported as named constants so they're easy to tune.
 */
export type Metrics = {
  offloadRatio: number; // 0..1  — share of turns asking the AI to produce
  verificationRate: number; // 0..1  — share of turns checking a claim
  caveRate: number; // 0..1  — share of turns caving to the AI
  acceptanceLatency: number; // seconds — mean time to respond
  independenceIndex: number; // 0..100 — composite
  turnsScored: number;
};

// Weights for the Independence Index (sum to 1). Each component is oriented so
// that 1 = most independent. Tune these as §7 evolves.
export const INDEX_WEIGHTS = {
  notOffloading: 0.3, // 1 - offloadRatio
  verification: 0.25, // verificationRate
  resistance: 0.2, // 1 - caveRate
  reasoning: 0.15, // avgReasoningDepth / 2
  deliberation: 0.1, // normalized acceptance latency
};

// Acceptance latency at/above this (seconds) earns full deliberation credit.
export const LATENCY_TARGET_SEC = 30;

// Hint ladder (Day 10): a hint request is a partial offload event — visible
// honesty, not punishment. L1 concept cue < L2 first step < L3 worked example.
export const HINT_OFFLOAD_WEIGHTS: Record<number, number> = {
  1: 0.15,
  2: 0.3,
  3: 0.5,
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const round = (x: number, d = 3) => {
  const f = 10 ** d;
  return Math.round(x * f) / f;
};

/**
 * Compute the four metrics + Independence Index from a session's turns.
 * Only user turns the judge has scored count toward the ratios.
 */
export function computeMetrics(turns: Turn[]): Metrics {
  const userTurns = turns.filter((t) => t.role === "user");
  // Hint requests are button clicks, not authored text — the judge skips them;
  // their offload cost comes from the level weights instead.
  const hintTurns = userTurns.filter((t) => t.hintLevel != null);
  // A user turn is "scored" once the judge has written its booleans.
  const scored = userTurns.filter(
    (t) => t.askedToProduce !== null && t.hintLevel == null
  );
  const n = scored.length;
  const nOffloadBase = n + hintTurns.length;

  if (nOffloadBase === 0) {
    return {
      offloadRatio: 0,
      verificationRate: 0,
      caveRate: 0,
      acceptanceLatency: 0,
      independenceIndex: 0,
      turnsScored: 0,
    };
  }

  // Weighted mean over scored + hint turns: a full production ask counts 1,
  // a hint counts its level weight, a self-authored turn counts 0.
  const hintWeightSum = hintTurns.reduce(
    (a, t) => a + (HINT_OFFLOAD_WEIGHTS[t.hintLevel as number] ?? 0),
    0
  );
  const offloadRatio = clamp01(
    (scored.filter((t) => t.askedToProduce).length + hintWeightSum) /
      nOffloadBase
  );
  // A faithful explain-back is a verification event: they transformed the idea
  // into their own words instead of accepting (or parroting) it.
  const verificationRate =
    n > 0
      ? scored.filter((t) => t.verifiedClaim || t.explainedBack === "faithful")
          .length / n
      : 0;
  const caveRate = n > 0 ? scored.filter((t) => t.concededToAi).length / n : 0;

  // Hint clicks are near-instant — they'd skew the deliberation signal.
  const latencies = userTurns
    .filter((t) => typeof t.latencyMs === "number" && t.hintLevel == null)
    .map((t) => (t.latencyMs as number) / 1000);
  const meanLatencySec = latencies.length
    ? latencies.reduce((a, b) => a + b, 0) / latencies.length
    : 0;

  const avgReasoning =
    n > 0 ? scored.reduce((a, t) => a + (t.reasoningDepth ?? 0), 0) / n : 0; // 0..2

  // Composite. The latency term is only included when we have samples, and the
  // weights are renormalized so a missing term doesn't unfairly drag the score.
  const components: Array<{ w: number; v: number }> = [
    { w: INDEX_WEIGHTS.notOffloading, v: 1 - offloadRatio },
    { w: INDEX_WEIGHTS.verification, v: verificationRate },
    { w: INDEX_WEIGHTS.resistance, v: 1 - caveRate },
    { w: INDEX_WEIGHTS.reasoning, v: avgReasoning / 2 },
  ];
  if (latencies.length > 0) {
    components.push({
      w: INDEX_WEIGHTS.deliberation,
      v: clamp01(meanLatencySec / LATENCY_TARGET_SEC),
    });
  }
  const totalW = components.reduce((a, c) => a + c.w, 0);
  const independenceIndex = Math.round(
    (100 * components.reduce((a, c) => a + c.w * c.v, 0)) / totalW
  );

  return {
    offloadRatio: round(offloadRatio),
    verificationRate: round(verificationRate),
    caveRate: round(caveRate),
    acceptanceLatency: round(meanLatencySec, 1),
    independenceIndex,
    turnsScored: n,
  };
}
