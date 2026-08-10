import type { Condition, Language, RegisterState, ResponseId } from "@eiai/schema";

/**
 * Register selection (STUDY3_SPEC_v2.md section 5).
 *
 *   LOW       conf < 40      reassurance register
 *   MODERATE  40 <= conf <= 70   collaborative register
 *   HIGH      conf > 70      affirming + gentle-divergence register
 *
 * This is deliberately NOT modelled in XState. Statecharts earn their
 * complexity on flows with history, guards and re-entry; a total function over
 * [0,100] needs four lines and a property test. Knowing which tool not to reach
 * for is the judgment being demonstrated here (spec section 5).
 */

export const REGISTER_THRESHOLDS = {
  /** Below this is LOW. */
  lowBelow: 40,
  /** Above this is HIGH. Equal to it is MODERATE. */
  highAbove: 70,
} as const;

/** Ordered weakest-to-strongest, so monotonicity is expressible. */
export const REGISTER_ORDER = ["LOW", "MODERATE", "HIGH"] as const;

export class ConfidenceOutOfDomainError extends Error {
  constructor(readonly value: number) {
    super(
      `Confidence must be a finite number in [0,100]; received ${String(value)}. ` +
        `Clamping here would silently corrupt the FSM trace, so this throws instead.`,
    );
    this.name = "ConfidenceOutOfDomainError";
  }
}

/**
 * Total over [0,100]. Throws outside it rather than clamping: a confidence of
 * 120 means a bug upstream, and quietly folding it into HIGH would put a wrong
 * register in the permanent event log where nothing can later detect it.
 */
export function register(confidence: number): RegisterState {
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 100) {
    throw new ConfidenceOutOfDomainError(confidence);
  }
  if (confidence < REGISTER_THRESHOLDS.lowBelow) return "LOW";
  if (confidence > REGISTER_THRESHOLDS.highAbove) return "HIGH";
  return "MODERATE";
}

/**
 * The neutral condition does not branch.
 *
 * This is theoretically load-bearing, not a shortcut: adaptive emotional
 * responsiveness is constitutive of the EI construct (Mayer-Salovey branch 4),
 * so a neutral condition that adapted would not be a neutral condition.
 * Returns null for neutral, which is what RESPONSE_REVEALED records.
 */
export function registerFor(
  condition: Condition,
  confidence: number,
): RegisterState | null {
  // Validate in both arms, so a bad confidence is caught in the neutral
  // condition too rather than only surfacing for half the sample.
  const state = register(confidence);
  return condition === "warm" ? state : null;
}

/** Slug used in response ids and stimulus filenames. `na` when there is no branch. */
export function registerSlug(state: RegisterState | null): string {
  return state === null ? "na" : state.toLowerCase();
}

/** Resolves the frozen stimulus to serve. Serving is a lookup, never a generation. */
export function responseIdFor(
  language: Language,
  condition: Condition,
  state: RegisterState | null,
  itemId: string,
): ResponseId {
  if (condition === "neutral" && state !== null) {
    throw new Error(
      `The neutral condition does not branch, but register state ${state} was supplied.`,
    );
  }
  if (condition === "warm" && state === null) {
    throw new Error("The warm condition must supply a register state.");
  }
  return `${language}_${condition}_${registerSlug(state)}_${itemId}` as ResponseId;
}

/** Stimulus file a response id lives in: {lang}_{condition}_{state}.json */
export function stimulusFileFor(
  language: Language,
  condition: Condition,
  state: RegisterState | null,
): string {
  return `${language}_${condition}_${registerSlug(state)}.json`;
}
