#!/usr/bin/env python3
"""Randomisation strata, read from configuration.

Spec v2 stratifies by English proficiency and requires that the number and names
of strata live in a config file rather than in code. The audit found them
hard-coded in three places at once -- a Zod enum, a statechart helper and the
allocation generator -- so changing the scheme meant editing all three and
hoping they agreed.

`pipeline/tests/test_strata_config.py` proves the point by writing a
three-stratum config to a temp file and running the allocation generator against
it. If any consumer had the count or the names baked in, that test fails.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from _common import MATERIALS, read_json

STRATA_PATH = MATERIALS / "strata.json"


@dataclass(frozen=True)
class Strata:
    """The configured scheme, in the shape consumers actually need."""

    ids: tuple[str, ...]
    labels: dict[str, str]
    #: CEFR level -> stratum id. A level that maps to nothing is not admitted.
    by_cefr: dict[str, str]
    block_size: int
    blocks_per_stratum: int
    conditions: tuple[str, ...]

    @property
    def sequence_length(self) -> int:
        return self.block_size * self.blocks_per_stratum


def load_strata(path: Path | None = None) -> Strata:
    document: dict[str, Any] = read_json(path or STRATA_PATH)

    entries = document["strata"]
    if not entries:
        raise ValueError(f"{path or STRATA_PATH} configures no strata")

    ids = tuple(str(entry["id"]) for entry in entries)
    if len(set(ids)) != len(ids):
        raise ValueError(f"duplicate stratum ids: {ids}")

    by_cefr: dict[str, str] = {}
    for entry in entries:
        for level in entry["cefr_levels"]:
            if level in by_cefr:
                # Overlapping strata would make assignment depend on iteration
                # order, which is exactly the kind of silent nondeterminism a
                # randomisation scheme cannot have.
                raise ValueError(
                    f"CEFR level {level} is claimed by both {by_cefr[level]} and {entry['id']}"
                )
            by_cefr[level] = str(entry["id"])

    block_size = int(document["block_size"])
    conditions = tuple(str(c) for c in document["conditions"])
    if block_size % len(conditions) != 0:
        raise ValueError(
            f"block size {block_size} does not divide evenly among {len(conditions)} conditions"
        )

    return Strata(
        ids=ids,
        labels={str(e["id"]): str(e["label"]) for e in entries},
        by_cefr=by_cefr,
        block_size=block_size,
        blocks_per_stratum=int(document["blocks_per_stratum"]),
        conditions=conditions,
    )


def stratum_for_cefr(level: str, strata: Strata | None = None) -> str | None:
    """The stratum a self-reported level belongs to, or None if not admitted.

    None rather than a fallback stratum: a level below the inclusion threshold
    is screened out before randomisation, and a participant who reaches
    allocation without a stratum is a bug that must not be papered over by
    assigning them somewhere.
    """
    return (strata or load_strata()).by_cefr.get(level)
