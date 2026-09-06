#!/usr/bin/env python3
"""Confirm content equivalence across conditions (STUDY3_SPEC_v3.md section 2).

The reviewer objection this exists to answer is:

    "The conditions may have differed in factual content, not only emotional
     style."

For every (language, item) the four variants -- warm/LOW, warm/MODERATE,
warm/HIGH, neutral -- must agree on:

  1. the numeric advice value, and carry no other numeric claim
  2. the justification text, byte for byte
  2b. the justification states no number at all -- it is not covered by 1 or 4,
     which walk the body and follow-ups only
  3. the presence of hedging
  4. the absence of the true value on planted-error items

Plus two balance checks that catch confounds a per-variant check cannot see:

  5. strong and weak justifications must not differ systematically in length
     within a language, or justification quality is confounded with length
  6. warm and neutral bodies must not differ systematically in length, or the
     emotional manipulation is confounded with sheer amount of text

Usage:
    python pipeline/verify_equivalence.py
    python pipeline/verify_equivalence.py --strict   # treat warnings as failures

Exit codes: 0 clean, 1 failures found, 2 stimuli missing.
"""

from __future__ import annotations

import argparse
import statistics
import sys
from typing import Any, Iterable

from _common import (
    FOLLOWUP_IDS,
    LANGUAGES,
    RESPONSES_DIR,
    VARIANTS,
    contains_value,
    extract_numbers,
    format_number,
    has_hedge_marker,
    load_items,
    read_json,
    stimulus_filename,
    word_count,
)

# Mean body length may differ between conditions by at most this many words
# before the emotional manipulation is confounded with amount of text.
BODY_LENGTH_TOLERANCE = 8.0
# Mean justification length may differ between strong and weak by at most this.
JUSTIFICATION_LENGTH_TOLERANCE = 3.0


class Report:
    def __init__(self) -> None:
        self.failures: list[str] = []
        self.warnings: list[str] = []
        self.checks = 0

    def check(self, ok: bool, message: str, *, warn_only: bool = False) -> None:
        self.checks += 1
        if ok:
            return
        (self.warnings if warn_only else self.failures).append(message)


def load_all() -> dict[tuple[str, str, str | None], dict[str, Any]]:
    """All 12 stimulus files, keyed by (language, condition, register_state)."""
    out: dict[tuple[str, str, str | None], dict[str, Any]] = {}
    missing: list[str] = []

    for language in LANGUAGES:
        for condition, state in VARIANTS:
            name = stimulus_filename(language, condition, state)
            path = RESPONSES_DIR / name
            if not path.exists():
                missing.append(name)
                continue
            out[(language, condition, state)] = read_json(path)

    if missing:
        print("Missing stimulus files -- run pipeline/generate.py first:", file=sys.stderr)
        for name in missing:
            print(f"  - {name}", file=sys.stderr)
        sys.exit(2)

    return out


