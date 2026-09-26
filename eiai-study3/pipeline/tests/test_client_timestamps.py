"""The pipeline has to read the timestamps the browser actually writes.

`client_ts` is declared in packages/schema/src/primitives.ts as an ISO 8601
string, and packages/telemetry/src/recorder.ts writes `now().toISOString()`.
The pipeline, however, was written alongside simulate.py, which emitted an
integer count of milliseconds -- so every duration in the projection was
computed as `int(client_ts)`. That works on synthetic data and raises
`ValueError` on the first real session, which is precisely the failure a
simulator is supposed to rule out.

These tests pin the two halves together: one parser, used everywhere, that
accepts the schema's form and refuses the simulator's old one. Refusing the
integer matters more than accepting it would: a parser tolerant of both would
let the fixtures drift away from reality again without anything going red.
"""

from __future__ import annotations

import random
import re
from pathlib import Path

import pytest

from _common import REPO_ROOT, epoch_ms, iso_from_epoch_ms

# One real row, copied from a browser run (data/dev-events.jsonl).
BROWSER_TS = "2026-09-26T10:12:00.948Z"
BROWSER_TS_MS = 1790417520948


def test_the_form_the_browser_writes_parses() -> None:
    assert epoch_ms(BROWSER_TS) == BROWSER_TS_MS


def test_an_offset_other_than_z_parses() -> None:
    # A client on a machine whose clock reports an offset is still a client.
    assert epoch_ms("2026-09-26T12:12:00.948+02:00") == BROWSER_TS_MS


def test_milliseconds_are_kept() -> None:
    # Truncating to whole seconds would quietly coarsen every reaction time.
    assert epoch_ms("2026-09-26T10:12:00.948Z") - epoch_ms("2026-09-26T10:12:00.048Z") == 900


def test_the_simulators_old_integer_form_is_refused() -> None:
    # Accepting both shapes is what let the fixture drift from the schema for
    # as long as it did. The integer is not a timestamp under the schema, so
    # reading one has to be an error rather than a silent success.
    with pytest.raises(ValueError):
        epoch_ms(1790417520948)
    with pytest.raises(ValueError):
        epoch_ms("1790417520948")


def test_nonsense_is_refused_loudly() -> None:
    for bad in ["", "yesterday", None, "2026-09-26"]:
        with pytest.raises(ValueError):
            epoch_ms(bad)


def test_the_message_names_the_field_and_the_value() -> None:
    # A traceback deep inside a projection is unactionable without both.
    with pytest.raises(ValueError, match="client_ts"):
        epoch_ms("yesterday")
    with pytest.raises(ValueError, match="yesterday"):
        epoch_ms("yesterday")


def test_the_written_form_matches_what_javascript_writes() -> None:
    # `new Date(ms).toISOString()` -- exactly three fractional digits and a Z.
    assert iso_from_epoch_ms(BROWSER_TS_MS) == BROWSER_TS
    assert iso_from_epoch_ms(0) == "1970-01-01T00:00:00.000Z"


def test_writing_and_reading_a_timestamp_round_trips() -> None:
    for ms in [0, 1, 999, 1_000, BROWSER_TS_MS, 1_760_000_000_000]:
        assert epoch_ms(iso_from_epoch_ms(ms)) == ms


def test_the_schema_still_declares_an_iso_string() -> None:
    """If the TypeScript side ever changes shape, this parser must be revisited.

    The two live in different languages with no shared type, so the only thing
    keeping them in agreement is a check that reads one and fails.
    """
    source = (REPO_ROOT / "packages/schema/src/primitives.ts").read_text(encoding="utf-8")
    declaration = source.split("export const ClientTimestamp")[1].split(";")[0]
    assert "z" in declaration and "iso" in declaration and "datetime" in declaration, declaration


def test_the_simulator_writes_what_the_schema_requires() -> None:
    """The simulator stands in for real participants, so it has to look like one."""
    import simulate

    bank = simulate.load_items()["items"]

    events = simulate.simulate_session(
        sorted(simulate.POLICIES)[0],
        simulate.CONDITIONS[0],
        "en",
        bank,
        "0" * 64,
        random.Random(1),
        1_760_000_000_000,
    )
    iso = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$")
    for event in events:
        value = event["client_ts"]
        assert isinstance(value, str), f"seq {event['seq']} wrote {type(value).__name__}"
        assert iso.match(value), value
    # And the clock still moves forward, in milliseconds.
    stamps = [epoch_ms(e["client_ts"]) for e in events]
    assert stamps == sorted(stamps)
    assert stamps[-1] > stamps[0]


def test_a_projection_of_browser_shaped_events_measures_a_duration() -> None:
    """End to end: the failure this file exists for.

    Before the fix this raised `ValueError: invalid literal for int() with
    base 10: '2026-09-26T10:15:11.631Z'` from reduce_session.
    """
    import replay

    bank = {item["id"]: item for item in replay.load_items()["items"]}
    item_id = sorted(bank)[0]
    session = "11111111-1111-4111-8111-111111111111"

    def event(seq: int, kind: str, ts: str, payload: dict) -> dict:
        return {
            "event_id": f"{session}-{seq}",
            "session_id": session,
            "seq": seq,
            "client_ts": ts,
            "run_mode": "live",
            "type": kind,
            "payload": payload,
        }

    events = [
        event(0, "SESSION_STARTED", "2026-09-26T10:12:00.000Z", {}),
        event(1, "ALLOCATED", "2026-09-26T10:12:01.000Z",
              {"condition": "warm", "stratum": "B1-B2", "allocation_seq": 0}),
        event(2, "ITEM_PRESENTED", "2026-09-26T10:12:10.000Z",
              {"item_id": item_id, "position": 1}),
        event(3, "ESTIMATE_SET", "2026-09-26T10:12:15.000Z",
              {"item_id": item_id, "phase": "initial", "value": 100}),
        event(4, "RESPONSE_REVEALED", "2026-09-26T10:12:17.500Z",
              {"item_id": item_id, "register_state": "steady", "response_id": "r1"}),
        event(5, "ESTIMATE_FINALIZED", "2026-09-26T10:12:25.000Z",
              {"item_id": item_id, "value": 120}),
    ]

    reduced = replay.reduce_session(session, events, bank)
    trial = reduced["trials"][0]
    assert trial["ms_present_to_reveal"] == 7500
    assert reduced["transitions"][-1]["ms_since_session_start"] == 25_000
