#!/usr/bin/env python3
"""Generate the frozen stimulus set for Study 3.

    12 items x 3 languages x (3 warm registers + 1 neutral) = 144 responses
    each carrying 3 follow-up branches                       = 432 branches

Written to materials/responses/{lang}_{condition}_{state}.json (12 files).

Two-phase by design
-------------------
Phase 1 renders each item's justification **once per language**. Phase 2 then
reuses that exact string across all four condition/register variants of that
item. The justification is therefore byte-identical across warm and neutral by
construction, not by luck -- which is precisely the claim
verify_equivalence.py has to be able to make, and the claim that answers the
reviewer objection "the conditions may have differed in content, not only
emotional style".

Offline mode
------------
`--offline` produces deterministic, structurally valid placeholder stimuli
without touching the API. This exists so the rest of the chain -- equivalence
checks, hash manifest, golden-file test, coding sheets -- can be exercised and
proven before an API key is available. Every placeholder record is flagged
`"placeholder": true` and the manifest records `launch_ready: false`.
Placeholders can never be silently mistaken for real stimuli.

Usage
-----
    python pipeline/generate.py --offline            # no API key needed
    # key from eiai-study3/.env (GEMINI_API_KEY)
    python pipeline/generate.py                      # real generation
    python pipeline/generate.py --languages en --conditions warm
    python pipeline/generate.py --dry-run

Exit codes
----------
    0  every planned variant generated and validated
    1  at least one record failed validation (files still written)
    2  configuration or I/O error, or the provider's quota stopped the run with
       variants still outstanding -- the set is incomplete and must not be
       manifested or fielded until a later run exits 0
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import time
from typing import Any, Iterable

from _common import (
    FOLLOWUP_IDS,
    MATERIALS,
    load_dotenv,
    LANGUAGE_NAMES,
    LANGUAGES,
    RESPONSES_DIR,
    VARIANTS,
    assigned_justification,
    contains_value,
    extract_numbers,
    format_number,
    has_hedge_marker,
    load_items,
    load_prompt,
    read_json,
    register_slug,
    response_id,
    sha256_text,
    stimulus_filename,
    word_count,
    write_json,
)

GENERATOR_VERSION = "2.1.0"

# Provider configuration, retry policy and budget constants live in
# pipeline/providers.py. They are re-exported here only so that existing call
# sites and the CLI defaults keep one import.
from providers import (  # noqa: E402
    DAILY_TOKEN_BUDGET,
    PROVIDER_CHOICES,
    DEFAULT_MAX_ATTEMPTS,
    DEFAULT_MAX_TOKENS,
    DEFAULT_PROVIDER,
    DEFAULT_SLEEP,
    PROVIDERS,
    ProviderError,
    GenerationHalt,
    QuotaExhausted,
    build_provider,
    resolve_defaults,
)
from cell_cache import CellCache, cell_id  # noqa: E402

BODY_WORDS = (60, 90)
FOLLOWUP_WORDS = (30, 60)
WORD_HARD_SLACK = 0.5
# Rendered justifications are checked against their own source's length rather
# than a shared band, because the pairs are word-count-matched per item.
JUSTIFICATION_WORD_SLACK = 0.25

# Operational scaffolding for the justification call, kept here rather than in
# materials/prompts/ for the same reason as OUTPUT_FORMAT_BLOCK: that file is
# reported verbatim in the appendix as pre-registered manipulation text, and
# JSON plumbing is not part of the manipulation.
JUSTIFICATION_FORMAT_BLOCK = """\
Reply with a JSON object containing exactly one key, "justification", whose
value is the rendered sentence. No other keys, and no text outside the object."""

REGISTER_PROMPTS = {
    "LOW": "warm_register_low.txt",
    "MODERATE": "warm_register_moderate.txt",
    "HIGH": "warm_register_high.txt",
}

# Operational scaffolding, kept separate from the manipulation prompts in
# materials/prompts/ so the appendix can report those verbatim as
# pre-registered and report this separately as generation machinery.
OUTPUT_FORMAT_BLOCK = """\
This response is pre-recorded and shown to many different research
participants. You are not talking to one person in real time.

Therefore:
- Never refer to the participant's specific estimate, number, or wording. You
  have not seen it. Anything you say about their thinking must make sense to
  someone who guessed far too high, far too low, or exactly right.
- The only thing you know about them is the confidence band named in the
  register above.
- Write the numeric value using digits, not words.

Produce four separate pieces of text:

1. body - your answer, under all the constraints above.
2. followup_measurement - your reply if they then ask: "Can you explain how
   that's measured?"
3. followup_certainty - your reply if they then ask: "How certain are you about
   that?"
4. followup_challenge - your reply if they then say: "I think that might be
   wrong."

Every follow-up must keep the same style, the same numeric value and the same
confidence level, add no new facts, and run 30-60 words.

For followup_challenge specifically: do not revise the value, do not concede it
may be wrong, and do not offer a different figure. Acknowledge what they said
in the style of your condition, then restate the same answer. If the warm
condition conceded more readily than the neutral condition, caving would
confound the emotional manipulation and the planted errors would not survive
contact with this follow-up."""

LANGUAGE_BLOCK = """\
Write every piece of text in {LANGUAGE_NAME} ({LANGUAGE_CODE}).

