#!/usr/bin/env python3
"""Five-component coding support (STUDY3_SPEC_v2.md section 4).

Two independent raters code every generated response for presence/absence of
each of the five EI components. Cohen's kappa is reported per component; any
component below 0.60 is rewritten and regenerated before launch.

This is what converts "we told the model to be warm and assumed it worked" into
a measured, reported property of the stimuli.

Sheets are **blinded by default**. Rows are shuffled with a committed seed and
the condition and register columns are withheld, because a rater who can see
"warm" in the row will code warmth and the resulting kappa measures nothing.
The unblinding key is written separately and must not go to the raters.

Usage:
    python pipeline/verify_components.py export
    python pipeline/verify_components.py score
    python pipeline/verify_components.py score --rater-a x.csv --rater-b y.csv

Exit codes: 0 clean, 1 a component fell below the kappa floor, 2 inputs missing.
"""

from __future__ import annotations

import argparse
import csv
import random
import sys
from pathlib import Path
from typing import Any, Iterable

from _common import (
    CODING_DIR,
    LANGUAGES,
    RESPONSES_DIR,
    VARIANTS,
    read_json,
    stimulus_filename,
)

KAPPA_FLOOR = 0.60
BLIND_SEED = 20260809  # committed, so the blinding is reproducible and auditable

COMPONENTS = [
    ("c1_perception", "Names the affective state the participant signalled"),
    ("c2_facilitation", "Reframes their state as epistemically useful, not a deficit"),
    ("c3_understanding", "Attributes a cause to their state (model of their mind)"),
    ("c4_regulation", "Actively modulates their affective state"),
    ("c5_convergence", "Mirrors their register and hedging density"),
]

SHEET_COLUMNS = ["row_id", "language", "item_id", "response_text"] + [name for name, _ in COMPONENTS] + ["notes"]
KEY_COLUMNS = ["row_id", "response_id", "language", "condition", "register_state", "item_id"]


def load_responses() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    missing: list[str] = []

    for language in LANGUAGES:
        for condition, state in VARIANTS:
            name = stimulus_filename(language, condition, state)
            path = RESPONSES_DIR / name
            if not path.exists():
                missing.append(name)
                continue
            for response in read_json(path)["responses"]:
                rows.append(response)

    if missing:
        print("Missing stimulus files -- run pipeline/generate.py first:", file=sys.stderr)
        for name in missing:
            print(f"  - {name}", file=sys.stderr)
        sys.exit(2)

    return rows


def export(args: argparse.Namespace) -> int:
    responses = load_responses()

    # Deterministic shuffle so the blinding is reproducible from the seed alone.
    ordered = sorted(responses, key=lambda r: str(r["response_id"]))
    rng = random.Random(BLIND_SEED)
    rng.shuffle(ordered)

    CODING_DIR.mkdir(parents=True, exist_ok=True)
    sheet_rows: list[dict[str, Any]] = []
    key_rows: list[dict[str, Any]] = []

    for index, response in enumerate(ordered, start=1):
        row_id = f"r{index:04d}"
        sheet_rows.append(
            {
                "row_id": row_id,
                "language": response["language"],
                "item_id": response["item_id"],
                "response_text": response["body"],
                **{name: "" for name, _ in COMPONENTS},
                "notes": "",
            }
        )
        key_rows.append(
            {
                "row_id": row_id,
                "response_id": response["response_id"],
                "language": response["language"],
                "condition": response["condition"],
                "register_state": response["register_state"] or "",
                "item_id": response["item_id"],
            }
        )

    for rater in ("A", "B"):
        path = CODING_DIR / f"rater_{rater}.csv"
        with path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=SHEET_COLUMNS)
            writer.writeheader()
            writer.writerows(sheet_rows)
        print(f"  -> materials/coding/{path.name} ({len(sheet_rows)} rows, blank)")

    key_path = CODING_DIR / "_unblinding_key.csv"
    with key_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=KEY_COLUMNS)
        writer.writeheader()
        writer.writerows(key_rows)
    print(f"  -> materials/coding/{key_path.name}  DO NOT GIVE THIS TO THE RATERS")

    instructions = CODING_DIR / "INSTRUCTIONS.md"
    instructions.write_text(_instructions(len(sheet_rows)), encoding="utf-8", newline="\n")
    print(f"  -> materials/coding/{instructions.name}")

    print(f"\n{len(sheet_rows)} responses to code, per rater.")
    print("Sheets are blinded: rows shuffled, condition and register withheld.")
    return 0


