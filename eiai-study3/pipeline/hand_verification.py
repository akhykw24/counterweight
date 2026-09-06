"""The record that a person read the frozen stimuli before anyone was recruited.

Why this exists
---------------
The specification requires stimuli to be "pre-generated, **hand-verified**,
frozen". The manifest computed `launch_ready` as `not placeholder`, which meant
the flag flipped to true the moment real generation replaced the offline
placeholders -- no human involved. Both the app's launch gate and the on-screen
"placeholder stimulus" warning key off that flag, so the last barrier standing
between a participant and unreviewed text would have lifted on its own.

Bound to a digest, not to a date
--------------------------------
Verification records the `manifest_sha256` it was performed against. Change one
cell and the digest changes and the approval lapses, because it no longer
describes the texts on disk. A stale approval of material that no longer exists
is worse than no approval: it reads as diligence.

This is deliberately a separate file rather than a field inside the manifest.
The manifest is rebuilt by a script; an approval that a script can rewrite is
not an approval.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from _common import MATERIALS, write_json

VERIFICATION_PATH = MATERIALS / "hand_verification.json"


@dataclass(frozen=True)
class HandVerification:
    verified_sha256: str
    verified_by: str
    verified_at: str


def load_verification(path: Path | None = None) -> HandVerification | None:
    """The recorded approval, or None when there is none that can be read.

    Fails closed: a corrupt or partial record is not an approval, and must not
    take down every command that consults it either.
    """
    target = path or VERIFICATION_PATH
    if not target.exists():
        return None
    try:
        raw = json.loads(target.read_text(encoding="utf-8"))
        return HandVerification(
            verified_sha256=str(raw["verified_sha256"]),
            verified_by=str(raw["verified_by"]),
            verified_at=str(raw["verified_at"]),
        )
    except (json.JSONDecodeError, KeyError, TypeError, OSError):
        return None


def is_verified(manifest_sha256: str, path: Path | None = None) -> bool:
    """True only when a person approved exactly these texts."""
    record = load_verification(path)
    return record is not None and record.verified_sha256 == manifest_sha256


def confirm(manifest_sha256: str, verified_by: str, path: Path | None = None) -> HandVerification:
    """Record that `verified_by` has read the stimuli behind this digest."""
    name = verified_by.strip()
    if not name:
        raise ValueError(
            "A verification needs a name. 'Verified by \"\"' records nothing and "
            "answers nobody who asks later who read the material."
        )
    record = HandVerification(
        verified_sha256=manifest_sha256,
        verified_by=name,
        verified_at=datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
    )
    write_json(
        path or VERIFICATION_PATH,
        {
            "verified_sha256": record.verified_sha256,
            "verified_by": record.verified_by,
            "verified_at": record.verified_at,
            "note": (
                "Confirms a person read every frozen stimulus behind this manifest "
                "digest. Regenerating any cell changes the digest and lapses this "
                "record, which is intended."
            ),
        },
    )
    return record
