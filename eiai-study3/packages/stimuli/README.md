# @eiai/stimuli

Loader and hash-manifest verification for the frozen stimulus set.

`loadStimuli()` re-hashes every response file against `materials/manifest.json`
and throws on any mismatch; `assertLaunchReady()` refuses a set generated in
offline placeholder mode. Serving a response is a lookup — nothing here
generates, interpolates, or falls back, because an improvised stimulus is an
uncontrolled one.

Node only (it reads the filesystem). The browser build bundles the same JSON
via `apps/study/src/stimuli.ts`; integrity is checked in CI by the golden-file
test rather than on every page load.
