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
import re
import sys
import unicodedata
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
MATERIALS = REPO_ROOT / "materials"
ITEMS_PATH = MATERIALS / "items.json"
QUALITY_ASSIGNMENT_PATH = MATERIALS / "quality_assignment.json"
PROMPTS_DIR = MATERIALS / "prompts"
RESPONSES_DIR = MATERIALS / "responses"
CODING_DIR = MATERIALS / "coding"
MANIFEST_JSON = MATERIALS / "manifest.json"
MANIFEST_SHA256 = MATERIALS / "manifest.sha256"

LANGUAGES = ("kk", "ru", "en")
LANGUAGE_NAMES = {"kk": "Kazakh", "ru": "Russian", "en": "English"}
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
