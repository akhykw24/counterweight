# ADR-002: Serve pre-generated, hash-manifested stimuli instead of calling an LLM live

**Status:** accepted, Day 1
**Embodied in:** `packages/schema/src/stimuli.ts`, `materials/items.json`

## Context

The emotional-intelligence manipulation is built from five named components, and
one of them — Mayer–Salovey branch 4, emotion regulation — is *by definition*
responsive. A system that says the same thing to everyone cannot instantiate it.
That argues for generating replies live, conditioned on the participant.

Against that: live generation destroys experimental control. Non-deterministic
outputs mean no two participants receive the same stimulus, so the study is not
replicable, content equivalence across conditions cannot be verified, and a
reviewer's first objection — *"the conditions may have differed in factual
content, not only emotional style"* — becomes unanswerable. It also puts an API
key within reach of client code.

## Decision

Pre-generate the full stimulus space, verify it by hand, hash it, and freeze it.
Adaptivity comes from a finite state machine over the frozen set: the
participant's initial confidence selects a register (LOW < 40, MODERATE 40–70,
HIGH > 70), and serving a reply is a lookup, not a generation.

12 items × 3 languages × (3 warm registers + 1 neutral) = 144 responses, plus
432 follow-up branches.

SHA-256 every response file into a manifest committed **before** collection
opens. `SESSION_STARTED` records the manifest hash the participant actually saw,
so alteration mid-study is not merely discouraged, it is detectable.

## Alternatives rejected

**Live API calls per turn.** Rejected: unreproducible, uncontrolled, and an API
key exposure. This is the trade-off the spec names explicitly (§9).

**Live generation with a fixed seed.** Rejected: providers do not guarantee
determinism across time or model revisions, so the guarantee would be a fiction
that only fails once you can no longer check it.

**One static reply per item per condition, no registers.** Rejected: it would
make the neutral and warm conditions differ only in wording, dropping branch 4
and the Communication Accommodation component. The construct under test would no
longer be in the stimulus.

## Consequences

Good:

- Content equivalence across conditions is verifiable, and is verified
  (`pipeline/verify_equivalence.py`, Day 2).
- No key anywhere near the client.
- The manifest gives a cryptographic integrity claim that costs almost nothing.
- Generation is a one-time, reportable artifact rather than a runtime dependency.

Costs, accepted:

- Register granularity is three states, not a continuum. Convergence is
  approximated, not achieved.
- The warm condition branches and the neutral condition does not. This is
  deliberate — adaptive responsiveness is constitutive of the EI construct, so a
  neutral condition that adapted would not be neutral — and it must be stated in
  the paper, because a reviewer will ask.
- Any change to an item forces regeneration, re-verification, re-coding for
  Cohen's κ, and a new manifest. After pre-registration this is effectively
  impossible, which is the point.
