"""Participant exclusion criteria (spec v2 section 8.6), as one logged step.

Why this is its own module and not a few filters inside analysis.py
-------------------------------------------------------------------
Exclusions are where an honest pipeline quietly stops being one. A
``df = df[df.completed == 1]`` on line 200 of an analysis script is invisible in
the output, impossible to audit from the paper, and trivially adjustable once
you have seen the result. So the rules live here, alone, as pure functions of
the projected tables; they produce a per-participant flag table and a count for
every criterion; and the counts are written to a file the report reads.

Two consequences worth stating. First, criterion 4 exists in the code even
though it never excludes anyone: a criterion deleted because it is unused
becomes a criterion nobody remembers was considered, and a reviewer asking
"did you use an attention check?" deserves an answer from the code rather than
from memory. Second, a missing input column raises instead of defaulting. If
replay stops emitting ``repeat_session``, criterion 5 must not silently become
"nobody is a repeat" -- a check that cannot fail is not a check.

Every analysis is reported both with and without exclusions (section 8.6), so
this module decides who is flagged and never decides what is done about it.
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

import pandas as pd

from _common import REPO_ROOT, write_json

# --- thresholds, straight from the specification table ----------------------

#: Criterion 2. The advice body runs 60-90 words; at 400 wpm -- fast for a
#: second language -- that is 9-13 seconds. Five seconds does not identify fast
#: reading, it identifies not reading. Strictly under, because "under 5 seconds"
#: is the pre-registered wording and 5000 ms exactly is not under it.
FAST_TRIAL_MS = 5_000

#: Criterion 2. A majority of the twelve, so skipping one item is not enough.
FAST_TRIAL_MIN_COUNT = 7


@dataclass(frozen=True)
class Criterion:
    number: int
    key: str
    label: str
    applied: bool
    rationale: str


CRITERIA: tuple[Criterion, ...] = (
    Criterion(
        1,
        "non_completion",
        "No SESSION_COMPLETED event",
        True,
        "A partial session has no questionnaire and no funnel probe.",
    ),
    Criterion(
        2,
        "fast_trials",
        "Under 5000 ms from reveal to final on 7 or more of 12 trials",
        True,
        "Five seconds does not identify fast reading; it identifies not reading.",
    ),
    Criterion(
        3,
        "invariant_responding",
        "Final estimate identical to initial on every trial and no revision in the final phase",
        True,
        "WOA is undefined for a participant who never moved. Never moving is a "
        "legitimate response to advice; the conjunction with zero interaction is "
        "what marks it as non-engagement.",
    ),
    Criterion(
        4,
        "attention_check",
        "Attention check",
        False,
        "Not used. No attention-check item exists and none is being added: it "
        "would need a new screen and a manipulation of its own. Criteria 2 and 3 "
        "plus the funnel probe cover the same ground.",
    ),
    Criterion(
        5,
        "repeat_session",
        "A second session from a browser that already completed one",
        True,
        "Detectable only within a browser. A repeat from another device cannot "
        "be detected without an identifier, which the no-PII rule forbids; that "
        "limit is stated in the paper rather than engineered around.",
    ),
)

PARTICIPANT_COLUMNS = ("session_id", "completed", "repeat_session")
TRIAL_COLUMNS = (
    "session_id",
    "initial_estimate",
    "final_estimate",
    "ms_reveal_to_final",
    "revision_count",
)


@dataclass(frozen=True)
class ExclusionReport:
    """One boolean column per criterion, one row per participant, plus counts."""

    flags: pd.DataFrame
    counts: dict[str, int]
    n_total: int

    def excluded_sessions(self) -> set[str]:
        if self.flags.empty:
            return set()
        return set(self.flags.loc[self.flags["excluded"].astype(bool), "session_id"])

    @property
    def n_retained(self) -> int:
        return self.n_total - len(self.excluded_sessions())

    def to_log(self) -> dict[str, Any]:
        return {
            "n_participants": self.n_total,
            "n_excluded": len(self.excluded_sessions()),
            "n_retained": self.n_retained,
            "criteria": [
                {
                    "number": c.number,
                    "key": c.key,
                    "label": c.label,
                    "applied": c.applied,
                    "rationale": c.rationale,
                    "n_excluded": self.counts[c.key],
                }
                for c in CRITERIA
            ],
            "excluded_session_ids": sorted(self.excluded_sessions()),
        }


def _require(frame: pd.DataFrame, columns: Iterable[str], what: str) -> None:
    missing = [c for c in columns if c not in frame.columns]
    if missing:
        raise KeyError(
            f"{what} is missing {missing}. Exclusion criteria are not optional: "
            "a criterion whose input is absent must fail loudly, not pass everyone."
        )


def apply_exclusions(participants: pd.DataFrame, trials: pd.DataFrame) -> ExclusionReport:
    """Flag every participant against every criterion. Decides nothing else."""
    _require(participants, PARTICIPANT_COLUMNS, "participants table")
    if not trials.empty:
        _require(trials, TRIAL_COLUMNS, "trials table")

    by_session: dict[str, pd.DataFrame] = (
        {str(sid): group for sid, group in trials.groupby("session_id")}
        if not trials.empty
        else {}
    )

    rows: list[dict[str, Any]] = []
    for record in participants.to_dict("records"):
        session_id = str(record["session_id"])
        group = by_session.get(session_id)

        flags = {
            "non_completion": int(record["completed"]) != 1,
            "fast_trials": _fast_trials(group),
            "invariant_responding": _invariant(group),
            # Declared, never applied. Kept so the report can say so out loud.
            "attention_check": False,
            "repeat_session": int(record["repeat_session"]) == 1,
        }
        row: dict[str, Any] = {"session_id": session_id}
        row.update(flags)
        row["excluded"] = any(flags.values())
        rows.append(row)

    columns = ["session_id", *[c.key for c in CRITERIA], "excluded"]
    if rows:
        flag_frame = pd.DataFrame(rows, columns=columns)
    else:
        # An empty run must still produce the full shape, or downstream code
        # discovers the columns only when there is data to lose.
        flag_frame = pd.DataFrame({name: pd.Series(dtype="object") for name in columns})

    counts = {
        c.key: (int(flag_frame[c.key].sum()) if not flag_frame.empty else 0) for c in CRITERIA
    }
    return ExclusionReport(flags=flag_frame, counts=counts, n_total=len(participants))


def filter_excluded(
    frames: dict[str, pd.DataFrame], report: ExclusionReport
) -> dict[str, pd.DataFrame]:
    """Copies of `frames` with the flagged sessions removed.

    Deliberately a separate call rather than something `apply_exclusions` does
    on its way past. Section 8.6 requires every analysis reported both with and
    without exclusions, which is only possible while the unfiltered tables still
    exist -- so filtering is an act the caller performs on a copy, and the
    originals are never mutated.

    Tables with no `session_id` column (the item bank, for instance) pass
    through untouched.
    """
    excluded = report.excluded_sessions()
    out: dict[str, pd.DataFrame] = {}
    for name, frame in frames.items():
        if "session_id" not in frame.columns:
            out[name] = frame
            continue
        out[name] = frame[~frame["session_id"].astype(str).isin(excluded)].reset_index(drop=True)
    return out


def _fast_trials(group: pd.DataFrame | None) -> bool:
    """Criterion 2.

    A trial with no reveal-to-final time is incomplete, which is criterion 1's
    business rather than this one's, so a missing value is not counted as fast.
    """
    if group is None or group.empty:
        return False
    ms = pd.to_numeric(group["ms_reveal_to_final"], errors="coerce")
    return int((ms < FAST_TRIAL_MS).sum()) >= FAST_TRIAL_MIN_COUNT


def _invariant(group: pd.DataFrame | None) -> bool:
    """Criterion 3.

    Both halves are required. Holding position after genuinely working the
    slider is a considered response to advice, and dropping it along with the
    non-engagement it superficially resembles would bias the sample toward
    people who move.
    """
    if group is None or group.empty:
        return False
    initial = pd.to_numeric(group["initial_estimate"], errors="coerce")
    final = pd.to_numeric(group["final_estimate"], errors="coerce")
    if bool(initial.isna().any()) or bool(final.isna().any()):
        return False
    never_moved = bool((initial == final).all())
    revisions = pd.to_numeric(group["revision_count"], errors="coerce").fillna(0)
    return never_moved and int(revisions.sum()) == 0


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def print_report(report: ExclusionReport) -> None:
    print("Participant exclusions (spec v2 section 8.6)")
    print(f"  participants projected : {report.n_total}")
    print(f"  excluded               : {len(report.excluded_sessions())}")
    print(f"  retained               : {report.n_retained}")
    print("")
    for criterion in CRITERIA:
        mark = " " if criterion.applied else "*"
        count = report.counts[criterion.key]
        print(f"  {mark}{criterion.number}. {criterion.key:<22} {count:>5}")
    print("")
    print("  * declared in the specification, deliberately not applied")


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Apply the specification's participant exclusion criteria."
    )
    parser.add_argument("--tables", default=str(REPO_ROOT / "data" / "tables"))
    parser.add_argument("--out", default=str(REPO_ROOT / "data" / "exclusions.json"))
    parser.add_argument("--csv", default=str(REPO_ROOT / "data" / "exclusions.csv"))
    args = parser.parse_args(list(argv) if argv is not None else None)

    tables = Path(args.tables)
    participants = pd.read_csv(tables / "participants.csv")
    trials_path = tables / "trials.csv"
    trials = pd.read_csv(trials_path) if trials_path.exists() else pd.DataFrame()

    report = apply_exclusions(participants, trials)
    print_report(report)

    Path(args.csv).parent.mkdir(parents=True, exist_ok=True)
    report.flags.to_csv(args.csv, index=False, lineterminator="\n")
    write_json(Path(args.out), report.to_log())
    print("")
    print(f"wrote {args.csv}")
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
