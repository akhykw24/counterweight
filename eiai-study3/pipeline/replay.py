#!/usr/bin/env python3
"""Project the append-only event log into tidy analysis tables (spec section 3).

    events.jsonl  ->  trials.csv, participants.csv, questionnaire.csv, transitions.csv

Projections are **pure functions of the log**. Delete the CSVs, rerun, get
byte-identical output. Nothing here reads the previous run's tables, and nothing
here writes back to the log. That is what makes the log the single source of
truth rather than one artefact among several.

What this deliberately does NOT do
----------------------------------
It does not apply analysis decisions. Weight of Advice needs a clamp range and a
denominator threshold, and those are exactly the arbitrary choices
`multiverse.py` is supposed to vary. So this emits the *components* --
`initial_estimate`, `final_estimate`, `advice_value`, plus an unclamped
`woa_raw` -- and lets the analysis layer apply a specification. A projection
that had already clamped would quietly fix one cell of the multiverse.

Duplicates and resumes
----------------------
Delivery is at-least-once, so the same event can arrive more than once; rows are
deduplicated on `event_id`. A resumed session re-emits `SESSION_STARTED` and
`RESPONSE_REVEALED`, so per-item reveals reduce on the **last** occurrence
rather than assuming there is exactly one -- see the day-4 note in README.md.

Usage
-----
    python pipeline/replay.py --events data/events.jsonl --out data/tables
    python pipeline/replay.py --events data/events.jsonl --out data/tables --check

`--check` rebuilds into a temporary directory and compares against what is
already on disk, so CI can prove the projections are reproducible.

Exit codes: 0 clean, 1 projection mismatch under --check, 2 unusable input.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import tempfile
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable, Sequence

from _common import REPO_ROOT, load_items

# Trials whose advice sits closer than this to the initial estimate have an
# unstable WOA denominator. Recorded per trial rather than filtered here, so the
# multiverse can vary the cut without reprojecting.
DEFAULT_DENOMINATOR_THRESHOLD = 0.05


class ReplayError(Exception):
    pass


# ---------------------------------------------------------------------------
# Reading
# ---------------------------------------------------------------------------


def read_events(paths: Sequence[Path]) -> list[dict[str, Any]]:
    """Every event across the given logs, deduplicated and ordered.

    Ordering is (session_id, seq) rather than arrival or timestamp: seq is the
    only field the client guarantees monotonic, and batches can arrive out of
    order after an outage.
    """
    seen: set[str] = set()
    events: list[dict[str, Any]] = []

    for path in paths:
        if not path.exists():
            raise ReplayError(f"event log not found: {path}")
        for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError as error:
                raise ReplayError(f"{path.name}:{lineno}: not valid JSON ({error})") from error
            for field in ("event_id", "session_id", "seq", "type", "client_ts"):
                if field not in event:
                    raise ReplayError(f"{path.name}:{lineno}: event is missing '{field}'")
            if event["event_id"] in seen:
                continue
            seen.add(event["event_id"])
            events.append(event)

    events.sort(key=lambda e: (str(e["session_id"]), int(e["seq"])))
    return events


def group_by_session(events: Iterable[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    sessions: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for event in events:
        sessions[str(event["session_id"])].append(event)
    return dict(sessions)


# ---------------------------------------------------------------------------
# Per-session reduction
# ---------------------------------------------------------------------------


def _last(events: list[dict[str, Any]], event_type: str) -> dict[str, Any] | None:
    for event in reversed(events):
        if event["type"] == event_type:
            return event
    return None


def _of_type(events: list[dict[str, Any]], event_type: str) -> list[dict[str, Any]]:
    return [e for e in events if e["type"] == event_type]


def reduce_session(session_id: str, events: list[dict[str, Any]], items: dict[str, Any]) -> dict[str, Any]:
    """Everything one participant contributes, as plain dicts ready for CSV."""
    started = _last(events, "SESSION_STARTED")
    allocated = _last(events, "ALLOCATED")
    completed = _last(events, "SESSION_COMPLETED")
    withdrawn = _last(events, "SESSION_WITHDRAWN")
    consent = _last(events, "CONSENT_GIVEN")
    assent = _last(events, "ASSENT_GIVEN")

    condition = (allocated or {}).get("payload", {}).get("condition")
    stratum = (allocated or {}).get("payload", {}).get("stratum")

    # ---- per-item accumulation ------------------------------------------
    presented: dict[str, dict[str, Any]] = {}
    revealed: dict[str, dict[str, Any]] = {}
    finalized: dict[str, dict[str, Any]] = {}
    initial_estimate: dict[str, float] = {}
    initial_confidence: dict[str, float] = {}
    final_confidence: dict[str, float] = {}
    max_scroll: dict[str, float] = defaultdict(float)
    followups: dict[str, list[str]] = defaultdict(list)
    verify_clicks: dict[str, int] = defaultdict(int)
    blurs: dict[str, int] = defaultdict(int)
    away_ms: dict[str, int] = defaultdict(int)

    for event in events:
        kind = event["type"]
        payload = event.get("payload", {})
        item_id = payload.get("item_id")

        if kind == "ITEM_PRESENTED":
            # Last wins: a resume re-mounts the item screen.
            presented[item_id] = event
        elif kind == "RESPONSE_REVEALED":
            revealed[item_id] = event
        elif kind == "ESTIMATE_CHANGED":
            if payload.get("phase") == "initial":
                initial_estimate[item_id] = float(payload["value"])
        elif kind == "CONFIDENCE_SET":
            target = initial_confidence if payload.get("phase") == "initial" else final_confidence
            target[item_id] = float(payload["value"])
        elif kind == "ESTIMATE_FINALIZED":
            finalized[item_id] = event
        elif kind == "RESPONSE_SCROLLED":
            max_scroll[item_id] = max(max_scroll[item_id], float(payload["max_scroll_fraction"]))
        elif kind == "FOLLOWUP_SELECTED":
            followups[item_id].append(str(payload["followup_id"]))
        elif kind == "VERIFY_CLICKED":
            verify_clicks[item_id] += 1
        elif kind == "WINDOW_BLURRED":
            if item_id:
                blurs[item_id] += 1
        elif kind == "WINDOW_FOCUSED":
            if item_id:
                away_ms[item_id] += int(payload.get("away_duration_ms", 0))

    trials: list[dict[str, Any]] = []
    for item_id, present_event in presented.items():
        item = items.get(item_id)
        if item is None:
            raise ReplayError(f"{session_id}: event references unknown item '{item_id}'")
        final_event = finalized.get(item_id)
        reveal_event = revealed.get(item_id)

        initial = initial_estimate.get(item_id)
        final = float(final_event["payload"]["value"]) if final_event else None
        advice = float(item["advice_value"])

        # Deliberation time is measured between two client timestamps in the
        # same session, so it needs no cross-clock assumption. Post-advice RT
        # comes from the client's own ms_since_reveal, which already restarts
        # when a resume re-reveals the response.
        ms_present_to_reveal = None
        if reveal_event is not None:
            ms_present_to_reveal = int(reveal_event["client_ts"]) - int(present_event["client_ts"])

        selected = sorted(set(followups.get(item_id, [])))
        trials.append(
            {
                "session_id": session_id,
                "item_id": item_id,
                "position": present_event["payload"].get("position"),
                "condition": condition,
                "stratum": stratum,
                "register_state": (reveal_event or {}).get("payload", {}).get("register_state"),
                "response_id": (reveal_event or {}).get("payload", {}).get("response_id"),
                "justification_quality": item["assigned_justification_quality"],
                # Carried through because the analysis has to be able to tell an
                # analysed item from a filler. Without it the quality contrast
                # silently averaged the four fillers into the strong cell, which
                # made the strong side 75% accurate against the weak side's 50%.
                "role": item["role"],
                "design_cell": item["design_cell"],
                "topic": item["topic"],
                "is_error_item": int(bool(item["is_error"])),
                "advice_value": advice,
                "true_value": item["true_value"],
                "initial_estimate": initial,
                "final_estimate": final,
                "initial_confidence": initial_confidence.get(item_id),
                "final_confidence": final_confidence.get(item_id),
                "woa_raw": woa_raw(initial, final, advice),
                "denominator_rel": denominator_rel(initial, advice),
                "revision_count": (final_event or {}).get("payload", {}).get("revision_count"),
                "ms_present_to_reveal": ms_present_to_reveal,
                "ms_reveal_to_final": (final_event or {}).get("payload", {}).get("ms_since_reveal"),
                "max_scroll_fraction": round(max_scroll.get(item_id, 0.0), 6),
                "n_followups": len(selected),
                "followups": "|".join(selected),
                "challenged": int("challenge" in selected),
                "verify_clicks": verify_clicks.get(item_id, 0),
                "n_blurs": blurs.get(item_id, 0),
                "away_ms": away_ms.get(item_id, 0),
                "complete": int(final_event is not None and initial is not None),
            }
        )

    trials.sort(key=lambda t: (t["position"] if t["position"] is not None else 99, t["item_id"]))

    questionnaire = [
        {
            "session_id": session_id,
            "scale": e["payload"]["scale"],
            "question_id": e["payload"]["question_id"],
            "value": e["payload"]["value"],
        }
        for e in _of_type(events, "QUESTIONNAIRE_ANSWERED")
    ]

    funnel = {
        e["payload"]["stage"]: e["payload"]["text"] for e in _of_type(events, "FUNNEL_RESPONSE")
    }
    covariates = {
        q["question_id"]: q["value"] for q in questionnaire if q["scale"] == "covariates"
    }

    participant = {
        "session_id": session_id,
        "condition": condition,
        "stratum": stratum,
        "allocation_seq": (allocated or {}).get("payload", {}).get("allocation_seq"),
        # Two different things, and conflating them misreports the language for
        # anyone whose browser disagrees with their choice -- which in a
        # trilingual sample is most of them.
        #
        #   browser_locale  what the browser reported at first load, BEFORE the
        #                   participant picked anything. Useful for knowing what
        #                   they were defaulted to; not their language.
        #   language        the language they chose, taken from the allocation
        #                   stratum, which is where it becomes authoritative.
        "browser_locale": (started or {}).get("payload", {}).get("locale"),
        "language": str(stratum).split(":")[0] if stratum else None,
        "app_version": (started or {}).get("payload", {}).get("app_version"),
        "stimuli_manifest_hash": (started or {}).get("payload", {}).get("stimuli_manifest_hash"),
        "resumed": int(bool((started or {}).get("payload", {}).get("resumed"))),
        "consent_flow": (consent or {}).get("payload", {}).get("flow")
        or ("minor" if assent else None),
        "age_band": covariates.get("cov_age_band"),
        "primary_language": covariates.get("cov_primary_language"),
        "ai_usage": covariates.get("cov_ai_usage"),
        "prior_knowledge": covariates.get("cov_prior_knowledge"),
        "completed": int(completed is not None),
        "withdrawn": int(withdrawn is not None),
        "withdrawn_at_state": (withdrawn or {}).get("payload", {}).get("at_state"),
        "total_duration_ms": (completed or {}).get("payload", {}).get("total_duration_ms"),
        "n_trials_presented": len(trials),
        "n_trials_complete": sum(t["complete"] for t in trials),
        "n_events": len(events),
        "funnel_purpose": funnel.get("purpose"),
        "funnel_anomaly": funnel.get("anomaly"),
        "funnel_belief": funnel.get("belief"),
    }

    session_start_ts = int(events[0]["client_ts"]) if events else 0
    transitions = [
        {
            "session_id": session_id,
            "seq": e["seq"],
            "type": e["type"],
            "item_id": e.get("payload", {}).get("item_id"),
            "client_ts": e["client_ts"],
            "ms_since_session_start": int(e["client_ts"]) - session_start_ts,
        }
        for e in events
    ]

    return {
        "participant": participant,
        "trials": trials,
        "questionnaire": questionnaire,
        "transitions": transitions,
    }


# ---------------------------------------------------------------------------
# Weight of Advice components
# ---------------------------------------------------------------------------


def woa_raw(initial: float | None, final: float | None, advice: float) -> float | None:
    """(final - initial) / (advice - initial), unclamped, or None when undefined.

    Left unclamped on purpose. Clamping is a specification choice the multiverse
    varies; baking one in here would silently remove it from the curve.
    """
    if initial is None or final is None:
        return None
    denominator = advice - initial
    if denominator == 0:
        return None
    return round((final - initial) / denominator, 10)


def denominator_rel(initial: float | None, advice: float) -> float | None:
    """|advice - initial| as a fraction of the advice value.

    The WOA denominator is unstable when a participant's initial estimate
    already sits on the advice: a one-unit revision then produces an enormous
    ratio. Reported per trial so a specification can cut at 1%, 5% or 10%
    without the projection having to choose.
    """
    if initial is None or advice == 0:
        return None
    return round(abs(advice - initial) / abs(advice), 10)


# ---------------------------------------------------------------------------
# Writing
# ---------------------------------------------------------------------------

TRIAL_COLUMNS = [
    "session_id", "item_id", "position", "condition", "stratum", "register_state",
    "response_id", "justification_quality", "role", "design_cell", "topic",
    "is_error_item", "advice_value", "true_value",
    "initial_estimate", "final_estimate", "initial_confidence", "final_confidence",
    "woa_raw", "denominator_rel", "revision_count", "ms_present_to_reveal",
    "ms_reveal_to_final", "max_scroll_fraction", "n_followups", "followups",
    "challenged", "verify_clicks", "n_blurs", "away_ms", "complete",
]

PARTICIPANT_COLUMNS = [
    "session_id", "condition", "stratum", "allocation_seq", "locale", "app_version",
    "stimuli_manifest_hash", "resumed", "consent_flow", "browser_locale", "language",
    "age_band", "primary_language",
    "ai_usage", "prior_knowledge",
    "completed", "withdrawn", "withdrawn_at_state", "total_duration_ms",
    "n_trials_presented", "n_trials_complete", "n_events",
    "funnel_purpose", "funnel_anomaly", "funnel_belief",
]

QUESTIONNAIRE_COLUMNS = ["session_id", "scale", "question_id", "value"]
TRANSITION_COLUMNS = ["session_id", "seq", "type", "item_id", "client_ts", "ms_since_session_start"]


def write_csv(path: Path, columns: Sequence[str], rows: Sequence[dict[str, Any]]) -> None:
    """One CSV, with LF endings so the same log hashes the same on any platform."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(columns), lineterminator="\n",
                                extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({c: "" if row.get(c) is None else row.get(c) for c in columns})


