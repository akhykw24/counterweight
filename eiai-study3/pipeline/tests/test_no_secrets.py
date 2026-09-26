"""No credential may live in the repository.

The study holds one genuinely dangerous secret: the Supabase service-role key,
which bypasses row-level security and can read every participant's responses.
It belongs in the hosting provider's environment and nowhere else.

A rule nobody checks is a rule that holds until the first hurried commit, so
this is a gate rather than a convention. It runs in CI and in `pnpm verify`.

The checker is tested against planted secrets rather than only against the
clean repository. A scanner that finds nothing proves nothing unless it has
been shown to find something.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from check_secrets import Finding, scan_text, scan_tree

# Fabricated, and shaped only to match each pattern. None is a real credential.
#
# Every one is assembled from fragments rather than written out, and the
# variable names below are assembled too. That is not obfuscation: this file is
# tracked, so a literal here would be a finding, and the only way to keep the
# gate green would be to exempt this path -- which is exactly the hole an
# attacker, or a hurried colleague, would then use. The scanner reads the
# assembled string, so the tests lose nothing.
PLANTED = {
    "supabase service key (JWT)": "eyJ" + "hbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" + ".abcdefghij.signature",
    "groq key": "gsk_" + "A1b2C3d4E5f6G7h8I9j0" + "K1l2M3n4O5p6Q7r8S9t0",
    "google key": "AIza" + "SyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6",
    "openai key": "sk-" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0",
}

#: The variable name the scanner treats as a tell, kept out of the source in
#: one piece for the same reason.
SERVICE_KEY = "SUPABASE" + "_SERVICE_KEY"


@pytest.mark.parametrize("label,secret", sorted(PLANTED.items()))
def test_each_shape_of_credential_is_recognised(label: str, secret: str) -> None:
    findings = scan_text("example.ts", f'const key = "{secret}";')
    assert findings, f"{label} was not recognised"


def test_a_service_key_assignment_is_recognised_even_without_a_known_prefix() -> None:
    # A key rotated into a new format still matters. The variable name is the
    # tell, so an assignment with any non-empty value is a finding.
    findings = scan_text(".env", f"{SERVICE_KEY}=whatever-this-is")
    assert findings


def test_naming_a_variable_without_a_value_is_fine() -> None:
    # Documentation, .env.example and deployment runbooks all name the
    # variables. A checker that flagged those would be turned off within a day.
    assert scan_text("docs/DEPLOY.md", f"Set `{SERVICE_KEY}` in Vercel.") == []
    assert scan_text(".env.example", f"{SERVICE_KEY}=") == []
    assert scan_text(".env.example", "SUPABASE" + "_URL=") == []


def test_a_placeholder_is_not_a_secret() -> None:
    for value in ["your-key-here", "<paste it here>", "xxx", "changeme"]:
        placeholder = f"{SERVICE_KEY}={value}"
        assert scan_text(".env.example", placeholder) == [], placeholder


def test_a_tracked_env_file_is_itself_a_finding(tmp_path: Path) -> None:
    # Even an empty one. A committed .env is where the next person will put a
    # real key, and by then it is in the history for good.
    (tmp_path / ".env").write_text("# nothing yet\n", encoding="utf-8")
    findings = scan_tree(tmp_path, tracked=[".env"])
    assert any("env file" in f.reason for f in findings)


def test_the_example_file_is_allowed(tmp_path: Path) -> None:
    (tmp_path / ".env.example").write_text(f"{SERVICE_KEY}=\n", encoding="utf-8")
    assert scan_tree(tmp_path, tracked=[".env.example"]) == []


def test_the_repository_as_it_stands_is_clean() -> None:
    # The assertion that matters day to day. It means something only because
    # every test above shows the scanner can fail.
    from _common import REPO_ROOT

    findings = scan_tree(REPO_ROOT)
    assert findings == [], "\n".join(f"{f.path}:{f.line} {f.reason}" for f in findings)


def test_a_finding_says_where_and_why() -> None:
    findings = scan_text("src/config.ts", f'const k = "{PLANTED["groq key"]}";')
    finding = findings[0]
    assert isinstance(finding, Finding)
    assert finding.path == "src/config.ts"
    assert finding.line == 1
    assert finding.reason
    # The value itself must not be echoed: a CI log is not a safe place to
    # reprint a credential that has just been found.
    assert PLANTED["groq key"] not in finding.reason
