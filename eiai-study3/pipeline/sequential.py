"""The pre-registered sequential stopping rule (spec v2 section 8.2).

Sequential Bayes factors do not inflate error rates the way sequential p-values
do -- but only when the looks are pre-registered. Peeking whenever you feel like
it and stopping when the number looks good is optional stopping regardless of
which school of statistics the number came from. So the schedule lives here, in
code, and the decision at any N is a pure function of the sample size and the
Bayes factor. There is nothing to exercise judgement about at three in the
morning on week six of recruitment.

Schedule: first look at N = 60, then every 20 participants, hard cap at 160.
Stop when BF10 > 6 (evidence for) or < 1/6 (evidence against).

See Schonbrodt & Wagenmakers, Bayes Factor Design Analysis.

Usage
-----
    python pipeline/sequential.py --tables data/tables

Exit codes: 0 continue, 3 stop (so a recruitment script can branch on it).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any, Iterable

#: First pre-registered look.
FIRST_LOOK_N = 60

#: Participants between looks thereafter.
LOOK_INTERVAL = 20

#: Recruitment stops here whatever the evidence says.
HARD_CAP_N = 160

#: Evidence for the effect. Strictly greater, as pre-registered.
STOP_FOR_BF = 6.0

#: Evidence against. Strictly less.
STOP_AGAINST_BF = 1.0 / 6.0


def looks_up_to(n: int) -> list[int]:
    """Every pre-registered look at or below `n`."""
    return [
        look
        for look in range(FIRST_LOOK_N, HARD_CAP_N + 1, LOOK_INTERVAL)
        if look <= n
    ]


def next_look_after(n: int) -> int | None:
    """The next scheduled look strictly above `n`, or None past the cap."""
    for look in range(FIRST_LOOK_N, HARD_CAP_N + 1, LOOK_INTERVAL):
        if look > n:
            return look
    return None


def stopping_decision(n: int, bf10: float) -> dict[str, Any]:
    """Whether the pre-registration licenses stopping at this N.

    `n` is completed participants and `bf10` the Bayes factor on H3. The
    decision is deliberately conservative about *when* it may be made: a Bayes
    factor of 500 measured between two scheduled looks is not a licence to
    stop, because that stop was not pre-registered.
    """
    if bf10 <= 0:
        raise ValueError(
            f"BF10 must be positive, got {bf10}. A ratio of marginal likelihoods "
            "cannot be zero or negative; treating one as 'evidence against' "
            "would turn a numerical failure into a recruitment decision."
        )

    at_cap = n >= HARD_CAP_N
    at_a_look = n in looks_up_to(n)

    if bf10 > STOP_FOR_BF:
        verdict = "evidence for"
    elif bf10 < STOP_AGAINST_BF:
        verdict = "evidence against"
    else:
        verdict = "inconclusive"

    if at_cap:
        return {
            "n": n,
            "bf10": bf10,
            "at_a_look": True,
            "stop": True,
            "verdict": verdict,
            "reason": f"hard cap of {HARD_CAP_N} reached",
            "next_look": None,
        }

    if not at_a_look:
        upcoming = next_look_after(n)
        reason = (
            f"before the first pre-registered look at N = {FIRST_LOOK_N}"
            if n < FIRST_LOOK_N
            else f"between pre-registered looks; the next is N = {upcoming}"
        )
        return {
            "n": n,
            "bf10": bf10,
            "at_a_look": False,
            "stop": False,
            "verdict": verdict,
            "reason": reason,
            "next_look": upcoming,
        }

    stop = verdict != "inconclusive"
    return {
        "n": n,
        "bf10": bf10,
        "at_a_look": True,
        "stop": stop,
        "verdict": verdict,
        "reason": (
            f"BF10 = {bf10:.3f} passes the {verdict} threshold"
            if stop
            else f"BF10 = {bf10:.3f} lies between 1/{STOP_FOR_BF:.0f} and {STOP_FOR_BF:.0f}"
        ),
        "next_look": next_look_after(n),
    }


def print_decision(decision: dict[str, Any]) -> None:
    print("Sequential stopping rule (spec v2 section 8.2)")
    print(f"  completed participants : {decision['n']}")
    print(f"  BF10 on H3             : {decision['bf10']:.3f}")
    print(f"  verdict                : {decision['verdict']}")
    print(f"  at a pre-registered look: {'yes' if decision['at_a_look'] else 'no'}")
    print()
    print(f"  {'STOP' if decision['stop'] else 'CONTINUE'} -- {decision['reason']}")
    if not decision["stop"] and decision["next_look"] is not None:
        print(f"  next look at N = {decision['next_look']}")


def main(argv: Iterable[str] | None = None) -> int:
    # Imported here rather than at module scope so the rule itself stays a
    # dependency-free pure function that tests can exercise without pandas.
    from analysis import Specification, analyse, load_tables

    parser = argparse.ArgumentParser(description="Apply the sequential stopping rule.")
    parser.add_argument("--tables", default="data/tables")
    parser.add_argument("--bf10", type=float, default=None,
                        help="skip the analysis and judge this Bayes factor")
    parser.add_argument("--n", type=int, default=None,
                        help="skip the analysis and judge this sample size")
    args = parser.parse_args(list(argv) if argv is not None else None)

    if args.bf10 is not None and args.n is not None:
        decision = stopping_decision(args.n, args.bf10)
    else:
        results = analyse(load_tables(Path(args.tables)), Specification())
        decision = stopping_decision(
            n=int(results["n"]["participants"]),
            bf10=float(results["H3_discrimination"]["bf10"]),
        )

    print_decision(decision)
    return 3 if decision["stop"] else 0


if __name__ == "__main__":
    sys.exit(main())
