#!/usr/bin/env python3
"""Specification-curve analysis over every defensible analysis choice (spec 8.3).

The pipeline contains arbitrary decisions -- where to clamp Weight of Advice,
how close the advice may sit to the initial estimate before the trial is
unusable, whether to drop suspicious or resumed participants, whether to trim
reaction-time outliers. Each is defensible; none is obviously right. Reporting
the single specification that happened to be written first invites exactly the
objection it deserves.

So this runs **all** of them and plots the estimate with its interval for every
one, sorted. If the interaction survives across the curve, no reviewer can
suggest the result was fished for. If it survives in only a corner of the
curve, that is worth knowing before publication rather than after.

    2 clamp ranges x 3 denominator thresholds x 2 suspicious x 2 resumed
      x 2 RT rules = 48 specifications

It is a for-loop wearing a very good suit. That is the point: the cost is one
afternoon and the credibility gain is disproportionate.

Usage
-----
    python pipeline/multiverse.py --tables data/tables --out data/multiverse
    python pipeline/multiverse.py --tables data/tables --no-plot

Exit codes: 0 ok, 2 unusable input.
"""

from __future__ import annotations

import argparse
import csv
import itertools
import sys
from pathlib import Path
from typing import Any, Iterable

import numpy as np

from _common import REPO_ROOT
from analysis import Specification, analyse, load_tables

CLAMPS: tuple[tuple[float, float], ...] = ((0.0, 1.0), (-0.5, 1.5))
DENOMINATOR_THRESHOLDS = (0.01, 0.05, 0.10)
BOOLEAN = (False, True)


def all_specifications() -> list[Specification]:
    return [
        Specification(
            woa_clamp=clamp,
            denominator_threshold=threshold,
            exclude_suspicious=suspicious,
            exclude_resumed=resumed,
            rt_trim=trim,
        )
        for clamp, threshold, suspicious, resumed, trim in itertools.product(
            CLAMPS, DENOMINATOR_THRESHOLDS, BOOLEAN, BOOLEAN, BOOLEAN
        )
    ]


