#!/usr/bin/env python3
"""Which randomisation slots are actually spoken for.

Two problems the audit left open, both of which bend the block balance without
leaving a trace:

**Exhaustion.** Nothing defined what happens after the last slot in a stratum.
`allocate()` computed `hash mod length`, so the sequence silently wrapped and two
participants drew the same position with nothing in the log to say so.

**Attrition.** A slot was consumed at assignment. Someone who opened the link and
closed it consumed one anyway, and nothing returned it.

The policy
----------
A slot is **reserved** when `ALLOCATED` is written and only **consumed** once the
participant produces their first `ESTIMATE_FINALIZED`. A reservation that
produces no judgement is **released** back to the pool -- immediately on
withdrawal, or after `SLOT_TIMEOUT_MS` otherwise.

Release is *derived from the log*, not performed by anyone. Nobody sends a
"release" event and no scheduled job mutates state; the state of every slot is a
pure function of the events plus the current time. That is what lets it be
recomputed identically months later, and it is why a crashed browser needs no
cleanup path.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Iterable

# How long a reservation is held without a judgement before the slot returns to
# the pool.
#
# The session runs about twenty minutes by design. Forty-five gives a genuinely
# slow participant more than double the intended time before anything is
# recycled underneath them, while still returning slots inside a recruitment day.
# NOT specified in v2 at the time of writing -- chosen here and recorded in the
# spec; flagged for the researcher.
SLOT_TIMEOUT_MS = 45 * 60 * 1000


class SlotState(Enum):
    RESERVED = "reserved"
    CONSUMED = "consumed"
    RELEASED = "released"


@dataclass
class _Reservation:
    session_id: str
    stratum: str
    index: int
    reserved_at: int
    judged: bool = False
    withdrawn_at: int | None = None

    def state(self, now_ms: int) -> SlotState:
        if self.judged:
            # They contributed data. Recycling the position would let a second
            # participant occupy it, which is the double-booking this exists to
            # prevent -- withdrawal afterwards does not undo the contribution.
            return SlotState.CONSUMED
        if self.withdrawn_at is not None:
            return SlotState.RELEASED
        if now_ms - self.reserved_at >= SLOT_TIMEOUT_MS:
            return SlotState.RELEASED
        return SlotState.RESERVED


@dataclass
class SlotUsage:
    """Slot states per stratum at one moment in time."""

    now_ms: int
    reservations: dict[str, list[_Reservation]] = field(default_factory=lambda: defaultdict(list))

    def state_of(self, stratum: str, index: int) -> SlotState | None:
        """The strongest claim on this slot, or None if nobody has claimed it.

        Strongest rather than latest: if one session consumed the slot and a
        later one merely reserved it, the slot is taken. Reporting the latest
        would let a transient reservation mask a real participant.
        """
        claims = [r for r in self.reservations.get(stratum, []) if r.index == index]
        if not claims:
            return None
        states = [r.state(self.now_ms) for r in claims]
        for strongest in (SlotState.CONSUMED, SlotState.RESERVED, SlotState.RELEASED):
            if strongest in states:
                return strongest
        return None

    def free_indices(self, stratum: str, total: int) -> list[int]:
        """Slots available now, released ones first.

        Released before untouched, because a run with heavy early attrition
        would otherwise exhaust the sequence while half its positions sat free.
        """
        released: list[int] = []
        untouched: list[int] = []
        for index in range(total):
            state = self.state_of(stratum, index)
            if state is None:
                untouched.append(index)
            elif state is SlotState.RELEASED:
                released.append(index)
        return released + untouched

    def is_exhausted(self, stratum: str, total: int) -> bool:
        return not self.free_indices(stratum, total)

    def counts(self, stratum: str, total: int) -> dict[str, int]:
        tally = {state.value: 0 for state in SlotState}
        tally["free"] = 0
        for index in range(total):
            state = self.state_of(stratum, index)
            if state is None:
                tally["free"] += 1
            else:
                tally[state.value] += 1
        tally["free"] += tally[SlotState.RELEASED.value]
        return tally


def slot_usage(events: Iterable[dict[str, Any]], now_ms: int) -> SlotUsage:
    """Slot states implied by the log at `now_ms`."""
    usage = SlotUsage(now_ms=now_ms)
    by_session: dict[str, _Reservation] = {}

    ordered = sorted(events, key=lambda e: (str(e["session_id"]), int(e["seq"])))
    for event in ordered:
        session = str(event["session_id"])
        payload = event.get("payload", {})

        if event["type"] == "ALLOCATED":
            reservation = _Reservation(
                session_id=session,
                stratum=str(payload["stratum"]),
                index=int(payload["allocation_seq"]),
                reserved_at=int(event["client_ts"]),
            )
            by_session[session] = reservation
            usage.reservations[reservation.stratum].append(reservation)
        elif event["type"] == "ESTIMATE_FINALIZED" and session in by_session:
            by_session[session].judged = True
        elif event["type"] == "SESSION_WITHDRAWN" and session in by_session:
            by_session[session].withdrawn_at = int(event["client_ts"])

    return usage
