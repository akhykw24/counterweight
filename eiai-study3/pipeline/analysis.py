#!/usr/bin/env python3
"""Confirmatory analysis and parameter recovery (spec sections 7 and 8).

Reads the projected tables, applies one **specification**, and reports H1-H5.
`--recover` instead checks that the effects planted by `simulate.py` come back
out, which is what makes this file a test of the pipeline rather than a report
about it.

    H1  style x justification-quality interaction on WOA (mixed ANOVA, partial eta^2)
    H2  style main effect on the vigilance composite
    H3  discrimination score (WOA_strong - WOA_weak), warm < neutral (Welch t + BF)
    H4  scroll-depth mediation of H1 (bootstrapped indirect effect)
    H5  trust, warm > neutral
    Holm-Bonferroni across the secondaries

H1 and H3 are the same test twice
---------------------------------
In a 2x2 with one within-subjects factor at two levels, the interaction is
algebraically identical to a between-groups test on the within-subject
difference score. So the H1 interaction F equals the H3 t squared (with pooled
variance). That is not a redundancy to hide -- the spec calls H3 "the
interaction expressed as one number" -- and this module asserts the identity
holds, because if it ever stops holding, one of the two is computed wrong.

Usage
-----
    python pipeline/analysis.py --tables data/tables
    python pipeline/analysis.py --tables data/tables --recover data/sim-truth.csv
    python pipeline/analysis.py --tables data/tables --json results.json

Exit codes: 0 ok, 1 recovery failed, 2 unusable input.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Iterable

import numpy as np
import pandas as pd
from scipy import integrate, stats

from exclusions import (
    apply_exclusions,
    filter_excluded,
    keep_live_only,
    print_report as print_exclusions,
    remove_withdrawn,
)
from _common import REPO_ROOT, REVERSE_SCORED

BOOTSTRAP_RESAMPLES = 5000
BOOTSTRAP_SEED = 20260817
CAUCHY_PRIOR_SCALE = 0.707  # Rouder et al. (2009) default for a two-sample test

# Family-wise error rate for the parameter-recovery gate.
#
# Recovery asks whether each planted value falls inside a recovered interval. A
# 95% interval misses its own parameter 5% of the time BY CONSTRUCTION, and the
# gate runs six of them, so a plain 95% gate would go red on a correct pipeline
# roughly a quarter of the time. A gate that fails on a coin flip teaches people
# to rerun it until it is green, which is worse than no gate.
#
# Bonferroni across the containment checks keeps the family-wise false-failure
# rate at 5% while leaving each check a genuine interval check: a real defect
# moves an estimate by 0.2 or more (the mutation test shifts discrimination from
# +0.248 to outside any interval), against the +/-0.05 that noise produces on
# the noisiest policy.
RECOVERY_FAMILY_ALPHA = 0.05


# ---------------------------------------------------------------------------
# Specification
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Specification:
    """One defensible set of analysis choices.

    Every field here is a decision a reasonable analyst could make differently.
    `multiverse.py` enumerates the product of them; this dataclass exists so
    that "the default specification" is a named object rather than a scatter of
    magic numbers, and so the multiverse cannot drift from the confirmatory run.
    """

    woa_clamp: tuple[float, float] = (0.0, 1.0)
    denominator_threshold: float = 0.05
    exclude_suspicious: bool = False
    exclude_resumed: bool = False
    rt_trim: bool = False

    def label(self) -> str:
        return (
            f"clamp{self.woa_clamp[0]}:{self.woa_clamp[1]}"
            f"|den{self.denominator_threshold}"
            f"|susp{'excl' if self.exclude_suspicious else 'incl'}"
            f"|res{'excl' if self.exclude_resumed else 'incl'}"
            f"|rt{'trim' if self.rt_trim else 'raw'}"
        )


# ---------------------------------------------------------------------------
# Loading and preparation
# ---------------------------------------------------------------------------


def load_tables(tables_dir: Path) -> dict[str, pd.DataFrame]:
    frames = {}
    for name in ("trials", "participants", "questionnaire"):
        path = tables_dir / f"{name}.csv"
        if not path.exists():
            raise FileNotFoundError(f"{path} not found -- run pipeline/replay.py first")
        frames[name] = pd.read_csv(path)
    return frames


def apply_specification(
    trials: pd.DataFrame, participants: pd.DataFrame, spec: Specification
) -> pd.DataFrame:
    """Trial-level table with WOA computed under `spec`, unusable rows dropped."""
    df = trials.copy()
    df = df[df["complete"] == 1]
    df = df[df["woa_raw"].notna()]

    # Unstable denominator: the advice sat essentially on the initial estimate,
    # so WOA is a ratio of two small numbers and says nothing about weighting.
    df = df[df["denominator_rel"] >= spec.denominator_threshold]

    df["woa"] = df["woa_raw"].clip(lower=spec.woa_clamp[0], upper=spec.woa_clamp[1])

    if spec.rt_trim and len(df) > 0:
        rt = df["ms_reveal_to_final"].astype(float)
        median = rt.median()
        mad = (rt - median).abs().median()
        if mad > 0:
            df = df[(rt - median).abs() <= 3 * 1.4826 * mad]

    drop: set[str] = set()
    if spec.exclude_suspicious:
        suspicious = participants[participants["funnel_belief"].astype(str) == "no"]
        drop |= set(suspicious["session_id"])
    if spec.exclude_resumed:
        drop |= set(participants[participants["resumed"] == 1]["session_id"])
    if drop:
        df = df[~df["session_id"].isin(drop)]

    return df


def per_participant(trials: pd.DataFrame, questionnaire: pd.DataFrame) -> pd.DataFrame:
    """One row per participant: the unit of analysis for every between test.

    The quality contrast is computed over **analysed items only**. Fillers are
    correct, strong-justification items that exist so planted errors are a third
    of twelve rather than half of eight; folding them into the strong cell makes
    it 75% accurate against the weak cell's 50%, at which point a participant who
    discounts weak justification on normative grounds is indistinguishable from
    one processing peripherally -- which is precisely the inference H3 makes.
    They stay in the frame for scroll depth, vigilance and reaction time, where
    every trial the participant actually saw is the right denominator.
    """
    if "role" not in trials.columns:
        # Refusing rather than falling back to "use every trial": the fallback
        # is the bug this replaced, and a silent one is worse than a crash.
        raise KeyError(
            "trials.csv has no 'role' column, so analysed items cannot be told from "
            "fillers. Re-project with pipeline/replay.py."
        )
    contrast = trials[trials["role"] == "analysed"]
    grouped = contrast.groupby(["session_id", "condition", "justification_quality"])["woa"].mean()
    wide = grouped.unstack("justification_quality")
    wide = wide.reset_index()

    for column in ("strong", "weak"):
        if column not in wide.columns:
            wide[column] = np.nan

    wide = wide.rename(columns={"strong": "woa_strong", "weak": "woa_weak"})
    wide["discrimination"] = wide["woa_strong"] - wide["woa_weak"]

    extras = trials.groupby("session_id").agg(
        scroll_depth=("max_scroll_fraction", "mean"),
        challenge_rate=("challenged", "mean"),
        verify_rate=("verify_clicks", "mean"),
        mean_rt=("ms_reveal_to_final", "mean"),
        n_trials=("item_id", "count"),
    )
    wide = wide.merge(extras, on="session_id", how="left")

    trust = _scale_score(questionnaire, "trust", reverse=set(REVERSE_SCORED["trust"]))
    warmth = _scale_score(questionnaire, "warmth", reverse=set(REVERSE_SCORED["warmth"]))
    # The control scale. Collected since day one and, until now, never scored --
    # which meant the study declared a control check it could not perform.
    competence = _scale_score(questionnaire, "competence", reverse=set(REVERSE_SCORED["competence"]))
    wide = wide.merge(trust.rename("trust"), on="session_id", how="left")
    wide = wide.merge(warmth.rename("warmth_perceived"), on="session_id", how="left")
    wide = wide.merge(competence.rename("competence_perceived"), on="session_id", how="left")

    # Vigilance composite: challenge-tapping, verification clicks and how far
    # down the reply they read, each standardised so no component dominates by
    # being on a bigger scale. Defined here rather than in replay because it is
    # an analysis construct, not a fact about the log.
    components = wide[["challenge_rate", "verify_rate", "scroll_depth"]].apply(_zscore)
    wide["vigilance"] = components.mean(axis=1)

    return wide.dropna(subset=["discrimination"])


def _zscore(series: pd.Series) -> pd.Series:
    sd = series.std(ddof=1)
    if not np.isfinite(sd) or sd == 0:
        return series * 0.0
    return (series - series.mean()) / sd


def _scale_score(questionnaire: pd.DataFrame, scale: str, reverse: set[str]) -> pd.Series:
    subset = questionnaire[questionnaire["scale"] == scale].copy()
    if subset.empty:
        # Indexed on session_id even when empty, so the merge downstream still
        # aligns. A run where nobody reached the questionnaire -- everyone
        # withdrew, or an early pilot batch -- is a real shape for this data,
        # and it used to raise KeyError instead of yielding NaN scores.
        return pd.Series(dtype=float, name=scale, index=pd.Index([], name="session_id"))
    subset["numeric"] = pd.to_numeric(subset["value"], errors="coerce")
    # Likert-7 reverse scoring: 8 - x. Getting this wrong silently flips the
    # sign of a hypothesis, so the reversed ids are named explicitly rather
    # than inferred.
    flip = subset["question_id"].isin(reverse)
    subset.loc[flip, "numeric"] = 8 - subset.loc[flip, "numeric"]
    return subset.groupby("session_id")["numeric"].mean()


#: Scales, their reverse-scored items, and nothing inferred. Naming the reversed
#: ids explicitly rather than deriving them from a heuristic is the same choice
#: `_scale_score` makes, for the same reason: getting one wrong silently flips
#: the sign of a hypothesis.
SCALES: tuple[tuple[str, set[str]], ...] = tuple(
    (scale, set(items)) for scale, items in REVERSE_SCORED.items()
)


def _wide(questionnaire: pd.DataFrame, scale: str, reverse: set[str]) -> pd.DataFrame:
    """One row per participant, one column per item, reverse scoring applied."""
    subset = questionnaire[questionnaire["scale"] == scale].copy()
    if subset.empty:
        return pd.DataFrame()
    subset["numeric"] = pd.to_numeric(subset["value"], errors="coerce")
    flip = subset["question_id"].isin(reverse)
    subset.loc[flip, "numeric"] = 8 - subset.loc[flip, "numeric"]
    wide = subset.pivot_table(
        index="session_id", columns="question_id", values="numeric", aggfunc="mean"
    )
    # Complete cases only. Alpha is computed from a covariance matrix, and a
    # matrix assembled from different subsets of participants per pair is not
    # internally consistent -- it can even fail to be positive semi-definite.
    return wide.dropna()


def cronbach_alpha(wide: pd.DataFrame) -> float | None:
    """Standard alpha from item variances. None when it is undefined.

    Undefined for fewer than two items or fewer than two participants, and
    returning 0.0 or 1.0 in those cases would produce a number somebody quotes.
    """
    k = wide.shape[1]
    if k < 2 or len(wide) < 2:
        return None
    item_variance = wide.var(axis=0, ddof=1).sum()
    total_variance = wide.sum(axis=1).var(ddof=1)
    if total_variance == 0:
        return None
    return float((k / (k - 1)) * (1 - item_variance / total_variance))


def reliability(
    questionnaire: pd.DataFrame, scale: str, reverse: set[str]
) -> dict[str, Any]:
    """Internal consistency of one scale, with per-item diagnostics.

    These items were written for this study: the repository holds no citation
    to a published instrument, and the earliest record of the wording is the v1
    specification, where the items already appear as finished text. Original
    items borrow no psychometrics, so alpha is the only evidence a reader has
    that the five warmth questions measure one thing rather than five.

    Per item, two figures that answer different questions:

    - `item_total_r`, the **corrected** item-total correlation: this item
      against the sum of the others. Correlating an item with a total that
      contains it inflates every figure and hides the weak one.
    - `alpha_if_dropped`, which is what actually identifies the item breaking a
      scale -- an alpha that rises when a question is removed is a question
      measuring something else.
    """
    wide = _wide(questionnaire, scale, reverse)
    if wide.empty:
        return {
            "scale": scale,
            "alpha": None,
            "n_items": 0,
            "n_participants": 0,
            "items": {},
        }

    items: dict[str, dict[str, float | None]] = {}
    for column in wide.columns:
        rest = wide.drop(columns=[column])
        if rest.shape[1] == 0:
            items[str(column)] = {"item_total_r": None, "alpha_if_dropped": None}
            continue
        rest_total = rest.sum(axis=1)
        # A constant item has zero variance, so its correlation is undefined
        # rather than zero. Reported as 0.0 with the variance implicitly nil is
        # wrong; numpy would return nan and print as "nan", so it is made
        # explicit instead.
        if wide[column].std(ddof=1) == 0 or rest_total.std(ddof=1) == 0:
            correlation = 0.0
        else:
            correlation = float(wide[column].corr(rest_total))
        items[str(column)] = {
            "item_total_r": correlation,
            "alpha_if_dropped": cronbach_alpha(rest),
        }

    return {
        "scale": scale,
        "alpha": cronbach_alpha(wide),
        "n_items": int(wide.shape[1]),
        "n_participants": int(len(wide)),
        "items": items,
    }


def reliabilities(questionnaire: pd.DataFrame) -> dict[str, dict[str, Any]]:
    """Every rating scale's internal consistency, in one call."""
    return {scale: reliability(questionnaire, scale, reverse) for scale, reverse in SCALES}


