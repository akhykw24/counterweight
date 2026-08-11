# @eiai/study

Participant-facing app. React + Vite, static.

```bash
pnpm --dir apps/study dev     # http://localhost:5173
```

Built so far (day 3): eligibility screening, the minor/adult consent fork,
allocation, and the item screen's three phases (estimate → advice → revise),
with withdrawal available from every screen.

Questionnaire, funnel and debrief are stubs — reachable and clickable so the
statechart's later states are exercised, but their content is day 5.

Every interactive control carries a `data-testid`, because the model-based
suite in `test/session.model.test.tsx` drives generated statechart paths
against this DOM rather than a hand-written script.

Two things worth knowing:

- Vite is configured with an empty inline postcss config. Without it, Vite
  walks up and applies the enclosing counterweight repo's Tailwind setup to
  this app's stylesheet.
- `src/events.ts` buffers events in memory and ships nothing. Day 4 replaces it
  with `@eiai/telemetry`.
