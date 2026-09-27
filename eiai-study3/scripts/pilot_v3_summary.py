#!/usr/bin/env python3
"""Pilot summary for v3: per participant and on average.

Reads the event log through pipeline/v3_export.load_v3, so a participant who
pressed "Remove my data" is already gone, and keeps pilot runs only unless told
otherwise. Writes results/pilot_v3/SUMMARY.md.

    python scripts/pilot_v3_summary.py --events data/pilot-events.csv
    python scripts/pilot_v3_summary.py --events data/dev-events.jsonl --mode test   # rehearsal data

Descriptive only. With five people these numbers can show whether the
procedure works -- whether reading times differ at all, whether anyone picks
the distractor, whether the tone check separates the tones -- not whether the
hypotheses hold. The pilot does not enter the main sample.
"""

from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from pathlib import Path
from statistics import mean
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "pipeline"))

import v3_export  # noqa: E402

OUT = ROOT / "results" / "pilot_v3" / "SUMMARY.md"
ROLES = ("lesson", "intuitive", "distractor")
VERSIONS = ("strong", "weak")


def avg(values: Iterable[float | int | None]) -> float | None:
    xs = [float(v) for v in values if v is not None]
    return mean(xs) if xs else None


def fmt(value: Any, digits: int = 2) -> str:
    if value is None:
        return "—"
    if isinstance(value, bool):
        return "yes" if value else "no"
    if isinstance(value, float):
        return f"{value:.{digits}f}"
    return str(value)


def minutes(ms: float | int | None) -> str:
    return "—" if ms is None else f"{ms / 60000:.1f} min"


def seconds(ms: float | int | None) -> str:
    return "—" if ms is None else f"{ms / 1000:.1f} s"


def participant(session_id: str, events: list[dict[str, Any]]) -> dict[str, Any]:
    by_type: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for e in events:
        by_type[e["type"]].append(e)
    allocation = (by_type["allocation"] or [None])[0]
    completed = (by_type["session_completed"] or [None])[0]
    attention = (by_type["attention_check"] or [None])[0]
    answers = {e["payload"]["item_id"]: e["payload"]["value"] for e in by_type["questionnaire_item"]}

    total_ms = completed["payload"]["total_duration_ms"] if completed else None
    if total_ms is None and len(events) > 1:
        total_ms = v3_export.epoch_ms(events[-1]["client_ts"]) - v3_export.epoch_ms(events[0]["client_ts"])

    dwell = {v: [e["payload"]["dwell_ms"] for e in by_type["lesson_item"] if e["payload"]["version"] == v] for v in VERSIONS}
    dwell_by_claim = {e["payload"]["claim_id"]: e["payload"]["dwell_ms"] for e in by_type["lesson_item"]}
    choices = {v: {r: 0 for r in ROLES} for v in VERSIONS}
    for e in by_type["mission_answer"]:
        choices[e["payload"]["version"]][e["payload"]["choice_role"]] += 1
    confidence = avg(e["payload"]["confidence"] for e in by_type["mission_answer"])

    version_of = {e["payload"]["claim_id"]: e["payload"]["version"] for e in by_type["lesson_item"]}
    quiz = {"strong": [], "weak": [], "filler_true": [], "filler_false": []}
    for e in by_type["quiz_rating"]:
        p = e["payload"]
        if p["is_filler"]:
            # F1, F2 are true statements; F3, F4 false (Appendix D3).
            quiz["filler_true" if p["item_id"] in ("F1", "F2") else "filler_false"].append(p["rating"])
        else:
            version = p.get("version") or version_of.get(p["claim_id"])
            if version in quiz:
                quiz[version].append(p["rating"])
    quality = {v: [e["payload"]["rating"] for e in by_type["arg_quality_rating"] if e["payload"]["version"] == v] for v in VERSIONS}

    def scale(ids: Iterable[str]) -> float | None:
        return avg(answers.get(i) for i in ids if isinstance(answers.get(i), (int, float)))

    return {
        "session_id": session_id,
        "short_id": session_id[:8],
        "cell": allocation["payload"]["cell"] if allocation else None,
        "tone": allocation["payload"]["tone"] if allocation else None,
        "completed": completed is not None,
        "total_ms": total_ms,
        "modules": v3_export.module_durations(events),
        "dwell_strong": avg(dwell["strong"]),
        "dwell_weak": avg(dwell["weak"]),
        "dwell_by_claim": dwell_by_claim,
        "version_of": version_of,
        "choices": choices,
        "confidence": confidence,
        "attention": attention["payload"]["passed"] if attention else None,
        "quiz_strong": avg(quiz["strong"]),
        "quiz_weak": avg(quiz["weak"]),
        "quiz_filler_true": avg(quiz["filler_true"]),
        "quiz_filler_false": avg(quiz["filler_false"]),
        "T1_T4": scale(["T1", "T2", "T3", "T4"]),
        "T5_T6": scale(["T5", "T6"]),
        "R1_R3": scale(["R1", "R2", "R3"]),
        "E1": answers.get("E1"),
        "E2": answers.get("E2"),
        "E3": answers.get("E3"),
        "quality_strong": avg(quality["strong"]),
        "quality_weak": avg(quality["weak"]),
        "funnel": {e["payload"]["item_id"]: e["payload"]["text"] for e in by_type["funnel_answer"]},
        "feedback": {e["payload"]["item_id"]: e["payload"]["text"] for e in by_type["pilot_feedback"]},
    }


