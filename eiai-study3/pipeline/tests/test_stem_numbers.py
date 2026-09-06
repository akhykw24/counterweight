"""A number the question itself supplies is not a stray numeric claim.

The finding
-----------
The equivalence check requires that a response body state the advice value and
no other number. On the first real generation run it failed four times, all on
item_12, all on the figure 4000 -- which is the depth in the question the
participant is reading on the same screen: *"What is the ambient water
temperature at 4,000 metres depth?"*. Restating it is the natural way to answer
in English.

Two independent generations confirmed it is not a fluke: the first restated the
depth in three of four variants, the second in four of four. So this is a false
positive in the rule rather than a defect in the text, and re-rolling cannot
clear it.

item_12 is the only item in the bank whose question contains a number at all,
so the exemption's reach is exactly one figure in one item.

What must not change
--------------------
The exemption is confined to numbers that appear literally in that item's own
question. A leaked true value, an invented figure, or a number borrowed from a
different item's question is still a failure. Those are the cases these tests
pin, because an exemption nobody has bounded is how a check quietly stops
checking.
"""

from __future__ import annotations

from verify_equivalence import stray_numbers

STEM = "What is the ambient water temperature at 4,000 metres depth, in degrees Celsius?"


def test_the_advice_value_is_never_stray() -> None:
    assert stray_numbers("The temperature is approximately 2 degrees Celsius.", 2.0, STEM) == []


def test_a_figure_from_the_question_is_not_a_claim() -> None:
    # The whole point. The participant is looking at "4,000 metres" as they
    # read this sentence; echoing it tells them nothing they do not have.
    text = "The ambient water temperature at 4,000 metres is approximately 2 degrees Celsius."
    assert stray_numbers(text, 2.0, STEM) == []


def test_an_invented_figure_is_still_caught() -> None:
    text = "At 4,000 metres the temperature is about 2 degrees, and salinity is 35 parts per thousand."
    assert stray_numbers(text, 2.0, STEM) == [35.0]


def test_a_leaked_true_value_is_still_caught() -> None:
    # The failure the rule exists for. On a planted-error item the advice is
    # wrong on purpose; the true value appearing anywhere in the body would
    # hand the participant the answer and destroy the trial.
    stem = "What was the longest recorded sperm whale dive, in minutes?"
    text = "The longest recorded dive is about 35 minutes, though some sources say 90."
    assert stray_numbers(text, 35.0, stem) == [90.0]


def test_a_number_from_a_different_item_is_not_exempt() -> None:
    # The exemption is per item. Borrowing another question's figure is exactly
    # the kind of cross-contamination a global whitelist would have allowed.
    text = "The temperature is 2 degrees, comparable to conditions at 8336 metres."
    assert stray_numbers(text, 2.0, STEM) == [8336.0]


def test_a_stem_number_written_in_another_format_still_matches() -> None:
    # "4,000" in the question, "4000" in the body: the same figure, and the
    # comparison is numeric rather than textual for exactly this reason.
    assert stray_numbers("At 4000 m the temperature is 2 degrees.", 2.0, STEM) == []


def test_a_question_with_no_numbers_exempts_nothing() -> None:
    stem = "What is the maximum recorded total length of a giant squid, in metres?"
    assert stray_numbers("About 13 metres, and 20 in folklore.", 13.0, stem) == [20.0]
