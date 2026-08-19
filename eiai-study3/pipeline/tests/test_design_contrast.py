"""The justification-quality contrast must exclude fillers.

This is the Python-side counterpart to
packages/schema/test/design-constraints.test.ts, which checks the bank. That one
cannot see the analysis, and the defect being guarded against lived in the
analysis: `per_participant` averaged every trial, so the four fillers landed in
the strong cell and made it 75% accurate against the weak cell's 50%.
"""

import pandas as pd
import pytest

from _common import load_items
from analysis import Specification, per_participant


def _frame(rows):
    return pd.DataFrame(rows)


def _empty_questionnaire():
    return pd.DataFrame(columns=["session_id", "scale", "question_id", "value"])


def _trial(session, item_id, quality, role, woa):
    return {
        "session_id": session,
        "item_id": item_id,
        "condition": "warm",
        "justification_quality": quality,
        "role": role,
        "woa": woa,
        "max_scroll_fraction": 0.5,
        "challenged": 0,
        "verify_clicks": 0,
        "ms_reveal_to_final": 1000,
    }


def test_fillers_do_not_enter_the_quality_contrast():
    # Fillers carry a deliberately extreme WOA. If they were averaged into the
    # strong cell, woa_strong would be dragged far from 0.2.
    trials = _frame(
        [_trial("s1", "item_04", "strong", "analysed", 0.2),
         _trial("s1", "item_10", "strong", "analysed", 0.2),
         _trial("s1", "item_02", "weak", "analysed", 0.1),
         _trial("s1", "item_07", "weak", "analysed", 0.1),
         _trial("s1", "item_01", "strong", "filler", 0.9),
         _trial("s1", "item_06", "strong", "filler", 0.9)]
    )
    people = per_participant(trials, _empty_questionnaire())

    assert people["woa_strong"].iloc[0] == pytest.approx(0.2)
    assert people["woa_weak"].iloc[0] == pytest.approx(0.1)
    assert people["discrimination"].iloc[0] == pytest.approx(0.1)


def test_fillers_still_count_toward_scroll_and_vigilance():
    # They are trials the participant actually saw, so excluding them from
    # exposure measures would understate how much of each reply was read.
    trials = _frame(
        [dict(_trial("s1", "item_04", "strong", "analysed", 0.2), max_scroll_fraction=0.0),
         _trial("s1", "item_02", "weak", "analysed", 0.1),
         dict(_trial("s1", "item_01", "strong", "filler", 0.9), max_scroll_fraction=1.0)]
    )
    people = per_participant(trials, _empty_questionnaire())
    assert people["scroll_depth"].iloc[0] == pytest.approx((0.0 + 0.5 + 1.0) / 3)


def test_missing_role_column_is_refused_rather_than_ignored():
    # Falling back to "use every trial" is exactly the defect this replaced.
    trials = _frame([_trial("s1", "item_04", "strong", "analysed", 0.2)]).drop(columns=["role"])
    with pytest.raises(KeyError, match="role"):
        per_participant(trials, _empty_questionnaire())


def test_bank_and_assignment_agree_on_every_item():
    bank = load_items()
    assert len(bank["items"]) == 12
    analysed = [i for i in bank["items"] if i["role"] == "analysed"]
    strong = [i for i in analysed if i["assigned_justification_quality"] == "strong"]
    weak = [i for i in analysed if i["assigned_justification_quality"] == "weak"]
    assert len(strong) == len(weak)
    # Equal advice accuracy across quality is the confound the design turns on.
    assert sum(i["is_error"] for i in strong) == sum(i["is_error"] for i in weak)
