"""The v3 export: long and wide CSV, JSON, and withdrawal honoured throughout."""

from __future__ import annotations

import csv
import json
import uuid
from pathlib import Path

import pytest

import v3_export as x
from _common import iso_from_epoch_ms

T0 = 1_790_000_000_000


def session(
    *,
    participant: str | None = None,
    mode: str = "pilot",
    cell: str = "EI-A",
    withdraw: bool = False,
    screened_out: str | None = None,
) -> list[dict]:
    """A compact but schema-shaped v3 session."""
    sid = str(uuid.uuid4())
    pid = participant or str(uuid.uuid4())
    events: list[dict] = []
    clock = [T0]

    def add(kind: str, payload: dict, allocated: bool, step: int = 1000) -> None:
        clock[0] += step
        events.append(
            {
                "event_id": str(uuid.uuid4()),
                "session_id": sid,
                "participant_id": pid,
                "seq": len(events),
                "client_ts": iso_from_epoch_ms(clock[0]),
                "run_mode": mode,
                "cell": cell if allocated else None,
                "type": kind,
                "payload": payload,
            }
        )

    add("session_started", {"study_version": "v3", "repeat_session": False}, False)
    add("consent_given", {"pilot_notice_shown": mode == "pilot"}, False)
    if screened_out:
        add("screened_out", {"reason": screened_out}, False)
        return events
    add("screening_answered", {"age_band": "18-24", "english_level": "B2", "study_language": "English"}, False)
    for i in range(1, 7):
        add("questionnaire_item", {"instrument": "pre", "item_id": f"P{i}", "value": 4}, False)
    add("allocation", {"cell": cell, "tone": cell.split("-")[0], "list": cell[-1], "method": "pilot_rotation",
                       "pilot_position": 1, "english_band": "B1-B2"}, True)
    score = 0
    for module in (1, 2, 3):
        add("screen_viewed", {"screen": f"lesson:{module}:1", "module": module}, True)
        claims = x.CLAIMS[(module - 1) * 4 : module * 4]
        for pos, claim in enumerate(claims, start=1):
            n = int(claim[-2:])
            version = "strong" if (n % 2 == 1) == (cell[-1] == "A") else "weak"
            add("lesson_item", {"module": module, "claim_id": claim, "version": version,
                                "order_position": pos, "dwell_ms": 4000 + n}, True, 4000)
        for pos, claim in enumerate(claims, start=1):
            n = int(claim[-2:])
            version = "strong" if (n % 2 == 1) == (cell[-1] == "A") else "weak"
            role = "lesson" if n % 3 else "intuitive"
            score += role == "lesson"
            add("mission_answer", {"module": module, "task_id": f"T{n}", "claim_id": claim, "version": version,
                                   "choice_role": role, "option_order": ["lesson", "intuitive", "distractor"],
                                   "order_position": pos, "confidence": 3, "rt_ms": 5000}, True, 5000)
        if module == 2:
            add("attention_check", {"passed": True, "choice": "Olympus", "position": 2, "rt_ms": 800}, True)
        end = {1: "transition:after_m1", 2: "transition:after_m2", 3: "transition:end"}[module]
        add("screen_viewed", {"screen": end, "module": module}, True)
    for i in range(1, 17):
        item = f"Q{i}" if i <= 12 else f"F{i - 12}"
        add("quiz_rating", {"item_id": item, "claim_id": x.CLAIMS[i - 1] if i <= 12 else None,
                            "version": None, "is_filler": i > 12, "rating": 5, "position": i}, True)
    add("session_completed", {"total_duration_ms": 900_000, "score": score}, True)
    add("debrief_viewed", {"score": score}, True)
    if withdraw:
        add("withdrawal_requested", {"at_screen": "debrief"}, True)
    return events


def write_jsonl(path: Path, events: list[dict]) -> Path:
    path.write_text("\n".join(json.dumps(e) for e in events) + "\n", encoding="utf-8")
    return path


def test_long_has_one_row_per_event_and_the_run_flags(tmp_path: Path) -> None:
    events = session()
    summary = x.export([write_jsonl(tmp_path / "e.jsonl", events)], tmp_path / "out")
    rows = list(csv.DictReader((tmp_path / "out" / "events_long.csv").open(encoding="utf-8")))
    assert len(rows) == len(events) == summary["events_written"]
    assert {r["pilot"] for r in rows} == {"True"} and {r["test"] for r in rows} == {"False"}
    assert rows[0]["cell"] == "" and rows[-1]["cell"] == "EI-A"