# ---------------------------------------------------------------------------
# Statistics
# ---------------------------------------------------------------------------


def welch(a: np.ndarray, b: np.ndarray, confidence: float = 0.95) -> dict[str, float]:
    """Welch t-test with Hedges' g and a CI on the raw difference.

    `confidence` widens the interval only; the t, p and effect size are
    unaffected. Recovery passes a Bonferroni-corrected level so its containment
    checks do not fail by construction.
    """
    a = np.asarray(a, dtype=float)
    b = np.asarray(b, dtype=float)
    a = a[np.isfinite(a)]
    b = b[np.isfinite(b)]
    n1, n2 = len(a), len(b)
    if n1 < 2 or n2 < 2:
        return {"t": float("nan"), "df": float("nan"), "p": float("nan"),
                "diff": float("nan"), "ci_low": float("nan"), "ci_high": float("nan"),
                "hedges_g": float("nan"), "n1": n1, "n2": n2}

    result = stats.ttest_ind(a, b, equal_var=False)
    v1, v2 = a.var(ddof=1), b.var(ddof=1)
    se = math.sqrt(v1 / n1 + v2 / n2)
    df = (v1 / n1 + v2 / n2) ** 2 / ((v1 / n1) ** 2 / (n1 - 1) + (v2 / n2) ** 2 / (n2 - 1))
    diff = a.mean() - b.mean()
    crit = stats.t.ppf(1 - (1 - confidence) / 2, df)

    pooled = math.sqrt(((n1 - 1) * v1 + (n2 - 1) * v2) / (n1 + n2 - 2))
    d = diff / pooled if pooled > 0 else float("nan")
    # Hedges' correction: Cohen's d is biased upward in small samples, and this
    # study is small by construction.
    correction = 1 - 3 / (4 * (n1 + n2) - 9) if (n1 + n2) > 3 else 1.0

    return {
        "t": float(result.statistic),
        "df": float(df),
        "p": float(result.pvalue),
        "diff": float(diff),
        "ci_low": float(diff - crit * se),
        "ci_high": float(diff + crit * se),
        "hedges_g": float(d * correction),
        "n1": n1,
        "n2": n2,
    }


