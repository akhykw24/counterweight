#!/usr/bin/env python3
"""Build and check the stimulus hash manifest (STUDY3_SPEC_v2.md section 5).

SHA-256 every frozen response file into a manifest committed **before**
collection opens. You can then prove, cryptographically, that stimuli were not
altered mid-study -- and `SESSION_STARTED` records the manifest hash each
participant actually saw, so the proof is per-session rather than global.

Writes two files:
  materials/manifest.json    machine-readable, validated by the golden-file test
  materials/manifest.sha256  classic sha256sum format, checkable with coreutils

Usage:
    python pipeline/hash_manifest.py            # write
    python pipeline/hash_manifest.py --check    # verify, change nothing

Exit codes: 0 clean, 1 drift detected, 2 stimuli missing.
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from typing import Any, Iterable

from _common import (
    ITEMS_PATH,
    MANIFEST_JSON,
    MANIFEST_SHA256,
    RESPONSES_DIR,
    all_stimulus_files,
    read_json,
    sha256_file,
    sha256_text,
    write_json,
)

GENERATOR_VERSION = "2.0.0"


def collect() -> tuple[list[dict[str, Any]], list[str]]:
    entries: list[dict[str, Any]] = []
    missing: list[str] = []

    for name in sorted(all_stimulus_files()):
        path = RESPONSES_DIR / name
        if not path.exists():
            missing.append(name)
            continue
        document = read_json(path)
        entries.append(
            {
                "path": f"materials/responses/{name}",
                "sha256": sha256_file(path),
                "response_count": len(document.get("responses", [])),
            }
        )

    return entries, missing


def manifest_digest(entries: list[dict[str, Any]]) -> str:
    """Digest over the sorted per-file digests. This is what SESSION_STARTED records."""
    lines = "\n".join(f"{entry['sha256']}  {entry['path']}" for entry in entries)
    return sha256_text(lines + "\n")


def build(entries: list[dict[str, Any]]) -> dict[str, Any]:
    modes: set[str] = set()
    models: set[str] = set()
    placeholder = False

    for entry in entries:
        document = read_json(RESPONSES_DIR / entry["path"].split("/")[-1])
        meta = document.get("meta", {})
        modes.add(str(meta.get("generator_mode", "unknown")))
        models.add(str(meta.get("model", "unknown")))
        placeholder = placeholder or bool(meta.get("placeholder"))

    return {
        # `Z`, not `+00:00`: the TypeScript schema uses zod's z.iso.datetime(),
        # which accepts only the Z form, and this manifest is read by both
        # languages. Keeping one canonical spelling avoids a cross-language
        # contract bug that would only surface at load time.
        "generated_at": datetime.now(timezone.utc)
        .isoformat(timespec="seconds")
        .replace("+00:00", "Z"),
        "generator_version": GENERATOR_VERSION,
        "generator_mode": "offline_placeholder" if placeholder else "anthropic_api",
        "model": sorted(models)[0] if len(models) == 1 else ", ".join(sorted(models)),
        "launch_ready": not placeholder,
        "items_file_sha256": sha256_file(ITEMS_PATH),
        "manifest_sha256": manifest_digest(entries),
        "files": entries,
    }


def write_sha256sum(entries: list[dict[str, Any]], digest: str) -> None:
    lines = [f"{entry['sha256']}  {entry['path']}" for entry in entries]
    lines.append("")
    lines.append(f"# manifest_sha256: {digest}")
    lines.append(f"# items.json: {sha256_file(ITEMS_PATH)}")
    MANIFEST_SHA256.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")


def check(entries: list[dict[str, Any]]) -> int:
    if not MANIFEST_JSON.exists():
        print("materials/manifest.json does not exist. Run pipeline/hash_manifest.py.", file=sys.stderr)
        return 1

    committed = read_json(MANIFEST_JSON)
    committed_files = {entry["path"]: entry["sha256"] for entry in committed["files"]}
    current_files = {entry["path"]: entry["sha256"] for entry in entries}

    drift: list[str] = []

    for path in sorted(set(committed_files) | set(current_files)):
        was, now = committed_files.get(path), current_files.get(path)
        if was is None:
            drift.append(f"NEW      {path}")
        elif now is None:
            drift.append(f"REMOVED  {path}")
        elif was != now:
            drift.append(f"CHANGED  {path}\n           was {was}\n           now {now}")

    current_digest = manifest_digest(entries)
    if committed.get("manifest_sha256") != current_digest:
        drift.append(
            f"MANIFEST digest changed\n           was {committed.get('manifest_sha256')}\n           now {current_digest}"
        )

    items_digest = sha256_file(ITEMS_PATH)
    if committed.get("items_file_sha256") != items_digest:
        drift.append(
            f"ITEMS    materials/items.json changed\n           was {committed.get('items_file_sha256')}\n           now {items_digest}"
        )

    if drift:
        print("Stimulus integrity check FAILED. Frozen material changed:\n", file=sys.stderr)
        for line in drift:
            print(f"  {line}", file=sys.stderr)
        print(
            "\nIf this change is intended and pre-registration has NOT happened, "
            "re-run pipeline/hash_manifest.py and commit the new manifest.\n"
            "If pre-registration HAS happened, this is a protocol deviation and must be reported.",
            file=sys.stderr,
        )
        return 1

    print(f"Stimulus integrity confirmed: {len(entries)} files match the committed manifest.")
    print(f"  manifest_sha256 {current_digest}")
    if not committed.get("launch_ready", False):
        print("  NOTE: manifest records launch_ready=false (placeholder stimuli).")
    return 0


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build or check the stimulus hash manifest.")
    parser.add_argument("--check", action="store_true", help="verify against the committed manifest")
    args = parser.parse_args(list(argv) if argv is not None else None)

    entries, missing = collect()
    if missing:
        print("Missing stimulus files -- run pipeline/generate.py first:", file=sys.stderr)
        for name in missing:
            print(f"  - {name}", file=sys.stderr)
        return 2

    if args.check:
        return check(entries)

    manifest = build(entries)
    write_json(MANIFEST_JSON, manifest)
    write_sha256sum(entries, manifest["manifest_sha256"])

    total = sum(entry["response_count"] for entry in entries)
    print(f"Hashed {len(entries)} stimulus files, {total} responses.")
    print(f"  manifest_sha256 {manifest['manifest_sha256']}")
    print(f"  launch_ready    {manifest['launch_ready']}")
    print("  -> materials/manifest.json")
    print("  -> materials/manifest.sha256")
    if not manifest["launch_ready"]:
        print("\nlaunch_ready is false: these are placeholder stimuli, not collection material.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
