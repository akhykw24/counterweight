"""Generation is idempotent, and the provider is swappable (spec v2, item 6).

Two claims that are easy to assert and easy to get wrong:

**Idempotence.** Running the generator twice must produce byte-identical output
and the same manifest digest. If it does not, the hash manifest stops meaning
"the stimuli are unchanged" and starts meaning "the generator ran again", which
is not a property anyone can pre-register.

**Provider swappability.** A stub standing in for the model must connect without
editing anything above the generation layer. The test uses a provider defined
*here*, in the test file, and never imported by the pipeline -- if generate.py
had to know about it, that would be the failure.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from _common import MANIFEST_JSON, MATERIALS, RESPONSES_DIR, REPO_ROOT, sha256_file
from providers import OfflineProvider, ProviderError

#: Where the subprocesses in this module write. Set by the fixture below to a
#: throwaway copy of materials/.
#
# Before this existed the tests ran the generator against the committed set.
# That was invisible while the stimuli were placeholders, because placeholders
# regenerate byte-identically -- but `generate.py --offline` regenerates
# unconditionally, so the first `pytest` run after real generation would have
# replaced every real stimulus with a placeholder and rebuilt the manifest to
# match. The integrity gate would have reported success, having been rewritten
# along with the thing it protects.
_SANDBOX: dict[str, Path] = {}


@pytest.fixture(autouse=True)
def isolated_materials(tmp_path: Path):
    """A per-test copy of materials/, so no test can touch the frozen set."""
    sandbox = tmp_path / "materials"
    shutil.copytree(MATERIALS, sandbox)
    _SANDBOX["path"] = sandbox
    yield sandbox
    _SANDBOX.clear()


def _env() -> dict[str, str]:
    env = dict(os.environ)
    env["EIAI_MATERIALS_DIR"] = str(_SANDBOX["path"])
    return env


def _sandbox_responses() -> Path:
    return _SANDBOX["path"] / "responses"


def _sandbox_manifest() -> Path:
    return _SANDBOX["path"] / "manifest.json"


def _run(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(REPO_ROOT / "pipeline" / "generate.py"), *args],
        capture_output=True, text=True, cwd=str(REPO_ROOT), env=_env(),
    )


def _digests() -> dict[str, str]:
    return {p.name: sha256_file(p) for p in sorted(_sandbox_responses().glob("*.json"))}


def test_two_offline_runs_produce_byte_identical_stimuli():
    first = _run("--offline")
    assert first.returncode == 0, first.stderr
    before = _digests()

    second = _run("--offline")
    assert second.returncode == 0, second.stderr
    after = _digests()

    assert before == after, (
        "a second run changed the frozen stimuli. The manifest would then record "
        "when the generator last ran rather than what the stimuli are."
    )


def test_the_manifest_digest_survives_a_regeneration():
    _run("--offline")
    subprocess.run([sys.executable, str(REPO_ROOT / "pipeline" / "hash_manifest.py")],
                   capture_output=True, cwd=str(REPO_ROOT), env=_env())
    first = json.loads(_sandbox_manifest().read_text(encoding="utf-8"))["manifest_sha256"]

    _run("--offline")
    subprocess.run([sys.executable, str(REPO_ROOT / "pipeline" / "hash_manifest.py")],
                   capture_output=True, cwd=str(REPO_ROOT), env=_env())
    second = json.loads(_sandbox_manifest().read_text(encoding="utf-8"))["manifest_sha256"]

    assert first == second


def test_the_integrity_gate_passes_after_a_regeneration():
    # The end-to-end version of the two tests above: regenerate, then ask the
    # gate whether anything moved.
    #
    # The sandbox is manifested from its OWN first regeneration before the
    # second one is checked. Previously the test regenerated once and checked
    # against whatever manifest the copy inherited, which only agreed while the
    # committed set was itself offline placeholders -- so the day real stimuli
    # landed, this failed for a reason that had nothing to do with idempotence.
    _run("--offline")
    subprocess.run(
        [sys.executable, str(REPO_ROOT / "pipeline" / "hash_manifest.py")],
        capture_output=True, cwd=str(REPO_ROOT), env=_env(),
    )

    _run("--offline")
    result = subprocess.run(
        [sys.executable, str(REPO_ROOT / "pipeline" / "hash_manifest.py"), "--check"],
        capture_output=True, text=True, cwd=str(REPO_ROOT), env=_env(),
    )
    assert result.returncode == 0, result.stdout + result.stderr


# ---------------------------------------------------------------------------
# Provider swappability
# ---------------------------------------------------------------------------


class StubProvider:
    """A provider the pipeline has never heard of.

    Defined in the test file and never imported by generate.py. If the
    generation layer needed to know about it -- a branch on a name, an entry in
    a registry -- this could not exist.
    """

    placeholder = False
    name = "stub"
    model = "fixture"
    sleep_seconds = 0.0

    def __init__(self, payload: dict[str, str]) -> None:
        self.payload = payload
        self.calls: list[str] = []
        self.tokens_used = 0
        self.requests_made = 0

    def estimate_tokens(self, system_prompt: str, user_message: str) -> int:
        return 0

    def complete(self, system_prompt, user_message, schema, schema_name, cell_id):
        self.calls.append(cell_id)
        self.requests_made += 1
        return {"payload": dict(self.payload), "tokens": 0}


def test_a_stub_provider_satisfies_the_interface_the_pipeline_uses():
    import generate

    stub = StubProvider({"justification": "a stub sentence of the right shape"})
    result = stub.complete("sys", "user", generate.JUSTIFICATION_SCHEMA, "justification",
                           "justification/en/item_01")
    assert result["payload"]["justification"]
    assert stub.calls == ["justification/en/item_01"]

    # The three shipped providers and the stub expose the same surface. Checked
    # by attribute rather than by isinstance, because Provider is a Protocol:
    # nothing has to inherit from it, which is what makes a stub possible.
    for provider in (stub, OfflineProvider(lambda name, cid: {})):
        for attribute in ("name", "model", "placeholder", "sleep_seconds",
                          "complete", "estimate_tokens"):
            assert hasattr(provider, attribute), f"{provider} lacks {attribute}"


def test_the_generation_layer_names_no_provider():
    """The whole point of the abstraction.

    Checked against the parsed syntax tree rather than the file text, so that
    prose is excluded precisely rather than approximately: a docstring that
    explains why OfflineProvider exists is documentation, and a comment naming a
    provider is documentation. What must not appear is an identifier or a string
    *in code* that ties the generation layer to one source.
    """
    import ast

    tree = ast.parse((REPO_ROOT / "pipeline" / "generate.py").read_text(encoding="utf-8"))

    # Docstrings are the first statement of a module, class or function; drop
    # them before looking at the constants that remain.
    docstrings = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            body = getattr(node, "body", [])
            if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant):
                docstrings.add(id(body[0].value))

    forbidden = {"LiveProvider", "OfflineProvider", "ManualProvider", "groq", "gemini", "manual"}
    offences: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            if id(node) not in docstrings and node.value in forbidden:
                offences.append(f"line {node.lineno}: string {node.value!r}")
        elif isinstance(node, ast.Name) and node.id in forbidden:
            offences.append(f"line {node.lineno}: name {node.id}")

    assert offences == [], (
        "generate.py names a provider in code: "
        + "; ".join(offences)
        + ". Provider choice belongs in providers.py and the --provider flag."
    )


def test_a_provider_that_cannot_serve_a_cell_says_so_rather_than_returning_nothing():
    from providers import ManualProvider

    provider = ManualProvider(directory=REPO_ROOT / "materials" / "does-not-exist")
    with pytest.raises(ProviderError):
        provider.complete("sys", "user", {"properties": {}, "required": []},
                          "justification", "justification/en/item_01")


def test_running_the_generator_never_touches_the_committed_materials():
    """The guard on everything above.

    Any test in this module that forgets the sandbox would rewrite the frozen
    stimuli, and the damage would be invisible for exactly as long as the
    stimuli remain placeholders. So the committed set is hashed before and
    after a real generator run, from outside the sandbox.
    """
    committed = REPO_ROOT / "materials"
    before = {
        path.relative_to(committed).as_posix(): sha256_file(path)
        for path in sorted(committed.rglob("*.json"))
    }
    assert before, "no committed materials found to protect"

    result = _run("--offline")
    assert result.returncode == 0, result.stderr
    # The manifest rebuild too, and not as an afterthought: regenerating
    # placeholders happens to be byte-identical, so generation alone would leave
    # the committed files untouched and this guard would pass without proving
    # anything. Rewriting the manifest is the step that actually moves bytes.
    manifest = subprocess.run(
        [sys.executable, str(REPO_ROOT / "pipeline" / "hash_manifest.py")],
        capture_output=True, text=True, cwd=str(REPO_ROOT), env=_env(),
    )
    assert manifest.returncode == 0, manifest.stderr

    after = {
        path.relative_to(committed).as_posix(): sha256_file(path)
        for path in sorted(committed.rglob("*.json"))
    }
    changed = sorted(k for k in before if before[k] != after.get(k))
    assert changed == [], (
        f"a test run rewrote committed materials: {changed}. "
        "Generation must happen in a sandbox; the frozen set is the thing the "
        "manifest exists to protect."
    )
