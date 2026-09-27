"""The v3 stimulus set is the approved text, and only the approved text.

The researcher approved Appendices B-E word for word. The app reads JSON that
pipeline/stimuli_v3.py derives from verbatim copies of those appendices, so the
questions worth asking are whether the derivation kept every word and whether
it let anything through that a participant must not see.

Where it matters, these tests re-derive the answer independently of the
parser: a check that calls the code it checks can only agree with it.
"""

from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path

import pytest

import stimuli_v3 as s

#: The brief's list. `core:` is matched as a word: the debrief's "Your mission
#: readiness score:" contains it as a substring, and the annotation it exists
#: to catch ("WEAK — core: A3") always starts a word.
FORBIDDEN = (re.compile(r"\["), re.compile("FLAW"), re.compile(r"\bcore:"), re.compile("TODO"))


@pytest.fixture(scope="module")
def built() -> dict[Path, object]:
    return s.build()


@pytest.fixture(scope="module")
def explanations(built) -> list[dict]:
    return built[s.EXPLANATIONS]["explanations"]


# --- (a) twelve claims, two versions, one shared opening ---------------------


def test_twelve_claims_times_two_versions(explanations) -> None:
    assert len(explanations) == 24
    counts = Counter(e["claim_id"] for e in explanations)
    assert sorted(counts) == [f"claim_{n:02d}" for n in range(1, 13)]
    assert set(counts.values()) == {2}
    for claim_id in counts:
        versions = sorted(e["version"] for e in explanations if e["claim_id"] == claim_id)
        assert versions == ["strong", "weak"], claim_id


def test_strong_and_weak_open_with_the_same_sentence_byte_for_byte(explanations) -> None:
    by_claim: dict[str, dict[str, str]] = {}
    for e in explanations:
        by_claim.setdefault(e["claim_id"], {})[e["version"]] = e["text"]
    for claim_id, pair in by_claim.items():
        strong_first = s.split_sentences(pair["strong"])[0].encode("utf-8")
        weak_first = s.split_sentences(pair["weak"])[0].encode("utf-8")
        assert strong_first == weak_first, claim_id


def test_the_shared_opening_is_the_claim_itself(explanations) -> None:
    for e in explanations:
        assert s.split_sentences(e["text"])[0] == e["claim"], (e["claim_id"], e["version"])


def test_four_claims_per_module(explanations) -> None:
    modules = Counter(e["module"] for e in explanations if e["version"] == "strong")
    assert modules == {1: 4, 2: 4, 3: 4}


def test_every_weak_explanation_carries_its_flaw_and_core(explanations) -> None:
    for e in explanations:
        if e["version"] == "weak":
            assert e["flaw"] and e["core"] and e["techniques"], e["claim_id"]
            assert e["evidence_type"] is None
        else:
            assert e["evidence_type"] and e["flaw"] is None and e["core"] is None, e["claim_id"]


# --- (b) nothing meant for the researcher reaches a participant --------------


def leaks(strings: list[tuple[str, str]]) -> list[tuple[str, str]]:
    """Forbidden fragments, with the brief's own placeholder markers set aside.

    Rule 3 of the brief makes `[TODO-DARYA: ...]` the one sanctioned marker for
    missing text. It is not waved through: every one is listed in the manifest,
    sets launch_ready to false, and fails the pre-pilot validation until the
    researcher supplies the text (see the tests further down). What is checked
    here is that nothing *else* leaks -- a stray tag, a FLAW line, a core code.
    """
    found = []
    for where, text in strings:
        remainder = s.PLACEHOLDER.sub("", text or "")
        for fragment in FORBIDDEN:
            if fragment.search(remainder):
                found.append((where, fragment.pattern))
    return found


def test_no_participant_string_contains_markup_or_researcher_notes(built) -> None:
    assert leaks(s.visible_strings(built)) == []


@pytest.mark.parametrize(
    "planted",
    [
        "Some text. [A3, B1]",
        "FLAW: this should never be shown.",
        "WEAK — core: C1",
        "TODO fix wording",
        "A [bracket] of any kind.",
        "core: B2 + E1",
    ],
)
def test_the_leak_check_can_fail(planted: str) -> None:
    assert leaks([("planted", planted)]) != []


def test_the_word_score_is_not_mistaken_for_a_core_code() -> None:
    assert leaks([("debrief", "Your mission readiness score: {score} / 12")]) == []


def test_a_placeholder_is_only_set_aside_in_its_exact_form() -> None:
    assert leaks([("x", "Contact: [TODO-DARYA: contact email].")]) == []
    assert leaks([("x", "Contact: TODO-DARYA contact email.")]) != []
    assert leaks([("x", "Contact: [TODO: contact email].")]) != []