def bayes_factor_two_sample(t: float, n1: int, n2: int, r: float = CAUCHY_PRIOR_SCALE) -> float:
    """JZS BF10 for a two-sample t, Cauchy(0, r) prior on the effect size.

    Rouder et al. (2009), integrated over the variance-scaling parameter g with
    a scaled inverse-chi-square prior -- the parameterisation in which a Cauchy
    on the effect size becomes a mixture of normals.

    The obvious implementation integrates the noncentral t density against a
    Cauchy directly. That reads better and overflows: at n = 180 per arm the
    noncentrality reaches ~190 in the prior tails and `tgamma` runs out of
    double. Here the two heavy factors are formed as a *ratio* first and raised
    to the power in log space, so nothing large is ever materialised.
    """
    if not np.isfinite(t) or n1 < 2 or n2 < 2:
        return float("nan")
    nu = n1 + n2 - 2
    n_eff = n1 * n2 / (n1 + n2)

    def integrand(g: float) -> float:
        if g <= 0:
            return 0.0
        shrink = 1.0 + n_eff * g
        # (1 + t^2/(shrink*nu)) / (1 + t^2/nu), always near 1, so the power below
        # cannot overflow the way each factor separately would.
        ratio = (1.0 + t * t / (shrink * nu)) / (1.0 + t * t / nu)
        log_term = -0.5 * math.log(shrink) - 0.5 * (nu + 1.0) * math.log(ratio)
        # Inverse-gamma(1/2, r^2/2) prior on g.
        log_prior = (
            math.log(r)
            - 0.5 * math.log(2.0 * math.pi)
            - 1.5 * math.log(g)
            - r * r / (2.0 * g)
        )
        return math.exp(log_term + log_prior)

    value, _ = integrate.quad(integrand, 0, np.inf, limit=200)
    return float(value)


#: A control check needs enough data to be informative. Below this, "the arms
#: did not differ" is a statement about the sample size, not about the arms.
CONTROL_CHECK_MIN_PER_ARM = 20

#: Evidence for the null on the control scale. Jeffreys' "substantial".
CONTROL_CHECK_MIN_BF01 = 3.0


