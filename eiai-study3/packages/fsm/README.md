# @eiai/fsm

Session flow and register selection.

- **`register(confidence)`** — a plain total function over `[0,100]`, verified
  by property tests. Throws outside the domain rather than clamping: a clamped
  value would write a wrong register into an immutable log.
- **`sessionMachine`** — the XState statechart for the session flow, with
  withdrawal reachable from every screen. Path-generated UI tests live in
  `apps/study/test`.

Why one is a statechart and the other deliberately is not:
[ADR-003](../../docs/adr/ADR-003-statechart-session-flow.md).
