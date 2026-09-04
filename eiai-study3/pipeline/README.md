# pipeline

Python. Stimulus generation, verification, and (from day 7) replay and analysis.

```
_common.py             locale-aware numeric matching, hashing, .env loading, paths

  materials
generate.py            12 files, 144 responses, 432 follow-up branches
providers.py           live API / offline placeholders / hand-authored, one interface
cell_cache.py          per-cell durability, so a stopped run loses nothing
verify_equivalence.py  content equivalence across the four condition variants
hash_manifest.py       SHA-256 manifest; --check is the integrity gate
verify_components.py   blinded kappa coding sheets, Cohen's kappa
allocation.py          seeded block-randomised condition sequence; --check gates it

  simulation and analysis
simulate.py            three bot policies -> synthetic event log + answer key
replay.py              event log -> trials/participants/questionnaire/transitions
exclusions.py          section 8.6 criteria, counted per criterion, as its own step
sequential.py          section 8.2 stopping rule: continue or stop, at this N
analysis.py            H1-H5, Bayes factor, and --recover for parameter recovery
multiverse.py          48-specification curve
report.py              results.json + curve -> a self-contained HTML document
verify_bridge.py       simulated and real event streams have the same shape
```

The dependency order is `simulate -> replay -> analysis -> multiverse -> report`,
which is what the `Makefile` encodes. `python pipeline/<file>.py --help` on any
of them.

## Generating stimuli

Provider settings live in one `PROVIDERS` block in `providers.py`. Every
supported API speaks the OpenAI chat-completions shape, so switching one is a
single edit and nothing above the generation layer changes.

```bash
python pipeline/generate.py --offline     # placeholders, no key needed
python pipeline/generate.py               # real run (needs a key in .env)
python pipeline/generate.py --provider gemini
```

The key is read from `eiai-study3/.env` (or the enclosing repo's `.env` /
`.env.local`); a real environment variable always wins over a file.

### Why Groq / `gpt-oss-120b`

Not a quality ranking — a constraint satisfaction. Two things forced it:

- **The whole set must come from one model.** Gemini's free tier allows 20
  requests per day *per model*; a full run is 168. Finishing on Gemini would
  mean either nine days or splitting the set across models, and stimuli written
  by different models are not one frozen stimulus set. Groq allows 1000/day.
- **Candidates must be tested in all three languages, not English.**
  `qwen3.6-27b` wrote the cleanest English of anything tried and then returned
  400 `Failed to validate JSON` for Russian and Kazakh. An English-only trial
  would have selected it and failed 60 calls into the run.

`gpt-oss-20b` was also rejected, and for a reason worth recording: it passes
every automated check while adding phrases like "this figure is widely accepted
in the community" to the body. That is *consensus-appeal* content — precisely
the weak-justification manipulation — leaking into text that is supposed to be
constant across the within-subjects factor. Word counts and numeric-leak checks
cannot see it. Read the samples.

### The daily token budget is the real constraint

Groq's free tier allows **200,000 tokens per day**, and it charges what a
request *reserves*, not what it returns. With `max_tokens` at 4096 a single
body call — prompt about 1200 tokens — was billed **5253** against the cap. The
longest response in the set is 1545 characters of Kazakh, roughly 700 tokens, so
that setting was reserving five times what any stimulus needs and paying for it
in days of wall-clock time. `DEFAULT_MAX_TOKENS` is now 1536, which is more than
double the observed worst case and cuts a full run from about 3.5 days to under
two. It caps length only; it cannot change a response that fits.

A full run is roughly 394,000 tokens, so **it does not finish in one day**.
That is expected, not a fault:

- The run stops cleanly, prints how many of the twelve variant files are still
  missing and names them, and exits **2**.
- Re-running the same command the next day skips what is finished.
- Every finished cell is cached, so nothing already paid for is paid for twice
  — see "Generation is idempotent per cell" below.

A partial set cannot be manifested: `hash_manifest.py` fails when the twelve
files disagree on provider, model or generator mode. So the set is either
entirely placeholders or entirely real, and there is no state in between that
can be committed and fielded by accident.

### Pacing