Write as a fluent native speaker would, not as a translation. Warmth markers
must take forms natural to {LANGUAGE_NAME}; do not transliterate or calque
English expressions of warmth. The factual content, the numeric value and the
confidence level must be identical to what they would be in any other language."""

BODY_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "body": {"type": "string", "description": "The answer, 60-90 words."},
        "followup_measurement": {"type": "string", "description": "Reply about measurement, 30-60 words."},
        "followup_certainty": {"type": "string", "description": "Reply about certainty, 30-60 words."},
        "followup_challenge": {"type": "string", "description": "Reply to pushback, 30-60 words. Holds the value."},
    },
    "required": ["body", "followup_measurement", "followup_certainty", "followup_challenge"],
    "additionalProperties": False,
}

JUSTIFICATION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "justification": {"type": "string", "description": "The rendered justification sentence."},
    },
    "required": ["justification"],
    "additionalProperties": False,
}


# ---------------------------------------------------------------------------
# Offline placeholder generation
# ---------------------------------------------------------------------------

_OFFLINE_LEAD = {
    "en": {
        ("warm", "LOW"): "It sounds like this one felt uncertain, which is an ordinary way to feel about it.",
        ("warm", "MODERATE"): "This is one of those questions where working it through together helps.",
        ("warm", "HIGH"): "Feeling settled about this is reasonable, and here is where the figure sits.",
        ("neutral", None): "The value is as follows.",
    },
    "ru": {
        ("warm", "LOW"): "Похоже, здесь была неуверенность, и это совершенно обычная реакция.",
        ("warm", "MODERATE"): "Это один из тех вопросов, которые полезно разобрать вместе.",
        ("warm", "HIGH"): "Уверенность здесь вполне оправдана, и вот где находится значение.",
        ("neutral", None): "Значение следующее.",
    },
    "kk": {
        ("warm", "LOW"): "Мұнда сенімсіздік болған сияқты, бұл әбден қалыпты жағдай.",
        ("warm", "MODERATE"): "Бұл бірге талқылағанда пайдалы болатын сұрақтардың бірі.",
        ("warm", "HIGH"): "Мұндағы сенімділік орынды, ал мән мынадай.",
        ("neutral", None): "Мән мынадай.",
    },
}

_OFFLINE_HEDGE = {"en": "approximately", "ru": "примерно", "kk": "шамамен"}
_OFFLINE_FILLER = {
    "en": "This sentence is placeholder filler and carries no content.",
    "ru": "Это предложение является заполнителем и не несёт содержания.",
    "kk": "Бұл сөйлем толтырғыш болып табылады және мазмұн тасымалдамайды.",
}
_OFFLINE_FOLLOWUP_LEAD = {
    "measurement": {"en": "On how it is measured:", "ru": "О том, как это измеряется:", "kk": "Мұның қалай өлшенетіні туралы:"},
    "certainty": {"en": "On how certain this is:", "ru": "О степени уверенности:", "kk": "Сенімділік дәрежесі туралы:"},
    "challenge": {"en": "I hear that, and the figure stands:", "ru": "Понимаю, и значение остаётся прежним:", "kk": "Түсінемін, мән өзгеріссіз қалады:"},
}


def _pad_to(text: str, language: str, target: int) -> str:
    filler = _OFFLINE_FILLER[language]
    while word_count(text) < target:
        text = f"{text} {filler}"
    words = text.split()
    return " ".join(words[:target]) if len(words) > target else text


def offline_body(item: dict[str, Any], language: str, condition: str, state: str | None) -> dict[str, str]:
    """Deterministic placeholder that satisfies every structural constraint.

    Contains the advice value in digits and a real hedge marker, so the
    validator and verify_equivalence.py exercise their real code paths rather
    than being skipped.
    """
    value = format_number(item["advice_value"])
    hedge = _OFFLINE_HEDGE[language]
    lead = _OFFLINE_LEAD[language][(condition, state)]
    head = f"[PLACEHOLDER] {lead} {hedge} {value}."
    body = _pad_to(head, language, 75)

    followups: dict[str, str] = {}
    for followup_id in FOLLOWUP_IDS:
        lead_text = _OFFLINE_FOLLOWUP_LEAD[followup_id][language]
        followups[followup_id] = _pad_to(
            f"[PLACEHOLDER] {lead_text} {hedge} {value}.", language, 45
        )

    return {"body": body, **{f"followup_{k}": v for k, v in followups.items()}}


def offline_justification(item: dict[str, Any], language: str) -> str:
    source = assigned_justification(item)
    if language == "en":
        return str(source["text"])
    marker = {"ru": "[ЗАПОЛНИТЕЛЬ]", "kk": "[ТОЛТЫРҒЫШ]"}[language]
    return _pad_to(f"{marker} {source['text']}", language, int(source["word_count"]) + 1)


# ---------------------------------------------------------------------------
# Prompt assembly
# ---------------------------------------------------------------------------


def build_system_prompt(item: dict[str, Any], language: str, condition: str, state: str | None) -> str:
    unit = item["unit"]["en"]
    value_text = f"{format_number(item['advice_value'])} {unit}".strip()

    shared = (
        load_prompt("shared_constraints.txt")
        .replace("{VALUE}", value_text)
        .replace("{HEDGE_LEVEL}", "moderate")
    )

    blocks = [shared]
    if condition == "warm":
        blocks.append(load_prompt("warm_components.txt"))
        blocks.append(load_prompt(REGISTER_PROMPTS[str(state)]))
    else:
        blocks.append(load_prompt("neutral.txt"))

    blocks.append(OUTPUT_FORMAT_BLOCK)
    blocks.append(
        LANGUAGE_BLOCK.replace("{LANGUAGE_NAME}", LANGUAGE_NAMES[language]).replace(
            "{LANGUAGE_CODE}", language
        )
    )
    return "\n\n".join(blocks)


def build_justification_prompt(item: dict[str, Any], language: str) -> str:
    source = assigned_justification(item)
    return (
        load_prompt("justification_translation.txt")
        .replace("{LANGUAGE_NAME}", LANGUAGE_NAMES[language])
        .replace("{LANGUAGE_CODE}", language)
        .replace("{JUSTIFICATION_SOURCE}", str(source["text"]))
        .replace("{TARGET_WORDS}", str(source["word_count"]))
    ) + "\n\n" + JUSTIFICATION_FORMAT_BLOCK


def validate_justification(text: str, target_words: int) -> list[str]:
    """Reasons the rendered justification is unusable, empty if it is fine.

    Every source justification in the bank is number-free -- they describe how a
    figure was established, never what it is -- so "introduce no numeric value
    that is not in the source" reduces to "contains no digits at all". That is
    worth enforcing rather than trusting, because a justification that states a
    value is not merely off-spec: on an error item it leaks the true value into
    text that is shown identically in both conditions, which is the one thing
    the design cannot survive.
    """
    problems: list[str] = []
    if not text.strip():
        return ["empty"]
    numbers = extract_numbers(text)
    if numbers:
        problems.append(f"introduces numeric content {sorted(set(numbers))}; sources have none")
    # The prompt asks for the source length within two words. Enforcing exactly
    # that would burn quota re-rolling a three-word miss, and Kazakh and Russian
    # legitimately compress or expand against English. Check #5 in
    # verify_equivalence.py is the real gate on length: it compares mean strong
    # against mean weak per language, which is what would confound the
    # manipulation. This band only catches a rendering that lost the sentence.
    slack = max(3, round(target_words * JUSTIFICATION_WORD_SLACK))
    count = word_count(text)
    if abs(count - target_words) > slack:
        problems.append(f"{count} words against a target of {target_words} (+/-{slack})")
    return problems


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def validate_record(
    payload: dict[str, str], item: dict[str, Any], language: str
) -> dict[str, Any]:
    errors: list[str] = []
    warnings: list[str] = []
    advice = float(item["advice_value"])

    fields = ["body"] + [f"followup_{k}" for k in FOLLOWUP_IDS]
    for field in fields:
        text = payload.get(field, "")
        if not text.strip():
            errors.append(f"{field}: empty")
            continue

        if not contains_value(text, advice):
            errors.append(
                f"{field}: missing required value {format_number(advice)} "
                f"(found {sorted(set(extract_numbers(text)))})"
            )

        if item["is_error"] and contains_value(text, float(item["true_value"])):
            errors.append(
                f"{field}: leaks the true value {format_number(item['true_value'])} on an error item"
            )

        if not has_hedge_marker(text, language):
            warnings.append(f"{field}: no recognised {language} hedge marker")

        lo, hi = BODY_WORDS if field == "body" else FOLLOWUP_WORDS
        n = word_count(text)
        if not lo <= n <= hi:
            hard_lo, hard_hi = int(lo * (1 - WORD_HARD_SLACK)), int(hi * (1 + WORD_HARD_SLACK))
            message = f"{field}: {n} words, outside {lo}-{hi}"
            (warnings if hard_lo <= n <= hard_hi else errors).append(message)

    return {"ok": not errors, "errors": errors, "warnings": warnings}


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------


JUSTIFICATION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "justification": {"type": "string", "description": "The rendered justification sentence."},
    },
    "required": ["justification"],
    "additionalProperties": False,
}


# ---------------------------------------------------------------------------
# Offline placeholder generation
# ---------------------------------------------------------------------------

_OFFLINE_LEAD = {
    "en": {
        ("warm", "LOW"): "It sounds like this one felt uncertain, which is an ordinary way to feel about it.",
        ("warm", "MODERATE"): "This is one of those questions where working it through together helps.",
        ("warm", "HIGH"): "Feeling settled about this is reasonable, and here is where the figure sits.",
        ("neutral", None): "The value is as follows.",
    },
    "ru": {
        ("warm", "LOW"): "Похоже, здесь была неуверенность, и это совершенно обычная реакция.",
        ("warm", "MODERATE"): "Это один из тех вопросов, которые полезно разобрать вместе.",
        ("warm", "HIGH"): "Уверенность здесь вполне оправдана, и вот где находится значение.",
        ("neutral", None): "Значение следующее.",
    },
    "kk": {
        ("warm", "LOW"): "Мұнда сенімсіздік болған сияқты, бұл әбден қалыпты жағдай.",
        ("warm", "MODERATE"): "Бұл бірге талқылағанда пайдалы болатын сұрақтардың бірі.",
        ("warm", "HIGH"): "Мұндағы сенімділік орынды, ал мән мынадай.",
        ("neutral", None): "Мән мынадай.",
    },
}

_OFFLINE_HEDGE = {"en": "approximately", "ru": "примерно", "kk": "шамамен"}
_OFFLINE_FILLER = {
    "en": "This sentence is placeholder filler and carries no content.",
    "ru": "Это предложение является заполнителем и не несёт содержания.",
    "kk": "Бұл сөйлем толтырғыш болып табылады және мазмұн тасымалдамайды.",
}
_OFFLINE_FOLLOWUP_LEAD = {
    "measurement": {"en": "On how it is measured:", "ru": "О том, как это измеряется:", "kk": "Мұның қалай өлшенетіні туралы:"},
    "certainty": {"en": "On how certain this is:", "ru": "О степени уверенности:", "kk": "Сенімділік дәрежесі туралы:"},
    "challenge": {"en": "I hear that, and the figure stands:", "ru": "Понимаю, и значение остаётся прежним:", "kk": "Түсінемін, мән өзгеріссіз қалады:"},
}


def _pad_to(text: str, language: str, target: int) -> str:
    filler = _OFFLINE_FILLER[language]
    while word_count(text) < target:
        text = f"{text} {filler}"
    words = text.split()
    return " ".join(words[:target]) if len(words) > target else text


def offline_body(item: dict[str, Any], language: str, condition: str, state: str | None) -> dict[str, str]:
    """Deterministic placeholder that satisfies every structural constraint.

    Contains the advice value in digits and a real hedge marker, so the
    validator and verify_equivalence.py exercise their real code paths rather
    than being skipped.
    """
    value = format_number(item["advice_value"])
    hedge = _OFFLINE_HEDGE[language]
    lead = _OFFLINE_LEAD[language][(condition, state)]
    head = f"[PLACEHOLDER] {lead} {hedge} {value}."
    body = _pad_to(head, language, 75)

    followups: dict[str, str] = {}
    for followup_id in FOLLOWUP_IDS:
        lead_text = _OFFLINE_FOLLOWUP_LEAD[followup_id][language]
        followups[followup_id] = _pad_to(
            f"[PLACEHOLDER] {lead_text} {hedge} {value}.", language, 45
        )

    return {"body": body, **{f"followup_{k}": v for k, v in followups.items()}}


def offline_justification(item: dict[str, Any], language: str) -> str:
    source = assigned_justification(item)
    if language == "en":
        return str(source["text"])
    marker = {"ru": "[ЗАПОЛНИТЕЛЬ]", "kk": "[ТОЛТЫРҒЫШ]"}[language]
    return _pad_to(f"{marker} {source['text']}", language, int(source["word_count"]) + 1)


# ---------------------------------------------------------------------------
# Prompt assembly
# ---------------------------------------------------------------------------


def build_system_prompt(item: dict[str, Any], language: str, condition: str, state: str | None) -> str:
    unit = item["unit"]["en"]
    value_text = f"{format_number(item['advice_value'])} {unit}".strip()

    shared = (
        load_prompt("shared_constraints.txt")
        .replace("{VALUE}", value_text)
        .replace("{HEDGE_LEVEL}", "moderate")
    )

    blocks = [shared]
    if condition == "warm":
        blocks.append(load_prompt("warm_components.txt"))
        blocks.append(load_prompt(REGISTER_PROMPTS[str(state)]))
    else:
        blocks.append(load_prompt("neutral.txt"))

    blocks.append(OUTPUT_FORMAT_BLOCK)
    blocks.append(
        LANGUAGE_BLOCK.replace("{LANGUAGE_NAME}", LANGUAGE_NAMES[language]).replace(
            "{LANGUAGE_CODE}", language
        )
    )
    return "\n\n".join(blocks)


def build_justification_prompt(item: dict[str, Any], language: str) -> str:
    source = assigned_justification(item)
    return (
        load_prompt("justification_translation.txt")
        .replace("{LANGUAGE_NAME}", LANGUAGE_NAMES[language])
        .replace("{LANGUAGE_CODE}", language)
        .replace("{JUSTIFICATION_SOURCE}", str(source["text"]))
        .replace("{TARGET_WORDS}", str(source["word_count"]))
    ) + "\n\n" + JUSTIFICATION_FORMAT_BLOCK


def validate_justification(text: str, target_words: int) -> list[str]:
    """Reasons the rendered justification is unusable, empty if it is fine.

    Every source justification in the bank is number-free -- they describe how a
    figure was established, never what it is -- so "introduce no numeric value
    that is not in the source" reduces to "contains no digits at all". That is
    worth enforcing rather than trusting, because a justification that states a
    value is not merely off-spec: on an error item it leaks the true value into
    text that is shown identically in both conditions, which is the one thing
    the design cannot survive.
    """
    problems: list[str] = []
    if not text.strip():
        return ["empty"]
    numbers = extract_numbers(text)
    if numbers:
        problems.append(f"introduces numeric content {sorted(set(numbers))}; sources have none")
    # The prompt asks for the source length within two words. Enforcing exactly
    # that would burn quota re-rolling a three-word miss, and Kazakh and Russian
    # legitimately compress or expand against English. Check #5 in
    # verify_equivalence.py is the real gate on length: it compares mean strong
    # against mean weak per language, which is what would confound the
    # manipulation. This band only catches a rendering that lost the sentence.
    slack = max(3, round(target_words * JUSTIFICATION_WORD_SLACK))
    count = word_count(text)
    if abs(count - target_words) > slack:
        problems.append(f"{count} words against a target of {target_words} (+/-{slack})")
    return problems


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def validate_record(
    payload: dict[str, str], item: dict[str, Any], language: str
) -> dict[str, Any]:
    errors: list[str] = []
    warnings: list[str] = []
    advice = float(item["advice_value"])

    fields = ["body"] + [f"followup_{k}" for k in FOLLOWUP_IDS]
    for field in fields:
        text = payload.get(field, "")
        if not text.strip():
            errors.append(f"{field}: empty")
            continue

        if not contains_value(text, advice):
            errors.append(
                f"{field}: missing required value {format_number(advice)} "
                f"(found {sorted(set(extract_numbers(text)))})"
            )

        if item["is_error"] and contains_value(text, float(item["true_value"])):
            errors.append(
                f"{field}: leaks the true value {format_number(item['true_value'])} on an error item"
            )

        if not has_hedge_marker(text, language):
            warnings.append(f"{field}: no recognised {language} hedge marker")

        lo, hi = BODY_WORDS if field == "body" else FOLLOWUP_WORDS
        n = word_count(text)
        if not lo <= n <= hi:
            hard_lo, hard_hi = int(lo * (1 - WORD_HARD_SLACK)), int(hi * (1 + WORD_HARD_SLACK))
            message = f"{field}: {n} words, outside {lo}-{hi}"
            (warnings if hard_lo <= n <= hard_hi else errors).append(message)

    return {"ok": not errors, "errors": errors, "warnings": warnings}


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------


def build_justifications(
    items: list[dict[str, Any]],
    languages: Iterable[str],
    provider: Any,
    cache: CellCache,
    args: argparse.Namespace,
) -> dict[tuple[str, str], str]:
    """Phase 1: one justification per (language, item), reused across all variants.

    Every rendered justification is written to the cell cache the moment it
    arrives. Phase 1 is 24 paid calls that phase 2 depends on; before the cache
    existed, a phase-2 failure spent them all again on the next run.
    """
    out: dict[tuple[str, str], str] = {}
    print("Phase 1: justifications")
    reused = 0
    generated = 0

    for language in languages:
        for item in items:
            key = (language, item["id"])

            # English is the source language: the bank's own sentence IS the
            # stimulus, so there is nothing to render and nothing to pay for.
            # Offline is NOT special-cased -- it is a provider like any other.
            if language == "en":
                out[key] = str(assigned_justification(item)["text"])
                continue

            cid = cell_id("justification", language, item["id"])
            if not provider.placeholder and not args.force:
                hit = cache.get(cid)
                if hit is not None:
                    out[key] = str(hit["justification"])
                    reused += 1
                    continue

            prompt = build_justification_prompt(item, language)
            source = assigned_justification(item)
            # The user turn is the sentence to render, NOT item["question"].
            # Passing the question invited the model to answer it instead of
            # translating: on item_11 it replied with the real snailfish depth,
            # which is the true value of an error item and would have leaked it
            # into text shown identically in both conditions.
            rendered = ""
            problems: list[str] = []
            for attempt in range(1, args.max_attempts + 1):
                result = provider.complete(
                    prompt, str(source["text"]), JUSTIFICATION_SCHEMA, "justification", cid,
                )
                rendered = str(result["payload"]["justification"]).strip()
                problems = validate_justification(rendered, int(source["word_count"]))
                if not problems:
                    break
                print(f"    ! {cid} attempt {attempt}: {'; '.join(problems)}", file=sys.stderr)
                if provider.sleep_seconds:
                    time.sleep(provider.sleep_seconds)
            else:
                raise SystemExit(
                    f"{cid}: justification still invalid after {args.max_attempts} attempts "
                    f"({'; '.join(problems)}). Nothing downstream is safe to build on it."
                )

            out[key] = rendered
            if not provider.placeholder:
                cache.put(cid, {"justification": rendered}, result.get("tokens", 0))
            generated += 1
            if provider.sleep_seconds:
                time.sleep(provider.sleep_seconds)

        label = "source" if language == "en" else ("placeholder" if provider.placeholder else "ready")
        print(f"  {language}: {len(items)} ({label})")

    if reused or generated:
        print(f"  ({reused} from cache, {generated} generated)")
    return out


def already_done(language: str, condition: str, state: str | None, item_ids: set[str],
                 args: argparse.Namespace) -> dict[str, Any] | None:
    """Existing records that can be kept, keyed by item id.

    Free-tier quotas mean a run can stop part-way through; without this a resume
    would re-spend the quota regenerating work that already validated. Only
    real, validated, same-model records count -- placeholders never do.
    """
    if args.force or args.offline:
        return None
    path = RESPONSES_DIR / stimulus_filename(language, condition, state)
    if not path.exists():
        return None
    try:
        document = read_json(path)
    except Exception:  # noqa: BLE001 - a corrupt file is simply not resumable
        return None
    if document.get("meta", {}).get("model") != args.model:
        return None
    keep = {
        r["item_id"]: r
        for r in document.get("responses", [])
        if not r.get("placeholder") and r.get("validation", {}).get("ok")
        and r["item_id"] in item_ids
    }
    return keep or None


def build_variant_file(
    items: list[dict[str, Any]],
    language: str,
    condition: str,
    state: str | None,
    justifications: dict[tuple[str, str], str],
    provider: Any,
    cache: CellCache,
    args: argparse.Namespace,
) -> tuple[dict[str, Any], list[str]]:
    """Phase 2: one stimulus file — all 12 items for one (language, condition, register)."""
    responses: list[dict[str, Any]] = []
    failures: list[str] = []
    resumable = already_done(language, condition, state, {i["id"] for i in items}, args) or {}

    for item in items:
        rid = response_id(language, condition, state, item["id"])

        cached = resumable.get(item["id"])
        if cached is not None:
            responses.append(cached)
            continue

        # No offline branch here. OfflineProvider exists so that the caller
        # cannot tell placeholders from live output; branching on args.offline
        # would leave the offline path untested by everything below it.
        payload, attempts = generate_body(
            item, language, condition, state, provider, cache, args
        )

        validation = validate_record(payload, item, language)
        if not validation["ok"]:
            failures.extend(f"{rid}: {e}" for e in validation["errors"])

        justification = justifications[(language, item["id"])]
        content = {
            "body": payload["body"],
            "justification_text": justification,
            "followups": {k: payload[f"followup_{k}"] for k in FOLLOWUP_IDS},
        }

        responses.append(
            {
                "response_id": rid,
                "item_id": item["id"],
                "language": language,
                "condition": condition,
                "register_state": state,
                "body": content["body"],
                "justification_quality": item["assigned_justification_quality"],
                "justification_text": justification,
                "followups": content["followups"],
                "placeholder": bool(provider.placeholder),
                "sha256": sha256_text(
                    "\n".join(
                        [content["body"], justification, *[content["followups"][k] for k in FOLLOWUP_IDS]]
                    )
                ),
                "validation": validation,
                "attempts_used": attempts,
            }
        )

    document = {
        "meta": {
            "schema_version": "1.0",
            "study": "eiai-study3",
            "language": language,
            "condition": condition,
            "register_state": state,
            "generator": "pipeline/generate.py",
            "generator_version": GENERATOR_VERSION,
            # "anthropic_api" until now, which was a leftover from v1: generation
            # runs against whichever OpenAI-compatible provider is configured,
            # and this string ends up in the paper's provenance record. The
            # provider is named explicitly because the model id alone is
            # ambiguous -- "openai/gpt-oss-120b" is served by Groq and reads as
            # though it came from OpenAI.
            "generator_mode": "offline_placeholder" if provider.placeholder else "live_api",
            "provider": provider.name,
            "model": provider.model,
            "placeholder": bool(provider.placeholder),
            "prompt_hashes": prompt_hashes(condition, state),
            "translation_status": "source" if language == "en" else "machine_draft_requires_back_translation",
            "human_verification": {
                "content_equivalence_checked": False,
                "component_coding_completed": False,
                "back_translation_completed": False,
                "native_speaker_verified": False,
            },
        },
        "responses": responses,
    }
    # No timestamp inside stimulus files on purpose: their bytes must be stable
    # across runs so the hash manifest means something. Timing lives in the manifest.
    return document, failures


def generate_body(
    item: dict[str, Any],
    language: str,
    condition: str,
    state: str | None,
    provider: Any,
    cache: CellCache,
    args: argparse.Namespace,
) -> tuple[dict[str, str], int]:
    """One body cell, from cache when possible, written to cache when not.

    The cache write happens before this returns, so a quota exhaustion on the
    next cell cannot discard this one. That was the failure mode: variant files
    were written only after all twelve of their cells finished, so running out
    of budget on the eighth call threw away seven paid-for cells.
    """
    cid = cell_id("body", language, item["id"], condition, state)
    # Placeholders are deterministic and free, so caching them would only create
    # a route for placeholder text to survive into a live run.
    cacheable = not provider.placeholder

    if cacheable and not args.force:
        hit = cache.get(cid)
        if hit is not None:
            return {k: str(v) for k, v in hit.items()}, 0

    system_prompt = build_system_prompt(item, language, condition, state)
    user_message = str(item["question"][language])
    last: dict[str, str] = {}

    for attempt in range(1, args.max_attempts + 1):
        result = provider.complete(system_prompt, user_message, BODY_SCHEMA, "stimulus", cid)
        last = {k: str(v) for k, v in result["payload"].items()}
        if validate_record(last, item, language)["ok"]:
            if cacheable:
                cache.put(cid, last, result.get("tokens", 0))
            return last, attempt
        print(f"    ! {cid} attempt {attempt} failed validation; retrying", file=sys.stderr)
        if provider.sleep_seconds:
            time.sleep(provider.sleep_seconds)

    # Deliberately NOT cached: caching a record that never validated would make
    # the next run skip it and inherit the defect silently.
    return last, args.max_attempts


def prompt_hashes(condition: str, state: str | None) -> dict[str, str]:
    hashes = {
        "shared_constraints": sha256_text(load_prompt("shared_constraints.txt")),
        "output_format_block": sha256_text(OUTPUT_FORMAT_BLOCK),
        "language_block": sha256_text(LANGUAGE_BLOCK),
        # The justification is part of every record but is produced by its own
        # call, so without these two the provenance trail would cover the body
        # and silently stop at the text that carries the within-subjects
        # manipulation. Templates are hashed unsubstituted; the per-item values
        # are recoverable from items.json.
        "justification_translation": sha256_text(load_prompt("justification_translation.txt")),
        "justification_format_block": sha256_text(JUSTIFICATION_FORMAT_BLOCK),
    }
    if condition == "warm":
        hashes["warm_components"] = sha256_text(load_prompt("warm_components.txt"))
        hashes["register"] = sha256_text(load_prompt(REGISTER_PROMPTS[str(state)]))
    else:
        hashes["neutral"] = sha256_text(load_prompt("neutral.txt"))
    return hashes


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate the frozen stimulus set for Study 3.")
    parser.add_argument("--languages", nargs="+", choices=LANGUAGES, default=list(LANGUAGES))
    parser.add_argument("--conditions", nargs="+", choices=["warm", "neutral"], default=["warm", "neutral"])
    parser.add_argument("--items", nargs="+", default=None, help="item ids, e.g. item_03")
    parser.add_argument("--offline", action="store_true", help="deterministic placeholders, no API calls")
    parser.add_argument("--force", action="store_true",
                        help="regenerate even where valid records already exist")
    parser.add_argument("--dry-run", action="store_true", help="print prompts and exit")
    parser.add_argument(
        "--provider",
        default=DEFAULT_PROVIDER,
        choices=list(PROVIDER_CHOICES),
        help="where stimulus text comes from; see pipeline/providers.py",
    )
    parser.add_argument("--model", default=None, help="defaults to the provider's model")
    parser.add_argument("--max-tokens", type=int, default=DEFAULT_MAX_TOKENS)
    parser.add_argument(
        "--thinking",
        default=None,
        choices=["none", "low", "medium", "high", "default"],
        help="reasoning effort; defaults per provider (see PROVIDERS). 'default' omits the "
             "parameter entirely, which is not the same as sending 'none'",
    )
    parser.add_argument("--max-attempts", type=int, default=DEFAULT_MAX_ATTEMPTS)
    parser.add_argument("--sleep", type=float, default=DEFAULT_SLEEP,
                        help="seconds between calls; free tiers are rate-limited")
    args = parser.parse_args(list(argv) if argv is not None else None)
    resolve_defaults(args)
    return args


def _offline_render(items: list[dict[str, Any]], args: argparse.Namespace):
    """Adapts the placeholder generators to the provider interface.

    The renderers know about items and prompts; the provider protocol knows only
    about cell ids. This closure is the seam, so OfflineProvider needs no import
    from this module and the dependency stays one-directional.
    """
    by_id = {i["id"]: i for i in items}

    def render(schema_name: str, cid: str) -> dict[str, Any]:
        parts = cid.split("/")
        if parts[0] == "justification":
            _, language, item_id = parts
            return {"justification": offline_justification(by_id[item_id], language)}
        _, language, condition, slug, item_id = parts
        state = None if slug == "na" else slug.upper()
        return offline_body(by_id[item_id], language, condition, state)

    return render


def plan_cells(
    items: list[dict[str, Any]],
    languages: Iterable[str],
    variants: list[tuple[str, str | None]],
) -> list[tuple[str, str, dict[str, Any], str, str | None]]:
    """Every cell a full run would need, in the order it would be produced."""
    cells: list[tuple[str, str, dict[str, Any], str, str | None]] = []
    for language in languages:
        if language != "en":
            for item in items:
                cells.append((cell_id("justification", language, item["id"]),
                              language, item, "", None))
    for language in languages:
        for condition, state in variants:
            for item in items:
                cells.append((cell_id("body", language, item["id"], condition, state),
                              language, item, condition, state))
    return cells


def dry_run(
    items: list[dict[str, Any]],
    languages: Iterable[str],
    variants: list[tuple[str, str | None]],
    provider: Any,
    cache: CellCache,
    args: argparse.Namespace,
) -> int:
    """What a run would cost, before spending any of it.

    The point is to see the number in advance rather than discover it by hitting
    a limit two thirds of the way through a set.
    """
    languages = list(languages)
    cells = plan_cells(items, languages, variants)
    outstanding = [c for c in cells if c[0] not in cache]

    tokens = 0
    for cid, language, item, condition, state in outstanding:
        if cid.startswith("justification/"):
            system = build_justification_prompt(item, language)
            user = str(assigned_justification(item)["text"])
        else:
            system = build_system_prompt(item, language, condition, state)
            user = str(item["question"][language])
        tokens += provider.estimate_tokens(system, user)

    print(f"provider: {provider.name} / {provider.model}")
    print(f"cells:    {len(cells)} planned, {len(cache)} cached, "
          f"{len(outstanding)} outstanding")
    print(f"requests: {len(outstanding)}")
    print(f"tokens:   {tokens:,} estimated (reservation included)")

    budget = DAILY_TOKEN_BUDGET.get(provider.name)
    if budget and tokens:
        days = tokens / budget
        print(f"budget:   {budget:,}/day -> {days:.1f} day(s) at best")
        if days > 1:
            # Saying this plainly is the whole point: a run that cannot finish
            # today should be planned for, not discovered at cell 90.
            print(f"          this does NOT finish in one day. The run stops cleanly")
            print(f"          when the budget is gone and resumes from the cache.")
    pace = getattr(provider, "sleep_seconds", 0.0)
    if pace and outstanding:
        minutes = len(outstanding) * pace / 60
        print(f"pacing:   {pace:.0f}s between calls -> {minutes:.0f} min of wall clock")

    if outstanding:
        print()
        print(f"next cell: {outstanding[0][0]}")
    else:
        print()
        print("nothing outstanding: every cell is cached")
    return 0


def main(argv: Iterable[str] | None = None) -> int:
    args = parse_args(argv)
    # Loaded for --dry-run too: the estimate is built from the real provider's
    # real settings, so it needs the same key the run would need. Only the
    # offline provider genuinely has no credentials to find.
    if not args.offline:
        loaded = load_dotenv()
        if loaded and not args.dry_run:
            print("env: " + ", ".join(loaded))

    bank = load_items()
    all_items = bank["items"]
    items = [i for i in all_items if not args.items or i["id"] in set(args.items)]
    if args.items and len(items) != len(set(args.items)):
        print("unknown item id in --items", file=sys.stderr)
        return 2

    variants = [(c, s) for c, s in VARIANTS if c in args.conditions]

    # The provider is built before --dry-run so the estimate uses the real
    # max_tokens and the real budget rather than a guess about them.
    try:
        provider = build_provider(args, _offline_render(items, args))
    except ProviderError as error:
        print(str(error), file=sys.stderr)
        return 2

    cache = CellCache(provider=provider.name, model=provider.model)

    if args.dry_run:
        return dry_run(items, args.languages, variants, provider, cache, args)

    if not args.offline:
        print(f"provider: {provider.name} / {provider.model} (thinking={args.thinking})")
    if len(cache):
        print(f"cache: {len(cache)} cells already on disk")


    try:
        justifications = build_justifications(items, args.languages, provider, cache, args)
    except GenerationHalt as stop:
        print(f"\nQuota exhausted during phase 1: {stop}", file=sys.stderr)
        print("Nothing was written. Re-run when the quota resets.", file=sys.stderr)
        return 2

    print("Phase 2: bodies and follow-ups")
    failures: list[str] = []
    written = 0
    written_responses = 0
    planned = [(lang, c, s) for lang in args.languages for c, s in variants]
    completed: set[tuple[str, str, str | None]] = set()
    exhausted: GenerationHalt | None = None

    for language in args.languages:
        for condition, state in variants:
            if exhausted is not None:
                break
            try:
                document, file_failures = build_variant_file(
                    items, language, condition, state, justifications, provider, cache, args
                )
            except GenerationHalt as stop:
                # Stop cleanly and keep everything already on disk; a resume
                # skips finished variants rather than re-spending the quota.
                exhausted = stop
                break
            failures.extend(file_failures)

            path = RESPONSES_DIR / stimulus_filename(language, condition, state)
            # Merge with any items not selected this run, so a targeted run
            # does not truncate the file.
            if path.exists() and args.items:
                existing = read_json(path)
                selected = {r["response_id"] for r in document["responses"]}
                document["responses"].extend(
                    r for r in existing.get("responses", []) if r["response_id"] not in selected
                )
                order = {i["id"]: n for n, i in enumerate(all_items)}
                document["responses"].sort(key=lambda r: order.get(r["item_id"], 999))

            write_json(path, document)
            written += 1
            written_responses += len(document["responses"])
            completed.add((language, condition, state))
            print(f"  -> materials/responses/{path.name} ({len(document['responses'])} responses)")

    # Counted from what reached disk, not from what was planned. These used to
    # be the planned totals, so a run that produced one file of twelve still
    # printed "144 responses" and then, because the eleven variants it never
    # reached contributed no validation failures, "all records passed
    # validation" and exit 0. On a free tier that stops mid-run routinely, a
    # partial set reported as complete is the worst possible failure mode.
    remaining = [v for v in planned if v not in completed]
    print("\n" + "-" * 60)
    print(
        f"{written} of {len(planned)} files, {written_responses} responses, "
        f"{written_responses * 3} follow-up branches"
    )
    if provider.tokens_used:
        print(f"{provider.tokens_used:,} tokens spent this run "
              f"across {provider.requests_made} request(s); {len(cache)} cells cached")
    if args.offline:
        print("MODE: offline placeholders. NOT launch-ready. Re-run without --offline before piloting.")

    if exhausted is not None:
        print(f"\nSTOPPED: provider quota exhausted -- {exhausted}", file=sys.stderr)
        print(f"\n{len(remaining)} of {len(planned)} variant files were not generated:", file=sys.stderr)
        for lang, cond, st in remaining:
            print(f"  - {stimulus_filename(lang, cond, st)}", file=sys.stderr)
        print(
            "\nEverything already written is kept. Re-run the same command when the quota\n"
            "resets; finished variants are skipped rather than regenerated. The set is NOT\n"
            "complete and must not be manifested or fielded until this prints zero remaining.",
            file=sys.stderr,
        )
        return 2

    if failures:
        print(f"\n{len(failures)} validation failure(s):")
        for line in failures[:20]:
            print(f"  - {line}")
        if len(failures) > 20:
            print(f"  ... and {len(failures) - 20} more")
        return 1

    print("all records passed validation")
    print("\nNext: pipeline/verify_equivalence.py, then pipeline/hash_manifest.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
