"""Manipulation and control checks (spec v2 section 1).

The study claims the warm arm was perceived as warmer and *not* as more
competent. Both halves matter. Without the first, a null interaction means
nothing: it could be that the manipulation never landed. Without the second,
a positive interaction means something else: warmth and competence would be
confounded, and the effect could be entirely about perceived expertise.

Until now the warmth scale was collected and scored and never tested, and the
competence scale was collected and never scored at all -- so the study had two
declared checks and performed neither.

The control check needs care. "Must not differ" cannot be established by a
p-value above .05: failing to reject is not evidence of absence, and a small
sample would pass the check by being uninformative. So the control is reported
as a Bayes factor, where evidence *for* the null is a number that can only get
larger with more data.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from analysis import manipulation_checks


def _people(
    n: int = 80,
    *,
    warmth_gap: float = 1.2,
    competence_gap: float = 0.0,
    seed: int = 7,
) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    rows = []
    for i in range(n):
        warm = i % 2 == 0
        rows.append(
            {
                "session_id": f"s{i:03d}",
                "condition": "warm" if warm else "neutral",
                "warmth_perceived": 4.0 + (warmth_gap if warm else 0.0) + rng.normal(0, 0.9),
                "competence_perceived": 5.0
                + (competence_gap if warm else 0.0)
                + rng.normal(0, 0.9),
            }
        )
    return pd.DataFrame(rows)


def test_a_manipulation_that_landed_is_reported_as_passing() -> None:
    checks = manipulation_checks(_people())
    assert checks["warmth"]["passed"] is True
    assert checks["warmth"]["diff"] > 0


def test_a_manipulation_that_did_not_land_fails_the_check() -> None:
    # The failure mode this exists for: if the warm stimuli do not read as
    # warmer, every hypothesis downstream is about nothing in particular.
    checks = manipulation_checks(_people(warmth_gap=0.0))
    assert checks["warmth"]["passed"] is False


def test_the_control_check_passes_when_competence_is_untouched() -> None:
    checks = manipulation_checks(_people(competence_gap=0.0))
    control = checks["competence"]
    assert control["passed"] is True
    # Evidence for the null, not merely absence of evidence against it.
    assert control["bf01"] > 3.0


def test_the_control_check_fails_when_the_arms_differ_on_competence() -> None:
    checks = manipulation_checks(_people(competence_gap=1.5))
    control = checks["competence"]
    assert control["passed"] is False
    assert control["bf01"] < 1.0


def test_the_control_check_is_not_satisfied_by_a_tiny_sample() -> None:
    # Six people cannot establish that two arms are equivalent. A check based
    # on p > .05 would call this a pass, which is the whole reason it is not.
    checks = manipulation_checks(_people(n=6, competence_gap=0.0))
    assert checks["competence"]["passed"] is False


def test_a_missing_scale_raises_rather_than_being_skipped() -> None:
    people = _people().drop(columns=["competence_perceived"])
    with pytest.raises(KeyError):
        manipulation_checks(people)