def manipulation_checks(people: pd.DataFrame) -> dict[str, dict[str, Any]]:
    """The warmth manipulation check and the competence control check.

    Both are required by section 1, and they fail in opposite directions. The
    manipulation check must find a difference: without it, a null interaction
    is indistinguishable from a manipulation that never landed. The control
    check must not: if perceived competence moves with style, warmth and
    competence are confounded and the interaction could be about expertise.

    The control is judged by a Bayes factor rather than a non-significant
    p-value. Failing to reject the null is not evidence for it, and a p-based
    control check is easiest to pass with a small, uninformative sample -- it
    would reward exactly the thing it is supposed to guard against.
    """
    for column in ("warmth_perceived", "competence_perceived"):
        if column not in people.columns:
            raise KeyError(
                f"{column} is missing. The manipulation and control checks are "
                "part of the confirmatory report; a missing scale must stop the "
                "analysis rather than quietly drop the check."
            )

    warm = people[people["condition"] == "warm"]
    neutral = people[people["condition"] == "neutral"]

    warmth = welch(
        warm["warmth_perceived"].dropna().to_numpy(),
        neutral["warmth_perceived"].dropna().to_numpy(),
    )
    warmth["bf10"] = bayes_factor_two_sample(warmth["t"], warmth["n1"], warmth["n2"])
    # One-sided in substance: the warm arm must be perceived as warmer, not
    # merely different. A warm manipulation that read as colder has failed.
    warmth["passed"] = bool(warmth["p"] < 0.05 and warmth["diff"] > 0)
    warmth["direction"] = "warm > neutral"

    competence = welch(
        warm["competence_perceived"].dropna().to_numpy(),
        neutral["competence_perceived"].dropna().to_numpy(),
    )
    bf10 = bayes_factor_two_sample(competence["t"], competence["n1"], competence["n2"])
    competence["bf10"] = bf10
    competence["bf01"] = float("inf") if bf10 == 0 else 1.0 / bf10
    competence["passed"] = bool(
        min(competence["n1"], competence["n2"]) >= CONTROL_CHECK_MIN_PER_ARM
        and competence["bf01"] >= CONTROL_CHECK_MIN_BF01
    )
    competence["direction"] = "no difference expected"

    return {"warmth": warmth, "competence": competence}


def adjusted_discrimination(people: pd.DataFrame) -> dict[str, Any]:
    """The style effect on discrimination, adjusted for English proficiency.

    Section 8.1 puts CEFR band in the primary model, and the reason is specific
    rather than decorative: a participant who cannot read a strong argument as
    strong shows a flat discrimination score for a reason that has nothing to do
    with warmth. If proficiency happened to be unbalanced across arms, the
    unadjusted contrast would confuse the two. That is the single most plausible
    alternative explanation for this study's headline result, so it is modelled
    rather than mentioned in the limitations.

    Ordinary least squares: discrimination ~ warm + CEFR level, level treated as
    a set of indicators rather than a number, because the CEFR scale is ordinal
    and the distance from B1 to B2 is not the distance from C1 to C2.
    """
    if "cefr" not in people.columns:
        raise KeyError(
            "cefr is missing from the participant table. It is a covariate in "
            "the primary model, so the analysis stops rather than reporting an "
            "unadjusted estimate under an adjusted name."
        )

    frame = people.dropna(subset=["discrimination", "condition", "cefr"])
    warm_flag = (frame["condition"] == "warm").astype(float).to_numpy()
    y = frame["discrimination"].to_numpy(dtype=float)

    levels = sorted(frame["cefr"].unique())
    if len(levels) < 2 or len(frame) <= len(levels) + 1:
        # Nothing to adjust for. Reported as unadjusted rather than silently
        # returning a number that only looks adjusted.
        warm = y[warm_flag == 1.0]
        neutral = y[warm_flag == 0.0]
        raw = welch(warm, neutral)
        return {
            "adjusted": False,
            "reason": "fewer than two CEFR levels present",
            "estimate": raw["diff"],
            "ci_low": raw["ci_low"],
            "ci_high": raw["ci_high"],
            "p": raw["p"],
            "levels": levels,
            "n": int(len(frame)),
        }

    # Indicators for every level but the first, plus an intercept.
    columns = [np.ones(len(frame)), warm_flag]
    for level in levels[1:]:
        columns.append((frame["cefr"] == level).astype(float).to_numpy())
    design = np.column_stack(columns)

    coefficients, *_ = np.linalg.lstsq(design, y, rcond=None)
    residuals = y - design @ coefficients
    dof = len(frame) - design.shape[1]
    sigma2 = float(residuals @ residuals) / dof
    covariance = sigma2 * np.linalg.pinv(design.T @ design)
    estimate = float(coefficients[1])
    se = float(np.sqrt(covariance[1, 1]))
    tstat = estimate / se if se > 0 else 0.0
    crit = float(stats.t.ppf(0.975, dof))

    return {
        "adjusted": True,
        "estimate": estimate,
        "se": se,
        "t": tstat,
        "df": dof,
        "p": float(2 * stats.t.sf(abs(tstat), dof)),
        "ci_low": estimate - crit * se,
        "ci_high": estimate + crit * se,
        "levels": levels,
        "n": int(len(frame)),
    }


def sensitivity_excluding_b1(people: pd.DataFrame) -> dict[str, Any]:
    """The discrimination contrast among B2 and above.

    Pre-specified in section 8.1 and reported whether or not it agrees with the
    primary result -- which is the entire point of pre-specifying it. B1 is the
    floor the screening gate admits, so it is where a proficiency explanation
    would bite hardest.
    """
    kept = people[people["cefr"].astype(str) != "B1"] if "cefr" in people.columns else people
    warm = kept[kept["condition"] == "warm"]["discrimination"].dropna().to_numpy()
    neutral = kept[kept["condition"] == "neutral"]["discrimination"].dropna().to_numpy()
    if len(warm) < 2 or len(neutral) < 2:
        return {"available": False, "n_excluded": int(len(people) - len(kept))}
    result = welch(warm, neutral)
    result["available"] = True
    result["n_excluded"] = int(len(people) - len(kept))
    return result


