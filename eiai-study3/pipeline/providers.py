#!/usr/bin/env python3
"""Where stimulus text comes from, behind one interface.

Generation has three legitimate sources and the layer above must not be able to
tell them apart:

    LiveProvider      an OpenAI-compatible API (Groq, Gemini, anything else)
    OfflineProvider   deterministic placeholders, no key, no network
    ManualProvider    hand-authored JSON on disk

The third is not a fallback. Stimuli are *frozen material*: once a researcher
has corrected a Kazakh phrasing by hand, that hand-written text is the stimulus,
and a pipeline that could only consume model output would force the correction
to be re-typed into a prompt and re-sampled -- which would change it. So a
manually authored cell is a first-class source, and the manifest records which
provider produced the set either way.

Swapping providers touches this file and the `--provider` flag. It touches
nothing in the validation, caching, equivalence or manifest layers.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
import time
from pathlib import Path
from typing import Any, Protocol

from _common import MATERIALS

# Every provider detail lives here so swapping one is a single edit. All of them
# speak the OpenAI chat-completions shape, so the call site does not change.
PROVIDERS: dict[str, dict[str, str]] = {
    "gemini": {
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai/",
        "api_key_env": "GEMINI_API_KEY",
        # Chosen by measurement, not by version number:
        #   2.5-flash      undershot both bands and dropped the required value
        #   3.7 / 3.6      persistently 503 / 400 at time of writing
        #   3.1-flash-lite passes but sits at the TOP of both bands, so Russian
        #                  and Kazakh would overshoot
        #   3.5-flash      passes mid-band, leaving headroom
        "default_model": "gemini-3.5-flash",
        # Gemini draws reasoning tokens from the same budget as the answer, so
        # leaving thinking on truncates replies mid-sentence.
        "default_thinking": "none",
        "console": "https://aistudio.google.com/apikey",
    },
    "groq": {
        "base_url": "https://api.groq.com/openai/v1",
        "api_key_env": "GROQ_API_KEY",
        # Chosen on a three-language test, not an English one:
        #   llama-3.3-70b / 3.1-8b  no json_schema support at all
        #   qwen3.6-27b             best English of the lot, but 400s on ru/kk --
        #                           an English-only trial would have picked it
        #                           and died at the Russian phase
        #   gpt-oss-20b             passes every automated check while adding
        #                           consensus-appeal phrasing to the body, which
        #                           is weak-justification content leaking into
        #                           text that must be constant across the factor
        #   gpt-oss-120b            passes validation in en, ru and kk
        "default_model": "openai/gpt-oss-120b",
        # Groq rejects reasoning_effort="none" outright (400: must be low,
        # medium or high). "default" omits the parameter, matching what the
        # calls measured against the word-count bands actually sent.
        "default_thinking": "default",
        "console": "https://console.groq.com/keys",
    },
}

# Groq, not Gemini: Gemini's free tier allows 20 requests per day PER MODEL
# against a 168-call run. Spreading those across models would mean stimuli
# written by different models inside one experiment, which defeats freezing them.
DEFAULT_PROVIDER = "groq"

# Groq charges the daily token budget for what a request RESERVES, not what it
# returns: a call with a ~1200-token prompt was billed 5253 with max_tokens at
# 4096. The longest response the set contains is roughly 700 tokens -- but on a
# reasoning model the chain of thought spends from the SAME completion budget
# before the answer starts. Cutting the cap to 1536 on that "700 tokens" logic
# made the first live run fail on its very first call: reasoning plus answer
# did not fit. 2560 leaves room for both and still fits the whole 48-cell run
# inside one 200k day (~185k reserved); the cap changes nothing about what the
# model writes unless it is hit, so the word-count bands measured at 4096 stay
# valid.
DEFAULT_MAX_TOKENS = 2560
DEFAULT_MAX_ATTEMPTS = 6
# Per-call reservation is ~2700 tokens against a per-minute cap of 8000, which
# divides into 2.9 calls -- so 22s, not the 20s that sits exactly on the line.
DEFAULT_SLEEP = 22.0

# Daily token allowance, used only by the --dry-run estimate. Naming it here
# rather than in the estimate keeps the provider's economics in the provider.
DAILY_TOKEN_BUDGET = {"groq": 200_000, "gemini": None}

MANUAL_DIR = MATERIALS / "manual"

# Every provider the CLI can select, including the non-API ones. Owned here so
# that adding a provider is an edit to this file and nothing else: the
# generation layer must not know the name of any particular source.
MANUAL_PROVIDER = "manual"
PROVIDER_CHOICES: tuple[str, ...] = tuple(sorted(PROVIDERS)) + (MANUAL_PROVIDER,)


class GenerationHalt(RuntimeError):
    """The run cannot usefully continue, through no fault of one cell.

    The caller is expected to stop cleanly, keep everything already produced,
    and let a later run resume -- not to retry, and not to die with a
    traceback. Both concrete halts share this so generate.py has one catch.
    """


class QuotaExhausted(GenerationHalt):
    """The provider will not serve more work today."""


class TokenBudgetTooSmall(GenerationHalt):
    """The model cannot fit its reasoning plus the answer in max_tokens.

    Structural, not transient: the cap is identical for every call, so the
    next cell would fail the same way, and backing off changes nothing. The
    first live run spent five paid retries and four minutes of exponential
    backoff proving that before dying with a traceback.
    """


class ProviderError(RuntimeError):
    """The provider cannot serve this cell and retrying will not help."""


class Provider(Protocol):
    """What the generation layer needs, and nothing else."""

    name: str
    model: str
    #: Whether output from this provider counts as real collection material.
    placeholder: bool
    #: Seconds to wait between calls. A rate-limit accommodation, so it belongs
    #: to the provider: a local placeholder or a file read needs none, and
    #: pacing them would make an offline run take ten minutes for nothing.
    sleep_seconds: float

    def complete(
        self,
        system_prompt: str,
        user_message: str,
        schema: dict[str, Any],
        schema_name: str,
        cell_id: str,
    ) -> dict[str, Any]:
        """One structured payload. Raises QuotaExhausted or ProviderError."""

    def estimate_tokens(self, system_prompt: str, user_message: str) -> int:
        """Tokens one call will cost against a budget, reservation included."""


# ---------------------------------------------------------------------------
# Live API
# ---------------------------------------------------------------------------


def _retry_after_seconds(error: Exception) -> float | None:
    """Provider-suggested wait.

    Two spellings: Gemini's `retryDelay: 30s` and Groq's prose
    `Please try again in 4m59.808s`.
    """
    text = str(error)
    match = re.search(r"retryDelay[\"':\s]+(\d+(?:\.\d+)?)s", text)
    if match:
        return float(match.group(1))
    match = re.search(r"try again in (?:(\d+)m)?(\d+(?:\.\d+)?)s", text)
    if match:
        return float(match.group(1) or 0) * 60 + float(match.group(2))
    return None


def _is_daily_limit(error: Exception) -> bool:
    """True when a 429 is a per-day cap rather than a per-minute one.

    Waiting only helps for the second kind. Groq spells these out ("tokens per
    day (TPD)" vs "tokens per minute (TPM)"); Gemini uses "PerDay" in the quota
    id.
    """
    text = str(error).lower()
    return "per day" in text or "(tpd)" in text or "(rpd)" in text or "perday" in text


class LiveProvider:
    """Any OpenAI-compatible chat-completions endpoint."""

    placeholder = False

    def __init__(
        self,
        name: str,
        model: str,
        max_tokens: int,
        thinking: str,
        max_attempts: int,
        sleep: float,
    ) -> None:
        from openai import OpenAI  # imported lazily: offline runs need no SDK

        config = PROVIDERS[name]
        key = os.environ.get(config["api_key_env"], "").strip()
        if not key:
            raise ProviderError(
                f"{config['api_key_env']} is not set.\n"
                f"  Get a key at {config['console']}\n"
                f"  Then put it in eiai-study3/.env as {config['api_key_env']}=..."
            )
        self.name = name
        self.model = model
        self.max_tokens = max_tokens
        self.thinking = thinking
        self.max_attempts = max_attempts
        self.sleep_seconds = sleep
        self.tokens_used = 0
        self.requests_made = 0
        self._client = OpenAI(
            api_key=key,
            base_url=config["base_url"],
            max_retries=0,  # retries are handled here so backoff can respect 429s
            timeout=120.0,
        )

    def estimate_tokens(self, system_prompt: str, user_message: str) -> int:
        # Roughly four characters per token for Latin text and closer to two for
        # Cyrillic; 3.0 is a deliberate middle that errs high, because a budget
        # estimate that undershoots is the useless direction. The reservation
        # dominates anyway: providers bill max_tokens whether the model uses it
        # or not, which is what made a full run take days rather than an hour.
        prompt = math.ceil(len(system_prompt) / 3.0) + math.ceil(len(user_message) / 3.0)
        return prompt + self.max_tokens

    def complete(
        self,
        system_prompt: str,
        user_message: str,
        schema: dict[str, Any],
        schema_name: str,
        cell_id: str,
    ) -> dict[str, Any]:
        request: dict[str, Any] = {
            "model": self.model,
            "max_tokens": self.max_tokens,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message},
            ],
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": schema_name, "schema": schema, "strict": True},
            },
        }
        if self.thinking != "default":
            request["reasoning_effort"] = self.thinking

        delay = 8.0
        for attempt in range(1, self.max_attempts + 1):
            try:
                self.requests_made += 1
                completion = self._client.chat.completions.create(**request)
            except Exception as error:  # noqa: BLE001 - provider SDKs vary
                status = getattr(error, "status_code", None)
                # A 400 is normally a bug in the request and must not be retried.
                # json_validate_failed is the exception: the request was accepted
                # and the model simply sampled something off-schema, which is a
                # re-roll rather than a defect.
                text = str(error)
                malformed = status == 400 and "json_validate_failed" in text
                # Same provider code, opposite meanings. A truncation is not a
                # bad sample: the reasoning the model emits before its answer
                # comes out of the same completion budget, and when the two
                # together exceed max_tokens every re-roll hits the same wall.
                if malformed and "max completion tokens reached" in text:
                    raise TokenBudgetTooSmall(
                        f"{cell_id}: the model ran out of completion tokens before "
                        f"finishing valid JSON (max_tokens={self.max_tokens}). Its "
                        "reasoning shares that budget with the answer. Re-run with a "
                        "larger --max-tokens; the provider's 'adjust your prompt' "
                        "advice points at the wrong knob."
                    ) from error
                transient = status in (408, 409, 429, 500, 502, 503, 504) or malformed

                if status == 429 and _is_daily_limit(error):
                    # Backing off 8-16-32-64-120s cannot help when the reset is
                    # hours away; it just spends four minutes per call to reach
                    # a conclusion the first response already gave.
                    raise QuotaExhausted(str(error)[:300]) from error
                if not transient or attempt == self.max_attempts:
                    if status == 429:
                        raise QuotaExhausted(str(error)[:300]) from error
                    raise
                wait = _retry_after_seconds(error) or delay
                print(f"    ! {cell_id}: {status}; waiting {wait:.0f}s", file=sys.stderr)
                time.sleep(wait)
                delay = min(delay * 2, 120.0)
                continue

            text = (completion.choices[0].message.content or "").strip()
            if not text:
                raise ProviderError(f"{cell_id}: provider returned empty content")

            usage = completion.usage
            spent = (getattr(usage, "prompt_tokens", 0) or 0) + (
                getattr(usage, "completion_tokens", 0) or 0
            )
            self.tokens_used += spent
            return {"payload": json.loads(text), "tokens": spent}

        raise QuotaExhausted(f"{cell_id}: exhausted retries")


# ---------------------------------------------------------------------------
# Offline placeholders
# ---------------------------------------------------------------------------


class OfflineProvider:
    """Deterministic placeholders. No key, no network, never launch-ready.

    Exists so the rest of the chain -- equivalence, manifest, golden-file test,
    coding sheets -- can be exercised and proven before a key is available.
    """

    placeholder = True
    name = "offline"
    model = "none (offline placeholder)"
    sleep_seconds = 0.0

    def __init__(self, render: Any) -> None:
        # The renderer stays in generate.py, where the prompt structure lives.
        self._render = render
        self.tokens_used = 0
        self.requests_made = 0

    def estimate_tokens(self, system_prompt: str, user_message: str) -> int:
        return 0

    def complete(
        self,
        system_prompt: str,
        user_message: str,
        schema: dict[str, Any],
        schema_name: str,
        cell_id: str,
    ) -> dict[str, Any]:
        return {"payload": self._render(schema_name, cell_id), "tokens": 0}


# ---------------------------------------------------------------------------
# Hand-authored
# ---------------------------------------------------------------------------


class ManualProvider:
    """Cells written or corrected by hand, read from materials/manual/.

    One JSON file per cell, named for the cell id. A missing file is an error
    naming the exact path to create rather than a silent skip -- a stimulus set
    with a hole in it must not look finished.
    """

    placeholder = False
    name = "manual"
    sleep_seconds = 0.0

    def __init__(self, directory: Path = MANUAL_DIR, model: str = "hand-authored") -> None:
        self.directory = directory
        self.model = model
        self.tokens_used = 0
        self.requests_made = 0

    def estimate_tokens(self, system_prompt: str, user_message: str) -> int:
        return 0

    def path_for(self, cell_id: str) -> Path:
        return self.directory / f"{cell_id}.json"

    def complete(
        self,
        system_prompt: str,
        user_message: str,
        schema: dict[str, Any],
        schema_name: str,
        cell_id: str,
    ) -> dict[str, Any]:
        path = self.path_for(cell_id)
        if not path.exists():
            raise ProviderError(
                f"{cell_id}: no hand-authored file at {path}.\n"
                f"  Create it with the keys {sorted(schema.get('properties', {}))}.\n"
                f"  Manual cells are a legitimate source, but a missing one is a hole "
                f"in the stimulus set, not an empty cell to skip."
            )
        payload = json.loads(path.read_text(encoding="utf-8"))
        missing = set(schema.get("required", [])) - set(payload)
        if missing:
            raise ProviderError(f"{cell_id}: {path} is missing {sorted(missing)}")
        return {"payload": payload, "tokens": 0}


# ---------------------------------------------------------------------------
# Construction
# ---------------------------------------------------------------------------


def resolve_defaults(args: argparse.Namespace) -> None:
    """Fill in model and reasoning defaults for whichever provider was chosen.

    Lives here rather than in the CLI so that the generation layer never has to
    name a provider to know what its defaults are.
    """
    if args.provider == MANUAL_PROVIDER:
        # Hand-authored cells have no model and no reasoning setting; the
        # manifest still records the provider so provenance stays explicit.
        args.model = args.model or "hand-authored"
        args.thinking = args.thinking or "default"
        return
    config = PROVIDERS[args.provider]
    if args.model is None:
        args.model = config["default_model"]
    if args.thinking is None:
        args.thinking = config["default_thinking"]


def build_provider(args: argparse.Namespace, offline_render: Any) -> Provider:
    """The provider named by the CLI. The only place the choice is made."""
    if args.offline:
        return OfflineProvider(offline_render)
    if args.provider == MANUAL_PROVIDER:
        return ManualProvider(model=args.model or "hand-authored")
    return LiveProvider(
        name=args.provider,
        model=args.model,
        max_tokens=args.max_tokens,
        thinking=args.thinking,
        max_attempts=args.max_attempts,
        sleep=args.sleep,
    )