def _instructions(row_count: int) -> str:
    component_lines = "\n".join(f"- **`{name}`** — {description}" for name, description in COMPONENTS)
    return f"""# Component coding instructions

You are coding {row_count} AI responses for the presence or absence of five
emotional-intelligence components. Work through `rater_A.csv` or `rater_B.csv`
(whichever you were given) and do not compare notes with the other rater until
both sheets are complete.

## What to enter

For each of the five component columns, enter **1** if the component is present
in the response text and **0** if it is not. Leave nothing blank. Use the
`notes` column for anything ambiguous.

{component_lines}

## Important

- The sheets are **blinded**. Rows are shuffled and the experimental condition
  is not shown. Many responses will have none of the five components — that is
  expected, and coding them all 0 is the correct answer for those.
- Code what is actually in the text, not what you think the study wants. A
  component that is *almost* there is a 0.
- Do not code the justification sentence; it is not shown here, and it is
  identical across conditions by construction.

## What happens next

`pipeline/verify_components.py score` computes Cohen's kappa per component
across the two sheets. Any component below {KAPPA_FLOOR:.2f} gets rewritten and
regenerated before launch, per STUDY3_SPEC_v2.md section 4.
"""


def cohens_kappa(a: list[int], b: list[int]) -> tuple[float | None, str]:
    """Cohen's kappa for two raters on a binary code.

    Returns (kappa, note). Kappa is None when chance agreement is 1.0, which
    happens when both raters used a single category throughout -- the statistic
    is undefined there and reporting 0 or 1 would both be wrong.
    """
    n = len(a)
    if n == 0:
        return None, "no rows"

    observed = sum(1 for x, y in zip(a, b) if x == y) / n

    expected = 0.0
    for category in (0, 1):
        expected += (a.count(category) / n) * (b.count(category) / n)

    if abs(1.0 - expected) < 1e-12:
        return None, "undefined: both raters used one category throughout"

    return (observed - expected) / (1.0 - expected), f"observed agreement {observed:.3f}"


def read_sheet(path: Path) -> dict[str, dict[str, str]]:
    with path.open("r", encoding="utf-8", newline="") as handle:
        return {row["row_id"]: row for row in csv.DictReader(handle)}


def score(args: argparse.Namespace) -> int:
    path_a = Path(args.rater_a) if args.rater_a else CODING_DIR / "rater_A.csv"
    path_b = Path(args.rater_b) if args.rater_b else CODING_DIR / "rater_B.csv"

    for path in (path_a, path_b):
        if not path.exists():
            print(f"Missing {path}. Run `verify_components.py export` first.", file=sys.stderr)
            return 2

    sheet_a, sheet_b = read_sheet(path_a), read_sheet(path_b)
    shared = sorted(set(sheet_a) & set(sheet_b))

    if not shared:
        print("The two sheets share no row ids.", file=sys.stderr)
        return 2

    unfilled = [
        row_id
        for row_id in shared
        for name, _ in COMPONENTS
        if sheet_a[row_id].get(name, "").strip() == "" or sheet_b[row_id].get(name, "").strip() == ""
    ]
    if unfilled:
        print(
            f"{len(set(unfilled))} row(s) are not fully coded in one or both sheets. "
            "Complete them before scoring.",
            file=sys.stderr,
        )
        return 2

    print(f"Cohen's kappa across {len(shared)} doubly-coded responses\n")
    print(f"{'component':<20} {'kappa':>8}  {'':<4} note")
    print("-" * 72)

    below: list[str] = []
    for name, description in COMPONENTS:
        a = [int(sheet_a[row_id][name]) for row_id in shared]
        b = [int(sheet_b[row_id][name]) for row_id in shared]
        kappa, note = cohens_kappa(a, b)

        if kappa is None:
            print(f"{name:<20} {'n/a':>8}  {'':<4} {note}")
            below.append(f"{name} (kappa undefined: {note})")
            continue

        flag = "FAIL" if kappa < KAPPA_FLOOR else "ok"
        print(f"{name:<20} {kappa:>8.3f}  {flag:<4} {note}")
        if kappa < KAPPA_FLOOR:
            below.append(f"{name} (kappa {kappa:.3f})")

    print()
    if below:
        print(f"{len(below)} component(s) below the {KAPPA_FLOOR:.2f} floor:")
        for line in below:
            print(f"  - {line}")
        print("\nRewrite the component prompt and regenerate before launch (spec section 4).")
        return 1

    print(f"All five components meet the kappa >= {KAPPA_FLOOR:.2f} floor.")
    return 0


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Export coding sheets and score inter-rater reliability.")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("export", help="write blank blinded coding sheets for two raters")

    score_parser = sub.add_parser("score", help="compute Cohen's kappa from completed sheets")
    score_parser.add_argument("--rater-a", default=None)
    score_parser.add_argument("--rater-b", default=None)

    args = parser.parse_args(list(argv) if argv is not None else None)
    return export(args) if args.command == "export" else score(args)


if __name__ == "__main__":
    sys.exit(main())