def project(events: list[dict[str, Any]], out_dir: Path) -> dict[str, int]:
    items = {i["id"]: i for i in load_items()["items"]}
    sessions = group_by_session(events)

    participants: list[dict[str, Any]] = []
    trials: list[dict[str, Any]] = []
    questionnaire: list[dict[str, Any]] = []
    transitions: list[dict[str, Any]] = []

    for session_id in sorted(sessions):
        reduced = reduce_session(session_id, sessions[session_id], items)
        participants.append(reduced["participant"])
        trials.extend(reduced["trials"])
        questionnaire.extend(reduced["questionnaire"])
        transitions.extend(reduced["transitions"])

    write_csv(out_dir / "participants.csv", PARTICIPANT_COLUMNS, participants)
    write_csv(out_dir / "trials.csv", TRIAL_COLUMNS, trials)
    write_csv(out_dir / "questionnaire.csv", QUESTIONNAIRE_COLUMNS, questionnaire)
    write_csv(out_dir / "transitions.csv", TRANSITION_COLUMNS, transitions)

    return {
        "participants": len(participants),
        "trials": len(trials),
        "questionnaire": len(questionnaire),
        "transitions": len(transitions),
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Project the event log into analysis tables.")
    parser.add_argument("--events", nargs="+", default=[str(REPO_ROOT / "data" / "events.jsonl")],
                        help="one or more JSONL event logs")
    parser.add_argument("--out", default=str(REPO_ROOT / "data" / "tables"),
                        help="directory for the projected CSVs")
    parser.add_argument("--check", action="store_true",
                        help="reproject into a temp dir and diff against --out")
    args = parser.parse_args(list(argv) if argv is not None else None)

    try:
        events = read_events([Path(p) for p in args.events])
    except ReplayError as error:
        print(f"{error}", file=sys.stderr)
        return 2

    if not events:
        print("no events to project", file=sys.stderr)
        return 2

    out_dir = Path(args.out)

    if args.check:
        with tempfile.TemporaryDirectory() as tmp:
            counts = project(events, Path(tmp))
            mismatches = []
            for name in ("participants.csv", "trials.csv", "questionnaire.csv", "transitions.csv"):
                fresh = (Path(tmp) / name).read_bytes()
                existing = out_dir / name
                if not existing.exists():
                    mismatches.append(f"{name}: missing from {out_dir}")
                elif existing.read_bytes().replace(b"\r\n", b"\n") != fresh:
                    mismatches.append(f"{name}: differs from a fresh projection")
        if mismatches:
            print("Projections are NOT reproducible:", file=sys.stderr)
            for line in mismatches:
                print(f"  - {line}", file=sys.stderr)
            print("\nThe tables were edited by hand, or replay.py changed without "
                  "regenerating them. Re-run without --check.", file=sys.stderr)
            return 1
        print(f"Projections reproduce byte-for-byte from {len(events)} events.")
        return 0

    counts = project(events, out_dir)
    print(f"Replayed {len(events)} events from {len(group_by_session(events))} sessions.")
    for name, count in counts.items():
        print(f"  {name + '.csv':20s} {count:6d} rows")
    print(f"  -> {out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