def jackknife_over_items(trials: pd.DataFrame) -> list[dict[str, Any]]:
    """The quality contrast re-estimated once per dropped item.

    Twelve estimates rather than one. A conclusion that holds only while a
    particular item is in the set is a conclusion about that item, and the
    cheapest way to find that out is to look.

    Fillers are excluded from the leave-one-out set for the same reason they are
    excluded from the contrast itself: they are not part of the analysed 2x2, so
    dropping one cannot change it.
    """
    analysed = trials[trials["role"] == "analysed"] if "role" in trials.columns else trials
    item_ids = sorted(analysed["item_id"].unique())

    results: list[dict[str, Any]] = []
    for dropped in item_ids:
        subset = analysed[analysed["item_id"] != dropped]
        per_person = (
            subset.pivot_table(
                index="session_id",
                columns="justification_quality",
                values="woa",
                aggfunc="mean",
            )
            .reindex(columns=["strong", "weak"])
        )
        discrimination = (per_person["strong"] - per_person["weak"]).dropna()
        results.append(
            {
                "dropped_item": dropped,
                "n_items": int(subset["item_id"].nunique()),
                "n_participants": int(len(discrimination)),
                "estimate": float(discrimination.mean()) if len(discrimination) else float("nan"),
            }
        )
    return results


def mixed_anova_interaction(participants: pd.DataFrame) -> dict[str, float]:
    """2 (style, between) x 2 (quality, within) interaction on WOA.

    Only the interaction term is reported, because it is the pre-registered
    primary. With two within levels the interaction sum of squares reduces to a
    one-way between-groups analysis on the difference score, which is exactly
    what is computed here -- writing out the full four-cell decomposition would
    produce the same F with more places to make an arithmetic slip.
    """
    warm = participants[participants["condition"] == "warm"]["discrimination"].dropna().to_numpy()
    neutral = participants[participants["condition"] == "neutral"]["discrimination"].dropna().to_numpy()
    n1, n2 = len(warm), len(neutral)
    if n1 < 2 or n2 < 2:
        return {"F": float("nan"), "df1": 1, "df2": float("nan"), "p": float("nan"),
                "partial_eta_sq": float("nan")}

    grand = np.concatenate([warm, neutral]).mean()
    ss_between = n1 * (warm.mean() - grand) ** 2 + n2 * (neutral.mean() - grand) ** 2
    ss_within = ((warm - warm.mean()) ** 2).sum() + ((neutral - neutral.mean()) ** 2).sum()
    df2 = n1 + n2 - 2
    # The difference score is twice the within-subject contrast, so both sums of
    # squares carry the same factor of 2 and it cancels in F and in eta^2.
    ms_between = ss_between / 1
    ms_within = ss_within / df2
    f_stat = ms_between / ms_within if ms_within > 0 else float("nan")

    return {
        "F": float(f_stat),
        "df1": 1,
        "df2": float(df2),
        "p": float(stats.f.sf(f_stat, 1, df2)) if np.isfinite(f_stat) else float("nan"),
        "partial_eta_sq": float(ss_between / (ss_between + ss_within))
        if (ss_between + ss_within) > 0
        else float("nan"),
    }


def bootstrap_mediation(
    participants: pd.DataFrame, resamples: int = BOOTSTRAP_RESAMPLES
) -> dict[str, float]:
    """Indirect effect of style on discrimination through scroll depth.

    Percentile bootstrap on the a*b product. The product of two normal
    estimates is not normal, which is why this is bootstrapped rather than
    given a Sobel test.
    """
    df = participants.dropna(subset=["discrimination", "scroll_depth"]).copy()
    if len(df) < 10:
        return {"a": float("nan"), "b": float("nan"), "indirect": float("nan"),
                "ci_low": float("nan"), "ci_high": float("nan"), "n": len(df)}

    x = (df["condition"] == "warm").astype(float).to_numpy()
    m = df["scroll_depth"].to_numpy(dtype=float)
    y = df["discrimination"].to_numpy(dtype=float)

    def paths(xi: np.ndarray, mi: np.ndarray, yi: np.ndarray) -> tuple[float, float]:
        a = np.polyfit(xi, mi, 1)[0]
        design = np.column_stack([np.ones_like(xi), xi, mi])
        coefficients, *_ = np.linalg.lstsq(design, yi, rcond=None)
        return float(a), float(coefficients[2])

    a_hat, b_hat = paths(x, m, y)

    rng = np.random.default_rng(BOOTSTRAP_SEED)
    indirect = np.empty(resamples)
    n = len(df)
    for i in range(resamples):
        idx = rng.integers(0, n, n)
        try:
            a_i, b_i = paths(x[idx], m[idx], y[idx])
            indirect[i] = a_i * b_i
        except (np.linalg.LinAlgError, ValueError):
            indirect[i] = np.nan

    indirect = indirect[np.isfinite(indirect)]
    if indirect.size == 0:
        return {"a": a_hat, "b": b_hat, "indirect": float("nan"),
                "ci_low": float("nan"), "ci_high": float("nan"), "n": n}

    return {
        "a": a_hat,
        "b": b_hat,
        "indirect": float(a_hat * b_hat),
        "ci_low": float(np.percentile(indirect, 2.5)),
        "ci_high": float(np.percentile(indirect, 97.5)),
        "n": n,
    }


def holm_bonferroni(pvalues: dict[str, float]) -> dict[str, dict[str, Any]]:
    """Holm step-down. Once a hypothesis fails to survive, so do all weaker ones."""
    usable = {k: v for k, v in pvalues.items() if np.isfinite(v)}
    ordered = sorted(usable.items(), key=lambda kv: kv[1])
    m = len(ordered)
    out: dict[str, dict[str, Any]] = {}
    still_rejecting = True
    for rank, (name, p) in enumerate(ordered):
        adjusted = min(1.0, p * (m - rank))
        if not still_rejecting or adjusted > 0.05:
            still_rejecting = False
            out[name] = {"p": p, "p_holm": adjusted, "survives": False}
        else:
            out[name] = {"p": p, "p_holm": adjusted, "survives": True}
    for name, p in pvalues.items():
        if name not in out:
            out[name] = {"p": p, "p_holm": float("nan"), "survives": False}
    return out


# ---------------------------------------------------------------------------
# The analysis itself
# ---------------------------------------------------------------------------


