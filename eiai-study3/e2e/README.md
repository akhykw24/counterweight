# e2e

Playwright, against a real dev server in real Chromium.

```bash
pnpm exec playwright install chromium   # once
pnpm e2e
```

The vitest suites drive React in jsdom, where IndexedDB is faked and layout does
not exist. These exist to catch what that cannot: a stimulus that fails to
bundle, a scroll container with no extent, a write-ahead log that will not open,
a screen that renders but does not fit.

`happy-path.spec.ts` covers a complete twelve-item adult session end to end, the
minor assent fork, screening exclusion, mid-session reload and resume, and
withdrawal — asserting the write-ahead log's contents from IndexedDB at the end
of each.

Day 6 adds the simulation bots (spec section 7) to this same project.
