"""The 6/6 relabelling, and what it must not disturb (spec v2, item 7).

Two items move from the strong to the weak justification category. The change is
a **label only**: every item carries both texts already, so nothing is rewritten
and no stimulus wording changes.

Which two, and why they stay fillers
------------------------------------
The twelve items are not one pool. Eight form the analysed 2x2 -- two per cell
across error x quality -- and are already 4/4 with equal advice accuracy in both
halves. The other four are correct, strong-justification fillers, present so
planted errors are a third of twelve rather than half of eight.

So "6 strong / 6 weak" names two incompatible changes, and only one of them is
safe:

  relabel two FILLERS, keeping them fillers
      displayed set becomes 6/6; the analysed contrast stays 4/4 with 50%/50%
      advice accuracy -- unchanged
  convert two fillers into ANALYSED weak items
      analysed set becomes 4 strong / 6 weak, accuracy 50% against 33%, which
      reintroduces the base-rate confound the fillers exist to avoid

This file pins the first reading. item_08 and item_12 were chosen because they
add two sub-domains the weak side does not have, so weak arguments do not
cluster in one topic; item_01 stays strong because the Challenger Deep is the
most checkable fact in the bank and a weak justification there would be the most
likely to arouse suspicion; item_06 stays strong so taxonomy appears on both
sides.
"""

from __future__ import annotations

from collections import Counter

import pytest

from _common import load_items, read_json, REPO_ROOT

RELABELLED = ("item_08", "item_12")

# Justification texts as they stood before the relabelling. The change is a
# label, so every one of these must still match: if a text moved, something
# rewrote a stimulus rather than reassigning it.
TEXT_DIGESTS_BEFORE = REPO_ROOT / "materials" / "justification-digests.json"


def _bank():
    return load_items()


def test_the_displayed_set_is_six_strong_and_six_weak():
    counts = Counter(i["assigned_justification_quality"] for i in _bank()["items"])
    assert counts["strong"] == 6, counts
    assert counts["weak"] == 6, counts


def test_the_analysed_contrast_is_untouched():
    """The point of choosing fillers.

    If this ever changes, the relabelling stopped being cosmetic and started
    being a redesign of the measurement.
    """
    analysed = [i for i in _bank()["items"] if i["role"] == "analysed"]
    counts = Counter(i["assigned_justification_quality"] for i in analysed)
    assert counts["strong"] == 4, counts
    assert counts["weak"] == 4, counts

    for quality in ("strong", "weak"):
        cell = [i for i in analysed if i["assigned_justification_quality"] == quality]
        correct = sum(1 for i in cell if not i["is_error"])
        assert correct * 2 == len(cell), (
            f"the {quality} cell is {correct}/{len(cell)} correct; the two cells must "
            f"match or a participant discounting weak justification on normative "
            f"grounds becomes indistinguishable from one persuaded by warmth"
        )


def test_exactly_the_two_named_items_moved():
    weak_fillers = sorted(
        i["id"] for i in _bank()["items"]
        if i["role"] == "filler" and i["assigned_justification_quality"] == "weak"
    )
    assert weak_fillers == sorted(RELABELLED)


def test_every_filler_is_still_correct():
    # This is what fillers are FOR: holding the planted-error rate at a third of
    # twelve. Their justification quality is a free parameter; their being
    # correct is not.
    for item in _bank()["items"]:
        if item["role"] == "filler":
            assert not item["is_error"], f"{item['id']} is a filler carrying a planted error"


def test_the_planted_error_rate_is_unchanged():
    items = _bank()["items"]
    planted = sum(1 for i in items if i["is_error"])
    assert planted == 4
    assert planted / len(items) == pytest.approx(1 / 3, abs=0.01)


def test_no_justification_text_changed():
    """A label moved; no wording did.

    Digests are compared against a committed record rather than recomputed from
    the same file, because comparing a file to itself proves nothing.
    """
    import hashlib

    recorded = read_json(TEXT_DIGESTS_BEFORE)
    for item in _bank()["items"]:
        for quality in ("strong", "weak"):
            text = item["justifications"][quality]["text"]
            digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
            assert digest == recorded[item["id"]][quality], (
                f"{item['id']}.{quality} text changed. The 6/6 change is a relabelling; "
                f"rewriting a justification is a different decision and not this one."
            )


def test_the_weak_side_draws_on_more_than_one_sub_domain():
    # Weak arguments clustering in one topic would let a participant infer
    # "questions about X get vague answers", which is a cue about the design
    # rather than about argument quality.
    weak_topics = {
        i["topic"] for i in _bank()["items"]
        if i["assigned_justification_quality"] == "weak"
    }
    assert len(weak_topics) >= 3, weak_topics
