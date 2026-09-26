"""Slot accounting: exhaustion and attrition (spec v2 §1).

Two problems the audit left open.

**Exhaustion.** Nothing defined what happens to the participant after the last
slot in their stratum. `allocate()` computed `hash mod length`, so the sequence
silently wrapped: two participants drew the same slot and nothing in the log said
so.

**Attrition.** A slot was consumed the moment it was assigned. Someone who
opened the link and left immediately consumed one anyway, and nothing returned
it -- so the block balance drifted for every participant after them.

The policy implemented here: a slot is **reserved** at ALLOCATED and only
**consumed** once the participant produces their first judgement. A reservation
that produces no judgement inside the timeout is released back to the pool, and
the release is derived from the log rather than being an action anyone takes.
That keeps it a pure function of the event stream, which is what lets it be
recomputed identically at any time.
"""

from __future__ import annotations

import pytest

from _common import iso_from_epoch_ms
from slots import (
    SLOT_TIMEOUT_MS,
    SlotState,
    slot_usage,
)

MINUTE = 60_000
#: The fixture's origin. The slot rules are about elapsed time, so the date
#: itself carries no meaning and `now_ms` is measured from the same zero.
EPOCH = 0


def _event(session, seq, kind, ts, **payload):
    return {
        "event_id": f"{session}-{seq}",
        "session_id": session,
        "seq": seq,
        # The fixture counts milliseconds because the timeout rules do; the
        # log itself carries the ISO string a browser writes.
        "client_ts": iso_from_epoch_ms(EPOCH + ts),
        "type": kind,
        "payload": payload,
    }


def _allocated(session, index, ts=0, stratum="B1-B2"):
    return [
        _event(session, 1, "SESSION_STARTED", ts, app_version="t",
               stimuli_manifest_hash="0" * 64, viewport={"width": 1, "height": 1},
               resumed=False),
        _event(session, 2, "ALLOCATED", ts + 1000, condition="warm",
               stratum=stratum, allocation_seq=index),
    ]


def test_a_reservation_with_a_judgement_is_consumed():
    events = _allocated("s1", 0) + [
        _event("s1", 3, "ESTIMATE_FINALIZED", 5 * MINUTE, item_id="item_01",
               value=1, revision_count=1, ms_since_reveal=100),
    ]
    usage = slot_usage(events, now_ms=6 * MINUTE)
    assert usage.state_of("B1-B2", 0) is SlotState.CONSUMED
    assert usage.free_indices("B1-B2", total=4) == [1, 2, 3]


def test_a_reservation_without_a_judgement_is_still_held_before_the_timeout():
    # Someone reading the consent screen slowly has not abandoned anything.
    events = _allocated("s1", 0, ts=0)
    usage = slot_usage(events, now_ms=SLOT_TIMEOUT_MS - MINUTE)
    assert usage.state_of("B1-B2", 0) is SlotState.RESERVED
    assert 0 not in usage.free_indices("B1-B2", total=4)


def test_a_reservation_without_a_judgement_is_released_after_the_timeout():
    events = _allocated("s1", 0, ts=0)
    usage = slot_usage(events, now_ms=SLOT_TIMEOUT_MS + MINUTE)
    assert usage.state_of("B1-B2", 0) is SlotState.RELEASED
    assert 0 in usage.free_indices("B1-B2", total=4)


def test_a_withdrawal_releases_the_slot_immediately():
    # No need to wait out the timeout: they told us they were leaving.
    events = _allocated("s1", 0) + [
        _event("s1", 3, "SESSION_WITHDRAWN", 2 * MINUTE, reason=None, at_state="consent"),
    ]
    usage = slot_usage(events, now_ms=3 * MINUTE)
    assert usage.state_of("B1-B2", 0) is SlotState.RELEASED


def test_a_withdrawal_after_judging_does_NOT_release_the_slot():
    # They contributed data. Recycling the slot would let a second participant
    # occupy the same position in the block, which is exactly the double-booking
    # the accounting exists to prevent.
    events = _allocated("s1", 0) + [
        _event("s1", 3, "ESTIMATE_FINALIZED", MINUTE, item_id="item_01", value=1,
               revision_count=1, ms_since_reveal=100),
        _event("s1", 4, "SESSION_WITHDRAWN", 2 * MINUTE, reason=None, at_state="task.estimate"),
    ]
    usage = slot_usage(events, now_ms=3 * MINUTE)
    assert usage.state_of("B1-B2", 0) is SlotState.CONSUMED


def test_released_slots_are_reused_before_untouched_ones():
    # Otherwise a run with heavy early attrition would exhaust the sequence
    # while half its slots sat free.
    events = _allocated("s1", 0, ts=0) + _allocated("s2", 1, ts=0)
    events += [
        _event("s2", 3, "ESTIMATE_FINALIZED", MINUTE, item_id="item_01", value=1,
               revision_count=1, ms_since_reveal=100),
    ]
    usage = slot_usage(events, now_ms=SLOT_TIMEOUT_MS + MINUTE)
    assert usage.free_indices("B1-B2", total=4) == [0, 2, 3]


def test_exhaustion_is_reported_rather_than_wrapping():
    events: list[dict] = []
    for index in range(4):
        events += _allocated(f"s{index}", index)
        events.append(
            _event(f"s{index}", 3, "ESTIMATE_FINALIZED", MINUTE, item_id="item_01",
                   value=1, revision_count=1, ms_since_reveal=100)
        )
    usage = slot_usage(events, now_ms=2 * MINUTE)
    assert usage.free_indices("B1-B2", total=4) == []
    assert usage.is_exhausted("B1-B2", total=4)


def test_one_stratum_running_dry_does_not_close_the_other():
    events: list[dict] = []
    for index in range(4):
        events += _allocated(f"s{index}", index, stratum="B1-B2")
        events.append(
            _event(f"s{index}", 3, "ESTIMATE_FINALIZED", MINUTE, item_id="item_01",
                   value=1, revision_count=1, ms_since_reveal=100)
        )
    usage = slot_usage(events, now_ms=2 * MINUTE)
    assert usage.is_exhausted("B1-B2", total=4)
    assert not usage.is_exhausted("C1-C2/native", total=4)


def test_the_timeout_is_long_enough_not_to_cut_off_a_slow_participant():
    # The session is about twenty minutes by design. A timeout near that would
    # recycle the slot of someone still working.
    assert SLOT_TIMEOUT_MS >= 40 * MINUTE
