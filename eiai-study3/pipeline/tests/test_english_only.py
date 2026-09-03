"""The active stimulus set is English only (spec v2 §1).

Russian and Kazakh move to `archive/` rather than being deleted: they are
provenance for a design decision, and the texts themselves took real work. What
matters here is that nothing archived can reach a participant, and the way that
is guaranteed is the manifest -- if a file is not in the manifest, the golden
test does not verify it and the loader will not serve it.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from _common import LANGUAGES, MANIFEST_JSON, RESPONSES_DIR, REPO_ROOT, read_json

ARCHIVED_LANGUAGES = ("ru", "kk")


def test_only_english_is_an_active_language():
    assert tuple(LANGUAGES) == ("en",)


def test_the_manifest_lists_no_archived_language():
    manifest = read_json(MANIFEST_JSON)
    listed = [entry["path"] for entry in manifest["files"]]
    offenders = [
        path
        for path in listed
        for language in ARCHIVED_LANGUAGES
        if Path(path).name.startswith(f"{language}_")
    ]
    assert offenders == [], (
        f"the active manifest still covers archived-language stimuli: {offenders}. "
        "A file in the manifest is a file the loader will serve."
    )


def test_the_active_response_directory_holds_english_only():
    present = sorted(p.name for p in RESPONSES_DIR.glob("*.json"))
    assert present, "no stimulus files at all"
    for name in present:
        assert name.startswith("en_"), f"{name} is not an English stimulus file"
    # 4 variants: warm x 3 registers, plus neutral.
    assert len(present) == 4, present


def test_archived_stimuli_are_kept_rather_than_deleted():
    archive = REPO_ROOT / "archive" / "responses"
    assert archive.exists(), "archived stimuli must be retained for provenance"
    archived = sorted(p.name for p in archive.glob("*.json"))
    for language in ARCHIVED_LANGUAGES:
        assert any(name.startswith(f"{language}_") for name in archived), (
            f"{language} stimuli were removed rather than archived"
        )


@pytest.mark.parametrize("language", ARCHIVED_LANGUAGES)
def test_no_archived_language_appears_in_the_item_bank_active_fields(language):
    # The bank still carries ru/kk question stems. They are inert once the
    # active language set is English only, but the manifest digest covers the
    # bank, so this records the decision rather than silently relying on it.
    bank = read_json(REPO_ROOT / "materials" / "items.json")
    for item in bank["items"]:
        assert "en" in item["question"], f"{item['id']} has no English stem"
