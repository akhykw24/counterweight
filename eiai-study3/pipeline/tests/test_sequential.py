"""The pre-registered sequential stopping rule (spec v2 section 8.2).

The rule is what makes an early stop legitimate rather than opportunistic. Its
whole value is that the looks are fixed in advance: sequential Bayes factors do
not inflate error rates when the schedule is pre-registered, and they inflate
everything when it is not. So the schedule is code, not judgement, and the
decision at any N is a pure function of the data.

The two failure modes worth testing are opposite. A rule that never says stop
wastes the design; a rule that says stop before the first pre-registered look
is optional stopping wearing a Bayesian hat.
"""

from __future__ import annotations

import pytest

from sequential import (
    FIRST_LOOK_N,
    HARD_CAP_N,
    LOOK_INTERVAL,
    STOP_AGAINST_BF,
    STOP_FOR_BF,
    looks_up_to,
    stopping_decision,
)


def test_the_look_schedule_is_the_pre_registered_one() -> None:
    assert FIRST_LOOK_N == 60
    assert LOOK_INTERVAL == 20
    assert HARD_CAP_N == 160
    assert looks_up_to(160) == [60, 80, 100, 120, 140, 160]


def test_no_look_happens_before_the_first_pre_registered_one() -> None:
    assert looks_up_to(59) == []
    decision = stopping_decision(n=59, bf10=100.0)
    assert decision["at_a_look"] is False
    assert decision["stop"] is False
    assert "before the first" in decision["reason"]


def test_overwhelming_evidence_between_looks_does_not_license_a_stop() -> None:
    # The point of the rule. A BF of 500 at N = 71 is not a reason to stop,
    # because stopping there is a decision the pre-registration did not license.
    decision = stopping_decision(n=71, bf10=500.0)
    assert decision["at_a_look"] is False
    assert decision["stop"] is False


def test_evidence_for_the_effect_stops_collection_at_a_look() -> None:
    decision = stopping_decision(n=80, bf10=STOP_FOR_BF + 0.1)
    assert decision["stop"] is True
    assert decision["verdict"] == "evidence for"


def test_evidence_against_the_effect_stops_collection_at_a_look() -> None:
    decision = stopping_decision(n=80, bf10=STOP_AGAINST_BF / 2)
    assert decision["stop"] is True
    assert decision["verdict"] == "evidence against"


def test_the_thresholds_are_exclusive_as_pre_registered() -> None:
    # "> 6" and "< 1/6". Exactly at the boundary is not past it.
    assert stopping_decision(n=80, bf10=STOP_FOR_BF)["stop"] is False
    assert stopping_decision(n=80, bf10=STOP_AGAINST_BF)["stop"] is False


def test_inconclusive_evidence_continues() -> None:
    decision = stopping_decision(n=100, bf10=1.4)
    assert decision["stop"] is False
    assert decision["verdict"] == "inconclusive"
    assert decision["next_look"] == 120


def test_the_hard_cap_stops_collection_whatever_the_evidence_says() -> None:
    decision = stopping_decision(n=HARD_CAP_N, bf10=1.0)
    assert decision["stop"] is True
    assert decision["verdict"] == "inconclusive"
    assert "cap" in decision["reason"]
    assert decision["next_look"] is None


def test_past_the_cap_is_also_a_stop() -> None:
    # Recruitment overshooting a look is normal; the rule must still terminate.
    assert stopping_decision(n=HARD_CAP_N + 5, bf10=1.0)["stop"] is True


def test_a_negative_or_zero_bayes_factor_is_rejected() -> None:
    # BF10 is a ratio of marginal likelihoods and cannot be <= 0. Accepting one
    # would let a numerical failure upstream read as "evidence against".
    with pytest.raises(ValueError):
        stopping_decision(n=80, bf10=0.0)