def responses_by_item(document: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {r["item_id"]: r for r in document["responses"]}


def texts_of(response: dict[str, Any]) -> list[tuple[str, str]]:
    out = [("body", response["body"])]
    out.extend((f"followup_{k}", response["followups"][k]) for k in FOLLOWUP_IDS)
    return out


def stray_numbers(text: str, advice: float, question: str) -> list[float]:
    """Numbers in `text` that are neither the advice value nor given by the question.

    The second exemption is narrow and was added for one figure. item_12 asks
    "the ambient water temperature at 4,000 metres depth", and every generation
    restates that depth -- it is how the sentence is written in English. The
    participant is reading 4,000 on the same screen, so echoing it is a
    reference to the question, not a claim about the world, and it can leak
    nothing: it is the question's own parameter.

    Confined to the item's OWN question on purpose. A leaked true value, an
    invented figure, or a number lifted from a different item's question all
    remain failures, which is what pipeline/tests/test_stem_numbers.py pins.
    item_12 is the only item in the bank whose question contains a number at
    all, so the reach of this is one figure in one item.
    """
    allowed = {advice, *extract_numbers(question)}
    return sorted(
        n
        for n in set(extract_numbers(text))
        if all(abs(n - a) > 1e-9 * max(1.0, abs(a)) for a in allowed)
    )


def verify(report: Report) -> None:
    bank = load_items()
    items = {i["id"]: i for i in bank["items"]}
    documents = load_all()

    # ---- completeness -----------------------------------------------------
    expected_responses = len(items) * len(VARIANTS) * len(LANGUAGES)
    actual = sum(len(d["responses"]) for d in documents.values())
    report.check(
        actual == expected_responses,
        f"expected {expected_responses} responses across all files, found {actual}",
    )

    for key, document in documents.items():
        by_item = responses_by_item(document)
        report.check(
            set(by_item) == set(items),
            f"{key}: item coverage mismatch (missing {sorted(set(items) - set(by_item))})",
        )
        for item_id, response in by_item.items():
            for followup_id in FOLLOWUP_IDS:
                report.check(
                    bool(response["followups"].get(followup_id, "").strip()),
                    f"{response['response_id']}: follow-up '{followup_id}' is empty",
                )

    # ---- per (language, item) equivalence across the four variants --------
    for language in LANGUAGES:
        for item_id, item in items.items():
            advice = float(item["advice_value"])
            variants = [
                documents[(language, condition, state)]
                for condition, state in VARIANTS
            ]
            responses = [responses_by_item(d)[item_id] for d in variants]

            # 1. numeric value present everywhere, and nothing else numeric
            for response in responses:
                for field, text in texts_of(response):
                    report.check(
                        contains_value(text, advice),
                        f"{response['response_id']}.{field}: missing advice value {format_number(advice)}",
                    )
                    stray = stray_numbers(text, advice, item["question"][language])
                    report.check(
                        not stray,
                        f"{response['response_id']}.{field}: carries numeric claims beyond "
                        f"the advice value and the question's own figures: {stray}",
                    )

            # 2. justification identical across all four variants -- the load-bearing check
            justifications = {r["justification_text"] for r in responses}
            report.check(
                len(justifications) == 1,
                f"{language}/{item_id}: justification differs across conditions "
                f"({len(justifications)} distinct variants). Content equivalence is broken.",
            )

            qualities = {r["justification_quality"] for r in responses}
            report.check(
                qualities == {item["assigned_justification_quality"]},
                f"{language}/{item_id}: justification_quality disagrees with the item bank",
            )

            # 2b. the justification states no number at all.
            #
            # The numeric checks above walk texts_of(), which is the body and
            # the three follow-ups -- the justification is not in it. So until
            # this check existed, a justification that named a value was
            # invisible here: on a planted-error item it would have carried the
            # true value into text that is byte-identical across all four
            # variants, and checks 1 and 4 would both have passed it.
            #
            # Every source justification in the bank describes how a figure was
            # established and never states one, so "no digits at all" is the
            # exact rule rather than a conservative approximation.
            for justification in sorted(justifications):
                numbers = sorted(set(extract_numbers(justification)))
                report.check(
                    not numbers,
                    f"{language}/{item_id}: justification states numeric content {numbers}; "
                    f"source justifications state none",
                )

            # 3. hedging present in every variant
            for response in responses:
                report.check(
                    has_hedge_marker(response["body"], language),
                    f"{response['response_id']}: body carries no {language} hedge marker",
                    warn_only=True,
                )

            # 4. no true-value leak on error items
            if item["is_error"]:
                true_value = float(item["true_value"])
                for response in responses:
                    for field, text in texts_of(response):
                        report.check(
                            not contains_value(text, true_value),
                            f"{response['response_id']}.{field}: leaks true value {format_number(true_value)}",
                        )

    # ---- 5. justification length balance, per language --------------------
    for language in LANGUAGES:
        document = documents[(language, "neutral", None)]
        by_quality: dict[str, list[int]] = {"strong": [], "weak": []}
        for response in document["responses"]:
            by_quality[response["justification_quality"]].append(
                word_count(response["justification_text"])
            )

        if by_quality["strong"] and by_quality["weak"]:
            delta = abs(
                statistics.mean(by_quality["strong"]) - statistics.mean(by_quality["weak"])
            )
            report.check(
                delta <= JUSTIFICATION_LENGTH_TOLERANCE,
                f"{language}: strong justifications average "
                f"{statistics.mean(by_quality['strong']):.1f} words vs weak "
                f"{statistics.mean(by_quality['weak']):.1f} -- justification quality is "
                f"confounded with length (delta {delta:.1f} > {JUSTIFICATION_LENGTH_TOLERANCE})",
            )

    # ---- 6. body length balance, warm vs neutral, per language ------------
    for language in LANGUAGES:
        warm_lengths = [
            word_count(r["body"])
            for condition, state in VARIANTS
            if condition == "warm"
            for r in documents[(language, condition, state)]["responses"]
        ]
        neutral_lengths = [
            word_count(r["body"]) for r in documents[(language, "neutral", None)]["responses"]
        ]
        if warm_lengths and neutral_lengths:
            delta = abs(statistics.mean(warm_lengths) - statistics.mean(neutral_lengths))
            report.check(
                delta <= BODY_LENGTH_TOLERANCE,
                f"{language}: warm bodies average {statistics.mean(warm_lengths):.1f} words vs "
                f"neutral {statistics.mean(neutral_lengths):.1f} -- emotional style is confounded "
                f"with amount of text (delta {delta:.1f} > {BODY_LENGTH_TOLERANCE})",
                warn_only=True,
            )

    # ---- placeholder visibility ------------------------------------------
    placeholders = [
        key for key, document in documents.items() if document["meta"].get("placeholder")
    ]
    if placeholders:
        report.warnings.append(
            f"{len(placeholders)} of {len(documents)} stimulus files are OFFLINE PLACEHOLDERS. "
            "Equivalence passing here says the pipeline works, not that the stimuli are usable."
        )


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Verify content equivalence across conditions.")
    parser.add_argument("--strict", action="store_true", help="treat warnings as failures")
    args = parser.parse_args(list(argv) if argv is not None else None)

    report = Report()
    verify(report)

    print(f"{report.checks} checks run")

    if report.warnings:
        print(f"\n{len(report.warnings)} warning(s):")
        for line in report.warnings[:20]:
            print(f"  ~ {line}")
        if len(report.warnings) > 20:
            print(f"  ... and {len(report.warnings) - 20} more")

    if report.failures:
        print(f"\n{len(report.failures)} FAILURE(S):")
        for line in report.failures[:30]:
            print(f"  x {line}")
        if len(report.failures) > 30:
            print(f"  ... and {len(report.failures) - 30} more")
        return 1

    if args.strict and report.warnings:
        print("\nstrict mode: warnings treated as failures")
        return 1

    print("\nContent equivalence confirmed: identical numeric claims, identical")
    print("justifications, identical hedging across all four condition variants.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
