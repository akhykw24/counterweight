#!/usr/bin/env python3
"""Synthetic participants with known ground truth (spec section 7).

Three bot policies write real event logs. `analysis.py` then has to recover the
effects planted here. If it cannot, the pipeline has a bug that would otherwise
have silently poisoned two months of real data -- and finding it on bots costs
an evening.

    SimCentral      reads the justification (long dwell, full scroll) and moves
                    toward the advice in proportion to justification quality
                    -> positive discrimination, no style effect
    SimPeripheral   skims (short dwell, partial scroll) and moves toward the
                    advice uniformly, more so when the style is warm
                    -> flat discrimination, style main effect
    SimRandom       noise -> null everything

The planted parameters are the constants in POLICIES below. They are the
answer key: `analysis.py --recover` compares its estimates against them and the
run fails if a planted effect falls outside the recovered interval.

Why the generative model plants WOA and inverts it
--------------------------------------------------
A bot decides its Weight of Advice first, then the final estimate is computed
as `initial + woa * (advice - initial)`. Replay recomputes WOA from the three
stored numbers, so the round trip plant -> events -> replay -> analysis
exercises the real projection arithmetic. Planting the final estimate directly
would test nothing: any bug in the WOA formula would appear in both the planting
and the recovery and cancel out.

Relationship to the browser bots
--------------------------------
This emits the event stream directly, which is what makes 360 sessions take
seconds instead of hours. It is only trustworthy because `e2e/bots.spec.ts`
drives the *real* app with the same policies and asserts the resulting event
stream has the same shape -- without that bridge, this file would be testing my
assumptions about the app rather than the app.

Usage
-----
    python pipeline/simulate.py --out data/sim-events.jsonl
    python pipeline/simulate.py --n 10 --seed 7 --out data/smoke.jsonl

Exit codes: 0 ok, 2 bad arguments.
"""

from __future__ import annotations

import argparse
import csv
import json
import random
import sys
import uuid
from pathlib import Path
from typing import Any, Iterable

from strata import load_strata, stratum_for_cefr
from _common import ALL_REVERSE_SCORED, LANGUAGES, REPO_ROOT, load_items

#: Levels the screening gate admits, taken from the stratum configuration so
#: adding a stratum does not need an edit here.
ADMITTED_CEFR: tuple[str, ...] = tuple(sorted(load_strata().by_cefr))

APP_VERSION = "sim-1.0.0"

# The answer key. Every number here is something analysis.py must recover.
#
#   woa_base          mean Weight of Advice with no modifiers
#   quality_effect    added when the justification is strong (central route:
#                     argument quality moves the needle)
#   style_effect      added in the warm condition (peripheral route: the cue
#                     moves the needle instead)
#   woa_sd            between-trial noise
#   scroll_mean       how far down the reply the bot reads -- the H4 mediator
#   challenge_rate    probability of tapping the "I think that might be wrong"
#                     follow-up, a behavioural vigilance measure
#   verify_rate       probability of pressing "check this claim"
#   dwell_ms          time spent before finalising
POLICIES: dict[str, dict[str, float]] = {
    "SimCentral": {
        "woa_base": 0.30,
        "quality_effect": 0.25,
        "style_effect": 0.0,
        "woa_sd": 0.10,
        "scroll_mean": 0.95,
        "scroll_sd": 0.05,
        "challenge_rate": 0.30,
        "verify_rate": 0.35,
        "dwell_ms": 9000,
    },
    "SimPeripheral": {
        "woa_base": 0.40,
        "quality_effect": 0.0,
        "style_effect": 0.20,
        "woa_sd": 0.10,
        "scroll_mean": 0.35,
        "scroll_sd": 0.10,
        "challenge_rate": 0.05,
        "verify_rate": 0.05,
        "dwell_ms": 2500,
    },
    "SimRandom": {
        "woa_base": 0.35,
        "quality_effect": 0.0,
        "style_effect": 0.0,
        "woa_sd": 0.45,
        "scroll_mean": 0.50,
        "scroll_sd": 0.30,
        "challenge_rate": 0.15,
        "verify_rate": 0.15,
        "dwell_ms": 4000,
    },
}