def test_every_placeholder_is_recorded_and_blocks_launch(built) -> None:
    manifest = json.loads(s.MANIFEST.read_text(encoding="utf-8"))
    found = s.placeholders(built)
    assert manifest["open_placeholders"] == found
    assert manifest["launch_ready"] is (not found)
    # Independently of the helper: count the markers in the source itself.
    in_source = len(re.findall(r"\[TODO-DARYA", s.SOURCE_E.read_text(encoding="utf-8")))
    assert len(found) == in_source


# --- (c) the text is the source, character for character ---------------------


def _tag_free_source_lines(path: Path) -> set[str]:
    # An independent tag remover: tags are one or more codes like A3 inside
    # square brackets, preceded by a space.
    cleaned = re.sub(r" \[[A-E]\d(?:, [A-E]\d)*\]", "", path.read_text(encoding="utf-8"))
    return {line.rstrip() for line in cleaned.splitlines()}


def test_explanations_equal_the_source_once_tags_are_removed(explanations) -> None:
    lines = _tag_free_source_lines(s.SOURCE_B)
    for e in explanations:
        assert e["text"] in lines, (e["claim_id"], e["version"])


def test_flaws_and_claims_are_verbatim(explanations) -> None:
    source = s.SOURCE_B.read_text(encoding="utf-8")
    for e in explanations:
        assert f"[{int(e['claim_id'][-2:])}] CLAIM: {e['claim']}" in source
        if e["flaw"]:
            assert f"FLAW: {e['flaw']}" in source


def test_every_other_visible_string_occurs_verbatim_in_a_source_file(built) -> None:
    sources = "\n".join(p.read_text(encoding="utf-8") for p in sorted(s.SOURCE.glob("*.md")))
    for where, text in s.visible_strings(built):
        if where.startswith("mission_heading/"):
            continue  # a template filled with the module number; checked below
        if where.endswith("/text") and where.startswith("claim_"):
            continue  # tag removal applies; checked above
        assert text in sources, where
    template = built[s.MISSION]["mission_heading_template"]
    assert template in sources and "{N}" in template


def test_no_double_spaces_survive_tag_removal(explanations) -> None:
    for e in explanations:
        assert "  " not in e["text"], e["claim_id"]


# --- the rest of the materials have the shape the design needs ---------------


def test_tone_lines_cover_every_claim_in_both_tones(built) -> None:
    lines = built[s.TONE]["lines"]
    assert [l["claim_id"] for l in lines] == [f"claim_{n:02d}" for n in range(1, 13)]
    for l in lines:
        assert l["ei_line"] and l["neutral_line"] and l["ei_line"] != l["neutral_line"]
    transitions = built[s.TONE]["transitions"]
    assert set(transitions) == {"start", "after_m1", "after_m2", "end"}
    for pair in transitions.values():
        assert pair["ei"] and pair["neutral"]


def test_twelve_tasks_each_with_one_option_of_each_role(built) -> None:
    tasks = built[s.MISSION]["tasks"]
    assert [t["claim_id"] for t in tasks] == [f"claim_{n:02d}" for n in range(1, 13)]
    for t in tasks:
        assert sorted(o["role"] for o in t["options"]) == ["distractor", "intuitive", "lesson"], t["task_id"]
        assert t["module"] == (int(t["claim_id"][-2:]) - 1) // 4 + 1


def test_the_attention_check_has_exactly_one_right_answer(built) -> None:
    options = built[s.MISSION]["attention_check"]["options"]
    assert [o["text"] for o in options if o["correct"]] == ["Olympus"]


def test_the_quiz_has_twelve_claims_and_four_fillers(built) -> None:
    items = built[s.QUIZ]["items"]
    assert len(items) == 16
    assert [i["claim_id"] for i in items if not i["is_filler"]] == [f"claim_{n:02d}" for n in range(1, 13)]
    fillers = [i for i in items if i["is_filler"]]
    assert [f["filler_truth"] for f in fillers] == [True, True, False, False]


def test_the_committed_json_and_manifest_are_current() -> None:
    assert s.check() == []


def test_an_edited_json_file_is_caught(tmp_path, monkeypatch) -> None:
    # Copy the set, change one character of one explanation, and check again.
    import shutil

    copy = tmp_path / "v3"
    shutil.copytree(s.V3, copy)
    target = copy / "explanations.json"
    target.write_text(target.read_text(encoding="utf-8").replace("taller", "Taller", 1), encoding="utf-8")
    monkeypatch.setattr(s, "EXPLANATIONS", target)
    monkeypatch.setattr(s, "DERIVED", (target, s.TONE, s.MISSION, s.QUIZ, s.INSTRUMENTS))
    problems = s.check()
    assert any("explanations.json" in p for p in problems), problems


def test_a_sentence_ending_inside_quotes_is_still_a_sentence(explanations) -> None:
    # Claim 7's weak version: `... over the course of a "day." Many astronauts`.
    # The first splitter missed it, and the surface check reported a sentence
    # mismatch that was not there.
    weak_7 = next(e for e in explanations if e["claim_id"] == "claim_07" and e["version"] == "weak")
    assert len(s.split_sentences(weak_7["text"])) == 4
