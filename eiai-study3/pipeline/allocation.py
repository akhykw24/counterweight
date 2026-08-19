#!/usr/bin/env python3
"""Generate the committed allocation sequence (spec section 1).

Six strata (language x age group), block-randomised with block size 4 so that
warm and neutral stay balanced at every block boundary rather than only in
expectation. The sequence is generated once from a committed seed and written
to `materials/allocation.json`, which means the assignment list can be audited
after the fact: anyone can re-run this and get the identical file.

Why a committed list rather than a coin flip in the browser
-----------------------------------------------------------
A per-session random draw is unauditable. With a committed sequence the paper
can state exactly which assignment each `allocation_seq` in the event log
corresponds to, and a reader can verify that the reported condition counts were
not the result of dropping inconvenient sessions.

Assignment at run time
----------------------
The app derives its index from the session id (see `apps/study/src/allocation.ts`),
which is deterministic and needs no backend. That gives balance in expectation
but not the exact block balance the sequence guarantees, because two
simultaneous participants can land on the same index. When the ingest service
is provisioned it should hand out indices instead, at which point the block
guarantee becomes real. Either way the index used is recorded in `ALLOCATED`,
so realised balance is checkable from the log rather than assumed.

Usage
-----
    python pipeline/allocation.py
    python pipeline/allocation.py --check      # fails if the file is stale

Exit codes: 0 ok, 1 committed file does not match a fresh generation.
"""

from __future__ import annotations

import argparse
import random
import sys
from pathlib import Path
from typing import Iterable

from _common import MATERIALS, canonical_json, read_json, sha256_text, write_json

SEED = 20260817
BLOCK_SIZE = 4
# 16 blocks per stratum. The hard cap is N = 160 across six strata, so this
# leaves room for the sequence never to run out even if recruitment lands
# unevenly across cells.
BLOCKS_PER_STRATUM = 16

CONDITIONS = ("warm", "neutral")
LANGUAGES = ("kk", "ru", "en")
AGE_GROUPS = ("minor", "adult")

ALLOCATION_PATH = MATERIALS / "allocation.json"


def build_sequence(seed: int = SEED) -> dict[str, list[str]]:
    """Block-randomised condition sequence per stratum.

    Each block holds an equal number of each condition and is shuffled
    independently, so at any block boundary the arms differ by at most zero and
    within a block by at most BLOCK_SIZE/2.
    """
    if BLOCK_SIZE % len(CONDITIONS) != 0:
        raise ValueError("block size must divide evenly among conditions")

    rng = random.Random(seed)
    sequence: dict[str, list[str]] = {}
    per_condition = BLOCK_SIZE // len(CONDITIONS)

    for language in LANGUAGES:
        for age_group in AGE_GROUPS:
            stratum = f"{language}:{age_group}"
            assignments: list[str] = []
            for _ in range(BLOCKS_PER_STRATUM):
                block = [c for c in CONDITIONS for _ in range(per_condition)]
                rng.shuffle(block)
                assignments.extend(block)
            sequence[stratum] = assignments
    return sequence


def build_document(seed: int = SEED) -> dict[str, object]:
    sequence = build_sequence(seed)
    payload = {
        "schema_version": "1.0",
        "study": "eiai-study3",
        "seed": seed,
        "block_size": BLOCK_SIZE,
        "blocks_per_stratum": BLOCKS_PER_STRATUM,
        "conditions": list(CONDITIONS),
        "sequence": sequence,
    }
    payload["sequence_sha256"] = sha256_text(canonical_json(sequence))
    return payload


def verify_balance(sequence: dict[str, list[str]]) -> list[str]:
    """Problems with the generated sequence, empty when it is sound."""
    problems: list[str] = []
    expected_strata = {f"{lang}:{age}" for lang in LANGUAGES for age in AGE_GROUPS}
    if set(sequence) != expected_strata:
        problems.append(f"strata mismatch: {sorted(set(sequence) ^ expected_strata)}")

    for stratum, assignments in sorted(sequence.items()):
        if len(assignments) != BLOCK_SIZE * BLOCKS_PER_STRATUM:
            problems.append(f"{stratum}: {len(assignments)} assignments, expected "
                            f"{BLOCK_SIZE * BLOCKS_PER_STRATUM}")
        for index in range(0, len(assignments), BLOCK_SIZE):
            block = assignments[index:index + BLOCK_SIZE]
            for condition in CONDITIONS:
                if block.count(condition) != BLOCK_SIZE // len(CONDITIONS):
                    problems.append(
                        f"{stratum}: block at {index} is unbalanced ({block})"
                    )
                    break
    return problems


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate the allocation sequence.")
    parser.add_argument("--check", action="store_true",
                        help="fail if materials/allocation.json is missing or stale")
    parser.add_argument("--seed", type=int, default=SEED)
    args = parser.parse_args(list(argv) if argv is not None else None)

    document = build_document(args.seed)
    problems = verify_balance(document["sequence"])  # type: ignore[arg-type]
    if problems:
        print("Generated sequence is not balanced:", file=sys.stderr)
        for line in problems:
            print(f"  - {line}", file=sys.stderr)
        return 1

    if args.check:
        if not ALLOCATION_PATH.exists():
            print(f"{ALLOCATION_PATH} does not exist. Run pipeline/allocation.py.",
                  file=sys.stderr)
            return 1
        committed = read_json(ALLOCATION_PATH)
        if canonical_json(committed) != canonical_json(document):
            print("materials/allocation.json does not match a fresh generation.",
                  file=sys.stderr)
            print("The allocation list is a pre-registered artefact; regenerating it "
                  "after collection starts would invalidate it.", file=sys.stderr)
            return 1
        print(f"Allocation sequence is current "
              f"({sum(len(v) for v in document['sequence'].values())} assignments, "  # type: ignore[union-attr]
              f"seed {args.seed}).")
        return 0

    write_json(ALLOCATION_PATH, document)
    total = sum(len(v) for v in document["sequence"].values())  # type: ignore[union-attr]
    print(f"{total} assignments across {len(document['sequence'])} strata, "  # type: ignore[arg-type]
          f"block size {BLOCK_SIZE}, seed {args.seed}")
    print(f"  sequence_sha256 {document['sequence_sha256']}")
    print(f"  -> {ALLOCATION_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
