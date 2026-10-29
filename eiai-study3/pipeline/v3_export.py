#!/usr/bin/env python3
"""Export the v3 event log: long CSV, wide CSV and JSON.

Reads what the database or the dev server holds -- a Supabase export (CSV or
JSON) or the dev server's JSONL -- keeps only v3 events, and writes three
files:

  events_long.csv       one row per event
  participants_wide.csv one row per session
  export.json           both, plus what was excluded and why

Withdrawal is honoured here, before anything is written: a participant who
pressed "Remove my data" is dropped entirely -- every session carrying their
participant_id, every event of those sessions. Nothing is deleted from the
log itself, which stays append-only; the exclusion happens every time the log
is read, so it can never be forgotten by a later script that reads the log
directly... provided it reads it through `load_v3`, which is why every v3
script here does.

Usage
-----
    python pipeline/v3_export.py --events data/pilot-events.csv --out results/export_v3
    python pipeline/v3_export.py --events data/dev-events.jsonl --mode test

`--mode` keeps one kind of run: pilot, test or live (default: all three).
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from _common import epoch_ms

#: The v3 family. Deep-sea events share the table and are ignored here.
V3_TYPES = frozenset(
    {
        "session_started",
        "consent_given",
        "screening_answered",
        "screened_out",
        "allocation",
        "plan_generated",
        "screen_viewed",
        "lesson_item",
        "mission_answer",
        "attention_check",
        "quiz_rating",
        "questionnaire_item",
        "funnel_answer",
        "arg_quality_rating",
        "pilot_feedback",
        "session_completed",
        "debrief_viewed",
        "withdrawal_requested",
    }
)

RUN_MODES = ("live", "pilot", "test")
CLAIMS = [f"claim_{n:02d}" for n in range(1, 13)]
LONG_COLUMNS = [
    "event_id",
    "participant_id",
    "session_id",
    "seq",
    "client_ts",
    "received_at",
    "run_mode",
    "pilot",
    "test",
    "cell",
    "type",
    "payload",
]


class ExportError(ValueError):
    """The input is not a log this exporter can read honestly."""


# ---------------------------------------------------------------------------
# Reading
# ---------------------------------------------------------------------------


_PG_TS = re.compile(r"^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d+)?)([+-]\d{2})(?::?(\d{2}))?$")


def _iso(value: Any) -> Any:
    """Postgres text timestamps, as Supabase's CSV export writes them
    (`2026-10-08 12:55:51.158+00`), into the ISO form the browser sends
    (`2026-10-08T12:55:51.158+00:00`). Anything else passes through unchanged,
    so a malformed value still fails loudly where it is used."""
    if not isinstance(value, str):
        return value
    m = _PG_TS.match(value.strip())
    if not m:
        return value
    return f"{m.group(1)}T{m.group(2)}{m.group(3)}:{m.group(4) or '00'}"


def _normalise(row: dict[str, Any]) -> dict[str, Any]:
    payload = row.get("payload")
    if isinstance(payload, str):
        # Supabase's CSV export writes jsonb as JSON text.
        payload = json.loads(payload) if payload.strip() else {}
    seq = row.get("seq")
    event = {
        "event_id": str(row["event_id"]),
        "participant_id": row.get("participant_id") or None,
        "session_id": str(row["session_id"]),
        "seq": int(seq) if seq not in (None, "") else None,
        "client_ts": _iso(row.get("client_ts")),
        "received_at": _iso(row.get("received_at")) or None,
        "run_mode": row.get("run_mode") or "live",
        # Supabase's CSV writes SQL NULL as the word null.
        "cell": None if row.get("cell") in (None, "", "null") else row.get("cell"),
        "type": row["type"],
        "payload": payload or {},
    }
    if event["seq"] is None:
        raise ExportError(f"event {event['event_id']} has no seq")
    return event


def read_rows(path: Path) -> list[dict[str, Any]]:
    """Rows from .jsonl, .json (an array) or .csv, as exported."""
    text = path.read_text(encoding="utf-8-sig")
    if path.suffix == ".csv":
        return [_normalise(r) for r in csv.DictReader(text.splitlines())]
    if path.suffix == ".json":
        data = json.loads(text)
        if not isinstance(data, list):
            raise ExportError(f"{path}: expected a JSON array of rows")
        return [_normalise(r) for r in data]
    rows = []
    for number, line in enumerate(text.splitlines(), start=1):
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(_normalise(json.loads(line)))
        except (json.JSONDecodeError, KeyError) as error:
            raise ExportError(f"{path}:{number}: {error}") from error
    return rows


def load_v3(paths: Iterable[Path], mode: str | None = None) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """v3 events with withdrawn participants removed, and a record of what went.

    The one entry point every v3 script reads through, so the withdrawal
    exclusion cannot be skipped by accident.
    """
    rows: list[dict[str, Any]] = []
    for path in paths:
        rows.extend(read_rows(Path(path)))

    seen: set[str] = set()
    events: list[dict[str, Any]] = []
    duplicates = 0
    for row in rows:
        if row["type"] not in V3_TYPES:
            continue
        if row["event_id"] in seen:
            duplicates += 1  # delivery is at-least-once; the key reconciles
            continue
        seen.add(row["event_id"])
        events.append(row)

    by_session: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for event in events:
        by_session[event["session_id"]].append(event)
    for session_id, session_events in by_session.items():
        modes = {e["run_mode"] for e in session_events}
        if len(modes) > 1:
            # Half pilot, half live is a bug, and guessing which half is right
            # would quietly put pilot answers in the sample or drop real ones.
            raise ExportError(f"session {session_id} mixes run modes: {sorted(modes)}")

    withdrawn_participants = {
        e["participant_id"] or e["session_id"] for e in events if e["type"] == "withdrawal_requested"
    }
    withdrawn_sessions = {
        e["session_id"]
        for e in events
        if (e["participant_id"] or e["session_id"]) in withdrawn_participants
    }
    kept = [e for e in events if e["session_id"] not in withdrawn_sessions]
    if mode is not None:
        if mode not in RUN_MODES:
            raise ExportError(f"unknown mode {mode!r}; expected one of {RUN_MODES}")
        kept = [e for e in kept if e["run_mode"] == mode]

    kept.sort(key=lambda e: (e["session_id"], e["seq"]))
    report = {
        "rows_read": len(rows),
        "v3_events": len(events),
        "duplicates_reconciled": duplicates,
        "withdrawn_participants": sorted(withdrawn_participants),
        "withdrawn_sessions": sorted(withdrawn_sessions),
        "mode": mode,
    }
    return kept, report


# ---------------------------------------------------------------------------
# Projections
# ---------------------------------------------------------------------------


def long_rows(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            **{k: e[k] for k in LONG_COLUMNS if k in e and k != "payload"},
            "pilot": e["run_mode"] == "pilot",
            "test": e["run_mode"] == "test",
            "payload": json.dumps(e["payload"], ensure_ascii=False, sort_keys=True),
        }
        for e in events
    ]


def _first(events: list[dict[str, Any]], kind: str) -> dict[str, Any] | None:
    return next((e for e in events if e["type"] == kind), None)


def _ms(event: dict[str, Any] | None) -> int | None:
    return epoch_ms(event["client_ts"]) if event else None


def module_durations(events: list[dict[str, Any]]) -> dict[int, int | None]:
    """Each module from its first lesson screen to the transition after its mission."""
    views = [e for e in events if e["type"] == "screen_viewed"]
    ends = {1: "transition:after_m1", 2: "transition:after_m2", 3: "transition:end"}
    out: dict[int, int | None] = {}
    for module in (1, 2, 3):
        start = next((v for v in views if v["payload"]["screen"] == f"lesson:{module}:1"), None)
        end = next((v for v in views if v["payload"]["screen"] == ends[module]), None)
        out[module] = (_ms(end) - _ms(start)) if start and end else None  # type: ignore[operator]
    return out


def wide_row(session_id: str, events: list[dict[str, Any]]) -> dict[str, Any]:
    started = _first(events, "session_started")
    allocation = _first(events, "allocation")
    screening = _first(events, "screening_answered")
    screened = _first(events, "screened_out")
    completed = _first(events, "session_completed")
    attention = _first(events, "attention_check")
    run_mode = events[0]["run_mode"]
    row: dict[str, Any] = {
        "participant_id": next((e["participant_id"] for e in events if e["participant_id"]), None),
        "session_id": session_id,
        "run_mode": run_mode,
        "pilot": run_mode == "pilot",
        "test": run_mode == "test",
        "cell": (allocation or {}).get("payload", {}).get("cell"),
        "tone": (allocation or {}).get("payload", {}).get("tone"),
        "list": (allocation or {}).get("payload", {}).get("list"),
        "allocation_method": (allocation or {}).get("payload", {}).get("method"),
        "pilot_position": (allocation or {}).get("payload", {}).get("pilot_position"),
        "english_band": (allocation or {}).get("payload", {}).get("english_band"),
        "sequence_index": (allocation or {}).get("payload", {}).get("sequence_index"),
        "age_band": (screening or {}).get("payload", {}).get("age_band"),
        "english_level": (screening or {}).get("payload", {}).get("english_level"),
        "study_language": (screening or {}).get("payload", {}).get("study_language"),
        "screened_out_reason": (screened or {}).get("payload", {}).get("reason"),
        "repeat_session": bool((started or {}).get("payload", {}).get("repeat_session")),
        "completed": completed is not None,
        "started_at": (started or {}).get("client_ts"),
        "total_duration_ms": (completed or {}).get("payload", {}).get("total_duration_ms"),
        "score": (completed or {}).get("payload", {}).get("score"),
        "attention_passed": (attention or {}).get("payload", {}).get("passed"),
        "attention_rt_ms": (attention or {}).get("payload", {}).get("rt_ms"),
    }
    for module, ms in module_durations(events).items():
        row[f"module{module}_ms"] = ms

    for e in events:
        p = e["payload"]
        if e["type"] == "questionnaire_item":
            row[str(p["item_id"])] = p["value"]
        elif e["type"] == "funnel_answer":
            row[str(p["item_id"])] = p["text"]
        elif e["type"] == "pilot_feedback":
            row[str(p["item_id"])] = p["text"]
        elif e["type"] == "lesson_item":
            c = p["claim_id"]
            row[f"version_{c}"] = p["version"]
            row[f"dwell_{c}"] = p["dwell_ms"]
            row[f"lesson_pos_{c}"] = p["order_position"]
        elif e["type"] == "mission_answer":
            c = p["claim_id"]
            row[f"version_{c}"] = p["version"]
            row[f"choice_{c}"] = p["choice_role"]
            row[f"confidence_{c}"] = p["confidence"]
            row[f"rt_{c}"] = p["rt_ms"]
        elif e["type"] == "quiz_rating":
            row[f"quiz_{p['item_id']}"] = p["rating"]
        elif e["type"] == "arg_quality_rating":
            row[f"quality_{p['claim_id']}"] = p["rating"]

    counts = defaultdict(int)
    for e in events:
        counts[e["type"]] += 1
    row["n_lesson_item"] = counts["lesson_item"]
    row["n_mission_answer"] = counts["mission_answer"]
    row["n_attention_check"] = counts["attention_check"]
    row["n_quiz_rating"] = counts["quiz_rating"]
    return row


def wide_rows(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_session: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for e in events:
        by_session[e["session_id"]].append(e)
    return [wide_row(s, sorted(evs, key=lambda e: e["seq"])) for s, evs in sorted(by_session.items())]


def write_csv(path: Path, rows: list[dict[str, Any]], columns: list[str] | None = None) -> None:
    if columns is None:
        columns = []
        for row in rows:
            for key in row:
                if key not in columns:
                    columns.append(key)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({k: ("" if row.get(k) is None else row.get(k)) for k in columns})


def export(paths: Iterable[Path], out_dir: Path, mode: str | None = None) -> dict[str, Any]:
    events, report = load_v3(paths, mode)
    long = long_rows(events)
    wide = wide_rows(events)
    out_dir.mkdir(parents=True, exist_ok=True)
    write_csv(out_dir / "events_long.csv", long, LONG_COLUMNS)
    write_csv(out_dir / "participants_wide.csv", wide)
    (out_dir / "export.json").write_text(
        json.dumps(
            {
                "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "report": report,
                "participants": wide,
                "events": events,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    return {**report, "events_written": len(long), "sessions_written": len(wide)}


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Export the v3 event log.")
    parser.add_argument("--events", nargs="+", required=True)
    parser.add_argument("--out", default="results/export_v3")
    parser.add_argument("--mode", choices=RUN_MODES, default=None)
    args = parser.parse_args(list(argv) if argv is not None else None)
    try:
        summary = export([Path(p) for p in args.events], Path(args.out), args.mode)
    except (ExportError, FileNotFoundError) as error:
        print(f"export failed: {error}", file=sys.stderr)
        return 1
    print(
        f"{summary['events_written']} events, {summary['sessions_written']} sessions -> {args.out}\n"
        f"  excluded as withdrawn: {len(summary['withdrawn_sessions'])} session(s)\n"
        f"  duplicates reconciled: {summary['duplicates_reconciled']}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
