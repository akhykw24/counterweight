#!/usr/bin/env python3
"""Required N for the H3 discrimination contrast.

H3 is a two-group comparison of a within-participant difference score,
`D = WOA(strong) - WOA(weak)`. Its precision depends on how many trials go into
each half of that difference, which is why excluding fillers from the contrast
changes the answer.

    contaminated   8 strong (4 analysed + 4 filler) vs 4 weak
                   Var(D) = sigma^2 (1/8 + 1/4) = 0.375 sigma^2
    corrected      4 strong vs 4 weak
                   Var(D) = sigma^2 (1/4 + 1/4) = 0.500 sigma^2

So the correct design is *less* precise per participant, by a factor of
sqrt(0.5/0.375) = 1.155 on the standard error. That is the price of removing the
base-rate confound, and it is a price rather than a saving: the four fillers were
buying apparent precision with contaminated trials.

Usage
-----
    python pipeline/power.py
    python pipeline/power.py --tables data/tables --effect 0.5
"""

from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd
from scipy import stats

from _common import REPO_ROOT

TRIALS_PER_CELL_CORRECTED = (4, 4)
TRIALS_PER_CELL_CONTAMINATED = (8, 4)


def variance_factor(n_strong: int, n_weak: int) -> float:
    """Var(D) in units of sigma^2, the per-trial WOA variance."""
    return 1 / n_strong + 1 / n_weak


def n_per_group(effect_d: float, power: float = 0.80, alpha: float = 0.05) -> float:
    """Participants per arm for a two-sample t-test, normal approximation."""
    if effect_d <= 0:
        return float("inf")
    z_a = stats.norm.ppf(1 - alpha / 2)
    z_b = stats.norm.ppf(power)
    return 2 * ((z_a + z_b) / effect_d) ** 2


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Power for the H3 discrimination contrast.")
    parser.add_argument("--tables", default=str(REPO_ROOT / "data" / "tables"))
    parser.add_argument("--effect", type=float, default=0.5,
                        help="target standardised difference in discrimination between arms")
    parser.add_argument("--power", type=float, default=0.80)
    args = parser.parse_args(list(argv) if argv is not None else None)

    corrected = variance_factor(*TRIALS_PER_CELL_CORRECTED)
    contaminated = variance_factor(*TRIALS_PER_CELL_CONTAMINATED)
    se_ratio = math.sqrt(corrected / contaminated)

    print("Design precision")
    print(f"  contaminated (8 strong incl. fillers vs 4 weak)  Var(D) = {contaminated:.4f} sigma^2")
    print(f"  corrected    (4 analysed strong vs 4 weak)       Var(D) = {corrected:.4f} sigma^2")
    print(f"  standard error ratio  corrected / contaminated = {se_ratio:.3f}")
    print(f"  participants needed for the same power           x{se_ratio ** 2:.3f}")
    print()

    base = n_per_group(args.effect, args.power)
    print(f"For d = {args.effect} at {args.power:.0%} power, alpha = 0.05:")
    print(f"  per arm, corrected design      {math.ceil(base):4d}   (total {math.ceil(base) * 2})")
    print(f"  per arm, if fillers were kept  {math.ceil(base / se_ratio ** 2):4d}"
          f"   (total {math.ceil(base / se_ratio ** 2) * 2}) -- but on a confounded contrast")
    print()

    tables = Path(args.tables)
    trials_path = tables / "trials.csv"
    if trials_path.exists():
        trials = pd.read_csv(trials_path)
        if "role" in trials.columns:
            print("Observed in the current (synthetic) data:")
            for label, subset in (
                ("analysed only", trials[trials["role"] == "analysed"]),
                ("all trials", trials),
            ):
                usable = subset[(subset["complete"] == 1) & subset["woa_raw"].notna()]
                usable = usable[usable["denominator_rel"] >= 0.05].copy()
                usable["woa"] = usable["woa_raw"].clip(0, 1)
                wide = (
                    usable.groupby(["session_id", "justification_quality"])["woa"]
                    .mean()
                    .unstack()
                )
                if {"strong", "weak"} <= set(wide.columns):
                    d = (wide["strong"] - wide["weak"]).dropna()
                    print(f"  {label:16s} SD(D) = {d.std(ddof=1):.4f}  over {len(d)} participants")
            print()
            print("Synthetic participants carry no item-level variance component, so the")
            print("observed ratio understates the theoretical one. Treat the theory as the")
            print("planning number and re-estimate SD(D) from the pilot.")
    else:
        print(f"({trials_path} not found -- theoretical figures only)")

    print()
    print("Known limitation: there are no pilot data. Every figure above rests on an")
    print("assumed standardised effect, not on an observed SD(D) from this population.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
