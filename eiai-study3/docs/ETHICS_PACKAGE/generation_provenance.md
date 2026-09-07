# How the assistant's answers were produced

Everything needed for a Method section, and the honest limits of it. Every
figure below was read out of the repository, not recalled.

## The model

| | |
|---|---|
| **Provider** | Groq (`https://api.groq.com/openai/v1`, OpenAI-compatible endpoint) |
| **Model** | `openai/gpt-oss-120b` |
| **Generated** | 2026-09-06, in one run |
| **What was produced** | 48 answers (12 items × 4 versions) and 144 follow-up replies |
| **Generator version** | 2.0.0 (`pipeline/generate.py`, recorded in the manifest) |
| **Cost** | 134,143 tokens across 105 requests |

Recorded in `materials/manifest.json` as `provider`, `model`,
`generator_mode: live_api` and `generator_version`, so the provenance travels
with the material rather than living in someone's memory.

### Why this model

Chosen by measurement rather than by reputation, and the alternatives that
failed are recorded in `pipeline/providers.py` next to the choice:

- `llama-3.3-70b` and `llama-3.1-8b` — no JSON-schema support at all.
- `qwen3.6-27b` — the best English of the group, but failed on the Russian and
  Kazakh trial. An English-only comparison would have selected it and it would
  have collapsed later.
- `gpt-oss-20b` — passed every automated check while adding consensus-appeal
  phrasing to the answer body. That is weak-justification content leaking into
  text that has to be constant across the argument-quality factor, so it was
  rejected on a ground no automated check would have caught.
- `gpt-oss-120b` — passed validation in all three languages. Selected.

Groq rather than Google's Gemini for a structural reason: Gemini's free tier
allows 20 requests per day *per model*, against a run needing over a hundred.
Spreading a run across models would mean one experiment's stimuli written by
several different models, which defeats the point of freezing them.

### Request parameters

| Parameter | Value | Where |
|---|---|---|
| `max_tokens` | 2560 | `pipeline/providers.py`, `DEFAULT_MAX_TOKENS` |
| `response_format` | JSON schema, `strict: true` | `pipeline/providers.py` |
| `reasoning_effort` | not sent (provider default) | Groq rejects the `"none"` value outright |
| temperature, `top_p` | **not set** — provider defaults | — |
| pacing | 22 s between calls | rate-limit compliance, not a modelling choice |

## The prompts

Seven files in `materials/prompts/`, versioned with the repository. SHA-256
prefixes as of this package:

| File | SHA-256 (first 16) | Role |
|---|---|---|
| `shared_constraints.txt` | `32ed613528e1f5c8` | Applies to every answer: state exactly this value, express exactly this hedge level, add no fact beyond the value, 60–90 words |
| `warm_components.txt` | `1884f35683b16e6c` | The five emotional-intelligence components the warm version must exhibit, and the rule that warmth may never alter the facts, the number, or the hedge |
| `warm_register_low.txt` | `e42b6ab2f8d74160` | Additional instruction when the participant reported low confidence |
| `warm_register_moderate.txt` | `8ce4d0361276a4ca` | …moderate confidence |
| `warm_register_high.txt` | `7dc0995f303de586` | …high confidence |
| `neutral.txt` | `7fce70e017333e21` | The neutral version: plain, no emotional content, no adaptation |
| `justification_translation.txt` | `03afe239c1c6368f` | Used for the supporting reasons; forbids introducing any numeric value or fact not in the source |

## Seeds: the honest answer

**No seed was set for generation, and none could have been.** The Groq endpoint
was called without a `seed` or a `temperature`, so re-running
`pipeline/generate.py` would produce different wording. This was demonstrated
during preparation: item 12 was regenerated once, and the four new texts
differed from the four originals while stating the same number and carrying the
same supporting reason.

**Reproducibility comes from freezing, not from re-running.** Every one of the
48 texts is stored in the repository and hashed:

```
manifest_sha256   ae66848166aeb2f1df9db5fa418649d7eb9811fd073bc5b351ad1ae20667751c
items_file_sha256 a45f4ab310cf934683453c520bd9d8360bb0fbc8846d8dcc28a7239004a09e26
```

`python pipeline/hash_manifest.py --check` recomputes every digest and fails if
a single byte has changed. So the claim the paper can make is not "these texts
can be regenerated" but the stronger one: "these are the exact texts every
participant saw, and here is the proof they were not edited afterwards."

### The seed that does exist

`seed 20260817`, recorded in `docs/allocation-precommit.txt`. It governs
**randomisation**, not generation: the order in which participants are assigned
to the warm or neutral version, in blocks of 4, 24 blocks per stratum. The
sequence is generated in advance and its SHA-256 committed before recruitment,
so the assignment list cannot be adjusted once results start arriving.

## What was checked before the texts were accepted

- **Content equivalence**, 683 automated checks (`pipeline/verify_equivalence.py`):
  within an item, the four versions state the same number, carry the supporting
  reason byte for byte identically, and match on hedging. Strong and weak
  reasons must not differ systematically in length, or argument quality would be
  confounded with how much there is to read.
- **No leaked true values.** On the four planted-error items the answer states
  the wrong value and the supporting reason contains no number at all.
- **Hash manifest** over all four files plus the item bank.
- **Hand verification** by the researcher: a separate, recorded step. Until it
  is done the application refuses to serve the material at all
  (`launch_ready: false`), so unreviewed text cannot reach a participant.

## Suggested wording for the Method section

> The assistant's responses were generated in advance using `gpt-oss-120b`
> served by Groq (accessed 6 September 2026), with structured JSON output and a
> 2,560-token limit; sampling temperature and seed were left at provider
> defaults, so the generation is not reproducible by re-execution. All 48
> responses (12 items × 2 styles, with the warm style branching into three
> confidence registers) were frozen before data collection and stored under a
> SHA-256 manifest (`ae668481…`), which is verified automatically before every
> release, so the texts shown to participants are provably identical to those
> reported here. Within each item, the four versions were checked automatically
> to state the same numeric value and to carry a byte-identical supporting
> argument, so that style varied independently of content. Assignment to style
> used block randomisation (blocks of 4, stratified by self-reported English
> proficiency) from a sequence generated with seed 20260817 and committed by
> digest before recruitment began.