CONDITIONS = ("warm", "neutral")
# v2 admits adults only.
AGE_BANDS = ("18-24", "25-34", "35+")
FOLLOWUP_IDS = ("measurement", "certainty", "challenge")


# ---------------------------------------------------------------------------
# Register function -- mirrors packages/fsm/src/register.ts
# ---------------------------------------------------------------------------


def register(confidence: float) -> str:
    """LOW below 40, HIGH above 70, MODERATE on the closed interval between.

    Duplicated from TypeScript rather than shared, because the simulator has to
    be able to disagree with the app for the browser bridge to catch anything.
    A shared implementation would make `e2e/bots.spec.ts` tautological.
    """
    if not (0 <= confidence <= 100):
        raise ValueError(f"confidence out of domain: {confidence}")
    if confidence < 40:
        return "LOW"
    if confidence > 70:
        return "HIGH"
    return "MODERATE"


def register_for(condition: str, confidence: float) -> str | None:
    state = register(confidence)
    return state if condition == "warm" else None


def response_id_for(language: str, condition: str, state: str | None, item_id: str) -> str:
    slug = "na" if state is None else state.lower()
    return f"{language}_{condition}_{slug}_{item_id}"


# ---------------------------------------------------------------------------
# Event emission
# ---------------------------------------------------------------------------


class SessionWriter:
    """Builds one session's event stream with a monotonic seq and a fake clock."""

    def __init__(self, session_id: str, start_ts: int) -> None:
        self.session_id = session_id
        self.seq = 0
        self.clock = start_ts
        self.events: list[dict[str, Any]] = []

    def advance(self, ms: int) -> None:
        self.clock += max(0, int(ms))

    def record(self, event_type: str, payload: dict[str, Any]) -> None:
        self.seq += 1
        self.events.append(
            {
                "event_id": str(uuid.uuid4()),
                "session_id": self.session_id,
                "seq": self.seq,
                "client_ts": self.clock,
                "type": event_type,
                "payload": payload,
            }
        )


def _clamp01(value: float) -> float:
    return max(0.0, min(1.0, value))


