#!/usr/bin/env python3
"""Fail if a credential is committed to the repository.

The study holds one genuinely dangerous secret: the Supabase service-role key,
which bypasses row-level security and can read every participant's responses.
It belongs in the hosting provider's environment and nowhere else. The Groq key
used to generate the stimuli is the second.

A rule nobody checks is a rule that holds until the first hurried commit, so
this runs in CI and in `pnpm verify` rather than living in a contributing guide.

What it will not do
-------------------
Flag a variable *name*. Documentation, `.env.example` and the deployment
runbook all have to name `SUPABASE_SERVICE_KEY` to be useful, and a checker
that complained about those would be switched off within a day -- at which
point it protects nothing. A name with a value is the finding; a name alone is
not, and neither is an obvious placeholder.

Usage
-----
    python pipeline/check_secrets.py            # the repository
    python pipeline/check_secrets.py --path DIR

Exit codes: 0 clean, 1 something found.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from _common import REPO_ROOT

#: Credential shapes, by the prefix each provider uses. Matching on shape
#: rather than on entropy keeps the false-positive rate at zero, which is what
#: decides whether a check like this survives.
PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("a JSON Web Token, the shape of a Supabase key", re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.")),
    ("a Groq API key", re.compile(r"\bgsk_[A-Za-z0-9]{32,}")),
    ("a Google API key", re.compile(r"\bAIza[A-Za-z0-9_-]{30,}")),
    ("an OpenAI API key", re.compile(r"\bsk-[A-Za-z0-9]{32,}")),
)

#: Variables whose value is always a secret, whatever shape it takes. A key
#: rotated into a new format still matters, and here the name is the tell.
#:
#: The value runs to the end of the line rather than to the first space. A
#: placeholder like `<paste it here>` contains spaces, and capturing only its
#: first word made it look like a real assignment.
SECRET_ASSIGNMENT = re.compile(
    r"\b(SUPABASE_SERVICE_KEY|GROQ_API_KEY|GEMINI_API_KEY|OPENAI_API_KEY|DATABASE_URL)\s*[:=]\s*(.*)$"
)

#: Values that are plainly not credentials. Without these the example file and
#: every runbook become findings.
PLACEHOLDERS = re.compile(
    r"^[\"']?(|x+|y+|<[^>]*>|\.\.\.|changeme|your[-_a-z]*|paste[-_a-z]*|the [a-z ]+|env\([^)]*\)|file:[^\"']*)[\"']?[,;]?$",
    re.IGNORECASE,
)

#: Extensions worth reading. Binaries and lockfiles are noise.
TEXT_SUFFIXES = frozenset(
    {".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".py", ".md", ".sql", ".yml", ".yaml", ".txt", ".env", ".sh", ".html", ".css"}
)

SKIP_DIRECTORIES = frozenset({"node_modules", ".git", "dist", ".turbo", "__pycache__", "test-results", "playwright-report", ".venv"})

#: The one env file allowed in version control: it holds names and no values.
ALLOWED_ENV_FILES = frozenset({".env.example"})


@dataclass(frozen=True)
class Finding:
    path: str
    line: int
    reason: str


def scan_text(path: str, text: str) -> list[Finding]:
    """Findings in one file's contents. The value itself is never echoed.

    A CI log is not a safe place to reprint a credential that has just been
    found, and a log that does it turns one leak into two.
    """
    findings: list[Finding] = []
    for number, line in enumerate(text.splitlines(), start=1):
        for reason, pattern in PATTERNS:
            if pattern.search(line):
                findings.append(Finding(path, number, f"looks like {reason}"))
        match = SECRET_ASSIGNMENT.search(line)
        if match and not PLACEHOLDERS.match(match.group(2).strip()):
            findings.append(
                Finding(path, number, f"{match.group(1)} is assigned a value here")
            )
    return findings


def _tracked_files(root: Path) -> list[str]:
    """Files git knows about. Ignored files are not the repository's problem."""
    try:
        result = subprocess.run(
            ["git", "ls-files"], cwd=str(root), capture_output=True, text=True, check=True
        )
    except (subprocess.CalledProcessError, FileNotFoundError):
        return []
    return [line for line in result.stdout.splitlines() if line.strip()]


def scan_tree(root: Path, tracked: Iterable[str] | None = None) -> list[Finding]:
    """Every finding under `root`, considering only files git tracks."""
    paths = list(tracked) if tracked is not None else _tracked_files(root)
    if not paths:
        paths = [
            str(p.relative_to(root)).replace("\\", "/")
            for p in root.rglob("*")
            if p.is_file() and not SKIP_DIRECTORIES & set(p.parts)
        ]

    findings: list[Finding] = []
    for relative in sorted(paths):
        name = Path(relative).name
        if name.startswith(".env") and name not in ALLOWED_ENV_FILES:
            findings.append(
                Finding(relative, 0, "an env file is tracked; env files hold credentials")
            )
        absolute = root / relative
        if not absolute.is_file():
            continue
        if absolute.suffix.lower() not in TEXT_SUFFIXES and not name.startswith(".env"):
            continue
        try:
            text = absolute.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        findings.extend(scan_text(relative, text))
    return findings


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Fail if a credential is committed.")
    parser.add_argument("--path", default=str(REPO_ROOT))
    args = parser.parse_args(list(argv) if argv is not None else None)

    findings = scan_tree(Path(args.path))
    if not findings:
        print("No credentials found in tracked files.")
        return 0

    print("Credentials found in the repository:", file=sys.stderr)
    for finding in findings:
        where = finding.path if finding.line == 0 else f"{finding.path}:{finding.line}"
        print(f"  {where}  {finding.reason}", file=sys.stderr)
    print(
        "\nRotate anything real that appears above -- a committed key is "
        "compromised even after it is deleted, because it stays in the history.",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
