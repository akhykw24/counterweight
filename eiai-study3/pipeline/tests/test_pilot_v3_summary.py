"""The pilot summary: pilot runs only, withdrawn participants gone, comments verbatim."""

from __future__ import annotations

import importlib.util
import json
import sys
import uuid
from pathlib import Path

from _common import REPO_ROOT, iso_from_epoch_ms
from test_v3_export import session, write_jsonl

spec = importlib.util.spec_from_file_location("pilot_v3_summary", REPO_ROOT / "scripts" / "pilot_v3_summary.py")
summary = importlib.util.module_from_spec(spec)
sys.modules["pilot_v3_summary"] = summary
spec.loader.exec_module(summary)  # type: ignore[union-attr]


def with_comment(events: list[dict], item: str, text: str) -> list[dict]:
    last = events[-1]
    extra = {**last, "event_id": str(uuid.uuid4()), "seq": last["seq"] + 1, "type": "pilot_feedback",
             "payload": {"item_id": item, "text": text}}
    return [*events, extra]


def test_only_pilot_runs_are_summarised_by_default(tmp_path: Path) -> None:
    path = write_jsonl(tmp_path / "e.jsonl", session(mode="pilot") + session(mode="test") + session(mode="test"))
    result = summary.summarise([path], out=tmp_path / "S.md")
    assert result["participants"] == 1


def test_a_withdrawn_participant_is_not_in_the_summary(tmp_path: Path) -> None:
    path = write_jsonl(tmp_path / "e.jsonl", session() + session(withdraw=True))
    result = summary.summarise([path], out=tmp_path / "S.md")
    assert result["participants"] == 1
    assert "Excluded after “Remove my data”: 1 session(s)" in (tmp_path / "S.md").read_text(encoding="utf-8")


def test_comments_are_quoted_verbatim(tmp_path: Path) -> None:
    text = "The quiz felt long — and “Nova” was a bit much!"
    path = write_jsonl(tmp_path / "e.jsonl", with_comment(session(), "PF2", text))
    summary.summarise([path], out=tmp_path / "S.md")
    assert f"**PF2**: {text}" in (tmp_path / "S.md").read_text(encoding="utf-8")


def test_mission_choices_are_counted_by_version(tmp_path: Path) -> None:
    # The fixture answers `intuitive` on claims 3, 6, 9, 12 and `lesson` elsewhere.
    # List A: odd strong. Strong claims 1,3,5,7,9,11 -> 3 and 9 intuitive; weak
    # claims 2,4,6,8,10,12 -> 6 and 12 intuitive.
    path = write_jsonl(tmp_path / "e.jsonl", session(cell="EI-A"))
    summary.summarise([path], out=tmp_path / "S.md")
    text = (tmp_path / "S.md").read_text(encoding="utf-8")
    assert "| **All** | 4 / 2 / 0 | 4 / 2 / 0 |" in text


def test_no_pilot_data_is_a_report_not_a_crash(tmp_path: Path) -> None:
    path = write_jsonl(tmp_path / "e.jsonl", session(mode="test"))
    result = summary.summarise([path], out=tmp_path / "S.md")
    assert result["participants"] == 0
    assert "No allocated participants" in (tmp_path / "S.md").read_text(encoding="utf-8")


def test_rehearsal_data_can_be_summarised_on_request(tmp_path: Path) -> None:
    path = write_jsonl(tmp_path / "e.jsonl", session(mode="test"))
    assert summary.summarise([path], mode="test", out=tmp_path / "S.md")["participants"] == 1


def test_since_keeps_only_the_later_pilot(tmp_path: Path) -> None:
    # The fixture's sessions start in 2026-09; a cutoff after that keeps none.
    path = write_jsonl(tmp_path / "e.jsonl", session())
    assert summary.summarise([path], out=tmp_path / "a.md", since="2026-01-01")["participants"] == 1
    assert summary.summarise([path], out=tmp_path / "b.md", since="2027-01-01")["participants"] == 0
