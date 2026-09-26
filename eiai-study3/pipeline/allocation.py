#!/usr/bin/env python3
"""Generate the committed allocation sequence (spec v2 §1).

Block randomisation within each configured stratum, so that the arms stay
balanced at every block boundary rather than only in expectation. The sequence
is generated once from a committed seed and written to
`materials/allocation.json`, which means the assignment list can be audited
after the fact: anyone can re-run this and get the identical file.

Nothing in this file knows how many strata there are or what they are called.
Spec v2 requires that the scheme be configuration, and
`pipeline/tests/test_strata_config.py` proves it by running this generator
against a three-stratum config in a temp directory. Before that, the strata were
hard-coded in three places at once -- a Zod enum, a statechart helper and this
generator -- so changing the scheme meant editing all three and hoping they
agreed.

Why a committed list rather than a coin flip in the browser
-----------------------------------------------------------
A per-session random draw is unauditable. With a committed sequence the paper
can state exactly which assignment each `allocation_seq` in the event log
corresponds to, and a reader can verify that the reported condition counts were
not the result of dropping inconvenient sessions.

Assignment at run time
----------------------
The app derives its index from the session id (see
`apps/study/src/allocation.ts`), which is deterministic and needs no backend.
That gives balance in expectation but not the exact block balance the sequence
guarantees, because two simultaneous participants can land on the same index.
When the ingest service is provisioned it should hand out indices instead, at
which point the block guarantee becomes real. Either way the index used is
recorded in `ALLOCATED`, so realised balance is checkable from the log rather
than assumed.

Usage
-----
    python pipeline/allocation.py
    python pipeline/allocation.py --check           # fails if the file is stale
    python pipeline/allocation.py --strata other.json --out /tmp/alloc.json

Exit codes: 0 ok, 1 committed file does not match a fresh generation.
"""

from __future__ import annotations

import argparse
import random
import sys
from pathlib import Path
from typing import Iterable

from _common import MATERIALS, canonical_json, read_json, sha256_text, write_json
from strata import STRATA_PATH, Strata, load_strata

SEED = 20260817

ALLOCATION_PATH = MATERIALS / "allocation.json"
PILOT_ALLOCATION_PATH = MATERIALS / "allocation-pilot.json"

#: The pilot's own seed, distinct from the study's so the two sequences cannot
#: be confused for one another by digest.
PILOT_SEED = 20260926

#: How many numbered pilot links exist. Small on purpose: a pilot is five
#: people, and a bounded range means a mistyped `?p=99` is refused rather than
#: wrapping silently onto somebody else's slot.
PILOT_PARTICIPANTS = 20
PRECOMMIT_PATH = MATERIALS.parent / "docs" / "allocation-precommit.txt"


def build_sequence(seed: int = SEED, strata: Strata | None = None) -> dict[str, list[str]]:
    """Block-randomised condition sequence per configured stratum.

    Each block holds an equal number of each condition and is shuffled
    independently, so at any block boundary the arms are level and within a
    block they differ by at most half a block.
    """
    config = strata or load_strata()
    rng = random.Random(seed)
    sequence: dict[str, list[str]] = {}
    per_condition = config.block_size // len(config.conditions)

    for stratum in config.ids:
        assignments: list[str] = []
        for _ in range(config.blocks_per_stratum):
            block = [c for c in config.conditions for _ in range(per_condition)]
            rng.shuffle(block)
            assignments.extend(block)
        sequence[stratum] = assignments
    return sequence


def build_pilot_sequence(strata: Strata | None = None) -> dict[str, list[str]]:
    """Strictly alternating arms, per stratum.

    Deliberately not randomised. With five participants, block randomisation
    has roughly a 6% chance of putting everyone in one arm, which would waste
    the pilot -- and a pilot is not analysed, so there is nothing for
    randomisation to protect. Alternation guarantees both arms appear as soon
    as two people take part.

    The seed decides only which arm goes first, which is why PILOT_SEED exists
    at all: it keeps this sequence distinguishable from the study's by digest.
    """
    config = strata or load_strata()
    conditions = list(config.conditions)
    offset = random.Random(PILOT_SEED).randrange(len(conditions))
    return {
        stratum: [conditions[(i + offset) % len(conditions)] for i in range(PILOT_PARTICIPANTS)]
        for stratum in config.ids
    }


