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
    export ANTHROPIC_API_KEY=...
    python pipeline/generate.py                      # real generation
    python pipeline/generate.py --languages en --conditions warm
    python pipeline/generate.py --dry-run

Exit codes
----------
    0  every record generated and validated
    1  at least one record failed validation (files still written)
    2  configuration or I/O error before generation started
"""

from __future__ import annotations

import argparse
import sys
import time
from typing import Any, Iterable

from _common import (
    FOLLOWUP_IDS,
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

GENERATOR_VERSION = "2.0.0"
DEFAULT_MODEL = "claude-opus-5"
DEFAULT_MAX_TOKENS = 4096
DEFAULT_EFFORT = "medium"
DEFAULT_MAX_ATTEMPTS = 4

BODY_WORDS = (60, 90)
FOLLOWUP_WORDS = (30, 60)
WORD_HARD_SLACK = 0.5

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
    )


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


def make_client(max_retries: int = 5):
    try:
        import anthropic
    except ImportError:  # pragma: no cover - dependency guard
        sys.exit("The `anthropic` package is required for online generation.\n    pip install anthropic")
    return anthropic.Anthropic(max_retries=max_retries)


def call_model(
    client: Any, system_prompt: str, user_message: str, schema: dict[str, Any], args: argparse.Namespace
) -> dict[str, Any]:
    import anthropic
    import json as _json

    output_config: dict[str, Any] = {"format": {"type": "json_schema", "schema": schema}}
    if args.effort:
        output_config["effort"] = args.effort

    try:
        message = client.messages.create(
            model=args.model,
            max_tokens=args.max_tokens,
            system=system_prompt,
            messages=[{"role": "user", "content": user_message}],
            output_config=output_config,
        )
    except anthropic.BadRequestError:
        if not args.effort:
            raise
        print("  ! output_config.effort rejected; retrying without it", file=sys.stderr)
        message = client.messages.create(
            model=args.model,
            max_tokens=args.max_tokens,
            system=system_prompt,
            messages=[{"role": "user", "content": user_message}],
            output_config={"format": {"type": "json_schema", "schema": schema}},
        )

    for block in message.content:
        if getattr(block, "type", None) == "text":
            return {
                "payload": _json.loads(block.text),
                "usage": {
                    "input_tokens": message.usage.input_tokens,
                    "output_tokens": message.usage.output_tokens,
                },
            }
    raise ValueError("response contained no text block")


# ---------------------------------------------------------------------------
# Phases
# ---------------------------------------------------------------------------


def build_justifications(
    items: list[dict[str, Any]], languages: Iterable[str], client: Any, args: argparse.Namespace
) -> dict[tuple[str, str], str]:
    """Phase 1: one justification per (language, item), reused across all variants."""
    out: dict[tuple[str, str], str] = {}
    print("Phase 1: justifications")

    for language in languages:
        for item in items:
            key = (language, item["id"])
            if args.offline or language == "en":
                out[key] = offline_justification(item, language)
                continue

            prompt = build_justification_prompt(item, language)
            result = call_model(client, prompt, str(item["question"][language]), JUSTIFICATION_SCHEMA, args)
            out[key] = str(result["payload"]["justification"]).strip()
            if args.sleep:
                time.sleep(args.sleep)

        rendered = "source" if language == "en" else ("placeholder" if args.offline else "generated")
        print(f"  {language}: {len(items)} ({rendered})")

    return out


def build_variant_file(
    items: list[dict[str, Any]],
    language: str,
    condition: str,
    state: str | None,
    justifications: dict[tuple[str, str], str],
    client: Any,
    args: argparse.Namespace,
) -> tuple[dict[str, Any], list[str]]:
    """Phase 2: one stimulus file — all 12 items for one (language, condition, register)."""
    responses: list[dict[str, Any]] = []
    failures: list[str] = []

    for item in items:
        rid = response_id(language, condition, state, item["id"])

        if args.offline:
            payload = offline_body(item, language, condition, state)
            attempts = 0
        else:
            payload, attempts = generate_body(item, language, condition, state, client, args)

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
                "placeholder": bool(args.offline),
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
            "generator_mode": "offline_placeholder" if args.offline else "anthropic_api",
            "model": "none (offline placeholder)" if args.offline else args.model,
            "placeholder": bool(args.offline),
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
    client: Any,
    args: argparse.Namespace,
) -> tuple[dict[str, str], int]:
    system_prompt = build_system_prompt(item, language, condition, state)
    user_message = str(item["question"][language])
    last: dict[str, str] = {}

    for attempt in range(1, args.max_attempts + 1):
        result = call_model(client, system_prompt, user_message, BODY_SCHEMA, args)
        last = {k: str(v) for k, v in result["payload"].items()}
        if validate_record(last, item, language)["ok"]:
            return last, attempt
        print(f"    ! attempt {attempt} failed validation; retrying", file=sys.stderr)
        if args.sleep:
            time.sleep(args.sleep)

    return last, args.max_attempts


def prompt_hashes(condition: str, state: str | None) -> dict[str, str]:
    hashes = {
        "shared_constraints": sha256_text(load_prompt("shared_constraints.txt")),
        "output_format_block": sha256_text(OUTPUT_FORMAT_BLOCK),
        "language_block": sha256_text(LANGUAGE_BLOCK),
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
    parser.add_argument("--dry-run", action="store_true", help="print prompts and exit")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--max-tokens", type=int, default=DEFAULT_MAX_TOKENS)
    parser.add_argument("--effort", default=DEFAULT_EFFORT, choices=["low", "medium", "high", "xhigh", "max", "none"])
    parser.add_argument("--max-attempts", type=int, default=DEFAULT_MAX_ATTEMPTS)
    parser.add_argument("--sleep", type=float, default=0.4)
    args = parser.parse_args(list(argv) if argv is not None else None)
    if args.effort == "none":
        args.effort = None
    return args


def main(argv: Iterable[str] | None = None) -> int:
    args = parse_args(argv)

    bank = load_items()
    all_items = bank["items"]
    items = [i for i in all_items if not args.items or i["id"] in set(args.items)]
    if args.items and len(items) != len(set(args.items)):
        print("unknown item id in --items", file=sys.stderr)
        return 2

    variants = [(c, s) for c, s in VARIANTS if c in args.conditions]

    if args.dry_run:
        for language in args.languages:
            for condition, state in variants:
                item = items[0]
                print("=" * 72)
                print(f"{stimulus_filename(language, condition, state)} :: {item['id']}")
                print("=" * 72)
                print(build_system_prompt(item, language, condition, state))
                print()
        planned = len(args.languages) * len(variants) * len(items)
        justification_calls = len([l for l in args.languages if l != "en"]) * len(items)
        print(f"dry run: {planned} body calls + {justification_calls} justification calls")
        return 0

    client = None if args.offline else make_client()
    justifications = build_justifications(items, args.languages, client, args)

    print("Phase 2: bodies and follow-ups")
    failures: list[str] = []
    written = 0

    for language in args.languages:
        for condition, state in variants:
            document, file_failures = build_variant_file(
                items, language, condition, state, justifications, client, args
            )
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
            print(f"  -> materials/responses/{path.name} ({len(document['responses'])} responses)")

    total = sum(1 for _ in args.languages for _ in variants) * len(items)
    print("\n" + "-" * 60)
    print(f"{written} files, {total} responses, {total * 3} follow-up branches")
    if args.offline:
        print("MODE: offline placeholders. NOT launch-ready. Re-run without --offline before piloting.")

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