def simulate_session(
    policy_name: str,
    condition: str,
    language: str,
    items: list[dict[str, Any]],
    manifest_hash: str,
    rng: random.Random,
    start_ts: int,
) -> list[dict[str, Any]]:
    policy = POLICIES[policy_name]
    session_id = str(uuid.uuid4())
    writer = SessionWriter(session_id, start_ts)

    age_band = rng.choice(AGE_BANDS)
    # v1 stratified by language and age band. v2 stratifies by English
    # proficiency, and the names live in materials/strata.json -- so they are
    # read rather than formatted, and a config change reaches the simulator for
    # free. The old "en:adult" literal survived the migration because the
    # bridge compares payload keys, not payload values.
    cefr = rng.choice(ADMITTED_CEFR)
    stratum = stratum_for_cefr(cefr)
    assert stratum is not None, f"{cefr} is not an admitted level"

    writer.record(
        "SESSION_STARTED",
        {
            "app_version": APP_VERSION,
            "stimuli_manifest_hash": manifest_hash,
            "viewport": {"width": 1280, "height": 800},
            "resumed": False,
            # Simulated participants are always first-timers. Criterion 5 is a
            # browser-local fact, so the simulator has nothing to vary here.
            "repeat_session": False,
        },
    )
    writer.advance(rng.randint(2000, 6000))

    writer.record("CONSENT_GIVEN", {})
    writer.advance(rng.randint(500, 2000))

    writer.record(
        "ALLOCATED",
        {
            "condition": condition,
            "stratum": stratum,
            "cefr": cefr,
            "allocation_seq": rng.randint(0, 999),
        },
    )

    order = list(items)
    rng.shuffle(order)

    for position, item in enumerate(order, start=1):
        advice = float(item["advice_value"])
        true_value = float(item["true_value"])
        strong = item["assigned_justification_quality"] == "strong"

        writer.advance(rng.randint(400, 1200))
        writer.record("ITEM_PRESENTED", {"item_id": item["id"], "position": position})
        present_ts = writer.clock

        # An initial estimate scattered around the truth. Deliberately not
        # around the advice: a bot that starts on the advice would give WOA a
        # zero denominator and quietly drop the trial.
        spread = max(abs(true_value) * 0.45, 1.0)
        initial = true_value + rng.gauss(0, spread)
        if abs(advice - initial) < abs(advice) * 0.02:
            initial += spread * (1 if rng.random() < 0.5 else -1)
        initial = round(initial, 4)

        # A few intermediate values, because trajectory analysis (spec 8.4) is
        # only possible if the log actually carries them.
        for _ in range(rng.randint(1, 3)):
            writer.advance(rng.randint(300, 1500))
            writer.record(
                "ESTIMATE_CHANGED",
                {
                    "item_id": item["id"],
                    "phase": "initial",
                    "value": round(initial + rng.gauss(0, spread * 0.2), 4),
                    "ms_since_present": writer.clock - present_ts,
                },
            )
        writer.advance(rng.randint(300, 900))
        writer.record(
            "ESTIMATE_CHANGED",
            {
                "item_id": item["id"],
                "phase": "initial",
                "value": initial,
                "ms_since_present": writer.clock - present_ts,
            },
        )

        confidence = round(_clamp01(rng.gauss(0.55, 0.22)) * 100, 2)
        writer.advance(rng.randint(400, 1500))
        writer.record(
            "CONFIDENCE_SET",
            {"item_id": item["id"], "phase": "initial", "value": confidence},
        )

        state = register_for(condition, confidence)
        writer.advance(rng.randint(200, 600))
        writer.record(
            "RESPONSE_REVEALED",
            {
                "item_id": item["id"],
                "response_id": response_id_for(language, condition, state, item["id"]),
                "register_state": state,
            },
        )
        reveal_ts = writer.clock

        scroll = _clamp01(rng.gauss(policy["scroll_mean"], policy["scroll_sd"]))
        writer.advance(int(policy["dwell_ms"] * rng.uniform(0.6, 1.4)))
        writer.record(
            "RESPONSE_SCROLLED",
            {"item_id": item["id"], "max_scroll_fraction": round(scroll, 4)},
        )

        for followup_id in FOLLOWUP_IDS:
            take = (
                policy["challenge_rate"]
                if followup_id == "challenge"
                else policy["challenge_rate"] * 1.5
            )
            if rng.random() < take:
                writer.advance(rng.randint(600, 2500))
                writer.record(
                    "FOLLOWUP_SELECTED",
                    {
                        "item_id": item["id"],
                        "followup_id": followup_id,
                        "ms_since_reveal": writer.clock - reveal_ts,
                    },
                )

        if rng.random() < policy["verify_rate"]:
            writer.advance(rng.randint(300, 1200))
            writer.record(
                "VERIFY_CLICKED",
                {"item_id": item["id"], "ms_since_reveal": writer.clock - reveal_ts},
            )

        # The planted effect. Everything above is scaffolding; this line is what
        # analysis.py has to recover.
        woa = (
            policy["woa_base"]
            + (policy["quality_effect"] if strong else 0.0)
            + (policy["style_effect"] if condition == "warm" else 0.0)
            + rng.gauss(0, policy["woa_sd"])
        )
        final = initial + woa * (advice - initial)

        revisions = rng.randint(1, 4)
        for _ in range(revisions):
            writer.advance(rng.randint(200, 1200))
            writer.record(
                "ESTIMATE_CHANGED",
                {
                    "item_id": item["id"],
                    "phase": "final",
                    "value": round(initial + rng.uniform(0, 1) * (final - initial), 4),
                    "ms_since_present": writer.clock - present_ts,
                },
            )

        writer.advance(rng.randint(300, 1500))
        writer.record(
            "CONFIDENCE_SET",
            {
                "item_id": item["id"],
                "phase": "final",
                "value": round(_clamp01(confidence / 100 + rng.gauss(0.05, 0.1)) * 100, 2),
            },
        )
        writer.record(
            "ESTIMATE_FINALIZED",
            {
                "item_id": item["id"],
                "value": round(final, 4),
                "revision_count": revisions,
                "ms_since_reveal": writer.clock - reveal_ts,
            },
        )

        # Perceived argument strength, asked once per item after the estimate.
        # Given a quality-dependent mean rather than a constant: the measure
        # exists to show participants could tell strong from weak, so synthetic
        # data in which nobody can tell them apart would make every downstream
        # check of it vacuous. The size of the gap here is arbitrary and is
        # deliberately NOT in the recovery truth table -- this is a
        # manipulation check the study measures, not an effect it plants.
        writer.advance(rng.randint(600, 2500))
        writer.record(
            "ARGUMENT_RATED",
            {
                "item_id": item["id"],
                "perceived_strength": int(
                    round(_clamp_likert((5.0 if strong else 3.0) + rng.gauss(0, 1.0)))
                ),
            },
        )

    # Questionnaire. Warmth and trust track the manipulation so H2 and H5 have
    # something to find; competence deliberately does not, because a style
    # manipulation that moved perceived competence would be a confound.
    #
    # Two properties this used to get wrong, both exposed the first time the
    # reliability report ran:
    #
    #   1. Reverse-scored items were answered in the same direction as the
    #      rest. A participant who found the assistant warm rates "The
    #      assistant felt impersonal" LOW; the simulator rated it high, the
    #      scoring code flipped it as instructed, and the item then pointed
    #      against its own scale (r = -0.43). ALL_REVERSE_SCORED is shared with
    #      the analysis so the two cannot drift apart again.
    #
    #   2. Every item was an independent draw, so there was no person-level
    #      agreement and alpha was zero by construction. Real questionnaire data
    #      has a person in it: one latent level per scale per participant, which
    #      is what alpha measures.
    def answer(scale_base: float, latent: float, question_id: str) -> None:
        writer.advance(rng.randint(300, 1500))
        value = int(round(_clamp_likert(scale_base + latent + rng.gauss(0, 0.6))))
        if question_id in ALL_REVERSE_SCORED:
            value = 8 - value
        writer.record(
            "QUESTIONNAIRE_ANSWERED",
            {"scale": question_id.rsplit("_", 1)[0], "question_id": question_id, "value": value},
        )

    warm_bump = 1.2 if condition == "warm" else 0.0
    warmth_latent = rng.gauss(0, 0.8)
    for question_id, base in (
        ("warmth_01", 3.4), ("warmth_02", 3.3), ("warmth_03", 3.5),
        ("warmth_04", 3.4), ("warmth_05", 3.3),
    ):
        answer(base + warm_bump, warmth_latent, question_id)

    competence_latent = rng.gauss(0, 0.8)
    for question_id in ("competence_01", "competence_02", "competence_03", "competence_04"):
        answer(4.5, competence_latent, question_id)

    trust_latent = rng.gauss(0, 0.8)
    for question_id in ("trust_01", "trust_02", "trust_03", "trust_04"):
        answer(3.8 + warm_bump * 0.6, trust_latent, question_id)

    for question_id, value in (
        ("cov_age_band", age_band),
        ("cov_gender", rng.choice(["female", "male", "other", "prefer_not_to_say"])),
        ("cov_primary_language", language),
        ("cov_ai_usage", rng.randint(1, 5)),
        ("cov_prior_knowledge", rng.randint(1, 7)),
    ):
        writer.advance(rng.randint(200, 900))
        writer.record("QUESTIONNAIRE_ANSWERED",
                      {"scale": "covariates", "question_id": question_id, "value": value})

    for stage, text in (
        ("purpose", "Guessing how people change answers after seeing an assistant."),
        ("anomaly", "Nothing obvious." if rng.random() < 0.8 else "One depth figure looked off."),
        ("belief", rng.choice(["yes", "no", "unsure"])),
    ):
        writer.advance(rng.randint(1000, 4000))
        writer.record("FUNNEL_RESPONSE", {"stage": stage, "text": text})

    writer.advance(rng.randint(500, 2000))
    writer.record("SESSION_COMPLETED", {"total_duration_ms": writer.clock - start_ts})
    return writer.events


