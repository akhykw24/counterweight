"""`launch_ready` must mean a person read the stimuli, not merely that an API did.

The gap
-------
The specification says stimuli are "pre-generated, **hand-verified**, frozen".
The code said ``"launch_ready": not placeholder`` -- so the moment real
generation replaced the offline placeholders and the manifest was rebuilt, the
study would have declared itself ready for collection with nobody having read a
single sentence. The app's own launch gate and the on-screen placeholder
warning both key off that flag, so the last barrier before a participant sees
unreviewed text would have lifted by itself.

The fix binds readiness to a recorded human act, and binds that act to the
exact texts it was performed on: verification records the manifest digest it
covers. Regenerating anything changes the digest and the verification lapses,
which is the behaviour that matters -- a stale approval of texts that no longer
exist is worse than no approval at all.
"""

from __future__ import annotations

import json

import pytest

from hand_verification import (
    HandVerification,
    confirm,
    is_verified,
    load_verification,
)

DIGEST = "a" * 64
OTHER_DIGEST = "b" * 64


def _path(tmp_path):
    return tmp_path / "hand_verification.json"


def test_absent_file_means_unverified(tmp_path) -> None:
    assert load_verification(_path(tmp_path)) is None
    assert is_verified(DIGEST, _path(tmp_path)) is False


def test_confirming_records_who_what_and_when(tmp_path) -> None:
    path = _path(tmp_path)
    confirm(DIGEST, "Darya Prokopenko", path)

    record = load_verification(path)
    assert isinstance(record, HandVerification)
    assert record.verified_sha256 == DIGEST
    assert record.verified_by == "Darya Prokopenko"
    # An approval nobody can date is an approval nobody can audit.
    assert record.verified_at.endswith("Z")
    assert is_verified(DIGEST, path) is True


def test_verification_lapses_when_the_stimuli_change(tmp_path) -> None:
    # The property the whole design exists for. A regeneration -- even of one
    # cell -- changes the manifest digest, and the earlier reading no longer
    # describes the texts on disk.
    path = _path(tmp_path)
    confirm(DIGEST, "Darya Prokopenko", path)
    assert is_verified(OTHER_DIGEST, path) is False


def test_an_empty_name_is_refused(tmp_path) -> None:
    # "Verified by ''" is not a record of anything.
    with pytest.raises(ValueError):
        confirm(DIGEST, "   ", _path(tmp_path))


def test_a_corrupt_record_reads_as_unverified_rather_than_crashing(tmp_path) -> None:
    # Failing closed: an unreadable approval must not become an approval, and
    # must not take down every other command that consults it.
    path = _path(tmp_path)
    path.write_text("{ not json", encoding="utf-8")
    assert load_verification(path) is None
    assert is_verified(DIGEST, path) is False


def test_a_record_missing_its_digest_is_not_a_verification(tmp_path) -> None:
    path = _path(tmp_path)
    path.write_text(json.dumps({"verified_by": "someone"}), encoding="utf-8")
    assert is_verified(DIGEST, path) is False