def run(frames: dict[str, Any], specs: list[Specification]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for spec in specs:
        results = analyse(frames, spec)
        h3 = results["H3_discrimination"]
        h1 = results["H1_interaction"]
        rows.append(
            {
                "label": spec.label(),
                "clamp_low": spec.woa_clamp[0],
                "clamp_high": spec.woa_clamp[1],
                "denominator_threshold": spec.denominator_threshold,
                "exclude_suspicious": int(spec.exclude_suspicious),
                "exclude_resumed": int(spec.exclude_resumed),
                "rt_trim": int(spec.rt_trim),
                "n_participants": results["n"]["participants"],
                "n_trials": results["n"]["trials_used"],
                "estimate": h3["diff"],
                "ci_low": h3["ci_low"],
                "ci_high": h3["ci_high"],
                "p": h3["p"],
                "hedges_g": h3["hedges_g"],
                "bf10": h3["bf10"],
                "partial_eta_sq": h1["partial_eta_sq"],
            }
        )
    rows.sort(key=lambda r: (r["estimate"] if np.isfinite(r["estimate"]) else np.inf))
    return rows


def summarise(rows: list[dict[str, Any]]) -> dict[str, Any]:
    estimates = np.array([r["estimate"] for r in rows], dtype=float)
    finite = estimates[np.isfinite(estimates)]
    # "Significant" here means the 95% interval excludes zero, in the predicted
    # direction. Counting both directions separately matters: a curve where
    # half the specifications point each way is not a robust effect, and a bare
    # count of "significant specifications" would hide that.
    negative = sum(1 for r in rows if np.isfinite(r["ci_high"]) and r["ci_high"] < 0)
    positive = sum(1 for r in rows if np.isfinite(r["ci_low"]) and r["ci_low"] > 0)
    return {
        "n_specifications": len(rows),
        "median_estimate": float(np.median(finite)) if finite.size else float("nan"),
        "min_estimate": float(finite.min()) if finite.size else float("nan"),
        "max_estimate": float(finite.max()) if finite.size else float("nan"),
        "n_ci_excludes_zero_negative": negative,
        "n_ci_excludes_zero_positive": positive,
        "n_ci_contains_zero": len(rows) - negative - positive,
    }


def plot_curve(rows: list[dict[str, Any]], path: Path) -> None:
    import matplotlib

    matplotlib.use("Agg")  # headless: this has to work in CI and in Docker
    import matplotlib.pyplot as plt

    x = np.arange(len(rows))
    estimate = np.array([r["estimate"] for r in rows], dtype=float)
    low = np.array([r["ci_low"] for r in rows], dtype=float)
    high = np.array([r["ci_high"] for r in rows], dtype=float)

    figure, (curve, grid) = plt.subplots(
        2, 1, figsize=(11, 8), sharex=True, gridspec_kw={"height_ratios": [2.2, 1]}
    )

    excludes_zero = (low > 0) | (high < 0)
    curve.vlines(x, low, high, color="#b0b0b0", linewidth=1.2, zorder=1)
    curve.scatter(x[~excludes_zero], estimate[~excludes_zero], s=16, color="#7a7a7a",
                  zorder=2, label="95% CI contains 0")
    curve.scatter(x[excludes_zero], estimate[excludes_zero], s=20, color="#b2182b",
                  zorder=3, label="95% CI excludes 0")
    curve.axhline(0, color="#333333", linewidth=1.0, linestyle="--")
    curve.set_ylabel("H3: discrimination, warm - neutral")
    curve.set_title("Specification curve: every defensible analysis choice")
    curve.legend(loc="upper left", frameon=False, fontsize=9)

    # The lower panel is what makes the curve readable: it shows WHICH choice
    # each specification made, so a reader can see at a glance whether the
    # effect tracks one particular decision.
    decisions = [
        ("clamp [0,1]", [r["clamp_low"] == 0.0 for r in rows]),
        ("clamp [-0.5,1.5]", [r["clamp_low"] != 0.0 for r in rows]),
        ("denominator 1%", [r["denominator_threshold"] == 0.01 for r in rows]),
        ("denominator 5%", [r["denominator_threshold"] == 0.05 for r in rows]),
        ("denominator 10%", [r["denominator_threshold"] == 0.10 for r in rows]),
        ("exclude suspicious", [bool(r["exclude_suspicious"]) for r in rows]),
        ("exclude resumed", [bool(r["exclude_resumed"]) for r in rows]),
        ("RT trim", [bool(r["rt_trim"]) for r in rows]),
    ]
    for row_index, (name, flags) in enumerate(decisions):
        marks = x[np.array(flags, dtype=bool)]
        grid.scatter(marks, np.full(marks.shape, row_index), marker="|", s=60,
                     color="#2166ac", linewidths=1.2)
    grid.set_yticks(range(len(decisions)))
    grid.set_yticklabels([name for name, _ in decisions], fontsize=9)
    grid.set_ylim(-0.6, len(decisions) - 0.4)
    grid.invert_yaxis()
    grid.set_xlabel("specification, sorted by estimate")

    for axis in (curve, grid):
        axis.spines["top"].set_visible(False)
        axis.spines["right"].set_visible(False)

    figure.tight_layout()
    path.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(path, dpi=150)
    plt.close(figure)


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Specification-curve analysis.")
    parser.add_argument("--tables", default=str(REPO_ROOT / "data" / "tables"))
    parser.add_argument("--out", default=str(REPO_ROOT / "data" / "multiverse"))
    parser.add_argument("--no-plot", action="store_true")
    args = parser.parse_args(list(argv) if argv is not None else None)

    try:
        frames = load_tables(Path(args.tables))
    except FileNotFoundError as error:
        print(str(error), file=sys.stderr)
        return 2

    specs = all_specifications()
    print(f"Running {len(specs)} specifications...")
    rows = run(frames, specs)

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    csv_path = out_dir / "specification_curve.csv"
    with csv_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]), lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)

    summary = summarise(rows)
    print()
    print(f"  specifications            {summary['n_specifications']}")
    print(f"  median estimate           {summary['median_estimate']:+.4f}")
    print(f"  range                     {summary['min_estimate']:+.4f} to {summary['max_estimate']:+.4f}")
    print(f"  CI excludes 0, negative   {summary['n_ci_excludes_zero_negative']}"
          f"  (the predicted direction: warmth flattens discrimination)")
    print(f"  CI excludes 0, positive   {summary['n_ci_excludes_zero_positive']}")
    print(f"  CI contains 0             {summary['n_ci_contains_zero']}")
    print(f"\n  -> {csv_path}")

    if not args.no_plot:
        plot_path = out_dir / "specification_curve.png"
        plot_curve(rows, plot_path)
        print(f"  -> {plot_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