def _clamp_likert(value: float) -> float:
    return max(1.0, min(7.0, value))


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate synthetic participant event logs.")
    parser.add_argument("--n", type=int, default=60,
                        help="sessions per policy per condition (default 60, so 360 in total)")
    parser.add_argument("--seed", type=int, default=20260817,
                        help="committed so the synthetic sample is reproducible")
    parser.add_argument("--languages", nargs="+", default=list(LANGUAGES), choices=list(LANGUAGES))
    parser.add_argument("--out", default=str(REPO_ROOT / "data" / "sim-events.jsonl"))
    args = parser.parse_args(list(argv) if argv is not None else None)

    if args.n < 1:
        print("--n must be at least 1", file=sys.stderr)
        return 2

    items = load_items()["items"]
    manifest_path = REPO_ROOT / "materials" / "manifest.json"
    manifest_hash = (
        json.loads(manifest_path.read_text(encoding="utf-8"))["manifest_sha256"]
        if manifest_path.exists()
        else "0" * 64
    )

    rng = random.Random(args.seed)
    truth: list[dict[str, Any]] = []
    # A fixed epoch, not time.time(): the log has to be byte-reproducible from
    # the seed alone, and a wall clock would make every run differ.
    clock = 1_760_000_000_000
    all_events: list[dict[str, Any]] = []

    for policy_name in sorted(POLICIES):
        for condition in CONDITIONS:
            for index in range(args.n):
                language = args.languages[index % len(args.languages)]
                events = simulate_session(
                    policy_name, condition, language, items, manifest_hash, rng, clock
                )
                all_events.extend(events)
                policy = POLICIES[policy_name]
                truth.append(
                    {
                        "session_id": events[0]["session_id"],
                        "policy": policy_name,
                        "condition": condition,
                        "language": language,
                        "planted_woa_base": policy["woa_base"],
                        "planted_quality_effect": policy["quality_effect"],
                        "planted_style_effect": policy["style_effect"],
                        "planted_scroll_mean": policy["scroll_mean"],
                    }
                )
                clock += 30 * 60 * 1000

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8", newline="\n") as handle:
        for event in all_events:
            handle.write(json.dumps(event, ensure_ascii=False, sort_keys=True) + "\n")

    # The answer key lives beside the log, never inside it. A real participant
    # has no "policy" field, so putting one in the event stream would make the
    # synthetic log structurally different from the thing it stands in for --
    # and analysis.py could then accidentally depend on a column that will not
    # exist when the data are real.
    truth_path = out_path.with_name(out_path.stem.replace("-events", "") + "-truth.csv")
    with truth_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(truth[0]), lineterminator="\n")
        writer.writeheader()
        writer.writerows(truth)

    sessions = args.n * len(CONDITIONS) * len(POLICIES)
    print(f"{sessions} synthetic sessions, {len(all_events)} events -> {out_path}")
    print(f"  ground truth -> {truth_path}")
    print(f"  {args.n} per policy per condition, seed {args.seed}")
    print("\nPlanted effects analysis.py must recover:")
    for name, policy in sorted(POLICIES.items()):
        print(
            f"  {name:14s} discrimination {policy['quality_effect']:+.2f}"
            f"   style {policy['style_effect']:+.2f}"
            f"   scroll {policy['scroll_mean']:.2f}"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