def test_wide_has_one_row_per_session_with_the_measures(tmp_path: Path) -> None:
    events = session(cell="Neutral-B")
    x.export([write_jsonl(tmp_path / "e.jsonl", events)], tmp_path / "out")
    rows = list(csv.DictReader((tmp_path / "out" / "participants_wide.csv").open(encoding="utf-8")))
    assert len(rows) == 1
    row = rows[0]
    assert (row["cell"], row["tone"], row["list"]) == ("Neutral-B", "Neutral", "B")
    assert row["n_lesson_item"] == "12" and row["n_mission_answer"] == "12"
    assert row["n_attention_check"] == "1" and row["n_quiz_rating"] == "16"
    assert row["version_claim_01"] == "weak" and row["version_claim_02"] == "strong"
    assert row["P1"] == "4" and row["attention_passed"] == "True"
    assert int(row["module1_ms"]) > 0


def test_a_withdrawn_participant_is_dropped_entirely(tmp_path: Path) -> None:
    person = str(uuid.uuid4())
    kept = session()
    first = session(participant=person)
    second = session(participant=person, withdraw=True)  # withdrew in a later session
    path = write_jsonl(tmp_path / "e.jsonl", kept + first + second)
    summary = x.export([path], tmp_path / "out")
    assert summary["sessions_written"] == 1
    assert len(summary["withdrawn_sessions"]) == 2
    data = json.loads((tmp_path / "out" / "export.json").read_text(encoding="utf-8"))
    assert {e["participant_id"] for e in data["events"]} == {kept[0]["participant_id"]}
    assert person not in (tmp_path / "out" / "events_long.csv").read_text(encoding="utf-8")


def test_the_log_itself_is_untouched_by_an_export(tmp_path: Path) -> None:
    path = write_jsonl(tmp_path / "e.jsonl", session(withdraw=True))
    before = path.read_bytes()
    x.export([path], tmp_path / "out")
    assert path.read_bytes() == before


def test_deep_sea_rows_in_the_same_table_are_ignored(tmp_path: Path) -> None:
    v2 = {"event_id": str(uuid.uuid4()), "session_id": str(uuid.uuid4()), "seq": 0,
          "client_ts": iso_from_epoch_ms(T0), "run_mode": "pilot", "type": "SESSION_STARTED", "payload": {}}
    summary = x.export([write_jsonl(tmp_path / "e.jsonl", [v2, *session()])], tmp_path / "out")
    assert summary["sessions_written"] == 1


def test_mode_keeps_one_kind_of_run(tmp_path: Path) -> None:
    path = write_jsonl(tmp_path / "e.jsonl", session(mode="pilot") + session(mode="test") + session(mode="test"))
    assert x.export([path], tmp_path / "a", "test")["sessions_written"] == 2
    assert x.export([path], tmp_path / "b", "pilot")["sessions_written"] == 1


def test_duplicate_deliveries_are_reconciled(tmp_path: Path) -> None:
    events = session()
    summary = x.export([write_jsonl(tmp_path / "e.jsonl", events + events[:5])], tmp_path / "out")
    assert summary["events_written"] == len(events)
    assert summary["duplicates_reconciled"] == 5


def test_a_session_that_mixes_run_modes_is_refused(tmp_path: Path) -> None:
    events = session()
    events[-1]["run_mode"] = "live"
    with pytest.raises(x.ExportError, match="mixes run modes"):
        x.export([write_jsonl(tmp_path / "e.jsonl", events)], tmp_path / "out")


def test_a_supabase_csv_export_reads_the_same_as_jsonl(tmp_path: Path) -> None:
    events = session()
    csv_path = tmp_path / "supabase.csv"
    with csv_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["event_id", "session_id", "participant_id", "seq",
                                                    "client_ts", "type", "payload", "run_mode", "cell", "received_at"])
        writer.writeheader()
        for e in events:
            writer.writerow({**e, "payload": json.dumps(e["payload"]), "cell": e["cell"] or "",
                             "received_at": e["client_ts"]})
    from_csv, _ = x.load_v3([csv_path])
    from_jsonl, _ = x.load_v3([write_jsonl(tmp_path / "e.jsonl", events)])
    assert [e["payload"] for e in from_csv] == [e["payload"] for e in from_jsonl]
    assert [e["cell"] for e in from_csv] == [e["cell"] for e in from_jsonl]


def test_a_screened_out_visitor_appears_with_the_reason_and_nothing_else(tmp_path: Path) -> None:
    x.export([write_jsonl(tmp_path / "e.jsonl", session(screened_out="age"))], tmp_path / "out")
    row = next(csv.DictReader((tmp_path / "out" / "participants_wide.csv").open(encoding="utf-8")))
    assert row["screened_out_reason"] == "age" and row["cell"] == "" and row["age_band"] == ""