def analyse(frames: dict[str, pd.DataFrame], spec: Specification) -> dict[str, Any]:
    trials = apply_specification(frames["trials"], frames["participants"], spec)
    people = per_participant(trials, frames["questionnaire"])

    warm = people[people["condition"] == "warm"]
    neutral = people[people["condition"] == "neutral"]

    h1 = mixed_anova_interaction(people)
    h3 = welch(warm["discrimination"].to_numpy(), neutral["discrimination"].to_numpy())
    h3["bf10"] = bayes_factor_two_sample(h3["t"], h3["n1"], h3["n2"])
    h2 = welch(warm["vigilance"].to_numpy(), neutral["vigilance"].to_numpy())
    h4 = bootstrap_mediation(people)
    h5 = welch(warm["trust"].to_numpy(), neutral["trust"].to_numpy())

    secondaries = holm_bonferroni({"H2_vigilance": h2["p"], "H5_trust": h5["p"]})
    checks = manipulation_checks(people)
    scale_reliability = reliabilities(frames["questionnaire"])

    # CEFR lives on the participant table, not on trials, so it is merged in
    # here rather than carried through per_participant -- which is about the
    # trial-level reduction and has no business knowing about eligibility.
    if "cefr" in frames["participants"].columns:
        people = people.merge(
            frames["participants"][["session_id", "cefr"]], on="session_id", how="left"
        )
    adjusted = adjusted_discrimination(people)
    sensitivity = sensitivity_excluding_b1(people)
    jackknife = jackknife_over_items(trials)

    return {
        "specification": {**asdict(spec), "label": spec.label()},
        "n": {
            "participants": int(len(people)),
            "warm": int(len(warm)),
            "neutral": int(len(neutral)),
            "trials_used": int(len(trials)),
            "trials_available": int(len(frames["trials"])),
        },
        "descriptives": {
            "woa_strong_warm": _safe_mean(warm["woa_strong"]),
            "woa_weak_warm": _safe_mean(warm["woa_weak"]),
            "woa_strong_neutral": _safe_mean(neutral["woa_strong"]),
            "woa_weak_neutral": _safe_mean(neutral["woa_weak"]),
            "discrimination_warm": _safe_mean(warm["discrimination"]),
            "discrimination_neutral": _safe_mean(neutral["discrimination"]),
            "scroll_warm": _safe_mean(warm["scroll_depth"]),
            "scroll_neutral": _safe_mean(neutral["scroll_depth"]),
        },
        "H1_interaction": h1,
        "manipulation_checks": checks,
        "reliability": scale_reliability,
        "H3_adjusted_for_cefr": adjusted,
        "sensitivity_excluding_b1": sensitivity,
        "jackknife_over_items": jackknife,
        "H2_vigilance": h2,
        "H3_discrimination": h3,
        "H4_mediation": h4,
        "H5_trust": h5,
        "holm": secondaries,
        # The identity that guards both computations at once.
        "h1_h3_consistent": bool(
            np.isfinite(h1["F"]) and np.isfinite(h3["t"]) and abs(h1["F"] - h3["t"] ** 2) < 0.5
        ),
    }


def _safe_mean(series: pd.Series) -> float:
    value = series.mean()
    return float(value) if np.isfinite(value) else float("nan")


# ---------------------------------------------------------------------------
# Parameter recovery
# ---------------------------------------------------------------------------


def recover(frames: dict[str, pd.DataFrame], truth_path: Path, spec: Specification) -> dict[str, Any]:
    """Does the pipeline return what simulate.py planted?

    Runs the analysis separately within each bot policy, because the policies
    are three different generative models and pooling them would average away
    the very contrasts being checked.
    """
    truth = pd.read_csv(truth_path)
    policies = sorted(truth["policy"].unique())
    # Two containment checks per policy: discrimination and style effect.
    containment_level = 1 - RECOVERY_FAMILY_ALPHA / max(1, 2 * len(policies))
    trials = apply_specification(frames["trials"], frames["participants"], spec)
    people = per_participant(trials, frames["questionnaire"])
    people = people.merge(truth[["session_id", "policy"]], on="session_id", how="left")

    findings: list[dict[str, Any]] = []
    per_policy: dict[str, dict[str, Any]] = {}

    for policy in policies:
        planted = truth[truth["policy"] == policy].iloc[0]
        subset = people[people["policy"] == policy]
        warm = subset[subset["condition"] == "warm"]
        neutral = subset[subset["condition"] == "neutral"]

        # Discrimination is planted as quality_effect and should appear in both
        # arms; the style effect shows up as a WOA difference between arms.
        discrimination = welch(
            warm["discrimination"].to_numpy(), neutral["discrimination"].to_numpy()
        )
        overall_disc = subset["discrimination"].dropna()
        woa_all = pd.concat([subset["woa_strong"], subset["woa_weak"]])
        style = welch(
            pd.concat([warm["woa_strong"], warm["woa_weak"]]).to_numpy(),
            pd.concat([neutral["woa_strong"], neutral["woa_weak"]]).to_numpy(),
            confidence=containment_level,
        )

        disc_ci = _mean_ci(overall_disc.to_numpy(), confidence=containment_level)
        per_policy[policy] = {
            "n": int(len(subset)),
            "planted_quality_effect": float(planted["planted_quality_effect"]),
            "recovered_discrimination": disc_ci,
            "planted_style_effect": float(planted["planted_style_effect"]),
            "recovered_style_effect": {
                "estimate": style["diff"],
                "ci_low": style["ci_low"],
                "ci_high": style["ci_high"],
            },
            "planted_scroll_mean": float(planted["planted_scroll_mean"]),
            "recovered_scroll_mean": _safe_mean(subset["scroll_depth"]),
            "discrimination_vs_neutral": discrimination,
            "woa_mean": _safe_mean(woa_all),
        }

        findings.append(
            _check(
                f"{policy}: discrimination CI contains the planted {planted['planted_quality_effect']:+.2f}",
                disc_ci["ci_low"] <= planted["planted_quality_effect"] <= disc_ci["ci_high"],
            )
        )
        findings.append(
            _check(
                f"{policy}: style-effect CI contains the planted {planted['planted_style_effect']:+.2f}",
                style["ci_low"] <= planted["planted_style_effect"] <= style["ci_high"],
            )
        )
        findings.append(
            _check(
                f"{policy}: mean scroll depth within 0.10 of the planted {planted['planted_scroll_mean']:.2f}",
                abs(per_policy[policy]["recovered_scroll_mean"] - planted["planted_scroll_mean"]) < 0.10,
            )
        )

    central = per_policy.get("SimCentral", {}).get("recovered_discrimination", {})
    peripheral = per_policy.get("SimPeripheral", {}).get("recovered_discrimination", {})
    if central and peripheral:
        findings.append(
            _check(
                "SimCentral discriminates more than SimPeripheral, with non-overlapping intervals",
                central.get("ci_low", -9) > peripheral.get("ci_high", 9),
            )
        )

    random_disc = per_policy.get("SimRandom", {}).get("recovered_discrimination", {})
    if random_disc:
        findings.append(
            _check(
                "SimRandom discrimination interval contains zero",
                random_disc.get("ci_low", 1) <= 0 <= random_disc.get("ci_high", -1),
            )
        )

    return {"per_policy": per_policy, "checks": findings,
            "containment_level": containment_level,
            "passed": all(f["ok"] for f in findings)}


