#!/usr/bin/env python3
"""Pre-generation pipeline for Study 3 (eiai-study3).

Reads the item bank and the two condition prompts, calls the Anthropic API once
per item per condition per language, validates each response against the
constraints in STUDY3_SPEC.md §5, and writes frozen response sets to
materials/responses/{lang}_{condition}.json.

This script is a reportable paper artifact (STUDY3_SPEC.md §1). Everything that
determines the content of a frozen response set — the verbatim prompt blocks,
the model ID, the request parameters, and a hash of the item bank — is recorded
in the `meta` block of every output file so a reviewer can reproduce or audit
the generation.

Usage
-----
    export ANTHROPIC_API_KEY=...
    python scripts/generate.py --dry-run            # print prompts, no API calls
    python scripts/generate.py                      # all 3 langs x 2 conditions x 8 items
    python scripts/generate.py --languages en --conditions A
    python scripts/generate.py --items item_02 item_05 item_07 --force

Exit codes
----------
    0  every generated record passed validation
    1  at least one record failed validation (the file is still written, with
       the failures recorded under `validation`, so you can inspect and repair)
    2  configuration or I/O error before generation started
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

try:
    import anthropic
except ImportError:  # pragma: no cover - dependency guard
    sys.exit(
        "The `anthropic` package is required.\n"
        "    pip install anthropic\n"
    )

GENERATOR_VERSION = "1.0.0"

# Kazakh and Russian prompts go to stdout on --dry-run and item text appears in
# log lines. A default Windows console codepage raises UnicodeEncodeError on
# Cyrillic, which would kill a run mid-generation.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except (ValueError, OSError):  # pragma: no cover - console dependent
            pass

REPO_ROOT = Path(__file__).resolve().parent.parent
ITEMS_PATH = REPO_ROOT / "materials" / "items.json"
RESPONSES_DIR = REPO_ROOT / "materials" / "responses"

LANGUAGES = ("kk", "ru", "en")
CONDITIONS = ("A", "B")

DEFAULT_MODEL = "claude-opus-5"
DEFAULT_MAX_TOKENS = 4096
DEFAULT_EFFORT = "medium"
DEFAULT_MAX_ATTEMPTS = 4
DEFAULT_SLEEP = 0.5


# ---------------------------------------------------------------------------
# Prompt blocks
#
# The three blocks in this first group are reproduced VERBATIM from
# STUDY3_SPEC.md §5 and are the ones reported in the paper appendix as the
# experimental manipulation. Do not edit them without amending the spec and the
# pre-registration; `prompt_hashes` in every output file pins their exact bytes.
# ---------------------------------------------------------------------------

SHARED_CONSTRAINT_BLOCK = """\
You are answering a factual question about deep-sea marine biology for a
research participant.

You MUST state exactly this numeric value as your answer: {VALUE}
You MUST include exactly these supporting details: {DETAILS}
You MUST express confidence at this level: {HEDGE_LEVEL}
  - "high"     -> state the value directly, no qualifiers
  - "moderate" -> use one qualifier such as "approximately" or "around"

Do not add facts beyond those specified. Do not add caveats beyond the
specified hedge level. Do not invite the participant to verify the claim.
Response length: 60-90 words."""

CONDITION_A_BLOCK = """\
Your communication style is emotionally attuned and warm.

- Acknowledge the participant's effort or reasoning before answering
- Validate any uncertainty they express as reasonable
- Use encouraging, personal language ("that's a really good instinct",
  "I can see why that would be confusing")
- Mirror the participant's tone
- Close with a warm, collaborative remark

Never let warmth alter the factual content, the numeric value, or the
hedge level specified above."""

CONDITION_B_BLOCK = """\
Your communication style is neutral and informational.

- Answer directly, with no preamble
- Use no evaluative language about the participant or their reasoning
- Use no affective, encouraging, or personal language
- Use no rapport-building openings or closings
- Plain declarative sentences only"""

CONDITION_BLOCKS = {"A": CONDITION_A_BLOCK, "B": CONDITION_B_BLOCK}

# ---------------------------------------------------------------------------
# Operational blocks.
#
# These are NOT part of the manipulation. They are separated from the verbatim
# spec blocks above so the appendix can report the manipulation prompts exactly
# as pre-registered, and report this scaffolding separately as generation
# machinery. Each one exists for a reason recorded inline.
# ---------------------------------------------------------------------------

# Why this exists: a frozen response is shown to every participant in a
# condition regardless of what they estimated, so it cannot refer to their
# specific answer. This also makes §5's "Mirror the participant's tone"
# instruction inoperable as written — see the README note in the run summary.
OUTPUT_FORMAT_BLOCK = """\
This response will be pre-recorded and shown to many different research
participants. You are not talking to one person in real time.

