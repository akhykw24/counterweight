"""Strata are configuration, not code (spec v2 §1).

v2 replaces six language x age strata with two proficiency strata, and says
their number and names must live in a config file. The test that matters is not
"there are two" -- that would just move the hard-coding into the test -- but
"changing the config to three works without touching any code".
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

from _common import REPO_ROOT, read_json
from strata import (
    STRATA_PATH,
    Strata,
    load_strata,
    stratum_for_cefr,
)


def test_the_config_file_exists_and_parses():
    strata = load_strata()
    assert strata.ids, "no strata configured"
    assert strata.block_size % 2 == 0, "block size must divide evenly into two arms"


def test_v2_ships_two_proficiency_strata():
    # Asserted here rather than in the code: this is what the spec currently
    # says, and the next test proves the code does not depend on it.
    strata = load_strata()
    assert strata.ids == ("B1-B2", "C1-C2/native")


def test_every_cefr_level_maps_to_exactly_one_stratum():
    strata = load_strata()
    admitted = ["B1", "B2", "C1", "C2"]
    for level in admitted:
        assert stratum_for_cefr(level, strata) in strata.ids
    # A level below the inclusion threshold has no stratum: those participants
    # are screened out before randomisation and must never consume a slot.
    for level in ["A1", "A2"]:
        assert stratum_for_cefr(level, strata) is None


def test_changing_the_config_to_three_strata_needs_no_code_change(tmp_path):
    """The load-bearing test.

    A three-stratum config is written to a temporary file and every consumer is
    pointed at it. If any of them has the count or the names baked in, this
    fails.
    """
    three = {
        "schema_version": "1.0",
        "study": "eiai-study3",
        "block_size": 4,
        "blocks_per_stratum": 4,
        "conditions": ["warm", "neutral"],
        "note": "temporary three-stratum config used to prove the config drives the code",
        "strata": [
            {"id": "B1", "label": "B1", "cefr_levels": ["B1"]},
            {"id": "B2", "label": "B2", "cefr_levels": ["B2"]},
            {"id": "C", "label": "C1-C2/native", "cefr_levels": ["C1", "C2"]},
        ],
    }
    config = tmp_path / "strata.json"
    config.write_text(json.dumps(three, indent=2), encoding="utf-8")

    strata = load_strata(config)
    assert len(strata.ids) == 3
    assert stratum_for_cefr("B1", strata) == "B1"
    assert stratum_for_cefr("C2", strata) == "C"

    # The allocation generator has to produce a balanced sequence for whatever
    # the config says, not for two named cells.
    out = tmp_path / "allocation.json"
    result = subprocess.run(
        [sys.executable, str(REPO_ROOT / "pipeline" / "allocation.py"),
         "--strata", str(config), "--out", str(out)],
        capture_output=True, text=True, cwd=str(REPO_ROOT),
    )
    assert result.returncode == 0, result.stderr
    document = json.loads(out.read_text(encoding="utf-8"))
    assert sorted(document["sequence"]) == ["B1", "B2", "C"]
    for stratum, assignments in document["sequence"].items():
        warm = assignments.count("warm")
        assert warm * 2 == len(assignments), f"{stratum} is not balanced"


def test_the_committed_allocation_covers_every_configured_stratum():
    strata = load_strata()
    allocation = read_json(REPO_ROOT / "materials" / "allocation.json")
    assert sorted(allocation["sequence"]) == sorted(strata.ids)


def test_the_committed_sequence_covers_the_hard_cap_in_any_one_stratum():
    # Two strata will not fill evenly. If recruitment runs hot in one of them,
    # the sequence must still reach the hard cap there or the run stops early
    # for a reason that has nothing to do with the evidence.
    strata = load_strata()
    allocation = read_json(REPO_ROOT / "materials" / "allocation.json")
    for stratum, assignments in allocation["sequence"].items():
        assert len(assignments) >= 96, (
            f"{stratum} holds {len(assignments)} assignments; the hard cap is 160 "
            f"and recruitment does not split evenly"
        )