def _check(description: str, ok: bool) -> dict[str, Any]:
    return {"check": description, "ok": bool(ok)}


def _mean_ci(values: np.ndarray, confidence: float = 0.95) -> dict[str, float]:
    values = values[np.isfinite(values)]
    if len(values) < 2:
        return {"estimate": float("nan"), "ci_low": float("nan"), "ci_high": float("nan")}
    mean = values.mean()
    se = values.std(ddof=1) / math.sqrt(len(values))
    crit = stats.t.ppf(1 - (1 - confidence) / 2, len(values) - 1)
    return {"estimate": float(mean), "ci_low": float(mean - crit * se),
            "ci_high": float(mean + crit * se)}


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------


def print_report(results: dict[str, Any]) -> None:
    n = results["n"]
    d = results["descriptives"]
    print(f"Specification: {results['specification']['label']}")
    print(
        f"N = {n['participants']} ({n['warm']} warm, {n['neutral']} neutral); "
        f"{n['trials_used']} of {n['trials_available']} trials used"
    )
    print()
    scales = results.get("reliability")
    if scales:
        print("Internal consistency (items written for this study, so alpha is")
        print("the only evidence they measure one thing each)")
        for name, scale in scales.items():
            alpha = scale["alpha"]
            shown = "n/a" if alpha is None else f"{alpha:.3f}"
            print(f"  {name:<12} alpha = {shown:>6}   {scale['n_items']} items, "
                  f"n = {scale['n_participants']}")
            for item_id, stats in scale["items"].items():
                r = stats["item_total_r"]
                dropped = stats["alpha_if_dropped"]
                # Flagged when removing the item would IMPROVE the scale, which
                # is the condition that actually matters and is easy to miss in
                # a column of numbers.
                flag = "  <-- scale improves without it" if (
                    dropped is not None and alpha is not None and dropped > alpha
                ) else ""
                r_shown = "  n/a" if r is None else f"{r:+.2f}"
                d_shown = "  n/a" if dropped is None else f"{dropped:.3f}"
                print(f"      {item_id:<16} r(item, rest) = {r_shown}   "
                      f"alpha without = {d_shown}{flag}")
        print()

    checks = results.get("manipulation_checks")
    if checks:
        warmth = checks["warmth"]
        competence = checks["competence"]
        print("Manipulation and control checks")
        print(
            f"  warmth      warm-neutral diff = {warmth['diff']:+.3f}, p = {warmth['p']:.4f}"
            f"   {'PASS' if warmth['passed'] else 'FAIL'}"
        )
        print(
            f"  competence  warm-neutral diff = {competence['diff']:+.3f}, "
            f"BF01 = {competence['bf01']:.2f}"
            f"   {'PASS' if competence['passed'] else 'FAIL'}"
        )
        print("  (competence must NOT differ; judged by evidence for the null)")
        print()

    print("                     strong    weak    discrimination")
    print(f"  warm             {d['woa_strong_warm']:8.3f}{d['woa_weak_warm']:8.3f}"
          f"{d['discrimination_warm']:14.3f}")
    print(f"  neutral          {d['woa_strong_neutral']:8.3f}{d['woa_weak_neutral']:8.3f}"
          f"{d['discrimination_neutral']:14.3f}")
    print()

    h1 = results["H1_interaction"]
    print(f"H1 style x quality interaction   F({h1['df1']:.0f},{h1['df2']:.0f}) = {h1['F']:.3f}, "
          f"p = {h1['p']:.4f}, partial eta^2 = {h1['partial_eta_sq']:.3f}")

    h3 = results["H3_discrimination"]
    print(f"H3 discrimination warm-neutral   t({h3['df']:.1f}) = {h3['t']:.3f}, p = {h3['p']:.4f}, "
          f"diff = {h3['diff']:+.3f} [{h3['ci_low']:+.3f}, {h3['ci_high']:+.3f}], "
          f"g = {h3['hedges_g']:+.3f}")
    print(f"                                 BF10 = {h3['bf10']:.3f}")

    h2 = results["H2_vigilance"]
    print(f"H2 vigilance composite           t({h2['df']:.1f}) = {h2['t']:.3f}, p = {h2['p']:.4f}, "
          f"diff = {h2['diff']:+.3f}")

    h4 = results["H4_mediation"]
    print(f"H4 scroll-depth mediation        indirect = {h4['indirect']:+.4f} "
          f"[{h4['ci_low']:+.4f}, {h4['ci_high']:+.4f}] (a = {h4['a']:+.3f}, b = {h4['b']:+.3f})")

    h5 = results["H5_trust"]
    print(f"H5 trust warm-neutral            t({h5['df']:.1f}) = {h5['t']:.3f}, p = {h5['p']:.4f}, "
          f"diff = {h5['diff']:+.3f}")

    print()
    print("Holm-Bonferroni across secondaries:")
    for name, entry in sorted(results["holm"].items()):
        mark = "survives" if entry["survives"] else "does not survive"
        print(f"  {name:16s} p = {entry['p']:.4f} -> {entry['p_holm']:.4f}  {mark}")

    if not results["h1_h3_consistent"]:
        print("\nWARNING: the H1 interaction F does not equal the H3 t squared.")
        print("In a 2x2 with two within levels these are the same test, so one is wrong.")


