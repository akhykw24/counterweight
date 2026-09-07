"""Internal consistency of the three rating scales.

Why this matters more here than usual
-------------------------------------
The warmth, competence and trust items were written for this study. A search of
the whole repository turned up no published instrument they were adapted from,
no citation, and no bibliography: the earliest record of the wording is the v1
specification, where the items already appear as finished text with no source.
So they are original items, and original items have no borrowed psychometrics.

For a validated scale, reporting alpha is a courtesy. For these, it is the only
evidence that the five warmth questions measure one thing rather than five, and
the reader has nothing else to go on.

What is computed
----------------
- **Cronbach's alpha** per scale, after reverse-scored items are flipped.
  Reversing first is not a detail: an unflipped negative item correlates
  negatively with the rest and drags alpha toward zero, which reads as "the
  scale is broken" when the truth is "one item is upside down".
- **Corrected item-total correlation** per item: the item against the sum of
  the *others*. Uncorrected, every item correlates with a total that contains
  itself, which inflates each figure and hides the weak one.
- **Alpha if the item were dropped**, which is what actually answers "which
  question is breaking this scale".
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from analysis import reliability

WARMTH_ITEMS = ["warmth_01", "warmth_02", "warmth_03", "warmth_04", "warmth_05"]


def _long(responses: dict[str, list[float]], scale: str = "warmth") -> pd.DataFrame:
    """Long-format questionnaire rows, the shape replay.py projects."""
    rows = []
    n = len(next(iter(responses.values())))
    for participant in range(n):
        for question_id, values in responses.items():
            rows.append(
                {
                    "session_id": f"s{participant:03d}",
                    "scale": scale,
                    "question_id": question_id,
                    "value": values[participant],
                }
            )
    return pd.DataFrame(rows)


def _consistent(n: int = 120, seed: int = 5) -> dict[str, list[float]]:
    """Everyone has a true level; each item is that level plus a little noise."""
    rng = np.random.default_rng(seed)
    level = rng.uniform(1.5, 6.5, n)
    out: dict[str, list[float]] = {}
    for item in WARMTH_ITEMS:
        values = np.clip(np.round(level + rng.normal(0, 0.4, n)), 1, 7)
        out[item] = list(values)
    return out


def _random(n: int = 120, seed: int = 5) -> dict[str, list[float]]:
    """No underlying level at all: every answer independent."""
    rng = np.random.default_rng(seed)
    return {item: list(rng.integers(1, 8, n).astype(float)) for item in WARMTH_ITEMS}


def test_a_consistent_scale_has_high_alpha() -> None:
    result = reliability(_long(_consistent()), "warmth", reverse=set())
    assert result["alpha"] > 0.85
    assert result["n_items"] == 5
    assert result["n_participants"] == 120


def test_random_answers_give_alpha_near_zero() -> None:
    # The check that makes the first test mean something. A formula that
    # returned a high number regardless would pass the first and fail here.
    result = reliability(_long(_random()), "warmth", reverse=set())
    assert result["alpha"] < 0.3


def test_reverse_scoring_happens_before_alpha() -> None:
    # The failure this exists for. One item recorded upside down correlates
    # negatively with the rest and drags alpha toward zero -- the scale looks
    # broken when in fact one item simply needs flipping.
    responses = _consistent()
    responses["warmth_04"] = [8 - v for v in responses["warmth_04"]]
    frame = _long(responses)

    not_flipped = reliability(frame, "warmth", reverse=set())
    flipped = reliability(frame, "warmth", reverse={"warmth_04"})

    # The size of the drop, not an arbitrary floor. With four of five items
    # still consistent, an unflipped fifth costs about 0.4 rather than sending
    # alpha to zero -- an absolute threshold here would be a number chosen to
    # match one seed.
    assert flipped["alpha"] > 0.85
    assert not_flipped["alpha"] < 0.65
    assert flipped["alpha"] - not_flipped["alpha"] > 0.3

    # And the diagnostic points at the culprit either way.
    assert not_flipped["items"]["warmth_04"]["item_total_r"] < 0
    assert not_flipped["items"]["warmth_04"]["alpha_if_dropped"] > not_flipped["alpha"]


def test_item_total_correlations_are_reported_for_every_item() -> None:
    result = reliability(_long(_consistent()), "warmth", reverse=set())
    assert sorted(result["items"].keys()) == WARMTH_ITEMS
    for stats in result["items"].values():
        assert stats["item_total_r"] > 0.6
        assert 0.0 <= stats["alpha_if_dropped"] <= 1.0


def test_the_item_that_breaks_a_scale_is_identifiable() -> None:
    # The whole point of reporting per-item figures. One item replaced by noise
    # must stand out on both diagnostics: a low correlation with the rest, and
    # an alpha that goes UP when it is removed.
    rng = np.random.default_rng(11)
    responses = _consistent()
    responses["warmth_03"] = list(rng.integers(1, 8, len(responses["warmth_03"])).astype(float))

    result = reliability(_long(responses), "warmth", reverse=set())
    broken = result["items"]["warmth_03"]
    others = [v for k, v in result["items"].items() if k != "warmth_03"]

    assert broken["item_total_r"] < 0.2
    assert all(o["item_total_r"] > 0.6 for o in others)
    assert broken["alpha_if_dropped"] > result["alpha"]


def test_item_total_correlation_is_corrected() -> None:
    # Uncorrected, an item correlates with a total that includes itself, which
    # inflates every figure and hides the weak one. With five items an
    # uncorrected r for a noise item would sit near 0.45; corrected it is near
    # zero, which is the number a reader needs.
    rng = np.random.default_rng(3)
    responses = _consistent()
    responses["warmth_02"] = list(rng.integers(1, 8, len(responses["warmth_02"])).astype(float))
    result = reliability(_long(responses), "warmth", reverse=set())
    assert abs(result["items"]["warmth_02"]["item_total_r"]) < 0.25


def test_a_scale_with_one_item_reports_no_alpha_rather_than_a_wrong_one() -> None:
    # Alpha is undefined for a single item. Returning 0.0, or 1.0, would be a
    # number somebody quotes.
    result = reliability(_long({"warmth_01": [1.0, 5.0, 3.0]}), "warmth", reverse=set())
    assert result["alpha"] is None
    assert result["n_items"] == 1


def test_an_absent_scale_is_empty_rather_than_an_error() -> None:
    # A pilot batch where nobody reached the questionnaire is a real shape.
    result = reliability(_long(_consistent()), "trust", reverse=set())
    assert result["alpha"] is None
    assert result["n_items"] == 0
    assert result["items"] == {}


def test_participants_missing_an_item_are_dropped_pairwise_free() -> None:
    # Alpha needs complete cases: a participant missing one item cannot
    # contribute to the covariance of that item with the others, and mixing
    # different subsets per pair produces a matrix that is not internally
    # consistent.
    responses = _consistent(n=40)
    frame = _long(responses)
    frame = frame[~((frame["session_id"] == "s000") & (frame["question_id"] == "warmth_02"))]

    result = reliability(frame, "warmth", reverse=set())
    assert result["n_participants"] == 39


def test_zero_variance_items_do_not_produce_a_nan_alpha() -> None:
    # Everyone answers 4 to one item. Its variance is zero and its correlation
    # with anything is undefined; alpha must still be a number.
    responses = _consistent()
    responses["warmth_05"] = [4.0] * len(responses["warmth_05"])
    result = reliability(_long(responses), "warmth", reverse=set())
    assert result["alpha"] is not None
    assert not np.isnan(result["alpha"])
    assert result["items"]["warmth_05"]["item_total_r"] == pytest.approx(0.0, abs=1e-9)


# --- the reverse-scored list must agree across three places -----------------


def test_python_agrees_with_the_typescript_instrument_on_which_items_reverse() -> None:
    """The questionnaire is defined in TypeScript; the analysis is in Python.

    Nothing but this test connects them. They disagreed once already, in the
    direction that is hardest to notice: the simulator answered every warmth
    item the same way, the scoring code flipped the one declared reverse, and
    the item ended up pointing against its own scale. Alpha went to 0.15 and the
    recovered warmth effect was cut roughly in half -- with no error anywhere.
    """
    import re
    from pathlib import Path

    from _common import ALL_REVERSE_SCORED, REPO_ROOT

    source = (REPO_ROOT / "packages" / "schema" / "src" / "questionnaire.ts").read_text(
        encoding="utf-8"
    )
    declared = {
        match.group(1)
        for match in re.finditer(
            r'id:\s*"([a-z_0-9]+)"[^}]*reverse_scored:\s*true', source
        )
    }
    assert declared, "no reverse-scored items found in questionnaire.ts -- has it moved?"
    assert declared == set(ALL_REVERSE_SCORED), (
        f"TypeScript declares {sorted(declared)} reverse-scored; Python has "
        f"{sorted(ALL_REVERSE_SCORED)}. One of them is wrong, and the symptom "
        "will be a scale that looks broken rather than an error."
    )


def test_the_simulator_answers_reverse_items_in_the_reverse_direction() -> None:
    # The behavioural half of the same guarantee. Simulated participants must
    # produce data the instrument's own scoring can read: after the analysis
    # flips the declared items, every item must correlate positively with its
    # scale. A negative correlation means somebody generated an item upside
    # down, which is exactly what happened before.
    import random

    from _common import load_items
    from analysis import SCALES, reliability
    from simulate import simulate_session

    rng = random.Random(20260907)
    items = load_items()["items"]
    rows: list[dict[str, object]] = []
    for index in range(80):
        events = simulate_session(
            "SimCentral" if index % 2 else "SimPeripheral",
            "warm" if index % 3 else "neutral",
            "en",
            items,
            "0" * 64,
            rng,
            1_700_000_000_000 + index * 1_000_000,
        )
        for event in events:
            if event["type"] == "QUESTIONNAIRE_ANSWERED":
                rows.append({"session_id": event["session_id"], **event["payload"]})

    questionnaire = pd.DataFrame(rows)
    for scale, reverse in SCALES:
        result = reliability(questionnaire, scale, reverse)
        assert result["alpha"] is not None and result["alpha"] > 0.5, (
            f"{scale}: simulated answers have no internal consistency "
            f"(alpha = {result['alpha']})"
        )
        for item_id, stats in result["items"].items():
            assert stats["item_total_r"] > 0, (
                f"{item_id} correlates {stats['item_total_r']:+.2f} against its own "
                "scale -- the simulator and the scoring disagree about its direction"
            )
