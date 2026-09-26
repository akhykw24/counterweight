"""Pilot and test sessions must never reach the analysed sample.

They land in the same table as the real study. Nothing about a pilot response
looks different from a participant's once it is in a CSV, so the separation has
to be structural: a mark on every row, and a filter that runs before any
statistic is computed.

Like withdrawal, and for the same reason, this is not one of section 8.6's
exclusion criteria. Those are methodological and reported both ways. This one
is about what the data *is*: a rehearsal is not an observation, and no
specification -- including the one that keeps excluded participants -- may
include it.
"""

from __future__ import annotations

import pandas as pd
import pytest

from exclusions import keep_live_only


def _participants(modes: list[str]) -> pd.DataFrame:
    return pd.DataFrame(
        [
            {
                "session_id": f"s{index:03d}",
                "run_mode": mode,
                "condition": "warm",
                "completed": 1,
                "withdrawn": 0,
                "repeat_session": 0,
            }
            for index, mode in enumerate(modes)
        ]
    )


def _trials(session_ids: list[str]) -> pd.DataFrame:
    return pd.DataFrame(
        [{"session_id": sid, "item_id": f"item_{i:02d}"} for sid in session_ids for i in range(1, 3)]
    )


def test_only_live_sessions_survive() -> None:
    frames = {
        "participants": _participants(["live", "pilot", "test", "live"]),
        "trials": _trials(["s000", "s001", "s002", "s003"]),
    }
    kept, counts = keep_live_only(frames)

    assert set(kept["participants"]["session_id"]) == {"s000", "s003"}
    assert set(kept["trials"]["session_id"]) == {"s000", "s003"}
    assert counts == {"pilot": 1, "test": 1}


def test_a_run_with_no_rehearsals_is_unchanged() -> None:
    frames = {"participants": _participants(["live", "live"]), "trials": _trials(["s000", "s001"])}
    kept, counts = keep_live_only(frames)
    assert len(kept["participants"]) == 2
    assert counts == {}


def test_the_originals_are_not_mutated() -> None:
    frames = {"participants": _participants(["live", "pilot"]), "trials": _trials(["s000", "s001"])}
    keep_live_only(frames)
    assert len(frames["participants"]) == 2


def test_a_missing_run_mode_column_raises() -> None:
    # Failing closed. A projection without the column would silently analyse
    # everything, pilot responses included, and nothing would look wrong.
    frames = {
        "participants": _participants(["live"]).drop(columns=["run_mode"]),
        "trials": _trials(["s000"]),
    }
    with pytest.raises(KeyError):
        keep_live_only(frames)


def test_an_unknown_mode_raises_rather_than_being_kept() -> None:
    # A typo in a link ("?pilot=yes") cannot produce this -- the client only
    # ever writes one of three values -- so an unrecognised mode means
    # something upstream is wrong, and guessing which way to file it is how a
    # rehearsal ends up in the sample.
    frames = {"participants": _participants(["live", "piIot"]), "trials": _trials(["s000", "s001"])}
    with pytest.raises(ValueError, match="piIot"):
        keep_live_only(frames)


def test_tables_without_a_session_column_pass_through() -> None:
    frames = {
        "participants": _participants(["live"]),
        "items": pd.DataFrame([{"item_id": "item_01", "advice_value": 1.0}]),
    }
    kept, _ = keep_live_only(frames)
    assert len(kept["items"]) == 1