def render(people: list[dict[str, Any]], report: dict[str, Any], mode: str) -> str:
    out: list[str] = ["# Pilot v3 — summary", ""]
    out.append(
        f"Run mode: **{mode}**. {len(people)} participant(s) allocated; "
        f"{sum(p['completed'] for p in people)} completed. "
        f"Excluded after “Remove my data”: {len(report['withdrawn_sessions'])} session(s)."
    )
    out += ["", "Descriptive only: the pilot tests the procedure, not the hypotheses.", ""]
    if not people:
        out += ["No allocated participants in this data.", ""]
        return "\n".join(out)

    out += ["## Per participant", ""]
    out.append("| Participant | Cell | Done | Total | M1 | M2 | M3 | Read strong | Read weak | Attention | Confidence |")
    out.append("|---|---|---|---|---|---|---|---|---|---|---|")
    for p in people:
        out.append(
            f"| {p['short_id']} | {fmt(p['cell'])} | {fmt(p['completed'])} | {minutes(p['total_ms'])} | "
            f"{minutes(p['modules'][1])} | {minutes(p['modules'][2])} | {minutes(p['modules'][3])} | "
            f"{seconds(p['dwell_strong'])} | {seconds(p['dwell_weak'])} | {fmt(p['attention'])} | {fmt(p['confidence'])} |"
        )

    out += ["", "## Mission answers", "", "Counts of lesson / intuitive / distractor choices, by how the claim was explained.", ""]
    out.append("| Participant | After strong (L / I / D) | After weak (L / I / D) |")
    out.append("|---|---|---|")
    totals = {v: {r: 0 for r in ROLES} for v in VERSIONS}
    for p in people:
        cells = []
        for v in VERSIONS:
            c = p["choices"][v]
            for r in ROLES:
                totals[v][r] += c[r]
            cells.append(" / ".join(str(c[r]) for r in ROLES))
        out.append(f"| {p['short_id']} | {cells[0]} | {cells[1]} |")
    out.append(
        f"| **All** | {' / '.join(str(totals['strong'][r]) for r in ROLES)} | "
        f"{' / '.join(str(totals['weak'][r]) for r in ROLES)} |"
    )

    out += ["", "## Final quiz (1 = definitely false … 7 = definitely true)", ""]
    out.append("| Participant | Claims after strong | Claims after weak | True fillers | False fillers |")
    out.append("|---|---|---|---|---|")
    for p in people:
        out.append(
            f"| {p['short_id']} | {fmt(p['quiz_strong'])} | {fmt(p['quiz_weak'])} | "
            f"{fmt(p['quiz_filler_true'])} | {fmt(p['quiz_filler_false'])} |"
        )
    out.append(
        f"| **Mean** | {fmt(avg(p['quiz_strong'] for p in people))} | {fmt(avg(p['quiz_weak'] for p in people))} | "
        f"{fmt(avg(p['quiz_filler_true'] for p in people))} | {fmt(avg(p['quiz_filler_false'] for p in people))} |"
    )

    out += ["", "## Tutor evaluation and explanation quality", ""]
    out.append("| Participant | Tone | T1–T4 | T5–T6 | R1–R3 | E1 | E2 | E3 | E6 strong | E6 weak |")
    out.append("|---|---|---|---|---|---|---|---|---|---|")
    for p in people:
        out.append(
            f"| {p['short_id']} | {fmt(p['tone'])} | {fmt(p['T1_T4'])} | {fmt(p['T5_T6'])} | {fmt(p['R1_R3'])} | "
            f"{fmt(p['E1'])} | {fmt(p['E2'])} | {fmt(p['E3'])} | {fmt(p['quality_strong'])} | {fmt(p['quality_weak'])} |"
        )
    out += ["", "By tone (means over participants):", ""]
    out.append("| Tone | n | T1–T4 | T5–T6 | R1–R3 | E1 | E2 | E3 |")
    out.append("|---|---|---|---|---|---|---|---|")
    for toneName in ("EI", "Neutral"):
        group = [p for p in people if p["tone"] == toneName]
        out.append(
            f"| {toneName} | {len(group)} | {fmt(avg(p['T1_T4'] for p in group))} | {fmt(avg(p['T5_T6'] for p in group))} | "
            f"{fmt(avg(p['R1_R3'] for p in group))} | {fmt(avg(p['E1'] for p in group))} | "
            f"{fmt(avg(p['E2'] for p in group))} | {fmt(avg(p['E3'] for p in group))} |"
        )
    out.append("")
    out.append(
        f"E6, all participants: strong {fmt(avg(p['quality_strong'] for p in people))}, "
        f"weak {fmt(avg(p['quality_weak'] for p in people))}."
    )

    out += ["", "## Reading time per claim (seconds)", ""]
    claims = v3_export.CLAIMS
    out.append("| Claim | " + " | ".join(p["short_id"] for p in people) + " | Mean strong | Mean weak |")
    out.append("|---|" + "---|" * (len(people) + 2))
    for claim in claims:
        cells = []
        strong, weak = [], []
        for p in people:
            ms = p["dwell_by_claim"].get(claim)
            version = p["version_of"].get(claim)
            cells.append("—" if ms is None else f"{ms / 1000:.1f} ({version[0] if version else '?'})")
            if ms is not None and version == "strong":
                strong.append(ms)
            elif ms is not None and version == "weak":
                weak.append(ms)
        out.append(f"| {claim} | " + " | ".join(cells) + f" | {seconds(avg(strong))} | {seconds(avg(weak))} |")
    out.append("")
    out.append("(s) = the participant read the strong version, (w) = the weak one.")
    out.append("")
    out.append(
        f"Mean reading time, all participants: strong {seconds(avg(p['dwell_strong'] for p in people))}, "
        f"weak {seconds(avg(p['dwell_weak'] for p in people))}."
    )

    out += ["", "## Funnel and pilot comments (verbatim)", ""]
    for p in people:
        out.append(f"### {p['short_id']} ({fmt(p['cell'])})")
        out.append("")
        for key in ("F1", "F2", "F3", "F4", "PF1", "PF2", "PF3"):
            text = p["funnel"].get(key, p["feedback"].get(key))
            out.append(f"- **{key}**: {text if text not in (None, '') else '—'}")
        out.append("")
    return "\n".join(out)


def summarise(paths: Iterable[Path], mode: str = "pilot", out: Path = OUT) -> dict[str, Any]:
    events, report = v3_export.load_v3(paths, mode)
    by_session: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for e in events:
        by_session[e["session_id"]].append(e)
    people = [
        participant(s, sorted(evs, key=lambda e: e["seq"]))
        for s, evs in sorted(by_session.items())
        if any(e["type"] == "allocation" for e in evs)
    ]
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(render(people, report, mode) + "\n", encoding="utf-8")
    return {"participants": len(people), "completed": sum(p["completed"] for p in people), "out": str(out)}


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Summarise the v3 pilot.")
    parser.add_argument("--events", nargs="+", required=True)
    parser.add_argument("--mode", choices=v3_export.RUN_MODES, default="pilot")
    parser.add_argument("--out", default=str(OUT))
    args = parser.parse_args(list(argv) if argv is not None else None)
    try:
        result = summarise([Path(p) for p in args.events], args.mode, Path(args.out))
    except (v3_export.ExportError, FileNotFoundError) as error:
        print(f"summary failed: {error}", file=sys.stderr)
        return 1
    print(f"{result['participants']} participant(s), {result['completed']} completed -> {result['out']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
