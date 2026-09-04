"""Participant exclusion criteria (spec v2 section 8.6).

Exclusions are the part of an analysis pipeline most easily fudged after the
fact, so they are implemented here as a separate, explicitly logged step rather
than as filters scattered through the analysis. Every criterion is a pure
function of the projected tables, every criterion is counted separately, and
the counts are written to a file that the report reads.

The tests below are one per criterion plus the thresholds' boundaries. Testing
a threshold only well inside its range is how an off-by-one survives: criterion
2 fires at seven fast trials, so six must not fire it.
"""

from __future__ import annotations

import pandas as pd
import pytest

from exclusions import (
    CRITERIA,
    filter_excluded,
    FAST_TRIAL_MIN_COUNT,
    FAST_TRIAL_MS,
    apply_exclusions,
)

TOTAL = 12


def _participant(session_id: str, **over: object) -> dict[str, object]:
    row: dict[str, object] = {
        "session_id": session_id,
        "condition": "warm",
        "completed": 1,
        "repeat_session": 0,
    }
    row.update(over)
    return row


def _trials(
    session_id: str,
    *,
    n: int = TOTAL,
    ms_reveal_to_final: int = 30_000,
    moved: bool = True,
    revisions: int = 2,
    fast_count: int | None = None,
) -> list[dict[str, object]]:
    """One participant's trial rows, uniform unless a test asks otherwise."""
    rows: list[dict[str, object]] = []
    for i in range(n):
        fast = fast_count is not None and i < fast_count
        rows.append(
            {
                "session_id": session_id,
                "item_id": f"item_{i + 1:02d}",
                "initial_estimate": 100.0,
                "final_estimate": 120.0 if moved else 100.0,
                "ms_reveal_to_final": 1_000 if fast else ms_reveal_to_final,
                "revision_count": revisions,
            }
        )
    return rows


def _report(participants: list[dict[str, object]], trials: list[dict[str, object]]):
    return apply_exclusions(pd.DataFrame(participants), pd.DataFrame(trials))


def test_every_criterion_in_the_specification_is_represented() -> None:
    # Including the one that is deliberately not applied. A criterion dropped
    # from the code because it is unused becomes a criterion nobody remembers
    # was considered.
    assert [c.number for c in CRITERIA] == [1, 2, 3, 4, 5]
    assert [c.applied for c in CRITERIA] == [True, True, True, False, True]


def test_criterion_1_non_completion() -> None:
    report = _report(
        [_participant("s1"), _participant("s2", completed=0)],
        _trials("s1") + _trials("s2", n=5),
    )
    assert report.counts["non_completion"] == 1
    assert report.excluded_sessions() == {"s2"}


def test_criterion_2_fires_at_seven_fast_trials() -> None:
    report = _report(
        [_participant("s1")],
        _trials("s1", fast_count=FAST_TRIAL_MIN_COUNT),
    )
    assert report.counts["fast_trials"] == 1


def test_criterion_2_does_not_fire_one_below_the_threshold() -> None:
    report = _report(
        [_participant("s1")],
        _trials("s1", fast_count=FAST_TRIAL_MIN_COUNT - 1),
    )
    assert report.counts["fast_trials"] == 0
    assert report.excluded_sessions() == set()


def test_criterion_2_boundary_is_strictly_under_five_seconds() -> None:
    # Exactly 5000 ms is not "under 5 seconds". The spec's wording is the
    # contract; a >= here would exclude someone the pre-registration keeps.
    at = _trials("s1")
    for row in at:
        row["ms_reveal_to_final"] = FAST_TRIAL_MS
    under = _trials("s2")
    for row in under:
        row["ms_reveal_to_final"] = FAST_TRIAL_MS - 1

    report = _report([_participant("s1"), _participant("s2")], at + under)
    assert report.excluded_sessions() == {"s2"}