- **22 seconds between calls**, with exponential backoff on 429. With
  `max_tokens` at 1536 a body call reserves about 2700 tokens, and Groq's
  per-minute cap is 8000, which divides into 2.9 calls — so 22s rather than the
  20s that sits exactly on the line. The first pacing figure was set from the
  size of a *justification* call and produced a 429 on nearly every body call.
- **A per-day 429 is not retried.** Backing off 8-16-32-64-120s cannot help
  when the reset is hours away; it just spends four minutes per call to reach a
  conclusion the first response already gave. Per-minute 429s are still waited
  out, and the two are told apart by the provider's own wording.
- **`--thinking` defaults per provider.** Gemini needs `none`, because it draws
  reasoning tokens from the same budget as the visible answer and otherwise
  truncates replies mid-sentence. Groq rejects `none` outright (400: must be
  low, medium or high), so its default is `default`, which omits the parameter —
  matching the configuration the model was actually measured under.

`--force` regenerates cells that are already cached. Placeholder records and
records from a different model never count as finished, so switching model or
coming from `--offline` always regenerates.

## Generation is idempotent per cell

A cell is one `(language, condition, register, item)` body, or one
`(language, item)` justification. Each is written to
`materials/generation_cache.json` the moment it arrives, keyed by provider and
model:

```bash
pnpm stimuli:estimate            # what a run would cost, before spending it
python pipeline/generate.py      # resumes; cached cells cost nothing
```

Before this, a variant file was written only after all twelve of its cells
finished, so running out of budget on the eighth call discarded seven cells that
had already been paid for. On a free tier that stops mid-run routinely, that is
the difference between finishing and not.

The cache is keyed by provider **and** model, so a Groq cell is never reused in
a Gemini run: two models inside one stimulus set is not one frozen set. A
key mismatch simply misses and the cell regenerates. Placeholders never enter
the cache at all — they are deterministic and free, and caching them would
create a route for placeholder text to survive into a live run.

`--dry-run` prices the work first:

```
cells:    168 planned, 0 cached, 168 outstanding
tokens:   455,517 estimated (reservation included)
budget:   200,000/day -> 2.3 day(s) at best
          this does NOT finish in one day.
next cell: justification/kk/item_01
```

When the budget does run out the run exits **2**, names the next cell, and keeps
everything cached. Re-running the same command resumes there.

## Three sources, one interface

`pipeline/providers.py` holds `LiveProvider` (any OpenAI-compatible API),
`OfflineProvider` (deterministic placeholders) and `ManualProvider`
(hand-authored JSON in `materials/manual/`). Nothing above the generation layer
branches on which is in use — `--provider manual` and `--offline` go through the
same code path as Groq, including validation, caching and the manifest.

Hand-authored cells are not a fallback. Stimuli are frozen material: once a
Kazakh phrasing has been corrected by hand, that text *is* the stimulus, and a
pipeline that could only consume model output would force the correction back
through a prompt and re-sample it. A missing manual cell is an error naming the
file to create, never a silently skipped cell.

## Parameter recovery, and why the bridge matters

`simulate.py` plants known effects, `analysis.py --recover` has to return them:

```bash
pnpm recover
```

The planted values are the constants in `POLICIES`. SimCentral discriminates by
justification quality (+0.25), SimPeripheral responds to style instead (+0.20),
SimRandom does neither. Recovery fails the build if any planted effect falls
outside the recovered interval.

That result is worth nothing on its own. `simulate.py` writes the event stream
directly rather than driving the app, so left alone it would confirm that the
simulator agrees with itself. `e2e/bots.spec.ts` walks the same policies through
the real UI and `verify_bridge.py` compares the two logs on **structure** —
event types, payload keys, per-item shape — never on values, because the bots
move sliders differently from synthetic participants and should.

```bash
pnpm e2e:bots && pnpm bridge
```

Both checks were mutation-tested rather than assumed. Recomputing WOA against
the true value instead of the advice fails 2 of 11 recovery checks; deleting
`ms_since_reveal` from the simulator fails the bridge.

## Projections are pure

`replay.py --check` reprojects into a temporary directory and diffs. Same log
in, byte-identical tables out, or the build fails. Nothing in `replay.py` reads
a previous run's tables, and analysis decisions live in `analysis.Specification`
rather than in the projection — a projection that had already clamped WOA would
have silently fixed one cell of the multiverse.