def build_pilot_document(strata: Strata | None = None,
                         strata_path: Path | None = None) -> dict[str, object]:
    config = strata or load_strata(strata_path)
    sequence = build_pilot_sequence(config)
    payload: dict[str, object] = {
        "schema_version": "1.0",
        "study": "eiai-study3",
        # Carried in the file itself so nobody can mistake this for the
        # sequence the study pre-registers.
        "purpose": "pilot runs only; never the analysed study",
        "pre_registered": False,
        "seed": PILOT_SEED,
        "participants": PILOT_PARTICIPANTS,
        "conditions": list(config.conditions),
        "strata_sha256": sha256_text(canonical_json(read_json(strata_path or STRATA_PATH))),
        "sequence": sequence,
    }
    payload["sequence_sha256"] = sha256_text(canonical_json(sequence))
    return payload


def build_document(seed: int = SEED, strata: Strata | None = None,
                   strata_path: Path | None = None) -> dict[str, object]:
    config = strata or load_strata(strata_path)
    sequence = build_sequence(seed, config)
    payload: dict[str, object] = {
        "schema_version": "1.0",
        "study": "eiai-study3",
        "seed": seed,
        "block_size": config.block_size,
        "blocks_per_stratum": config.blocks_per_stratum,
        "conditions": list(config.conditions),
        # Pins which stratum scheme produced this sequence. A sequence and a
        # config that disagree would be undetectable otherwise.
        "strata_sha256": sha256_text(canonical_json(read_json(strata_path or STRATA_PATH))),
        "sequence": sequence,
    }
    payload["sequence_sha256"] = sha256_text(canonical_json(sequence))
    return payload


def verify_alternation(sequence: dict[str, list[str]]) -> list[str]:
    """Problems with a pilot sequence, empty when it is sound.

    Block balance is the wrong check here: the pilot's guarantee is not "the
    arms are level at every block boundary" but "two participants already give
    both arms". Running the study's check against it would reject a correct
    sequence, and skipping the check entirely would leave the pilot's own
    property unverified.
    """
    problems: list[str] = []
    for stratum, assignments in sorted(sequence.items()):
        if len(set(assignments)) < 2:
            problems.append(f"{stratum}: only one arm appears; the pilot would test half the design")
        for index in range(1, len(assignments)):
            if assignments[index] == assignments[index - 1]:
                problems.append(
                    f"{stratum}: positions {index - 1} and {index} repeat "
                    f"'{assignments[index]}'; the sequence does not alternate"
                )
                break
    return problems


def verify_balance(sequence: dict[str, list[str]], strata: Strata | None = None) -> list[str]:
    """Problems with the generated sequence, empty when it is sound."""
    config = strata or load_strata()
    problems: list[str] = []

    if set(sequence) != set(config.ids):
        problems.append(f"strata mismatch: {sorted(set(sequence) ^ set(config.ids))}")

    for stratum, assignments in sorted(sequence.items()):
        if len(assignments) != config.sequence_length:
            problems.append(
                f"{stratum}: {len(assignments)} assignments, expected "
                f"{config.sequence_length}"
            )
        for index in range(0, len(assignments), config.block_size):
            block = assignments[index:index + config.block_size]
            for condition in config.conditions:
                if block.count(condition) != config.block_size // len(config.conditions):
                    problems.append(f"{stratum}: block at {index} is unbalanced ({block})")
                    break
    return problems