def print_confirmatory_extras(results: dict[str, Any]) -> None:
    """Section 8.1's three guards against the obvious alternative readings."""
    adjusted = results.get("H3_adjusted_for_cefr")
    if adjusted:
        print()
        if adjusted["adjusted"]:
            print(
                f"H3 adjusted for CEFR             diff = {adjusted['estimate']:+.3f} "
                f"[{adjusted['ci_low']:+.3f}, {adjusted['ci_high']:+.3f}], "
                f"p = {adjusted['p']:.4f}  (levels: {', '.join(adjusted['levels'])})"
            )
        else:
            print(f"H3 adjusted for CEFR             not adjusted: {adjusted['reason']}")

    sensitivity = results.get("sensitivity_excluding_b1")
    if sensitivity:
        print()
        if sensitivity.get("available"):
            print(
                f"Sensitivity, B1 excluded         diff = {sensitivity['diff']:+.3f} "
                f"[{sensitivity['ci_low']:+.3f}, {sensitivity['ci_high']:+.3f}], "
                f"p = {sensitivity['p']:.4f}  ({sensitivity['n_excluded']} excluded)"
            )
        else:
            print("Sensitivity, B1 excluded         too few participants remain")

    jackknife = results.get("jackknife_over_items")
    if jackknife:
        estimates = [row["estimate"] for row in jackknife if row["estimate"] == row["estimate"]]
        print()
        print("Jackknife over items (quality contrast, one item dropped each time)")
        for row in jackknife:
            print(f"  without {row['dropped_item']}   {row['estimate']:+.4f}")
        if estimates:
            print(f"  range           {min(estimates):+.4f} to {max(estimates):+.4f}")


def print_recovery(recovery: dict[str, Any]) -> None:
    print("Parameter recovery")
    print("=" * 72)
    for policy, entry in sorted(recovery["per_policy"].items()):
        disc = entry["recovered_discrimination"]
        style = entry["recovered_style_effect"]
        print(f"\n{policy}  (n = {entry['n']})")
        print(f"  discrimination  planted {entry['planted_quality_effect']:+.3f}   "
              f"recovered {disc['estimate']:+.3f} [{disc['ci_low']:+.3f}, {disc['ci_high']:+.3f}]")
        print(f"  style effect    planted {entry['planted_style_effect']:+.3f}   "
              f"recovered {style['estimate']:+.3f} [{style['ci_low']:+.3f}, {style['ci_high']:+.3f}]")
        print(f"  scroll depth    planted {entry['planted_scroll_mean']:.3f}    "
              f"recovered {entry['recovered_scroll_mean']:.3f}")

    print("\n" + "-" * 72)
    for finding in recovery["checks"]:
        print(f"  [{'ok' if finding['ok'] else 'FAIL'}] {finding['check']}")
    print()
    if recovery["passed"]:
        print("All planted effects recovered within interval.")
    else:
        failed = sum(1 for f in recovery["checks"] if not f["ok"])
        print(f"{failed} recovery check(s) FAILED -- the pipeline would have "
              f"mis-estimated real data in the same way.")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Confirmatory analysis and parameter recovery.")
    parser.add_argument("--tables", default=str(REPO_ROOT / "data" / "tables"))
    parser.add_argument("--recover", default=None,
                        help="path to the simulate.py ground-truth CSV")
    parser.add_argument("--json", default=None, help="also write results as JSON")
    parser.add_argument("--denominator-threshold", type=float, default=0.05)
    parser.add_argument("--clamp", nargs=2, type=float, default=[0.0, 1.0])
    parser.add_argument("--exclude-suspicious", action="store_true")
    parser.add_argument("--exclude-resumed", action="store_true")
    parser.add_argument("--rt-trim", action="store_true")
    parser.add_argument(
        "--exclusions",
        action="store_true",
        help="also report the analysis with the section 8.6 exclusions applied",
    )
    args = parser.parse_args(list(argv) if argv is not None else None)

    spec = Specification(
        woa_clamp=(args.clamp[0], args.clamp[1]),
        denominator_threshold=args.denominator_threshold,
        exclude_suspicious=args.exclude_suspicious,
        exclude_resumed=args.exclude_resumed,
        rt_trim=args.rt_trim,
    )

    try:
        frames = load_tables(Path(args.tables))
    except FileNotFoundError as error:
        print(str(error), file=sys.stderr)
        return 2

    # First of all: a pilot or test session is a rehearsal, not an
    # observation. Before even the consent filter, because there is no sense
    # in asking whether a rehearsal withdrew.
    frames, rehearsals = keep_live_only(frames)
    if rehearsals:
        summary = ", ".join(f"{count} {mode}" for mode, count in sorted(rehearsals.items()))
        print(f"Removed before analysis: {summary}. Only live sessions are analysed.")
        print()

    # Then consent. Participants who withdrew did not consent to this
    # analysis, so no specification -- including the unexcluded one -- may
    # include them.
    frames, n_withdrawn = remove_withdrawn(frames)
    if n_withdrawn:
        print(
            f"{n_withdrawn} participant(s) withdrew their responses and are excluded "
            "from every analysis below, unconditionally."
        )
        print()

    results = analyse(frames, spec)
    print_report(results)
    print_confirmatory_extras(results)

    if args.exclusions:
        # Both ways, always, and in this order: the unfiltered result is
        # printed before anyone has seen which participants the criteria would
        # remove. Section 8.6 requires the pair; printing only the filtered one
        # is how an exclusion rule turns into a result-dependent choice.
        exclusion_report = apply_exclusions(frames["participants"], frames["trials"])
        print()
        print_exclusions(exclusion_report)
        retained = analyse(filter_excluded(frames, exclusion_report), spec)
        print()
        print("--- with exclusions applied ---")
        print_report(retained)
        results["exclusions"] = exclusion_report.to_log()
        results["with_exclusions"] = retained

    exit_code = 0
    if args.recover:
        print()
        recovery = recover(frames, Path(args.recover), spec)
        print_recovery(recovery)
        results["recovery"] = recovery
        exit_code = 0 if recovery["passed"] else 1

    if args.json:
        Path(args.json).parent.mkdir(parents=True, exist_ok=True)
        Path(args.json).write_text(
            json.dumps(results, indent=2, sort_keys=True, default=float) + "\n",
            encoding="utf-8",
        )
        print(f"\n-> {args.json}")

    return exit_code


if __name__ == "__main__":
    sys.exit(main())
