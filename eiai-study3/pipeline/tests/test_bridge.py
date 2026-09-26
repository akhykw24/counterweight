"""The bridge has to compare types, not only key names.

verify_bridge.py exists to stop the simulator drifting away from the real app,
and its docstring promises to compare "the *shape* of what lands in the log".
It compared the set of payload keys and nothing about what sat under them --
so when simulate.py wrote `client_ts` as an integer count of milliseconds and
the browser wrote the ISO string the schema requires, the bridge reported that
the two logs agreed. Every duration in the projection was computed with
`int(client_ts)`, which worked on synthetic data and raised `ValueError` on the
first real session.

A field whose type differs is a shape difference. These tests hold the bridge
to the claim it makes.

Values stay out of scope, deliberately: the bots move sliders differently from
the simulated participants and should.
"""

from __future__ import annotations

from typing import Any

from verify_bridge import compare

BROWSER_TS = "2026-09-26T10:12:00.948Z"


def event(kind: str, session: str = "s1", seq: int = 1, ts: Any = BROWSER_TS, **payload: Any) -> dict:
    return {
        "event_id": f"{session}-{seq}",
        "session_id": session,
        "seq": seq,
        "client_ts": ts,
        "run_mode": "live",
        "type": kind,
        "payload": payload,
    }


def one_complete_item(ts: Any = BROWSER_TS, **overrides: Any) -> list[dict]:
    """The five per-item events a finalised trial must carry, minimally filled."""
    common = {"item_id": "item_01"}
    return [
        event("ITEM_PRESENTED", ts=ts, position=1, **common),
        event("ESTIMATE_CHANGED", ts=ts, phase="initial", value=overrides.get("value", 100), **common),
        event("CONFIDENCE_SET", ts=ts, phase="initial", value=60, **common),
        event("RESPONSE_REVEALED", ts=ts, register_state="steady", response_id="r1", **common),
        event("ESTIMATE_FINALIZED", ts=ts, value=120, **common),
    ]


def test_two_logs_of_the_same_shape_agree() -> None:
    assert compare(one_complete_item(), one_complete_item()) == []


def test_differing_values_are_not_a_divergence() -> None:
    # The whole point of the simulator is that it answers differently.
    assert compare(one_complete_item(value=100), one_complete_item(value=4000)) == []


def test_a_null_where_the_other_log_has_a_value_is_tolerated() -> None:
    # An optional field left empty is not a different shape. register_state is
    # null whenever the neutral condition is in play.
    browser = one_complete_item()
    simulated = one_complete_item()
    simulated[3]["payload"]["register_state"] = None
    assert compare(browser, simulated) == []


def test_a_whole_number_against_a_fractional_one_is_not_a_divergence() -> None:
    # JSON has one numeric type. The browser's slider lands on 50 and the
    # simulator computes 47.3; both are the `Estimate` the schema declares, and
    # flagging the pair would make this check unusable.
    assert compare(one_complete_item(value=50), one_complete_item(value=47.3)) == []


def test_the_historic_bug_is_reported() -> None:
    """The simulator's integer client_ts against the browser's ISO string."""
    problems = compare(one_complete_item(), one_complete_item(ts=1_760_000_000_000))
    assert problems, "an integer timestamp against an ISO string was reported as agreeing"
    assert any("client_ts" in p for p in problems), problems


def test_a_payload_field_of_the_wrong_type_is_reported() -> None:
    simulated = one_complete_item()
    simulated[4]["payload"]["value"] = "120"  # a number sent as a string
    problems = compare(one_complete_item(), simulated)
    assert any("ESTIMATE_FINALIZED" in p and "value" in p for p in problems), problems


def test_the_message_says_which_side_wrote_what() -> None:
    problems = compare(one_complete_item(), one_complete_item(ts=1_760_000_000_000))
    joined = " ".join(problems)
    assert "str" in joined and "number" in joined, joined
