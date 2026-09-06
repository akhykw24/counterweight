"""The launch gate, end to end, through the command the researcher actually runs.

`test_hand_verification.py` covers the record in isolation and the golden-file
test asserts the committed manifest. Neither can show the gate *opening*: the
committed set is live and unverified, so every assertion about it sees one side
of the conjunction. A rule only ever observed in one state is a rule nobody has
watched work.

These tests drive `hash_manifest.py` in a sandbox copy of materials/ and walk
the whole cycle: build, confirm, regenerate, lapse. They use subprocesses
rather than imports because the paths resolve at module load, and because the
CLI is the thing being promised to a human -- testing the function underneath
it would leave the promise untested.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from _common import MATERIALS, REPO_ROOT

MANIFEST = "manifest.json"
VERIFICATION = "hand_verification.json"


@pytest.fixture()
def sandbox(tmp_path: Path) -> Path:
    """A throwaway copy of materials/, so no test can touch the frozen set."""
    target = tmp_path / "materials"
    shutil.copytree(MATERIALS, target)
    (target / VERIFICATION).unlink(missing_ok=True)
    return target


def _run(sandbox: Path, *args: str) -> subprocess.CompletedProcess[str]:
    env = dict(os.environ)
    env["EIAI_MATERIALS_DIR"] = str(sandbox)
    return subprocess.run(
        [sys.executable, str(REPO_ROOT / "pipeline" / "hash_manifest.py"), *args],
        capture_output=True,
        text=True,
        cwd=str(REPO_ROOT),
        env=env,
    )


def _manifest(sandbox: Path) -> dict:
    return json.loads((sandbox / MANIFEST).read_text(encoding="utf-8"))


def test_rebuilding_alone_never_confirms_anything(sandbox: Path) -> None:
    # The property the separate command exists for. Building the manifest is
    # something a script does; approving the texts is something a person does,
    # and the first must never quietly perform the second.
    result = _run(sandbox)
    assert result.returncode == 0, result.stderr

    manifest = _manifest(sandbox)
    assert manifest["generator_mode"] == "live_api", "sandbox should hold the real stimuli"
    assert manifest["hand_verified"] is False
    assert manifest["launch_ready"] is False
    assert not (sandbox / VERIFICATION).exists()


def test_the_unverified_state_says_what_to_do_about_it(sandbox: Path) -> None:
    # A gate that refuses without naming the key is an obstacle.
    result = _run(sandbox)
    assert "--confirm-verified" in result.stdout


def test_confirming_opens_the_gate(sandbox: Path) -> None:
    # The other side of the conjunction, which nothing else can observe while
    # the committed set is unverified.
    _run(sandbox)
    result = _run(sandbox, "--confirm-verified", "Darya Prokopenko")
    assert result.returncode == 0, result.stderr

    manifest = _manifest(sandbox)
    assert manifest["hand_verified"] is True
    assert manifest["launch_ready"] is True

    record = json.loads((sandbox / VERIFICATION).read_text(encoding="utf-8"))
    assert record["verified_by"] == "Darya Prokopenko"
    assert record["verified_sha256"] == manifest["manifest_sha256"]


def test_a_changed_stimulus_lapses_the_approval(sandbox: Path) -> None:
    # The reason approval is bound to a digest rather than to a date. After an
    # edit the earlier reading no longer describes the texts on disk, and an
    # approval that survived it would be worse than none: it reads as
    # diligence.
    _run(sandbox)
    _run(sandbox, "--confirm-verified", "Darya Prokopenko")
    assert _manifest(sandbox)["launch_ready"] is True

    target = sandbox / "responses" / "en_neutral_na.json"
    document = json.loads(target.read_text(encoding="utf-8"))
    document["responses"][0]["body"] += " One more sentence nobody approved."
    target.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8", newline="\n")

    result = _run(sandbox)
    assert result.returncode == 0, result.stderr
    manifest = _manifest(sandbox)
    assert manifest["hand_verified"] is False
    assert manifest["launch_ready"] is False
    # The stale record is still on disk; it simply no longer matches. Keeping
    # it is deliberate -- who approved what, and when, stays auditable.
    assert (sandbox / VERIFICATION).exists()


def test_re_confirming_after_a_change_opens_it_again(sandbox: Path) -> None:
    # Lapsing must be recoverable by reading the new text, not by starting the
    # project over.
    _run(sandbox)
    _run(sandbox, "--confirm-verified", "Darya Prokopenko")

    target = sandbox / "responses" / "en_warm_low.json"
    document = json.loads(target.read_text(encoding="utf-8"))
    document["responses"][0]["body"] += " Edited."
    target.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8", newline="\n")

    _run(sandbox)
    assert _manifest(sandbox)["launch_ready"] is False

    _run(sandbox, "--confirm-verified", "Darya Prokopenko")
    assert _manifest(sandbox)["launch_ready"] is True


def test_an_empty_name_is_refused_at_the_command_line(sandbox: Path) -> None:
    _run(sandbox)
    result = _run(sandbox, "--confirm-verified", "   ")
    assert result.returncode != 0
    assert _manifest(sandbox)["launch_ready"] is False
