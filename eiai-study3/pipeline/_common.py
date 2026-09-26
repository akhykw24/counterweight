"""Shared helpers for the Study 3 pipeline.

Locale-aware numeric matching, hedge detection, word counting, hashing and
paths. Imported by generate.py, verify_equivalence.py, hash_manifest.py and
verify_components.py so there is exactly one implementation of each.

The numeric matcher carries over from the v1 generator (archive/v1/) where it
was tested against 19 locale-formatting cases across en / ru / kk.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

# Kazakh and Russian text goes to stdout. A default Windows console codepage
# raises UnicodeEncodeError on Cyrillic, which would kill a run mid-way.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except (ValueError, OSError):  # pragma: no cover - console dependent
            pass

REPO_ROOT = Path(__file__).resolve().parent.parent


def load_dotenv() -> list[str]:
    """Loads .env files into os.environ without overwriting real env vars.

    Checks this repo first, then the enclosing counterweight checkout, so a key
    already configured there is picked up without being duplicated. Existing
    environment variables always win -- a shell export overrides a file.
    """
    import os

    loaded: list[str] = []
    candidates = [
        REPO_ROOT / ".env",
        REPO_ROOT / ".env.local",
        REPO_ROOT.parent / ".env",
        REPO_ROOT.parent / ".env.local",
    ]
    for path in candidates:
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and value and key not in os.environ:
                os.environ[key] = value
                loaded.append(f"{key} <- {path.name}")
    return loaded


def epoch_ms(client_ts: Any) -> int:
    """Milliseconds since the epoch, from the timestamp the client writes.

    `client_ts` is an ISO 8601 string: that is what packages/schema declares
    (`ClientTimestamp`) and what packages/telemetry/src/recorder.ts sends. The
    pipeline used to read it with `int()`, which held only because simulate.py
    wrote an integer instead -- so every duration in the projection worked on
    synthetic data and raised on the first real session.

    An integer is refused rather than accepted. Tolerating both shapes is what
    let the fixture drift away from the schema unnoticed, and a parser that
    accepts the wrong one cannot report that it has been handed the wrong one.
    Ordering still comes from `seq`; this is for durations and reporting only.
    """
    if not isinstance(client_ts, str):
        raise ValueError(
            f"client_ts must be an ISO 8601 string, got {type(client_ts).__name__} "
            f"{client_ts!r}"
        )
    text = client_ts.strip()
    # datetime.fromisoformat accepts "Z" only from Python 3.11, and accepts a
    # date with no time at all -- which would silently read as midnight.
    if "T" not in text:
        raise ValueError(f"client_ts is not a date-time: {client_ts!r}")
    try:
        moment = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError(f"client_ts is not an ISO 8601 date-time: {client_ts!r}") from error
    if moment.tzinfo is None:
        # A reading with no offset cannot be placed on a shared timeline, and
        # guessing UTC would put it silently hours away from the truth.
        raise ValueError(f"client_ts carries no UTC offset: {client_ts!r}")
    return round(moment.timestamp() * 1000)


def iso_from_epoch_ms(ms: int) -> str:
    """The inverse: the exact shape JavaScript's `toISOString()` produces.

    Used by the simulator so its logs are indistinguishable in shape from a
    browser's. A simulator that writes a form the real client never sends
    exercises a pipeline nobody will run.
    """
    moment = datetime.fromtimestamp(int(ms) / 1000, tz=timezone.utc)
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


# Materials root. Overridable so a test can exercise the generator against a
# throwaway copy instead of the committed, frozen set.
#
# This is not a convenience. `generate.py --offline` regenerates
# unconditionally, so before this existed a plain `pytest` run overwrote every
# real stimulus with a placeholder and rebuilt the manifest around it -- the
# integrity gate would then have passed, because the thing it compares against
# had been rewritten too. The safeguard was destroyed by the suite that tests
# it. Nothing but the test suite should ever set this.
MATERIALS = Path(os.environ.get("EIAI_MATERIALS_DIR") or (REPO_ROOT / "materials"))
ITEMS_PATH = MATERIALS / "items.json"
QUALITY_ASSIGNMENT_PATH = MATERIALS / "quality_assignment.json"
PROMPTS_DIR = MATERIALS / "prompts"
RESPONSES_DIR = MATERIALS / "responses"
CODING_DIR = MATERIALS / "coding"
MANIFEST_JSON = MATERIALS / "manifest.json"
MANIFEST_SHA256 = MATERIALS / "manifest.sha256"

# Active languages. Russian and Kazakh moved to archive/ under spec v2: the
# study is English only, and a translation that shifted argument strength would
# have been indistinguishable from the effect under study.
LANGUAGES = ("en",)
ARCHIVED_LANGUAGES = ("kk", "ru")
LANGUAGE_NAMES = {"kk": "Kazakh", "ru": "Russian", "en": "English"}
# Reverse-scored questionnaire items, named rather than inferred.
#
# One definition, three consumers: the scale score, the reliability analysis,
# and the simulator. They were three separate copies until the reliability
# report exposed the consequence -- the simulator answered every warmth item in
# the same direction, including "The assistant felt impersonal", so the scoring
# code dutifully flipped an item that had never been reversed and the scale
# looked broken (r = -0.43 against the rest). A shared constant cannot disagree
# with itself.
REVERSE_SCORED: dict[str, frozenset[str]] = {
    "warmth": frozenset({"warmth_04"}),
    "competence": frozenset({"competence_04"}),
    "trust": frozenset({"trust_03"}),
}

ALL_REVERSE_SCORED: frozenset[str] = frozenset().union(*REVERSE_SCORED.values())

REGISTERS = ("LOW", "MODERATE", "HIGH")

# (condition, register_state) pairs. The neutral condition does not branch.
VARIANTS: tuple[tuple[str, str | None], ...] = (
    ("warm", "LOW"),
    ("warm", "MODERATE"),
    ("warm", "HIGH"),
    ("neutral", None),
)

FOLLOWUP_IDS = ("measurement", "certainty", "challenge")

HEDGE_MARKERS = {
    "en": ("approximately", "around", "about", "roughly", "close to", "or so"),
    "ru": ("примерно", "около", "приблизительно", "порядка", "почти"),
    "kk": ("шамамен", "шамасында", "жуық", "маңайында", "шамалас"),
}


# ---------------------------------------------------------------------------
# Hashing
# ---------------------------------------------------------------------------


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def sha256_file(path: Path) -> str:
    """Digest of the file's bytes with line endings normalised to LF.

    Without normalisation a CRLF checkout on Windows would produce a different
    digest from the same content on CI, and the integrity guarantee would
    reduce to a platform check.
    """
    raw = path.read_bytes().replace(b"\r\n", b"\n")
    return hashlib.sha256(raw).hexdigest()


def canonical_json(payload: Any) -> str:
    """Stable serialisation: sorted keys, LF endings, fixed separators."""
    return json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(canonical_json(payload), encoding="utf-8", newline="\n")


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# Locale-aware numeric extraction
# ---------------------------------------------------------------------------

_SPACES = "     "
_NUMBER_RE = re.compile(rf"\d[\d{_SPACES}.,'’]*\d|\d")
_THOUSANDS_COMMA = re.compile(r"^\d{1,3}(,\d{3})+$")
_THOUSANDS_DOT = re.compile(r"^\d{1,3}(\.\d{3})+$")


def _token_to_float(token: str) -> float | None:
    t = token
    for ch in _SPACES:
        t = t.replace(ch, " ")
    t = t.replace("’", "'").replace(" ", "").replace("'", "")
    if not t:
        return None

    has_dot, has_comma = "." in t, "," in t
    if has_dot and has_comma:
        decimal = "." if t.rindex(".") > t.rindex(",") else ","
        t = t.replace("," if decimal == "." else ".", "").replace(decimal, ".")
    elif has_comma:
        t = t.replace(",", "") if _THOUSANDS_COMMA.match(t) else t.replace(",", ".")
    elif has_dot and _THOUSANDS_DOT.match(t):
        t = t.replace(".", "")

    try:
        return float(t)
    except ValueError:
        return None


def extract_numbers(text: str) -> list[float]:
    """Every number in `text`, normalised across en / ru / kk separator conventions."""
    out: list[float] = []
    for match in _NUMBER_RE.finditer(unicodedata.normalize("NFKC", text)):
        value = _token_to_float(match.group())
        if value is not None:
            out.append(value)
    return out


def contains_value(text: str, target: float) -> bool:
    """True if `target` appears as a number, in any locale format. Exact, not fuzzy.

    One known ambiguity: two numbers separated only by a space ("150 400") read
    as a single value, because a space is a legitimate thousands separator in
    Russian and Kazakh. There is no way to resolve that locally, and guessing
    would be worse. verify_equivalence.py compensates by rejecting *any* number
    that is not the advice value, so a leak in any spelling still fails -- the
    stray-number check is the safety net, not this function.
    """
    epsilon = 1e-9 * max(1.0, abs(target))
    return any(abs(n - target) <= epsilon for n in extract_numbers(text))


def word_count(text: str) -> int:
    return len([w for w in re.split(r"\s+", text.strip()) if w])


def has_hedge_marker(text: str, language: str) -> bool:
    lowered = text.lower()
    return any(marker in lowered for marker in HEDGE_MARKERS.get(language, ()))


# ---------------------------------------------------------------------------
# Naming
# ---------------------------------------------------------------------------


def register_slug(register_state: str | None) -> str:
    return "na" if register_state is None else register_state.lower()


def response_id(language: str, condition: str, register_state: str | None, item_id: str) -> str:
    return f"{language}_{condition}_{register_slug(register_state)}_{item_id}"


def stimulus_filename(language: str, condition: str, register_state: str | None) -> str:
    return f"{language}_{condition}_{register_slug(register_state)}.json"


def all_stimulus_files() -> list[str]:
    return [
        stimulus_filename(lang, condition, state)
        for lang in LANGUAGES
        for condition, state in VARIANTS
    ]


# ---------------------------------------------------------------------------
# Item bank
# ---------------------------------------------------------------------------


def design_cell(is_error: bool, quality: str, role: str) -> str:
    """The cell an item occupies, derived rather than stored.

    Storing it alongside quality and role would allow the three to disagree,
    and a design cell that contradicts the assignment is the kind of error that
    survives review because every individual file looks right.
    """
    if role == "filler":
        return "correct_filler"
    return f"{'error' if is_error else 'correct'}_{quality}"


def load_items() -> dict[str, Any]:
    """The item bank with the quality assignment merged in.

    Justification quality and analysed/filler role live in
    materials/quality_assignment.json, not in the bank: reassigning an item is
    then a config edit plus a stimulus regeneration rather than a code change,
    and there is exactly one place the assignment can be read from.
    """
    bank = read_json(ITEMS_PATH)
    assignment = read_json(QUALITY_ASSIGNMENT_PATH)["assignment"]

    missing = {i["id"] for i in bank["items"]} ^ set(assignment)
    if missing:
        raise ValueError(
            f"quality_assignment.json and items.json disagree on which items exist: "
            f"{sorted(missing)}"
        )

    for item in bank["items"]:
        entry = assignment[item["id"]]
        item["assigned_justification_quality"] = entry["quality"]
        item["role"] = entry["role"]
        item["design_cell"] = design_cell(bool(item["is_error"]), entry["quality"], entry["role"])
    return bank


def analysed_items(bank: dict[str, Any]) -> list[dict[str, Any]]:
    """Items that enter the justification-quality contrast, fillers excluded."""
    return [i for i in bank["items"] if i["role"] == "analysed"]


def load_prompt(name: str) -> str:
    return (PROMPTS_DIR / name).read_text(encoding="utf-8").strip()


def assigned_justification(item: dict[str, Any]) -> dict[str, Any]:
    quality = item["assigned_justification_quality"]
    return {"quality": quality, **item["justifications"][quality]}


def format_number(value: float) -> str:
    return str(int(value)) if float(value).is_integer() else str(value)


def iter_variants() -> Iterable[tuple[str, str, str | None]]:
    for language in LANGUAGES:
        for condition, state in VARIANTS:
            yield language, condition, state