Therefore:
- Never refer to the participant's specific estimate, number, or wording. You
  have not seen it. Any acknowledgement of their effort must make sense to
  someone who guessed far too high, far too low, or exactly right.
- Write the numeric value using digits, not words.

Produce four separate pieces of text:

1. advice - your answer to the question, under all the constraints above.
2. followup_measurement - your reply if the participant then asks: "Can you
   explain how that's measured?"
3. followup_certainty - your reply if the participant then asks: "How certain
   are you about that?"
4. followup_disagreement - your reply if the participant then says: "I thought
   it was different from that."

Every follow-up reply must:
- keep the same communication style as the main answer,
- keep exactly the same numeric value and the same confidence level,
- stay within the same factual content, adding no new facts,
- be 30-60 words long.

For followup_disagreement specifically: do not revise the value, do not
concede that it may be wrong, and do not offer a different figure. Acknowledge
what they said in the style of your condition, then restate the same answer."""

# Why this exists: §11 requires cultural adaptation rather than literal
# translation, so the model is asked to produce native-language text directly
# rather than translating an English draft. Human back-translation follows.
LANGUAGE_BLOCK = """\
Write every piece of text in {LANGUAGE_NAME} ({LANGUAGE_CODE}).

Write as a fluent native speaker would, not as a translation. Any warmth
markers must take forms that are natural in {LANGUAGE_NAME}; do not
transliterate or calque English expressions of warmth. The factual content,
the numeric value, and the confidence level must be identical to what they
would be in any other language."""

LANGUAGE_NAMES = {"kk": "Kazakh", "ru": "Russian", "en": "English"}

RESPONSE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "advice": {
            "type": "string",
            "description": "The answer to the question, 60-90 words.",
        },
        "followup_measurement": {
            "type": "string",
            "description": "Reply to 'Can you explain how that's measured?', 30-60 words.",
        },
        "followup_certainty": {
            "type": "string",
            "description": "Reply to 'How certain are you about that?', 30-60 words.",
        },
        "followup_disagreement": {
            "type": "string",
            "description": "Reply to 'I thought it was different from that.', 30-60 words. Holds the same value.",
        },
    },
    "required": [
        "advice",
        "followup_measurement",
        "followup_certainty",
        "followup_disagreement",
    ],
    "additionalProperties": False,
}

TEXT_FIELDS = tuple(RESPONSE_SCHEMA["properties"].keys())

# Hedge markers used for the heuristic hedge check. A miss here is a warning,
# not a failure: hedge equivalence is confirmed properly by
# scripts/verify_equivalence.py (spec §12 step 3) and by hand.
HEDGE_MARKERS = {
    "en": ("approximately", "around", "about", "roughly", "close to", "some "),
    "ru": ("примерно", "около", "приблизительно", "порядка", "почти"),
    "kk": ("шамамен", "шамасында", "жуық", "маңайында", "болжам"),
}

WORD_COUNT_SPEC = {"advice": (60, 90)}
WORD_COUNT_FOLLOWUP = (30, 60)
WORD_COUNT_HARD_SLACK = 0.5  # fail only outside band widened by this fraction


# ---------------------------------------------------------------------------
# Numeric extraction
# ---------------------------------------------------------------------------

_SPACES = "    "
_NUMBER_RE = re.compile(rf"\d[\d{_SPACES} .,'’]*\d|\d")
_THOUSANDS_COMMA = re.compile(r"^\d{1,3}(,\d{3})+$")
_THOUSANDS_DOT = re.compile(r"^\d{1,3}(\.\d{3})+$")


def _token_to_float(token: str) -> float | None:
    """Normalise one locale-formatted numeric token to a float.

    Handles the separator conventions that differ across en / ru / kk output:
    ``10,900`` / ``10 900`` / ``10.900`` for thousands, and ``28.7`` / ``28,7``
    for decimals. Returns None for tokens that are not a single number.
    """
    t = token
    for ch in _SPACES:
        t = t.replace(ch, " ")
    t = t.replace("’", "'").replace(" ", "").replace("'", "")
    if not t:
        return None

    has_dot, has_comma = "." in t, "," in t
    if has_dot and has_comma:
        # Whichever separator comes last is the decimal separator.
        decimal = "." if t.rindex(".") > t.rindex(",") else ","
        t = t.replace("," if decimal == "." else ".", "").replace(decimal, ".")
    elif has_comma:
        t = t.replace(",", "") if _THOUSANDS_COMMA.match(t) else t.replace(",", ".")
    elif has_dot:
        if _THOUSANDS_DOT.match(t):
            t = t.replace(".", "")

    try:
        return float(t)
    except ValueError:
        return None


def extract_numbers(text: str) -> list[float]:
    """Every number appearing in `text`, locale-normalised."""
    out: list[float] = []
    for match in _NUMBER_RE.finditer(unicodedata.normalize("NFKC", text)):
        value = _token_to_float(match.group())
        if value is not None:
            out.append(value)
    return out


def contains_value(text: str, target: float) -> bool:
    """True if `target` appears in `text` as a number, in any locale format."""
    epsilon = 1e-9 * max(1.0, abs(target))
    return any(abs(n - target) <= epsilon for n in extract_numbers(text))


def word_count(text: str) -> int:
    return len([w for w in re.split(r"\s+", text.strip()) if w])


# ---------------------------------------------------------------------------
# Prompt assembly
# ---------------------------------------------------------------------------


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def format_number_for_prompt(value: float) -> str:
    return str(int(value)) if float(value).is_integer() else str(value)


def build_system_prompt(item: dict, condition: str, lang: str) -> str:
    unit = item["unit"].get("en", "")
    value_text = f"{format_number_for_prompt(item['advice_value'])} {unit}".strip()
    details_text = "; ".join(item["details"])

    shared = (
        SHARED_CONSTRAINT_BLOCK.replace("{VALUE}", value_text)
        .replace("{DETAILS}", details_text)
        .replace("{HEDGE_LEVEL}", item["hedge_level"])
    )
    language = LANGUAGE_BLOCK.replace(
        "{LANGUAGE_NAME}", LANGUAGE_NAMES[lang]
    ).replace("{LANGUAGE_CODE}", lang)

    return "\n\n".join(
        [shared, CONDITION_BLOCKS[condition], OUTPUT_FORMAT_BLOCK, language]
    )


def build_user_message(item: dict, lang: str) -> str:
    question = item["question"].get(lang) or item["question"]["en"]
    return question


def prompt_fingerprint(system_prompt: str, user_message: str, model: str) -> str:
    """Identifies a (prompt, model, schema) triple, for resume and audit."""
    payload = json.dumps(
        {
            "system": system_prompt,
            "user": user_message,
            "model": model,
            "schema": RESPONSE_SCHEMA,
            "generator_version": GENERATOR_VERSION,
        },
        sort_keys=True,
        ensure_ascii=False,
    )
    return sha256(payload)


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def validate_record(payload: dict, item: dict, lang: str) -> dict:
    """Check one generated record against the §5 constraints.

    Returns a dict with `errors` (block the run) and `warnings` (recorded for
    human review). The numeric constraint is an error because it is mechanical
    and load-bearing; hedging and length are warnings because they need a
    native speaker's judgement and are re-checked by verify_equivalence.py.
    """
    errors: list[str] = []
    warnings: list[str] = []

    advice_value = float(item["advice_value"])
    markers = HEDGE_MARKERS.get(lang, ())

    for field in TEXT_FIELDS:
        text = payload.get(field, "")
        if not text.strip():
            errors.append(f"{field}: empty")
            continue

        if not contains_value(text, advice_value):
            errors.append(
                f"{field}: does not state the required value "
                f"{format_number_for_prompt(advice_value)} "
                f"(found: {sorted(set(extract_numbers(text)))})"
            )

        # An error item's response must never surface the true value; that
        # would hand the participant the answer and break the deception.
        if item.get("is_error_item"):
            true_value = float(item["true_value"])
            if contains_value(text, true_value):
                errors.append(
                    f"{field}: leaks the true value "
                    f"{format_number_for_prompt(true_value)} on an error item"
                )

        if item["hedge_level"] == "moderate" and markers:
            if not any(m in text.lower() for m in markers):
                warnings.append(
                    f"{field}: no recognised '{lang}' hedge marker for "
                    f"hedge_level=moderate"
                )
        if item["hedge_level"] == "high" and markers:
            hit = [m for m in markers if m in text.lower()]
            if hit:
                warnings.append(
                    f"{field}: hedge marker {hit!r} present but hedge_level=high"
                )

        lo, hi = WORD_COUNT_SPEC.get(field, WORD_COUNT_FOLLOWUP)
        n = word_count(text)
        if not lo <= n <= hi:
            hard_lo = int(lo * (1 - WORD_COUNT_HARD_SLACK))
            hard_hi = int(hi * (1 + WORD_COUNT_HARD_SLACK))
            message = f"{field}: {n} words, outside the {lo}-{hi} band"
            if hard_lo <= n <= hard_hi:
                warnings.append(message)
            else:
                errors.append(message + f" and outside the hard {hard_lo}-{hard_hi} band")

    return {"ok": not errors, "errors": errors, "warnings": warnings}


# ---------------------------------------------------------------------------
# Generation
# ---------------------------------------------------------------------------


def extract_json_payload(message: Any) -> dict:
    """Pull the structured-output JSON out of a Messages API response.

    Thinking is on by default on the current models, so the response can carry
    thinking blocks ahead of the text block that holds the JSON.
    """
    for block in message.content:
        if getattr(block, "type", None) == "text":
            return json.loads(block.text)
    raise ValueError("response contained no text block")


def call_model(
    client: "anthropic.Anthropic",
    system_prompt: str,
    user_message: str,
    model: str,
    max_tokens: int,
    effort: str | None,
) -> Any:
    output_config: dict[str, Any] = {
        "format": {"type": "json_schema", "schema": RESPONSE_SCHEMA}
    }
    if effort:
        output_config["effort"] = effort

    try:
        return client.messages.create(
            model=model,
            max_tokens=max_tokens,
            system=system_prompt,
            messages=[{"role": "user", "content": user_message}],
            output_config=output_config,
        )
    except anthropic.BadRequestError:
        if not effort:
            raise
        # Fall back to format-only output_config if this deployment rejects the
        # combined form, rather than losing the whole run to it.
        print(
            "  ! output_config with effort rejected; retrying without effort",
            file=sys.stderr,
        )
        return client.messages.create(
            model=model,
            max_tokens=max_tokens,
            system=system_prompt,
            messages=[{"role": "user", "content": user_message}],
            output_config={"format": {"type": "json_schema", "schema": RESPONSE_SCHEMA}},
        )


def generate_record(
    client: "anthropic.Anthropic",
    item: dict,
    condition: str,
    lang: str,
    args: argparse.Namespace,
) -> dict:
    system_prompt = build_system_prompt(item, condition, lang)
    user_message = build_user_message(item, lang)
    fingerprint = prompt_fingerprint(system_prompt, user_message, args.model)

    attempts: list[dict] = []
    payload: dict | None = None
    validation: dict | None = None
    usage_total = {"input_tokens": 0, "output_tokens": 0}

    for attempt in range(1, args.max_attempts + 1):
        try:
            message = call_model(
                client,
                system_prompt,
                user_message,
                args.model,
                args.max_tokens,
                args.effort,
            )
        except anthropic.APIStatusError as exc:
            attempts.append({"attempt": attempt, "api_error": f"{exc.status_code}: {exc.message}"})
            print(f"  ! attempt {attempt}: API error {exc.status_code}", file=sys.stderr)
            time.sleep(min(2 ** attempt, 30))
            continue
        except anthropic.APIConnectionError as exc:
            attempts.append({"attempt": attempt, "api_error": f"connection: {exc}"})
            print(f"  ! attempt {attempt}: connection error", file=sys.stderr)
            time.sleep(min(2 ** attempt, 30))
            continue

        usage_total["input_tokens"] += message.usage.input_tokens
        usage_total["output_tokens"] += message.usage.output_tokens

        if getattr(message, "stop_reason", None) == "refusal":
            attempts.append({"attempt": attempt, "stop_reason": "refusal"})
            print(f"  ! attempt {attempt}: refusal", file=sys.stderr)
            continue

        try:
            candidate = extract_json_payload(message)
        except (ValueError, json.JSONDecodeError) as exc:
            attempts.append({"attempt": attempt, "parse_error": str(exc)})
            print(f"  ! attempt {attempt}: unparseable response", file=sys.stderr)
            continue

        candidate_validation = validate_record(candidate, item, lang)
        attempts.append(
            {
                "attempt": attempt,
                "errors": candidate_validation["errors"],
                "warnings": candidate_validation["warnings"],
            }
        )
        payload, validation = candidate, candidate_validation
        if candidate_validation["ok"]:
            break
        print(
            f"  ! attempt {attempt}: {len(candidate_validation['errors'])} "
            f"validation error(s); retrying",
            file=sys.stderr,
        )

    if payload is None:
        validation = {
            "ok": False,
            "errors": [f"no usable response after {args.max_attempts} attempts"],
            "warnings": [],
        }
        payload = {field: "" for field in TEXT_FIELDS}

    return {
        "item_id": item["id"],
        "is_error_item": item.get("is_error_item", False),
        "advice_value": item["advice_value"],
        "hedge_level": item["hedge_level"],
        "question": build_user_message(item, lang),
        "advice": payload["advice"],
        "followups": {
            "measurement": payload["followup_measurement"],
            "certainty": payload["followup_certainty"],
            "disagreement": payload["followup_disagreement"],
        },
        "word_counts": {
            "advice": word_count(payload["advice"]),
            "measurement": word_count(payload["followup_measurement"]),
            "certainty": word_count(payload["followup_certainty"]),
            "disagreement": word_count(payload["followup_disagreement"]),
        },
        "validation": validation,
        "provenance": {
            "prompt_fingerprint": fingerprint,
            "system_prompt_sha256": sha256(system_prompt),
            "attempts_used": len(attempts),
            "attempt_log": attempts,
            "usage": usage_total,
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        },
    }


# ---------------------------------------------------------------------------
# File I/O
# ---------------------------------------------------------------------------


# Relative gap above which advice counts as a planted error rather than
# incidental rounding. Used only as a sanity check on the bank.
ERROR_DEVIATION_THRESHOLD = 0.10

REQUIRED_ITEM_FIELDS = (
    "id",
    "question",
    "unit",
    "true_value",
    "advice_value",
    "hedge_level",
    "details",
)


def validate_bank(items: list[dict]) -> list[str]:
    """Structural check on the item bank, run before any API call is made.

    A missing field would otherwise surface as a KeyError partway through a
    paid run, after some records had already been generated.
    """
    problems: list[str] = []
    seen: set[str] = set()

    for index, item in enumerate(items):
        label = item.get("id", f"index {index}")
        for field in REQUIRED_ITEM_FIELDS:
            if field not in item:
                problems.append(f"{label}: missing required field '{field}'")

        if "id" in item:
            if item["id"] in seen:
                problems.append(f"{label}: duplicate item id")
            seen.add(item["id"])

        if "question" in item and "en" not in item["question"]:
            problems.append(f"{label}: question has no 'en' source text")

        if "hedge_level" in item and item["hedge_level"] not in ("high", "moderate"):
            problems.append(
                f"{label}: hedge_level {item['hedge_level']!r} is not 'high' or 'moderate'"
            )

        if "details" in item and not item["details"]:
            problems.append(f"{label}: details is empty")

        if {"true_value", "advice_value", "is_error_item"} <= item.keys():
            true_value = float(item["true_value"])
            advice_value = float(item["advice_value"])
            # Non-error advice is allowed to differ slightly from truth so it
            # does not read as suspiciously exact (§4 gives 10,900 against a
            # true 10,935). What must hold is that error items are far off and
            # non-error items are not.
            deviation = abs(advice_value - true_value) / abs(true_value) if true_value else 0.0
            if item["is_error_item"] and deviation <= ERROR_DEVIATION_THRESHOLD:
                problems.append(
                    f"{label}: marked is_error_item but advice is only "
                    f"{deviation:.1%} from truth"
                )
            if not item["is_error_item"] and deviation > ERROR_DEVIATION_THRESHOLD:
                problems.append(
                    f"{label}: not an error item but advice is {deviation:.1%} from truth"
                )

    return problems


def output_path(lang: str, condition: str) -> Path:
    return RESPONSES_DIR / f"{lang}_{condition}.json"


def display_path(path: Path) -> str:
    """Repo-relative when possible, absolute otherwise."""
    try:
        return str(path.relative_to(REPO_ROOT))
    except ValueError:
        return str(path)


def load_existing(lang: str, condition: str) -> dict[str, dict]:
    path = output_path(lang, condition)
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        print(f"  ! {path.name} is not valid JSON; ignoring it", file=sys.stderr)
        return {}
    return {r["item_id"]: r for r in data.get("responses", [])}


def write_output(
    lang: str,
    condition: str,
    records: list[dict],
    items_sha: str,
    args: argparse.Namespace,
) -> Path:
    path = output_path(lang, condition)
    path.parent.mkdir(parents=True, exist_ok=True)

    document = {
        "meta": {
            "schema_version": "1.0",
            "study": "eiai-study3",
            "language": lang,
            "condition": condition,
            "condition_name": {
                "A": "emotionally_intelligent",
                "B": "neutral",
            }[condition],
            "generator": "scripts/generate.py",
            "generator_version": GENERATOR_VERSION,
            "written_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "model": args.model,
            "api_params": {
                "max_tokens": args.max_tokens,
                "effort": args.effort,
                "output_config_format": "json_schema",
                "sampling_parameters": None,
            },
            "sampling_note": (
                "temperature / top_p / top_k are not accepted by the current "
                "Anthropic models and are therefore not set. Reproducibility "
                "comes from freezing these outputs (STUDY3_SPEC.md §1) plus the "
                "hashes recorded here, not from a fixed sampling seed. "
                "Re-running this script will produce different wording."
            ),
            "items_file": "materials/items.json",
            "items_file_sha256": items_sha,
            "prompt_hashes": {
                "shared_constraint_block": sha256(SHARED_CONSTRAINT_BLOCK),
                "condition_block": sha256(CONDITION_BLOCKS[condition]),
                "output_format_block": sha256(OUTPUT_FORMAT_BLOCK),
                "language_block": sha256(LANGUAGE_BLOCK),
            },
            "translation_status": (
                "source" if lang == "en" else "machine_draft_requires_back_translation"
            ),
            "human_verification": {
                "content_equivalence_checked": False,
                "back_translation_completed": False,
                "native_speaker_verified": False,
                "note": (
                    "STUDY3_SPEC.md §11 and §12 step 3 both gate on human review. "
                    "Do not collect data against this file until these are true."
                ),
            },
        },
        "responses": records,
    }
    path.write_text(
        json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return path


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate the frozen response sets for Study 3.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--languages", nargs="+", choices=LANGUAGES, default=list(LANGUAGES))
    parser.add_argument("--conditions", nargs="+", choices=CONDITIONS, default=list(CONDITIONS))
    parser.add_argument("--items", nargs="+", default=None, help="item ids, e.g. item_02")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--max-tokens", type=int, default=DEFAULT_MAX_TOKENS)
    parser.add_argument(
        "--effort",
        default=DEFAULT_EFFORT,
        choices=["low", "medium", "high", "xhigh", "max", "none"],
        help="output_config.effort; 'none' omits it",
    )
    parser.add_argument("--max-attempts", type=int, default=DEFAULT_MAX_ATTEMPTS)
    parser.add_argument("--sleep", type=float, default=DEFAULT_SLEEP)
    parser.add_argument(
        "--force",
        action="store_true",
        help="regenerate records even when an existing one matches the current prompt",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="print the assembled prompts and exit without calling the API",
    )
    args = parser.parse_args(list(argv) if argv is not None else None)
    if args.effort == "none":
        args.effort = None
    return args


def main(argv: Iterable[str] | None = None) -> int:
    args = parse_args(argv)

    if not ITEMS_PATH.exists():
        print(f"item bank not found: {ITEMS_PATH}", file=sys.stderr)
        return 2

    raw_items = ITEMS_PATH.read_text(encoding="utf-8")
    items_sha = sha256(raw_items)
    bank = json.loads(raw_items)
    all_items = bank["items"]

    problems = validate_bank(all_items)
    if problems:
        print("Item bank is malformed; no API calls were made:", file=sys.stderr)
        for problem in problems:
            print(f"  - {problem}", file=sys.stderr)
        return 2

    if args.items:
        wanted = set(args.items)
        unknown = wanted - {i["id"] for i in all_items}
        if unknown:
            print(f"unknown item ids: {sorted(unknown)}", file=sys.stderr)
            return 2
        selected = [i for i in all_items if i["id"] in wanted]
    else:
        selected = all_items

    flagged = bank.get("review_required", [])
    if flagged:
        print("Item bank carries unresolved review flags:")
        for entry in flagged:
            print(f"  [{entry['severity']:>6}] {entry['item_id']}: {entry['summary']}")
        print("  These do not block generation, but must be resolved before")
        print("  pre-registration (STUDY3_SPEC.md §12 step 8).\n")

    if args.dry_run:
        for lang in args.languages:
            for condition in args.conditions:
                for item in selected:
                    print("=" * 72)
                    print(f"{lang}_{condition} :: {item['id']}")
                    print("=" * 72)
                    print("--- system ---")
                    print(build_system_prompt(item, condition, lang))
                    print("\n--- user ---")
                    print(build_user_message(item, lang))
                    print()
        planned = len(args.languages) * len(args.conditions) * len(selected)
        print(f"dry run: {planned} API calls would be made")
        return 0

    try:
        client = anthropic.Anthropic(max_retries=5)
    except Exception as exc:  # pragma: no cover - credential resolution
        print(f"could not construct the Anthropic client: {exc}", file=sys.stderr)
        return 2

    total_usage = {"input_tokens": 0, "output_tokens": 0}
    failures: list[str] = []
    warning_count = 0

    for lang in args.languages:
        for condition in args.conditions:
            # Always load: even with --force we need the unselected records so
            # a targeted `--force --items ...` run does not truncate the file.
            existing = load_existing(lang, condition)
            records: list[dict] = []
            print(f"[{lang}_{condition}]")

            for item in selected:
                system_prompt = build_system_prompt(item, condition, lang)
                user_message = build_user_message(item, lang)
                fingerprint = prompt_fingerprint(system_prompt, user_message, args.model)

                cached = None if args.force else existing.get(item["id"])
                if (
                    cached
                    and cached.get("provenance", {}).get("prompt_fingerprint") == fingerprint
                    and cached.get("validation", {}).get("ok")
                ):
                    print(f"  = {item['id']} (unchanged)")
                    records.append(cached)
                    continue

                print(f"  + {item['id']}")
                record = generate_record(client, item, condition, lang, args)
                records.append(record)

                total_usage["input_tokens"] += record["provenance"]["usage"]["input_tokens"]
                total_usage["output_tokens"] += record["provenance"]["usage"]["output_tokens"]

                if not record["validation"]["ok"]:
                    for err in record["validation"]["errors"]:
                        failures.append(f"{lang}_{condition}/{item['id']}: {err}")
                warning_count += len(record["validation"]["warnings"])

                if args.sleep:
                    time.sleep(args.sleep)

            # Preserve any items that exist in the file but were not selected
            # this run, so a targeted --items run does not truncate the set.
            selected_ids = {i["id"] for i in selected}
            for item_id, cached in existing.items():
                if item_id not in selected_ids:
                    records.append(cached)
            order = {i["id"]: n for n, i in enumerate(all_items)}
            records.sort(key=lambda r: order.get(r["item_id"], 999))

            path = write_output(lang, condition, records, items_sha, args)
            print(f"  -> {display_path(path)} ({len(records)} records)")

    print("\n" + "-" * 60)
    print(f"tokens: {total_usage['input_tokens']:,} in / {total_usage['output_tokens']:,} out")
    print(f"warnings: {warning_count}")

    if failures:
        print(f"\n{len(failures)} validation failure(s):")
        for line in failures:
            print(f"  - {line}")
        print("\nFiles were still written. Inspect the `validation` block on each")
        print("failing record, then re-run with --items to regenerate just those.")
        return 1

    print("all records passed validation")
    print("\nNext: scripts/verify_equivalence.py (STUDY3_SPEC.md §12 step 3).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