def write_precommit(document: dict[str, object], config: Strata) -> None:
    """The digest published before collection opens.

    This is the whole point of generating the sequence in advance: a reader can
    check afterwards that the assignment list was not adjusted to suit the
    result. The file is plain text so it can be pasted into a pre-registration
    form without any tooling.
    """
    sequence: dict[str, list[str]] = document["sequence"]  # type: ignore[assignment]
    lines = [
        "Allocation pre-commitment",
        "=========================",
        "",
        "Published BEFORE data collection opens. The sequence itself is in",
        "materials/allocation.json; this file records the digest so that a reader",
        "can verify after the fact that the randomisation was not adjusted.",
        "",
        f"seed              {document['seed']}",
        f"strata_sha256     {document['strata_sha256']}",
        f"sequence_sha256   {document['sequence_sha256']}",
        "",
        "Per stratum:",
    ]
    for stratum in config.ids:
        assignments = sequence[stratum]
        warm = assignments.count("warm")
        lines.append(
            f"  {stratum:16s} {len(assignments):4d} assignments"
            f"  ({warm} warm / {len(assignments) - warm} neutral)"
        )
    lines += [
        "",
        "Verify with:",
        "",
        "    python pipeline/allocation.py --check",
        "",
    ]
    PRECOMMIT_PATH.parent.mkdir(parents=True, exist_ok=True)
    PRECOMMIT_PATH.write_text(chr(10).join(lines), encoding="utf-8", newline=chr(10))


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate the allocation sequence.")
    parser.add_argument("--check", action="store_true",
                        help="fail if the committed allocation is missing or stale")
    parser.add_argument("--seed", type=int, default=SEED)
    parser.add_argument(
        "--pilot",
        action="store_true",
        help="write the pilot sequence instead; never pre-committed, never consumed by the study",
    )
    parser.add_argument("--strata", default=None,
                        help="path to a strata config; defaults to materials/strata.json")
    parser.add_argument("--out", default=None,
                        help="where to write; defaults to materials/allocation.json")
    args = parser.parse_args(list(argv) if argv is not None else None)

    strata_path = Path(args.strata) if args.strata else None
    out_path = Path(args.out) if args.out else (
        PILOT_ALLOCATION_PATH if args.pilot else ALLOCATION_PATH
    )

    config = load_strata(strata_path)
    # The pilot document is built by its own function and written to its own
    # path. write_precommit below is keyed on ALLOCATION_PATH, so the pilot
    # sequence can never reach docs/allocation-precommit.txt -- which is the
    # property that keeps the study's pre-registered list untouched.
    document = (
        build_pilot_document(config, strata_path)
        if args.pilot
        else build_document(args.seed, config, strata_path)
    )
    problems = (
        verify_alternation(document["sequence"])  # type: ignore[arg-type]
        if args.pilot
        else verify_balance(document["sequence"], config)  # type: ignore[arg-type]
    )
    if problems:
        print("Generated sequence is not balanced:", file=sys.stderr)
        for line in problems:
            print(f"  - {line}", file=sys.stderr)
        return 1

    if args.check:
        if not out_path.exists():
            print(f"{out_path} does not exist. Run pipeline/allocation.py.", file=sys.stderr)
            return 1
        committed = read_json(out_path)
        if canonical_json(committed) != canonical_json(document):
            print(f"{out_path} does not match a fresh generation.", file=sys.stderr)
            print("The allocation list is a pre-registered artefact; regenerating it "
                  "after collection starts would invalidate it.", file=sys.stderr)
            return 1
        total = sum(len(v) for v in document["sequence"].values())  # type: ignore[union-attr]
        print(f"Allocation sequence is current ({total} assignments across "
              f"{len(config.ids)} strata, seed {args.seed}).")
        return 0

    write_json(out_path, document)
    if out_path == ALLOCATION_PATH:
        write_precommit(document, config)
    total = sum(len(v) for v in document["sequence"].values())  # type: ignore[union-attr]
    print(f"{total} assignments across {len(config.ids)} strata, "
          f"block size {config.block_size}, seed {args.seed}")
    for stratum in config.ids:
        print(f"  {stratum:16s} {config.blocks_per_stratum} blocks")
    print(f"  sequence_sha256 {document['sequence_sha256']}")
    print(f"  -> {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
