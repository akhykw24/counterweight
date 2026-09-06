"""Withdrawn responses must never reach an analysis.

The gap
-------
`replay.py` projected a `withdrawn` column and nothing read it. A participant
who pressed "withdraw my responses" on the debrief screen -- after being told
what the study was really about -- had their data counted anyway. The consent
form is about to promise that withdrawal works, so it has to.

Why this is not a sixth exclusion criterion
-------------------------------------------
Section 8.6's criteria are methodological: they answer "is this data
informative?", they are counted per criterion, and every analysis is reported
both with and without them. Withdrawal answers a different question --
"do we have permission to use this?" -- and the answer is no in every
specification, including the "without exclusions" one. Filing it alongside the
five would make consent look like an analytic choice, and would let a
"sensitivity analysis including excluded participants" quietly re-admit people
who asked to be left out.

So it is removed earlier, unconditionally, and counted separately.

What withdrawal does not mean
-----------------------------
The event log is append-only by construction, and that is a claim the paper
makes. The rows stay; nothing derived from them is ever used or reported. The
consent text says exactly that rather than promising a deletion the design
cannot perform.
"""

from __future__ import annotations

import pandas as pd
import pytest

from exclusions import apply_exclusions, remove_withdrawn


def _participants(rows: list[tuple[str, int, int]]) -> pd.DataFrame:
    return pd.DataFrame(
        [
            {
                "session_id": sid,
                "condition": "warm",
                "completed": completed,
                "withdrawn": withdrawn,
                "repeat_session": 0,
            }
            for sid, completed, withdrawn in rows
        ]
    )


def _trials(session_ids: list[str]) -> pd.DataFrame:
    return pd.DataFrame(
        [
            {
                "session_id": sid,
                "item_id": f"item_{i:02d}",
                "initial_estimate": 100.0,
                "final_estimate": 120.0,
                "ms_reveal_to_final": 30_000,
                "revision_count": 2,
            }
            for sid in session_ids
            for i in range(1, 13)
        ]
    )


def test_a_withdrawn_participant_is_removed_from_every_table() -> None:
    frames = {
        "participants": _participants([("keep", 1, 0), ("gone", 1, 1)]),
        "trials": _trials(["keep", "gone"]),
        "questionnaire": pd.DataFrame(
            [{"session_id": "keep", "value": 5}, {"session_id": "gone", "value": 5}]
        ),
    }
    kept, count = remove_withdrawn(frames)

    assert count == 1
    for name, frame in kept.items():
        assert set(frame["session_id"]) == {"keep"}, name


def test_the_originals_are_not_mutated() -> None:
    # Section 8.6 reports every analysis with and without exclusions, which is
    # only possible while the unfiltered tables still exist.
    frames = {
        "participants": _participants([("keep", 1, 0), ("gone", 1, 1)]),
        "trials": _trials(["keep", "gone"]),
    }
    remove_withdrawn(frames)
    assert len(frames["participants"]) == 2
    assert set(frames["trials"]["session_id"]) == {"keep", "gone"}


def test_withdrawal_survives_the_both_ways_reporting() -> None:
    # The failure this guards: a "sensitivity analysis including excluded
    # participants" must not re-admit somebody who asked to be left out.
    # Withdrawal is removed before the criteria run, so no toggle can undo it.
    participants = _participants([("keep", 1, 0), ("gone", 1, 1)])
    frames = {"participants": participants, "trials": _trials(["keep", "gone"])}
    kept, _ = remove_withdrawn(frames)

    report = apply_exclusions(kept["participants"], kept["trials"])
    assert set(report.flags["session_id"]) == {"keep"}
    assert "gone" not in report.excluded_sessions()


def test_a_withdrawal_before_completion_still_counts_as_withdrawal() -> None:
    # Someone who withdraws mid-session is not merely a non-completer. Both
    # facts are true; the one that matters is that they asked to be left out.
    frames = {"participants": _participants([("gone", 0, 1)]), "trials": _trials([])}
    kept, count = remove_withdrawn(frames)
    assert count == 1
    assert kept["participants"].empty


def test_a_missing_withdrawn_column_raises() -> None:
    # Failing closed. If replay stops emitting it, the pipeline must stop
    # rather than silently analyse data nobody has permission to use.
    frames = {
        "participants": _participants([("keep", 1, 0)]).drop(columns=["withdrawn"]),
        "trials": _trials(["keep"]),
    }
    with pytest.raises(KeyError):
        remove_withdrawn(frames)


def test_nothing_withdrawn_changes_nothing() -> None:
    frames = {
        "participants": _participants([("a", 1, 0), ("b", 1, 0)]),
        "trials": _trials(["a", "b"]),
    }
    kept, count = remove_withdrawn(frames)
    assert count == 0
    assert len(kept["participants"]) == 2
