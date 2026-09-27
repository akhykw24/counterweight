#!/usr/bin/env python3
"""Build the v3 stimulus set from the approved source texts.

The researcher approved Appendices B-E of the v3 brief word for word. They are
kept exactly as written in `stimuli/v3/source/`, and everything the app shows
is *derived* from those files by this script rather than typed out a second
time. A retyped copy is a second text; a derived copy can be proven equal.

What the derivation is allowed to do, and nothing else:

  - remove technique tags such as ` [A3, B1]` together with the space before
    them, and collapse any double space that leaves behind;
  - drop the annotations addressed to the researcher (role labels, codes,
    notes in parentheses, `FLAW:` lines, `→ ineligible screen` and so on);
  - split a line into the pieces a screen needs (an item code from its text,
    a scale's anchors from its question).

Every string a participant sees therefore occurs verbatim in a source file,
apart from the tag removal -- and `pipeline/tests/test_stimuli_v3.py` checks
exactly that.

Usage
-----
    python pipeline/stimuli_v3.py            # rebuild the JSON and the manifest
    python pipeline/stimuli_v3.py --check    # fail if either is stale or edited

Exit codes: 0 current, 1 stale or edited.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any, Iterable

from _common import REPO_ROOT

V3 = REPO_ROOT / "stimuli" / "v3"
SOURCE = V3 / "source"
SOURCE_B = SOURCE / "B_explanations.md"
SOURCE_C = SOURCE / "C_tone_and_transitions.md"
SOURCE_D = SOURCE / "D_lesson_mission_quiz.md"
SOURCE_E = SOURCE / "E_consent_questionnaire_debrief.md"

EXPLANATIONS = V3 / "explanations.json"
TONE = V3 / "tone.json"
MISSION = V3 / "mission.json"
QUIZ = V3 / "quiz.json"
INSTRUMENTS = V3 / "instruments.json"
NCS6 = V3 / "ncs6_items.json"
MANIFEST = V3 / "manifest.json"

#: The files the app reads. The manifest covers these and the sources.
DERIVED = (EXPLANATIONS, TONE, MISSION, QUIZ, INSTRUMENTS)

#: Technique tags as they appear in Appendix B: ` [A3, B1]`.
TAG = re.compile(r" ?\[([A-E][0-9](?:, ?[A-E][0-9])*)\]")

#: The marker the brief uses for text the researcher still has to supply.
PLACEHOLDER = re.compile(r"\[TODO-DARYA[^\]]*\]")


class SourceError(ValueError):
    """The source text is not in the shape this parser was written for."""


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def strip_tags(text: str) -> tuple[str, list[str]]:
    """Removes technique tags; returns the clean text and the codes in order."""
    codes: list[str] = []
    for match in TAG.finditer(text):
        for code in match.group(1).split(","):
            code = code.strip()
            if code not in codes:
                codes.append(code)
    clean = TAG.sub("", text)
    clean = re.sub(r" {2,}", " ", clean).strip()
    return clean, codes


def split_sentences(text: str) -> list[str]:
    """Sentences, split after . ! ? when followed by a capital or a quote.

    A closing quote may sit between the stop and the space: claim 7's weak
    version ends a sentence with `a "day."`, and missing that miscounted it.
    """
    parts = re.split(r"(?:(?<=[.!?])|(?<=[.!?][\"”’]))\s+(?=[A-Z\"“‘])", text.strip())
    return [p for p in parts if p]


def lines_of(text: str) -> list[str]:
    return [line.rstrip() for line in text.splitlines()]


def section(text: str, start: str, end: str | None) -> str:
    """The text between two headings (exclusive of both)."""
    i = text.index(start) + len(start)
    j = text.index(end, i) if end else len(text)
    return text[i:j]


def after_label(line: str) -> str:
    """`[1] EI (E3): text` -> `text`; `Start — NEUTRAL: text` -> `text`."""
    return line.split(": ", 1)[1].strip()


def scale_anchors(parenthetical: str) -> dict[str, Any]:
    """`(1 = Not at all … 7 = Extremely)` -> {min, max, low, high}."""
    m = re.fullmatch(r"\((\d) = (.+?) … (\d) = (.+?)\)", parenthetical.strip())
    if not m:
        raise SourceError(f"not a scale: {parenthetical!r}")
    return {"min": int(m.group(1)), "low": m.group(2), "max": int(m.group(3)), "high": m.group(4)}


# ---------------------------------------------------------------------------
# Appendix B -- explanations
# ---------------------------------------------------------------------------

CLAIM_HEAD = re.compile(r"^\[(\d+)\] CLAIM: (.+)$")
MODULE_HEAD = re.compile(r"^## MODULE (\d) — (.+)$")


def parse_explanations(text: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    module = None
    lines = lines_of(text)
    i = 0
    while i < len(lines):
        line = lines[i]
        m = MODULE_HEAD.match(line)
        if m:
            module = int(m.group(1))
            i += 1
            continue
        m = CLAIM_HEAD.match(line)
        if not m:
            i += 1
            continue
        claim_number = int(m.group(1))
        claim = m.group(2).strip()
        block: list[str] = []
        i += 1
        while i < len(lines) and not CLAIM_HEAD.match(lines[i]) and not MODULE_HEAD.match(lines[i]):
            block.append(lines[i])
            i += 1
        nonblank = [b for b in block if b.strip()]
        strong_head = next(b for b in nonblank if b.startswith("STRONG — "))
        weak_head = next(b for b in nonblank if b.startswith("WEAK — "))
        s = nonblank.index(strong_head)
        w = nonblank.index(weak_head)
        strong_raw = " ".join(nonblank[s + 1 : w]).strip()
        weak_lines = nonblank[w + 1 :]
        flaw_line = next(b for b in weak_lines if b.startswith("FLAW: "))
        weak_raw = " ".join(b for b in weak_lines if not b.startswith("FLAW: ")).strip()

        strong_text, strong_codes = strip_tags(strong_raw)
        weak_text, weak_codes = strip_tags(weak_raw)
        evidence_type = strong_head.split("evidence type:", 1)[1].strip()
        core = weak_head.split("core:", 1)[1].strip()
        if module is None:
            raise SourceError(f"claim {claim_number} appears before any module heading")

        claim_id = f"claim_{claim_number:02d}"
        common = {"claim_id": claim_id, "module": module, "claim": claim}
        out.append({
            **common,
            "version": "strong",
            "text": strong_text,
            "techniques": strong_codes,
            "evidence_type": evidence_type,
            "core": None,
            "flaw": None,
        })
        out.append({
            **common,
            "version": "weak",
            "text": weak_text,
            "techniques": weak_codes,
            "evidence_type": None,
            "core": core,
            "flaw": flaw_line[len("FLAW: "):].strip(),
        })
    return out


# ---------------------------------------------------------------------------
# Appendix C -- tone lines and transitions
# ---------------------------------------------------------------------------

TONE_LINE = re.compile(r"^\[(\d+)\] (EI|NEUTRAL)(?: \(([^)]*)\))?: (.+)$")
TRANSITION_LINE = re.compile(r"^(Start|After M1|After M2|End) — (EI|NEUTRAL)(?: \(([^)]*)\))?: (.+)$")
TRANSITION_KEYS = {"Start": "start", "After M1": "after_m1", "After M2": "after_m2", "End": "end"}


def parse_tone(text: str) -> dict[str, Any]:
    lines: dict[str, dict[str, Any]] = {}
    transitions: dict[str, dict[str, Any]] = {}
    for line in lines_of(text):
        m = TONE_LINE.match(line)
        if m:
            claim_id = f"claim_{int(m.group(1)):02d}"
            entry = lines.setdefault(claim_id, {"claim_id": claim_id})
            key = "ei" if m.group(2) == "EI" else "neutral"
            entry[f"{key}_line"] = m.group(4).strip()
            if key == "ei":
                entry["ei_codes"] = [c.strip() for c in (m.group(3) or "").split(",") if c.strip()]
            continue
        m = TRANSITION_LINE.match(line)
        if m:
            name = TRANSITION_KEYS[m.group(1)]
            entry = transitions.setdefault(name, {})
            entry["ei" if m.group(2) == "EI" else "neutral"] = m.group(4).strip()
    return {"lines": [lines[k] for k in sorted(lines)], "transitions": transitions}


# ---------------------------------------------------------------------------
# Appendix D -- lesson headings, mission, attention check, quiz
# ---------------------------------------------------------------------------

TASK_HEAD = re.compile(r"^\[T(\d+) → claim (\d+)\] (.+)$")
OPTION = re.compile(r"^- \((lesson|intuitive|distractor)\) (.+)$")


def parse_mission(text: str) -> dict[str, Any]:
    lines = lines_of(text)
    headings = {}
    for line in lines:
        m = re.match(r"^- (LESSON — Module (\d): .+)$", line)
        if m:
            headings[int(m.group(2))] = m.group(1)

    mission_line = next(l for l in lines if l.startswith("MISSION — Module {N}."))
    confidence = next(l for l in lines if l.startswith("How sure are you?"))
    labels = re.findall(r"\[([^\]]+)\]", confidence)
    prompt = confidence.split("  [", 1)[0].strip()

    tasks: list[dict[str, Any]] = []
    module = None
    i = 0
    d1 = section(text, "## D1.", "## D2.")
    d1_lines = lines_of(d1)
    while i < len(d1_lines):
        line = d1_lines[i]
        mm = re.match(r"^### Module (\d)$", line)
        if mm:
            module = int(mm.group(1))
        m = TASK_HEAD.match(line)
        if m:
            situation = d1_lines[i + 1].strip()
            options = []
            j = i + 2
            while j < len(d1_lines) and d1_lines[j].startswith("- "):
                o = OPTION.match(d1_lines[j])
                if not o:
                    raise SourceError(f"option without a role: {d1_lines[j]!r}")
                options.append({"role": o.group(1), "text": o.group(2).strip()})
                j += 1
            tasks.append({
                "task_id": f"T{int(m.group(1))}",
                "claim_id": f"claim_{int(m.group(2)):02d}",
                "module": module,
                "title": m.group(3).strip(),
                "situation": situation,
                "options": options,
            })
            i = j
            continue
        i += 1

    d2 = lines_of(section(text, "## D2.", "## D3."))
    d2 = [l for l in d2 if l.strip()]
    title = d2[1].strip()
    instruction = d2[2].strip()
    attention_options = []
    for l in d2[3:]:
        if not l.startswith("- "):
            continue
        label = l[2:].strip()
        correct = label.endswith("(correct)")
        attention_options.append({"text": label.replace("(correct)", "").strip(), "correct": correct})

    return {
        "lesson_headings": {str(k): headings[k] for k in sorted(headings)},
        "mission_heading_template": mission_line,
        "confidence": {"prompt": prompt, "labels": labels, "codes": [1, 2, 3, 4]},
        "tasks": tasks,
        "attention_check": {
            "module": 2,
            "title": title,
            "instruction": instruction,
            "options": attention_options,
        },
    }


QUIZ_LINE = re.compile(r"^(Q\d+|F\d+) \((claim (\d+)|filler, (true|false))\): (.+)$")


def parse_quiz(text: str) -> dict[str, Any]:
    d3 = [l for l in lines_of(section(text, "## D3.", None)) if l.strip()]
    heading = d3[1].strip()
    scale_line = d3[2].strip()
    m = re.fullmatch(r"Scale: (\d) = (.+?) … (\d) = (.+)", scale_line)
    if not m:
        raise SourceError(f"quiz scale: {scale_line!r}")
    items = []
    for line in d3[3:]:
        q = QUIZ_LINE.match(line)
        if not q:
            continue
        is_filler = q.group(3) is None
        items.append({
            "item_id": q.group(1),
            "claim_id": None if is_filler else f"claim_{int(q.group(3)):02d}",
            "is_filler": is_filler,
            "filler_truth": None if not is_filler else q.group(4) == "true",
            "statement": q.group(5).strip(),
        })
    return {
        "heading": heading,
        "scale": {"min": int(m.group(1)), "low": m.group(2), "max": int(m.group(3)), "high": m.group(4)},
        "items": items,
    }


# ---------------------------------------------------------------------------
# Appendix E -- consent, screening, questionnaires, debrief
# ---------------------------------------------------------------------------


def _paragraphs(block: str) -> list[str]:
    return [p.strip() for p in block.strip().split("\n\n") if p.strip()]


def parse_instruments(text: str) -> dict[str, Any]:
    e1 = _paragraphs(section(text, "## E1. Information and consent", "## E2."))
    pilot_note_prefix = "(Only when pilot=true:) "
    consent_paragraphs = []
    pilot_notice = None
    checkboxes: list[str] = []
    button = None
    for p in e1:
        if p.startswith(pilot_note_prefix):
            pilot_notice = p[len(pilot_note_prefix):].strip()
        elif p.startswith("[ ] "):
            # The checkboxes and the button share one block in the source.
            for line in p.splitlines():
                line = line.strip()
                if line.startswith("[ ] "):
                    checkboxes.append(line[4:].strip())
                elif re.fullmatch(r"\[[A-Za-z ]+\]", line):
                    button = line[1:-1]
                else:
                    raise SourceError(f"unexpected line in the consent block: {line!r}")
        else:
            consent_paragraphs.append(p)

    e2 = lines_of(section(text, "## E2. Screening", "## E3."))
    s1 = next(l for l in e2 if l.startswith("S1. "))
    s2 = next(l for l in e2 if l.startswith("S2. "))
    s3 = next(l for l in e2 if l.startswith("S3. "))
    cefr_codes = ["A1-A2", "B1", "B2", "C1", "C2-native"]
    s2_options = [l[2:] for l in e2[e2.index(s2) + 1:] if l.startswith("- ")][:5]
    cefr_options = []
    for code, raw in zip(cefr_codes, s2_options):
        label = re.sub(r" \((?:A1–A2 → ineligible screen|B1|B2|C1|C2/native)\)$", "", raw).strip()
        cefr_options.append({"code": code, "label": label, "eligible": code != "A1-A2"})
    s3_question, s3_opts = s3[4:].split("  ", 1)
    ineligible = next(l for l in e2 if l.startswith("Ineligible screen: "))[len("Ineligible screen: "):]

    e3 = [l for l in lines_of(section(text, "## E3. Before the training (one screen)", "## E4.")) if l.strip()]
    pre: list[dict[str, Any]] = []
    agree_scale = None
    for l in e3:
        m = re.match(r"^(P[1-3])\. (.+?)  (.+)$", l)
        if m:
            question, rest = m.group(2), m.group(3)
            if rest.startswith("("):
                pre.append({"item_id": m.group(1), "text": question, "scale": scale_anchors(rest)})
            else:
                pre.append({"item_id": m.group(1), "text": question,
                            "options": [o.strip() for o in rest.split(" / ")]})
            continue
        m = re.match(r"^P4–P6: (\(.+\))$", l)
        if m:
            agree_scale = scale_anchors(m.group(1))
            continue
        m = re.match(r"^(P[4-6])\. (.+)$", l)
        if m:
            pre.append({"item_id": m.group(1), "text": m.group(2).strip(), "scale": agree_scale})

    e4 = [l for l in lines_of(section(text, "## E4. About Nova", "## E5.")) if l.strip()]
    instruction_line = e4[0]
    instr, scale_part = instruction_line.split(" (", 1)
    tutor_scale = scale_anchors("(" + scale_part)
    stem = e4[1].strip()
    tutor_items = []
    for l in e4[2:]:
        m = re.match(r"^([TRE]\d)\. (.+)$", l)
        if m:
            tutor_items.append({"item_id": m.group(1), "text": m.group(2).strip(),
                                "uses_stem": m.group(1).startswith("T")})

    e5 = [l for l in lines_of(section(text, "## E5. A few questions about the study (one per screen, no going back)", "## E6.")) if l.strip()]
    funnel = []
    for l in e5:
        m = re.match(r"^(F\d)\. (.+?)  (.+)$", l)
        if not m:
            continue
        if m.group(3) == "[open text]":
            funnel.append({"item_id": m.group(1), "text": m.group(2), "kind": "text"})
        else:
            funnel.append({"item_id": m.group(1), "text": m.group(2), "kind": "choice",
                           "options": [o.strip() for o in m.group(3).split(" / ")]})

    e6 = [l for l in lines_of(section(text, "## E6. Nova's explanations", "## E7.")) if l.strip()]
    quality = {"instruction": e6[0].strip(), "scale": scale_anchors(e6[1])}

    e8 = [l for l in lines_of(section(text, "## E8. About you", "## E9.")) if l.strip()]
    demographics = []
    for l in e8:
        m = re.match(r"^(D\d)\. (.+?): (.+)$", l)
        if not m:
            continue
        rest = m.group(3)
        if rest == "[text]":
            demographics.append({"item_id": m.group(1), "text": m.group(2), "kind": "text"})
            continue
        options = []
        for o in rest.split(" / "):
            o = o.strip()
            if o.endswith(" [text]"):
                options.append({"label": o[: -len(" [text]")], "free_text": True})
            else:
                options.append({"label": o, "free_text": False})
        demographics.append({"item_id": m.group(1), "text": m.group(2), "kind": "choice", "options": options})

    e9 = [l for l in lines_of(section(text, "## E9. Pilot feedback (only when pilot=true)", "## E10.")) if l.strip()]
    pilot_feedback = []
    for l in e9:
        m = re.match(r"^(PF\d)\. (.+?)  \[open text\]$", l)
        if m:
            pilot_feedback.append({"item_id": m.group(1), "text": m.group(2)})

    debrief = parse_debrief(section(text, "## E10. Debriefing", None))

    return {
        "consent": {
            "paragraphs": consent_paragraphs,
            "pilot_notice": pilot_notice,
            "checkboxes": checkboxes,
            "button": button,
        },
        "screening": {
            "age": {"item_id": "S1", "text": s1[4:].split("  ", 1)[0], "minimum": 18},
            "english": {"item_id": "S2", "text": s2[4:], "options": cefr_options},
            "study_language": {"item_id": "S3", "text": s3_question,
                               "options": [o.strip() for o in s3_opts.split(" / ")]},
            "ineligible": ineligible.strip(),
        },
        "pre_measures": pre,
        "tutor": {"instruction": instr.strip(), "scale": tutor_scale, "stem": stem, "items": tutor_items},
        "funnel": funnel,
        "explanation_quality": quality,
        "demographics": demographics,
        "pilot_feedback": pilot_feedback,
        "debrief": debrief,
    }


def parse_debrief(block: str) -> dict[str, Any]:
    # Line-level first: the source puts a researcher's note and the button on
    # lines of their own inside otherwise participant-facing paragraphs.
    paras: list[str] = []
    button = None
    for para in _paragraphs(block):
        kept = []
        for line in para.splitlines():
            if line.startswith("(score = "):
                continue  # how the score is computed; for the researcher
            if re.fullmatch(r"\[[A-Za-z ]+\]", line.strip()):
                button = line.strip()[1:-1]
                continue
            kept.append(line)
        if kept:
            paras.append("\n".join(kept))

    title = paras[0]
    score_line = paras[1]
    sections: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    for p in paras[2:]:
        # A heading sits either alone or on the first line of its paragraph.
        m = re.match(r"\*\*(.+)\*\*(?:\n|$)", p)
        if m:
            current = {"heading": m.group(1), "paragraphs": []}
            sections.append(current)
            p = p[m.end():].strip()
            if not p:
                continue
        if current is None:
            raise SourceError(f"debrief text before any heading: {p!r}")
        current["paragraphs"].append(p)

    if button is None:
        raise SourceError("debrief has no [button] line")
    by_heading = {s["heading"]: s for s in sections}
    about = by_heading["What this study was really about"]["paragraphs"]
    flawed = by_heading["Where Nova's reasoning was flawed in your version"]["paragraphs"]
    answers = by_heading["Correct answers"]["paragraphs"]
    data = by_heading["Your data"]["paragraphs"]

    return {
        "title": title,
        "score_template": score_line,
        "about_heading": "What this study was really about",
        # Multi-line paragraphs are numbered lists, one item per line.
        "about_paragraphs": about,
        "flawed_heading": "Where Nova's reasoning was flawed in your version",
        # The source's instruction for this block, kept so the rule is
        # visible next to the data it governs. Not shown to participants.
        "flawed_rule": flawed[0],
        "answers_heading": "Correct answers",
        "answers_paragraphs": answers,
        "data_heading": "Your data",
        "data_paragraphs": data[:1],
        "remove_button": button,
        "closing_paragraphs": data[1:],
    }


# ---------------------------------------------------------------------------
# Build, participant-visible strings, manifest
# ---------------------------------------------------------------------------


def build() -> dict[Path, Any]:
    return {
        EXPLANATIONS: {"explanations": parse_explanations(read(SOURCE_B))},
        TONE: parse_tone(read(SOURCE_C)),
        MISSION: parse_mission(read(SOURCE_D)),
        QUIZ: parse_quiz(read(SOURCE_D)),
        INSTRUMENTS: parse_instruments(read(SOURCE_E)),
    }


def dump(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False, indent=2) + "\n"


def visible_strings(built: dict[Path, Any]) -> list[tuple[str, str]]:
    """Every (where, text) pair a participant can see.

    Kept next to the parser because the two have to change together: a field
    added to the JSON and shown in the app but missing here would escape the
    leak checks.
    """
    out: list[tuple[str, str]] = []

    for e in built[EXPLANATIONS]["explanations"]:
        out.append((f"{e['claim_id']}/{e['version']}/text", e["text"]))

    tone = built[TONE]
    for line in tone["lines"]:
        out.append((f"{line['claim_id']}/ei_line", line["ei_line"]))
        out.append((f"{line['claim_id']}/neutral_line", line["neutral_line"]))
    for name, pair in tone["transitions"].items():
        out.append((f"transition/{name}/ei", pair["ei"]))
        out.append((f"transition/{name}/neutral", pair["neutral"]))

    mission = built[MISSION]
    for k, heading in mission["lesson_headings"].items():
        out.append((f"lesson_heading/{k}", heading))
    for n in (1, 2, 3):
        out.append((f"mission_heading/{n}", mission["mission_heading_template"].replace("{N}", str(n))))
    out.append(("confidence/prompt", mission["confidence"]["prompt"]))
    out.extend((f"confidence/{i}", label) for i, label in enumerate(mission["confidence"]["labels"]))
    for task in mission["tasks"]:
        out.append((f"{task['task_id']}/title", task["title"]))
        out.append((f"{task['task_id']}/situation", task["situation"]))
        out.extend((f"{task['task_id']}/option", o["text"]) for o in task["options"])
    ac = mission["attention_check"]
    out.append(("attention/title", ac["title"]))
    out.append(("attention/instruction", ac["instruction"]))
    out.extend(("attention/option", o["text"]) for o in ac["options"])

    quiz = built[QUIZ]
    out.append(("quiz/heading", quiz["heading"]))
    out.append(("quiz/low", quiz["scale"]["low"]))
    out.append(("quiz/high", quiz["scale"]["high"]))
    out.extend((f"quiz/{q['item_id']}", q["statement"]) for q in quiz["items"])

    ins = built[INSTRUMENTS]
    c = ins["consent"]
    out.extend(("consent/paragraph", p) for p in c["paragraphs"])
    out.append(("consent/pilot_notice", c["pilot_notice"]))
    out.extend(("consent/checkbox", p) for p in c["checkboxes"])
    out.append(("consent/button", c["button"]))
    s = ins["screening"]
    out.append(("screening/age", s["age"]["text"]))
    out.append(("screening/english", s["english"]["text"]))
    out.extend(("screening/english/option", o["label"]) for o in s["english"]["options"])
    out.append(("screening/study_language", s["study_language"]["text"]))
    out.extend(("screening/study_language/option", o) for o in s["study_language"]["options"])
    out.append(("screening/ineligible", s["ineligible"]))
    for p in ins["pre_measures"]:
        out.append((f"pre/{p['item_id']}", p["text"]))
        if "scale" in p:
            out.append((f"pre/{p['item_id']}/low", p["scale"]["low"]))
            out.append((f"pre/{p['item_id']}/high", p["scale"]["high"]))
        out.extend((f"pre/{p['item_id']}/option", o) for o in p.get("options", []))
    t = ins["tutor"]
    out.append(("tutor/instruction", t["instruction"]))
    out.append(("tutor/stem", t["stem"]))
    out.append(("tutor/low", t["scale"]["low"]))
    out.append(("tutor/high", t["scale"]["high"]))
    out.extend((f"tutor/{i['item_id']}", i["text"]) for i in t["items"])
    for f in ins["funnel"]:
        out.append((f"funnel/{f['item_id']}", f["text"]))
        out.extend((f"funnel/{f['item_id']}/option", o) for o in f.get("options", []))
    q = ins["explanation_quality"]
    out.append(("quality/instruction", q["instruction"]))
    out.append(("quality/low", q["scale"]["low"]))
    out.append(("quality/high", q["scale"]["high"]))
    for d in ins["demographics"]:
        out.append((f"demographics/{d['item_id']}", d["text"]))
        out.extend((f"demographics/{d['item_id']}/option", o["label"]) for o in d.get("options", []))
    out.extend((f"pilot/{p['item_id']}", p["text"]) for p in ins["pilot_feedback"])
    d = ins["debrief"]
    out.append(("debrief/title", d["title"]))
    out.append(("debrief/score", d["score_template"]))
    for key in ("about_heading", "flawed_heading", "answers_heading", "data_heading", "remove_button"):
        out.append((f"debrief/{key}", d[key]))
    for key in ("about_paragraphs", "answers_paragraphs", "data_paragraphs", "closing_paragraphs"):
        out.extend((f"debrief/{key}", p) for p in d[key])
    # The flawed-reasoning block shows each weak claim's sentence and flaw.
    for e in built[EXPLANATIONS]["explanations"]:
        if e["version"] == "weak":
            out.append((f"{e['claim_id']}/claim", e["claim"]))
            out.append((f"{e['claim_id']}/flaw", e["flaw"]))
    return out


def placeholders(built: dict[Path, Any]) -> list[dict[str, str]]:
    """Open [TODO-DARYA] markers in participant-facing text, with where each is."""
    found = []
    for where, text in visible_strings(built):
        for m in PLACEHOLDER.finditer(text or ""):
            found.append({"where": where, "placeholder": m.group(0)})
    return found


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _key(path: Path) -> str:
    """Manifest key: the path from the repository root, forward slashes."""
    try:
        return str(path.relative_to(REPO_ROOT)).replace("\\", "/")
    except ValueError:
        return path.name  # a copy outside the tree, as in the tests


def manifest_for(files: Iterable[Path], open_placeholders: list[dict[str, str]]) -> dict[str, Any]:
    entries = {_key(p): sha256(p) for p in files}
    digest = hashlib.sha256(
        "".join(f"{k}\n{v}\n" for k, v in sorted(entries.items())).encode("utf-8")
    ).hexdigest()
    return {
        "version": "v3",
        "files": dict(sorted(entries.items())),
        "manifest_sha256": digest,
        # Not ready while the consent or debrief still carries a marker for
        # text the researcher has to supply. Integrity (the hashes) and
        # readiness (nothing missing) are different questions; --check answers
        # the first and reports the second.
        "open_placeholders": open_placeholders,
        "launch_ready": not open_placeholders,
    }


def tracked_files() -> list[Path]:
    sources = sorted(SOURCE.glob("*.md"))
    return [*sources, *DERIVED, NCS6]


def write() -> dict[str, Any]:
    built = build()
    for path, data in built.items():
        path.write_text(dump(data), encoding="utf-8", newline="\n")
    if not NCS6.exists():
        NCS6.write_text("[]\n", encoding="utf-8", newline="\n")
    manifest = manifest_for(tracked_files(), placeholders(built))
    MANIFEST.write_text(dump(manifest), encoding="utf-8", newline="\n")
    return manifest


def check() -> list[str]:
    problems: list[str] = []
    built = build()
    for path, data in built.items():
        if not path.exists():
            problems.append(f"{path.name} is missing; run python pipeline/stimuli_v3.py")
        elif path.read_text(encoding="utf-8") != dump(data):
            problems.append(
                f"{path.name} does not match what the approved source produces "
                "(edited by hand, or the source changed without a rebuild)"
            )
    if not MANIFEST.exists():
        problems.append("manifest.json is missing")
        return problems
    recorded = json.loads(MANIFEST.read_text(encoding="utf-8"))
    current = manifest_for(tracked_files(), placeholders(built))
    for name, digest in current["files"].items():
        if recorded.get("files", {}).get(name) != digest:
            problems.append(f"{name}: hash differs from the manifest")
    for name in set(recorded.get("files", {})) - set(current["files"]):
        problems.append(f"{name}: in the manifest but no longer present")
    if recorded.get("manifest_sha256") != current["manifest_sha256"]:
        problems.append("manifest_sha256 is stale")
    return problems


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build or check the v3 stimulus set.")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args(list(argv) if argv is not None else None)

    if args.check:
        problems = check()
        if problems:
            print("v3 stimuli are NOT current:", file=sys.stderr)
            for p in problems:
                print(f"  - {p}", file=sys.stderr)
            return 1
        manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
        print(f"v3 stimuli match the approved source; {len(manifest['files'])} files match the manifest.")
        print(f"  manifest_sha256 {manifest['manifest_sha256']}")
        if manifest["open_placeholders"]:
            print(f"  NOTE: launch_ready=false -- {len(manifest['open_placeholders'])} [TODO-DARYA] "
                  "placeholder(s) still in participant-facing text:")
            for p in manifest["open_placeholders"]:
                print(f"    {p['where']}: {p['placeholder']}")
        return 0

    manifest = write()
    print(f"Wrote v3 stimuli and manifest ({len(manifest['files'])} files).")
    print(f"  manifest_sha256 {manifest['manifest_sha256']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