def test_criterion_3_invariant_responding_needs_both_halves() -> None:
    # Never moved and never touched the slider -> excluded.
    frozen = _trials("s1", moved=False, revisions=0)
    # Never moved but did revise -- a considered decision to stay put, which
    # the spec explicitly protects.
    deliberate = _trials("s2", moved=False, revisions=3)
    # Moved, but the revision counter is zero (slider dragged once, committed).
    moved = _trials("s3", moved=True, revisions=0)

    report = _report(
        [_participant("s1"), _participant("s2"), _participant("s3")],
        frozen + deliberate + moved,
    )
    assert report.counts["invariant_responding"] == 1
    assert report.excluded_sessions() == {"s1"}


def test_criterion_4_is_declared_but_never_excludes_anyone() -> None:
    report = _report([_participant("s1")], _trials("s1"))
    assert report.counts["attention_check"] == 0
    criterion = next(c for c in CRITERIA if c.key == "attention_check")
    assert criterion.applied is False


def test_criterion_5_repeat_participation() -> None:
    report = _report(
        [_participant("s1"), _participant("s2", repeat_session=1)],
        _trials("s1") + _trials("s2"),
    )
    assert report.counts["repeat_session"] == 1
    assert report.excluded_sessions() == {"s2"}


def test_counts_are_per_criterion_not_a_single_total() -> None:
    # One participant failing two criteria must appear under both, or the
    # per-criterion table stops being readable as "why were people dropped".
    report = _report(
        [_participant("s1", completed=0, repeat_session=1)],
        _trials("s1", fast_count=TOTAL),
    )
    assert report.counts["non_completion"] == 1
    assert report.counts["repeat_session"] == 1
    assert report.counts["fast_trials"] == 1
    assert len(report.excluded_sessions()) == 1


def test_a_participant_with_no_trials_is_not_silently_kept() -> None:
    report = _report([_participant("s1", completed=0)], [])
    assert report.excluded_sessions() == {"s1"}


def test_the_flag_table_covers_every_participant() -> None:
    report = _report(
        [_participant("s1"), _participant("s2", completed=0)],
        _trials("s1") + _trials("s2"),
    )
    assert set(report.flags["session_id"]) == {"s1", "s2"}
    assert list(report.flags.columns[:1]) == ["session_id"]
    for criterion in CRITERIA:
        assert criterion.key in report.flags.columns


def test_a_missing_column_is_an_error_rather_than_a_silent_pass() -> None:
    # If replay stops emitting repeat_session, criterion 5 must not quietly
    # become "nobody is a repeat". That is the failure mode that makes an
    # exclusion step worthless.
    participants = pd.DataFrame([_participant("s1")]).drop(columns=["repeat_session"])
    with pytest.raises(KeyError):
        apply_exclusions(participants, pd.DataFrame(_trials("s1")))


def test_filter_removes_excluded_sessions_from_every_table() -> None:
    # The analysis is reported both ways, so filtering has to be something the
    # caller does explicitly to a copy -- never something apply_exclusions does
    # on its way past.
    participants = [_participant("s1"), _participant("s2", completed=0)]
    trials = _trials("s1") + _trials("s2", n=4)
    frames = {
        "participants": pd.DataFrame(participants),
        "trials": pd.DataFrame(trials),
        "questionnaire": pd.DataFrame(
            [
                {"session_id": "s1", "scale": "trust", "question_id": "trust_01", "value": 5},
                {"session_id": "s2", "scale": "trust", "question_id": "trust_01", "value": 5},
            ]
        ),
    }
    report = _report(participants, trials)
    kept = filter_excluded(frames, report)

    for name, frame in kept.items():
        assert set(frame["session_id"]) == {"s1"}, name
    # The originals are untouched, or "both ways" quietly becomes one way.
    assert len(frames["participants"]) == 2
    assert set(frames["trials"]["session_id"]) == {"s1", "s2"}


def test_filter_leaves_tables_without_a_session_column_alone() -> None:
    report = _report([_participant("s1", completed=0)], _trials("s1"))
    frames = {"items": pd.DataFrame([{"item_id": "item_01", "advice_value": 1.0}])}
    assert len(filter_excluded(frames, report)["items"]) == 1
