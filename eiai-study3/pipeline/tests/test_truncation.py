"""Token-budget truncation must halt the run, cleanly and immediately.

What actually happened on the first live run: Groq returned 400
``json_validate_failed`` with "max completion tokens reached before generating
a valid document". The retry loop treated it as an off-schema sample -- a
re-roll -- and backed off 8, 16, 32, 64, 120 seconds against an error that is
structural: the model's reasoning plus the answer do not fit in ``max_tokens``,
and no amount of waiting changes arithmetic. After five paid failures the raw
exception escaped and killed the run with a traceback.

Two distinct failures hide in that one sentence. The retry policy could not
tell a bad sample from a too-small budget, and the run-level handler only knew
how to stop cleanly for quota exhaustion. Both are pinned here.
"""

from __future__ import annotations

import os
from types import SimpleNamespace

import pytest

import providers as providers_module
from providers import (
    GenerationHalt,
    LiveProvider,
    QuotaExhausted,
    TokenBudgetTooSmall,
)

TRUNCATION_TEXT = (
    "Error code: 400 - {'error': {'message': \"Failed to generate JSON.\", "
    "'type': 'invalid_request_error', 'code': 'json_validate_failed', "
    "'failed_generation': 'max completion tokens reached before generating "
    "a valid document'}}"
)

OFF_SCHEMA_TEXT = (
    "Error code: 400 - {'error': {'code': 'json_validate_failed', "
    "'failed_generation': '{\"body\": 12}'}}"
)


class FakeApiError(Exception):
    status_code = 400


def _provider(monkeypatch, responses) -> tuple[LiveProvider, list]:
    """A LiveProvider whose client plays back `responses` (exceptions raise)."""
    monkeypatch.setenv("GROQ_API_KEY", "fake-key-for-tests")
    provider = LiveProvider("groq", "test-model", 1536, "default", 6, 0.0)

    calls: list = []

    def create(**request):
        calls.append(request)
        action = responses[min(len(calls), len(responses)) - 1]
        if isinstance(action, Exception):
            raise action
        return action

    provider._client = SimpleNamespace(
        chat=SimpleNamespace(completions=SimpleNamespace(create=create))
    )
    # Recorded, never slept: a test that waits out an exponential backoff is a
    # test nobody runs.
    slept: list[float] = []
    monkeypatch.setattr(providers_module.time, "sleep", slept.append)
    return provider, calls


def _ok(payload='{"body": "text"}'):
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=payload))],
        usage=SimpleNamespace(prompt_tokens=100, completion_tokens=50),
    )


def test_truncation_halts_after_one_call_with_an_actionable_message(monkeypatch):
    provider, calls = _provider(monkeypatch, [FakeApiError(TRUNCATION_TEXT)])

    with pytest.raises(TokenBudgetTooSmall) as caught:
        provider.complete("sys", "user", {}, "stimulus", "body/en/warm/low/item_01")

    # One paid call, not six. The first response already carried the diagnosis.
    assert len(calls) == 1
    # The message must tell the operator what to change, and name the cap that
    # was too small -- "adjust your prompt", the provider's advice, points at
    # the wrong knob entirely.
    assert "--max-tokens" in str(caught.value)
    assert "1536" in str(caught.value)


def test_an_off_schema_sample_is_still_a_re_roll(monkeypatch):
    # The behaviour that was already right and must not be lost: a model that
    # sampled something invalid gets another chance, and the second draw wins.
    provider, calls = _provider(monkeypatch, [FakeApiError(OFF_SCHEMA_TEXT), _ok()])

    result = provider.complete("sys", "user", {}, "stimulus", "cell")

    assert len(calls) == 2
    assert result["payload"] == {"body": "text"}


def test_truncation_stops_the_run_the_way_quota_exhaustion_does() -> None:
    # generate.py stops cleanly on GenerationHalt, keeping every cell already
    # on disk. Truncation must ride that path: the cap is the same for every
    # call, so pressing on to the next cell would fail identically, and a
    # traceback mid-run is how the first attempt died.
    assert issubclass(QuotaExhausted, GenerationHalt)
    assert issubclass(TokenBudgetTooSmall, GenerationHalt)


def test_a_plain_400_is_still_a_bug_not_a_retry(monkeypatch):
    provider, calls = _provider(
        monkeypatch, [FakeApiError("Error code: 400 - {'error': {'code': 'bad_request'}}")]
    )
    with pytest.raises(FakeApiError):
        provider.complete("sys", "user", {}, "stimulus", "cell")
    assert len(calls) == 1
