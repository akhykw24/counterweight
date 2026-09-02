"""Generation must survive running out of budget.

The failure this guards against is not hypothetical: a variant file used to be
written only after all twelve of its cells finished, so a quota exhaustion on
the eighth call discarded seven cells that had already been paid for. On a free
tier that stops mid-run routinely, losing most of a day's budget on every stop
is the same thing as never finishing.
"""

from __future__ import annotations

import json

import pytest

from cell_cache import CellCache, cell_id
from providers import ManualProvider, ProviderError, QuotaExhausted


class FlakyProvider:
    """Serves a fixed number of cells, then refuses the way a real one does."""

    placeholder = False
    name = "flaky"
    model = "test"
    sleep_seconds = 0.0

    def __init__(self, budget: int) -> None:
        self.budget = budget
        self.served: list[str] = []
        self.tokens_used = 0
        self.requests_made = 0

    def estimate_tokens(self, system_prompt: str, user_message: str) -> int:
        return 100

    def complete(self, system_prompt, user_message, schema, schema_name, cell_id_):
        if len(self.served) >= self.budget:
            raise QuotaExhausted("tokens per day (TPD): Limit 200000, Used 200000")
        self.served.append(cell_id_)
        self.requests_made += 1
        return {"payload": {"justification": f"rendered {cell_id_}"}, "tokens": 100}


def _cache(tmp_path, provider="flaky", model="test"):
    return CellCache(path=tmp_path / "cache.json", provider=provider, model=model)


def test_cells_survive_a_quota_exhaustion_mid_run(tmp_path):
    provider = FlakyProvider(budget=5)
    cache = _cache(tmp_path)
    keys = [cell_id("justification", "ru", f"item_{i:02d}") for i in range(1, 13)]

    with pytest.raises(QuotaExhausted):
        for key in keys:
            result = provider.complete("sys", "user", {}, "justification", key)
            cache.put(key, result["payload"], result["tokens"])

    # Five paid cells, five cells kept. Not four, and not zero.
    assert len(cache) == 5
    reopened = _cache(tmp_path)
    assert len(reopened) == 5
    assert reopened.get(keys[0]) == {"justification": f"rendered {keys[0]}"}


def test_a_resume_pays_only_for_what_is_missing(tmp_path):
    keys = [cell_id("justification", "ru", f"item_{i:02d}") for i in range(1, 13)]

    first = FlakyProvider(budget=5)
    cache = _cache(tmp_path)
    for key in keys[:5]:
        result = first.complete("sys", "user", {}, "justification", key)
        cache.put(key, result["payload"], result["tokens"])

    second = FlakyProvider(budget=100)
    resumed = _cache(tmp_path)
    for key in resumed.missing(keys):
        result = second.complete("sys", "user", {}, "justification", key)
        resumed.put(key, result["payload"], result["tokens"])

    assert len(resumed) == 12
    # The whole point: the second run pays for seven cells, not twelve.
    assert second.requests_made == 7
    assert set(second.served) == set(keys[5:])


def test_a_cache_from_a_different_model_is_not_reused(tmp_path):
    """Mixing two models inside one stimulus set is not one frozen set."""
    cache = _cache(tmp_path, model="model-a")
    key = cell_id("justification", "ru", "item_01")
    cache.put(key, {"justification": "from model a"})

    other = _cache(tmp_path, model="model-b")
    assert len(other) == 0
    assert other.get(key) is None


def test_a_corrupt_cache_costs_a_regeneration_not_a_wrong_stimulus(tmp_path):
    path = tmp_path / "cache.json"
    path.write_text("{ this is not json", encoding="utf-8")
    cache = CellCache(path=path, provider="flaky", model="test")
    assert len(cache) == 0


def test_the_cache_file_is_replaced_atomically(tmp_path):
    # A torn write would leave a cache that parses as valid but has lost cells,
    # which is worse than one that fails to parse.
    cache = _cache(tmp_path)
    for i in range(1, 6):
        cache.put(cell_id("justification", "ru", f"item_{i:02d}"), {"justification": str(i)})
        document = json.loads((tmp_path / "cache.json").read_text(encoding="utf-8"))
        assert len(document["cells"]) == i
        assert document["provider"] == "flaky"


def test_a_missing_hand_authored_cell_names_the_file_to_create(tmp_path):
    # Manual cells are a legitimate source, so a missing one must be an error
    # that says what to do rather than a silently skipped cell.
    provider = ManualProvider(directory=tmp_path)
    schema = {"properties": {"justification": {}}, "required": ["justification"]}
    with pytest.raises(ProviderError) as raised:
        provider.complete("sys", "user", schema, "justification", "justification/ru/item_01")
    message = str(raised.value)
    # Asserted on components rather than on a joined path: the separator is
    # platform-dependent and the point is that the message names the exact file.
    assert str(provider.path_for("justification/ru/item_01")) in message
    assert "item_01.json" in message
    assert "justification" in message


def test_a_hand_authored_cell_is_served_verbatim(tmp_path):
    # Hand-corrected text is the stimulus. Re-sampling it through a model would
    # change it, so the pipeline has to accept the file as authoritative.
    (tmp_path / "justification").mkdir(parents=True)
    (tmp_path / "justification" / "ru").mkdir(parents=True)
    target = tmp_path / "justification" / "ru" / "item_01.json"
    target.write_text(json.dumps({"justification": "выверенный вручную текст"}), encoding="utf-8")

    provider = ManualProvider(directory=tmp_path)
    schema = {"properties": {"justification": {}}, "required": ["justification"]}
    result = provider.complete("sys", "user", schema, "justification", "justification/ru/item_01")
    assert result["payload"]["justification"] == "выверенный вручную текст"
    assert result["tokens"] == 0


def test_a_hand_authored_cell_missing_a_required_key_is_refused(tmp_path):
    (tmp_path / "body" / "ru" / "warm" / "low").mkdir(parents=True)
    target = tmp_path / "body" / "ru" / "warm" / "low" / "item_01.json"
    target.write_text(json.dumps({"body": "only the body"}), encoding="utf-8")

    provider = ManualProvider(directory=tmp_path)
    schema = {
        "properties": {"body": {}, "followup_measurement": {}},
        "required": ["body", "followup_measurement"],
    }
    with pytest.raises(ProviderError, match="followup_measurement"):
        provider.complete("sys", "user", schema, "stimulus", "body/ru/warm/low/item_01")
