"""The three section 8.1 requirements the pipeline did not implement.

All three exist to close off an alternative explanation, and each closes off a
different one.

**CEFR as a covariate.** A participant who cannot read a strong argument as
strong will show a flat discrimination score for a reason that has nothing to
do with warmth. English proficiency is the one participant characteristic with
a mechanistic route to the dependent variable, so it belongs in the model
rather than in the limitations section.

**Sensitivity excluding B1.** Reported alongside the primary result whether or
not it agrees with it. Pre-specifying it is what stops it from becoming a
robustness check that only gets mentioned when it is convenient.

**Jackknife over items.** The interaction re-estimated twelve times, each time
dropping one item. A conclusion that survives only with one particular item in
the set is a conclusion about that item.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from analysis import (
    adjusted_discrimination,
    jackknife_over_items,
)

CEFR_LEVELS = ("B1", "B2", "C1", "C2")


def _people(
    n: int = 120,
    *,
    style_effect: float = 0.0,
    cefr_effect: float = 0.0,
    confound: bool = False,
    seed: int = 3,
) -> pd.DataFrame:
    """Participants with a discrimination score, a condition and a CEFR level.

    `confound=True` puts the proficient participants disproportionately in the
    neutral arm, which is the situation the covariate exists to survive.
    """
    rng = np.random.default_rng(seed)
    rows = []
    for i in range(n):
        warm = i % 2 == 0
        if confound:
            level = CEFR_LEVELS[0] if warm else CEFR_LEVELS[3]
        else:
            level = CEFR_LEVELS[i % len(CEFR_LEVELS)]
        skill = CEFR_LEVELS.index(level)
        rows.append(
            {
                "session_id": f"s{i:03d}",
                "condition": "warm" if warm else "neutral",
                "cefr": level,
                "discrimination": (
                    0.10
                    + (style_effect if warm else 0.0)
                    + cefr_effect * skill
                    + rng.normal(0, 0.05)
                ),
            }
        )
    return pd.DataFrame(rows)


# --- CEFR covariate ---------------------------------------------------------


def test_the_adjusted_estimate_matches_the_raw_one_when_cefr_is_balanced() -> None:
    people = _people(style_effect=0.10, cefr_effect=0.02)
    result = adjusted_discrimination(people)
    # Balanced allocation across levels: adjusting changes little.
    assert result["estimate"] == pytest.approx(0.10, abs=0.03)
    assert result["p"] < 0.01


def test_the_covariate_removes_a_proficiency_confound() -> None:
    # Warm arm is all B1, neutral arm all C2, and proficiency alone drives
    # discrimination. Unadjusted, this looks like a large style effect.
    people = _people(style_effect=0.0, cefr_effect=0.06, confound=True)
    warm = people[people["condition"] == "warm"]["discrimination"].mean()
    neutral = people[people["condition"] == "neutral"]["discrimination"].mean()
    assert abs(warm - neutral) > 0.10, "the fixture failed to create a confound"

    result = adjusted_discrimination(people)
    assert result["estimate"] == pytest.approx(0.0, abs=0.05)


def test_a_missing_cefr_column_raises() -> None:
    with pytest.raises(KeyError):
        adjusted_discrimination(_people().drop(columns=["cefr"]))


def test_a_single_cefr_level_is_reported_rather_than_crashing() -> None:
    # Legitimate early in recruitment. The adjustment is undefined with no
    # variation to adjust for, and that has to be visible rather than silent.
    people = _people()
    people["cefr"] = "B2"
    result = adjusted_discrimination(people)
    assert result["adjusted"] is False
    assert result["estimate"] == pytest.approx(
        people[people["condition"] == "warm"]["discrimination"].mean()
        - people[people["condition"] == "neutral"]["discrimination"].mean(),
        abs=1e-9,
    )


# --- jackknife --------------------------------------------------------------


def _trials(n_participants: int = 60, n_items: int = 12, seed: int = 11) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    rows = []
    for p in range(n_participants):
        warm = p % 2 == 0
        for i in range(n_items):
            strong = i % 2 == 0
            rows.append(
                {
                    "session_id": f"s{p:03d}",
                    "item_id": f"item_{i + 1:02d}",
                    "condition": "warm" if warm else "neutral",
                    "role": "analysed",
                    "justification_quality": "strong" if strong else "weak",
                    "woa": 0.4 + (0.15 if strong else 0.0) + rng.normal(0, 0.08),
                }
            )
    return pd.DataFrame(rows)


def test_the_jackknife_drops_each_item_exactly_once() -> None:
    results = jackknife_over_items(_trials())
    assert len(results) == 12
    assert sorted(r["dropped_item"] for r in results) == [
        f"item_{i:02d}" for i in range(1, 13)
    ]


def test_every_jackknife_estimate_is_computed_from_the_remaining_items() -> None:
    results = jackknife_over_items(_trials())
    for result in results:
        assert result["n_items"] == 11
        assert np.isfinite(result["estimate"])


def test_the_jackknife_exposes_an_estimate_carried_by_one_item() -> None:
    # One item given an enormous quality gap. Dropping it must visibly move the
    # estimate; if the jackknife cannot see that, it is decoration.
    trials = _trials()
    outlier = (trials["item_id"] == "item_01") & (trials["justification_quality"] == "strong")
    trials.loc[outlier, "woa"] += 3.0

    results = {r["dropped_item"]: r["estimate"] for r in jackknife_over_items(trials)}
    without_the_outlier = results["item_01"]
    others = [v for k, v in results.items() if k != "item_01"]
    assert abs(without_the_outlier - np.mean(others)) > 0.1


def test_the_jackknife_ignores_filler_items() -> None:
    # Fillers are not part of the analysed 2x2, so dropping one says nothing
    # about the interaction and would pad the report with meaningless rows.
    trials = _trials()
    trials.loc[trials["item_id"].isin(["item_11", "item_12"]), "role"] = "filler"
    results = jackknife_over_items(trials)
    assert len(results) == 10
    assert "item_11" not in [r["dropped_item"] for r in results]
