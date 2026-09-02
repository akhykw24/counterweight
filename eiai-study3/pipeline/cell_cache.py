#!/usr/bin/env python3
"""Per-cell durability for stimulus generation.

A cell is one (language, condition, register, item) for a body, or one
(language, item) for a justification. Each is written to disk the moment it
comes back, before anything else happens.

Why this exists
---------------
Generation used to write a variant *file* only after all twelve of its cells
were finished. When the daily token budget ran out on the eighth call, the seven
already-paid-for cells went with it -- and on a free tier that stops mid-run
routinely, "routinely lose most of a day's budget" is the same thing as "cannot
finish". Writing per cell makes a run resumable at the granularity the provider
actually charges at.

The cache is keyed by provider and model as well as by cell. Reusing a Groq cell
in a Gemini run would silently produce a stimulus set written by two models,
which is not one frozen set; a key mismatch simply misses and the cell is
regenerated.

Placeholders never enter the cache. An offline run is deterministic and free, so
caching it would only create a way for placeholder text to survive into a live
run.
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any

from _common import MATERIALS, canonical_json

CACHE_PATH = MATERIALS / "generation_cache.json"

SCHEMA_VERSION = "1.0"


def cell_id(kind: str, language: str, item_id: str, condition: str | None = None,
            register: str | None = None) -> str:
    """Stable identifier for one generated unit.

    Justifications are per (language, item) because they are rendered once and
    reused across all four condition variants -- that reuse is what makes them
    byte-identical across warm and neutral by construction.
    """
    if kind == "justification":
        return f"justification/{language}/{item_id}"
    slug = "na" if register is None else register.lower()
    return f"body/{language}/{condition}/{slug}/{item_id}"


class CellCache:
    """Append-oriented JSON cache, flushed after every write.

    Rewriting the whole file per cell is O(n^2) over a run, but n is 168 and the
    file is a few hundred kilobytes: the cost is milliseconds against calls that
    take seconds, and the alternative is a format that can be truncated by a
    crash mid-append.
    """

    def __init__(self, path: Path = CACHE_PATH, provider: str = "", model: str = "") -> None:
        self.path = path
        self.provider = provider
        self.model = model
        self._cells: dict[str, Any] = {}
        self._load()

    def _load(self) -> None:
        if not self.path.exists():
            return
        try:
            document = json.loads(self.path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            # A corrupt cache costs a regeneration, never a wrong stimulus.
            return
        if document.get("provider") != self.provider or document.get("model") != self.model:
            # Different source: everything in here belongs to another set.
            return
        self._cells = dict(document.get("cells", {}))

    def get(self, key: str) -> dict[str, Any] | None:
        entry = self._cells.get(key)
        return dict(entry["payload"]) if entry else None

    def put(self, key: str, payload: dict[str, Any], tokens: int = 0) -> None:
        self._cells[key] = {"payload": payload, "tokens": tokens}
        self._flush()

    def __contains__(self, key: str) -> bool:
        return key in self._cells

    def __len__(self) -> int:
        return len(self._cells)

    def missing(self, keys: list[str]) -> list[str]:
        return [k for k in keys if k not in self._cells]

    def _flush(self) -> None:
        """Atomic replace, so an interrupted write cannot leave a torn cache."""
        self.path.parent.mkdir(parents=True, exist_ok=True)
        document = {
            "schema_version": SCHEMA_VERSION,
            "provider": self.provider,
            "model": self.model,
            "cells": self._cells,
        }
        handle = tempfile.NamedTemporaryFile(
            "w", encoding="utf-8", newline="\n", dir=self.path.parent, delete=False, suffix=".tmp"
        )
        try:
            handle.write(canonical_json(document))
            handle.flush()
            os.fsync(handle.fileno())
        finally:
            handle.close()
        os.replace(handle.name, self.path)

    def clear(self) -> None:
        self._cells = {}
        if self.path.exists():
            self.path.unlink()
