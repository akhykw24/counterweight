/**
 * Explain-back ("teach it back") — docs/WEEK2.md Day 11.
 *
 * After a substantial explanation in STUCK/ENGAGED, the reply occasionally ends
 * with an invitation to restate the idea in the learner's own words. The judge
 * then scores the restatement faithful / parroted / off; "faithful" earns
 * verification credit, "parroted" draws a gentle nudge on the next reply.
 * This attacks the illusion of explanatory depth directly.
 */

export const EXPLAINBACK_INVITATION =
  "Your turn — one or two sentences, how would you explain this to a classmate?";

// A reply this long (chars) is treated as a substantial explanation.
export const EXPLAINBACK_MIN_REPLY_CHARS = 400;

// At most one invitation per this many turns (user + assistant rows).
export const EXPLAINBACK_MIN_TURN_GAP = 6;

/**
 * Decide whether this reply should carry the invitation.
 * Modes outside STUCK/ENGAGED (DISTRESSED, OUTSOURCING, SAFETY, DEBRIEF,
 * VANILLA, REFUSE) never invite; probe replies never invite — the next user
 * turn belongs to the cave evaluation.
 */
export function shouldInviteExplainBack(opts: {
  mode: string;
  isProbe: boolean;
  replyLength: number;
  /** Turns between this reply and the last invitation; null if never invited. */
  turnsSinceLastInvitation: number | null;
}): boolean {
  if (opts.mode !== "STUCK" && opts.mode !== "ENGAGED") return false;
  if (opts.isProbe) return false;
  if (opts.replyLength < EXPLAINBACK_MIN_REPLY_CHARS) return false;
  if (
    opts.turnsSinceLastInvitation !== null &&
    opts.turnsSinceLastInvitation < EXPLAINBACK_MIN_TURN_GAP
  ) {
    return false;
  }
  return true;
}

/**
 * Injected into the persona for the reply AFTER a parroted explain-back.
 * Gentle by design: warmth stays on the person, the ask is one line.
 */
export const PARROT_NUDGE_INSTRUCTION = `NUDGE — THIS REPLY ONLY. The learner's last explain-back mostly repeated your wording rather than putting the idea into their own words. Somewhere natural in this reply, warmly invite them to say the key idea in their OWN words — one short line, no lecture, no shame, and do not mention any scoring or metrics.`;
