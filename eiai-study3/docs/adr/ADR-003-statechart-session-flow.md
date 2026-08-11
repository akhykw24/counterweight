# ADR-003: Session flow is a statechart; register selection is not

**Status:** accepted, Day 3
**Embodied in:** `packages/fsm/src/session.ts`, `packages/fsm/src/register.ts`

## Context

Two pieces of this system look superficially alike — both decide "what happens
next" — and the obvious move is to model both the same way. Doing so would be
wrong in one of the two cases, and the interesting part of this decision is the
line between them.

The **session flow** has: a branch whose two arms carry different legal
obligations (parental consent plus assent for minors, single consent for
adults), a three-phase inner loop repeated twelve times, guards that must block
progress on incomplete answers, and an exit transition reachable from every
screen.

The **register selection** is `confidence → LOW | MODERATE | HIGH`. It is a
total function over `[0, 100]` with two thresholds.

## Decision

The session flow is an XState statechart, tested by generated paths
(`@xstate/graph`). The register function is a plain function with property
tests (`fast-check`), and is deliberately *not* a state in any machine.

## Alternatives rejected

**Model the register as a statechart too.** Rejected: it would be four lines of
logic wrapped in a machine, a context, and an event type, and would make the
thing harder to test rather than easier. A property test asserting totality,
monotonicity and exact partitioning over the whole domain is both stronger
evidence and less code. Statecharts earn their complexity on flows with
history, guards and re-entry; spending it on a pure function is the
sophistication-as-decoration failure the spec warns about in §9.

**Hand-written UI tests instead of generated paths.** Rejected: withdrawal is
reachable from every screen, which is exactly the class of transition a
hand-written suite forgets. Generating the paths from the machine means the
coverage follows the machine when the machine changes.

**`onDone` on the task loop.** Rejected after trying it. A final child state
with `onDone` makes XState raise an internal `xstate.done.state.*` event, which
then appears in generated paths *in place of* the `SUBMIT_FINAL` that caused
it — and a model-based UI test cannot click an internal event. Targeting
`#session.questionnaire` directly keeps every transition user-driven and
therefore executable against the DOM.

## Consequences

Good:

- Withdrawal from every screen is verified rather than assumed, in both consent
  arms.
- The consent fork is proved exclusive: no generated path reaches `assent` for
  an adult, or `consent` for a minor. That is a legal requirement, so it is
  worth having as a test rather than a code reading.
- Adding a screen adds its paths automatically.

Costs, accepted:

- `getSimplePaths()` does not terminate usefully on this machine: with
  `SET_ESTIMATE` and `SET_CONFIDENCE` as self-transitions in two phases, plus
  withdrawal from everywhere, the enumeration explodes. The suite therefore
  covers *every reachable screen, withdrawal from every screen, and both arms
  end to end* — stated that way rather than as "every path", because a suite
  that samples while claiming to exhaust is worse than one that is honest.
- Path generation runs against a **two-item** machine so the graph stays small.
  The real twelve-item loop is verified separately by direct machine tests.
- Generated paths only assert *state*. They cannot catch a control that fails
  to report a value the participant intended — see the slider defect recorded
  in the day 3 notes, which the model suite passed straight through.
