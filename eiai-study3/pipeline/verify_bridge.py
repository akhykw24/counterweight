#!/usr/bin/env python3
"""Check that the fast simulator emits what the real app emits.

`simulate.py` writes event streams directly, which is what makes parameter
recovery affordable. That shortcut is only legitimate if the streams it writes
are structurally the same as the ones the actual application produces -- and
nothing about writing both files myself guarantees that. A simulator that
quietly omitted `ms_since_reveal`, or spelled a payload key differently, would
still recover its own planted effects perfectly and prove nothing.

So this compares the two logs on structure, never on values:

  1. every event type one log contains, the other contains
  2. for each shared event type, the payload keys match exactly
  3. for every envelope and payload field, the two logs agree on its *type*
  4. each completed session shows the same per-item event pattern

Values are deliberately out of scope. The bots move sliders differently from
the simulated participants and should; what has to agree is the *shape* of what
lands in the log.

Type agreement is part of that shape, and it was missing until it cost
something: the simulator wrote `client_ts` as an integer count of milliseconds
while the browser wrote the ISO string the schema declares, and this file
reported that the logs agreed. The pipeline had been written against the
integer, so it raised on the first real session. Matching key names is not
matching shape.

Usage
-----
    python pipeline/verify_bridge.py \
        --browser data/browser-events.jsonl \
        --simulated data/sim-events.jsonl

Exit codes: 0 shapes agree, 1 they diverge, 2 a log is missing.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable

from _common import REPO_ROOT

# Emitted only on a tab switch, a resume, a withdrawal or a screening exit --
# none of which a scripted bot run performs. Absent from one side is expected,
# not a divergence. ASSENT_GIVEN used to sit in this set and no longer exists:
# v2 admits adults only, so an allowance for it would quietly excuse a real
# divergence if the name were ever reused.
SITUATIONAL_TYPES = {
    "WINDOW_BLURRED",
    "WINDOW_FOCUSED",
    "SESSION_WITHDRAWN",
    "SCREENED_OUT",
}

# Per-item events every completed trial must carry in both logs.
REQUIRED_PER_ITEM = {
    "ITEM_PRESENTED",
    "ESTIMATE_CHANGED",
    "CONFIDENCE_SET",
    "RESPONSE_REVEALED",
    "ESTIMATE_FINALIZED",
}


def load(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        raise FileNotFoundError(
            f"{path} not found.\n"
            "  browser log:   pnpm e2e:bots\n"
            "  simulated log: python pipeline/simulate.py"
        )
    events = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            events.append(json.loads(line))
    return events


def payload_keys(events: list[dict[str, Any]]) -> dict[str, set[str]]:
    keys: dict[str, set[str]] = defaultdict(set)
    for event in events:
        keys[event["type"]] |= set(event.get("payload", {}).keys())
    return dict(keys)


#: Envelope fields both logs must describe the same way. `type` is compared
#: separately, as a set of names, and `payload` is descended into.
ENVELOPE_FIELDS = ("event_id", "session_id", "seq", "client_ts", "run_mode")


def _json_type(value: Any) -> str | None:
    """The JSON type name, or None for null.

    Null is not a type disagreement: an optional field left empty in one log is
    the same shape as the same field filled in the other. Treating it as a
    divergence would flag `register_state`, which is null in every neutral
    condition, and a check that cries wolf gets deleted.
    """
    if value is None:
        return None
    if isinstance(value, bool):
        return "bool"
    if isinstance(value, (int, float)):
        # One name for both. JSON has a single numeric type; the int/float
        # distinction is invented by json.loads, so 50 and 47.3 would otherwise
        # read as a divergence. Whether a number has to be whole is the
        # schema's business -- scripts/validate-log.ts checks that -- not this
        # file's.
        return "number"
    if isinstance(value, str):
        return "str"
    if isinstance(value, list):
        return "list"
    if isinstance(value, dict):
        return "dict"
    return type(value).__name__


def envelope_types(events: list[dict[str, Any]]) -> dict[str, set[str]]:
    """The types each envelope field takes across a log."""
    out: dict[str, set[str]] = defaultdict(set)
    for event in events:
        for field in ENVELOPE_FIELDS:
            if field not in event:
                continue
            name = _json_type(event[field])
            if name is not None:
                out[field].add(name)
    return dict(out)


def payload_types(events: list[dict[str, Any]]) -> dict[str, dict[str, set[str]]]:
    """Per event type, the types each payload key takes across a log."""
    out: dict[str, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
    for event in events:
        for key, value in (event.get("payload") or {}).items():
            name = _json_type(value)
            if name is not None:
                out[event["type"]][key].add(name)
    return {kind: dict(keys) for kind, keys in out.items()}


def _type_problems(
    where: str, left: dict[str, set[str]], right: dict[str, set[str]]
) -> list[str]:
    """Fields whose types cannot be reconciled between two logs.

    Disjoint, not unequal: a field that is a number in one log and a
    number-or-string in the other still overlaps, and the overlap is enough to
    say the pipeline will read both. Disjoint type sets mean the two logs are
    describing different things.
    """
    problems: list[str] = []
    for field in sorted(set(left) & set(right)):
        if left[field] & right[field]:
            continue
        problems.append(
            f"{where}{field}: the app writes {'/'.join(sorted(left[field]))} "
            f"where the simulator writes {'/'.join(sorted(right[field]))}"
        )
    return problems


def per_item_types(events: list[dict[str, Any]]) -> dict[tuple[str, str], set[str]]:
    out: dict[tuple[str, str], set[str]] = defaultdict(set)
    for event in events:
        item_id = event.get("payload", {}).get("item_id")
        if item_id:
            out[(event["session_id"], item_id)].add(event["type"])
    return dict(out)


def compare(browser: list[dict[str, Any]], simulated: list[dict[str, Any]]) -> list[str]:
    problems: list[str] = []

    browser_types = {e["type"] for e in browser} - SITUATIONAL_TYPES
    simulated_types = {e["type"] for e in simulated} - SITUATIONAL_TYPES

    only_browser = browser_types - simulated_types
    only_simulated = simulated_types - browser_types
    if only_browser:
        problems.append(
            f"the app emits event types the simulator never produces: {sorted(only_browser)}. "
            "Recovery cannot speak to measures the synthetic data does not contain."
        )
    if only_simulated:
        problems.append(
            f"the simulator produces event types the app does not emit: {sorted(only_simulated)}. "
            "Those are fictional measures and any effect recovered through them is an artefact."
        )

    browser_keys = payload_keys(browser)
    simulated_keys = payload_keys(simulated)
    for event_type in sorted(browser_types & simulated_types):
        left = browser_keys.get(event_type, set())
        right = simulated_keys.get(event_type, set())
        if left != right:
            problems.append(
                f"{event_type}: payload keys differ -- app has {sorted(left - right) or '[]'} "
                f"that the simulator lacks, simulator has {sorted(right - left) or '[]'} "
                f"that the app lacks"
            )

    problems.extend(_type_problems("", envelope_types(browser), envelope_types(simulated)))

    browser_payload_types = payload_types(browser)
    simulated_payload_types = payload_types(simulated)
    for event_type in sorted(browser_types & simulated_types):
        problems.extend(
            _type_problems(
                f"{event_type}.",
                browser_payload_types.get(event_type, {}),
                simulated_payload_types.get(event_type, {}),
            )
        )

    for label, events in (("browser", browser), ("simulated", simulated)):
        finalized = {
            (e["session_id"], e["payload"]["item_id"])
            for e in events
            if e["type"] == "ESTIMATE_FINALIZED"
        }
        by_item = per_item_types(events)
        for key in sorted(finalized):
            missing = REQUIRED_PER_ITEM - by_item.get(key, set())
            if missing:
                problems.append(
                    f"{label}: {key[0][:8]}/{key[1]} finalised without {sorted(missing)}"
                )
                break  # one example is enough to fail on

    return problems


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Compare browser and simulated event shapes.")
    parser.add_argument("--browser", default=str(REPO_ROOT / "data" / "browser-events.jsonl"))
    parser.add_argument("--simulated", default=str(REPO_ROOT / "data" / "sim-events.jsonl"))
    args = parser.parse_args(list(argv) if argv is not None else None)

    try:
        browser = load(Path(args.browser))
        simulated = load(Path(args.simulated))
    except FileNotFoundError as error:
        print(str(error), file=sys.stderr)
        return 2

    problems = compare(browser, simulated)

    print(f"browser log    {len(browser):6d} events, "
          f"{len({e['session_id'] for e in browser})} sessions")
    print(f"simulated log  {len(simulated):6d} events, "
          f"{len({e['session_id'] for e in simulated})} sessions")
    print()

    if problems:
        print("Simulated and real event streams DIVERGE:", file=sys.stderr)
        for line in problems:
            print(f"  - {line}", file=sys.stderr)
        print(
            "\nUntil these agree, parameter recovery is a statement about "
            "pipeline/simulate.py, not about the study pipeline.",
            file=sys.stderr,
        )
        return 1

    shared = ({e["type"] for e in browser} & {e["type"] for e in simulated}) - SITUATIONAL_TYPES
    print(f"Shapes agree across {len(shared)} event types. The simulated log is a "
          f"faithful stand-in for the real one.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
