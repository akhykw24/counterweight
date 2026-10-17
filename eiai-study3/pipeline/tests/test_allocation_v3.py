"""The v3 main-study sequence: balanced in every block, fixed by its seed."""

from __future__ import annotations

import re

import allocation_v3 as a


def test_every_block_of_four_holds_each_cell_once() -> None:
    document = a.build_document()
    for sequence in (document["sequence"], document["test_sequence"]):
        for stratum, cells in sequence.items():
            assert len(cells) % 4 == 0, stratum
            for start in range(0, len(cells), 4):
                assert sorted(cells[start : start + 4]) == sorted(a.CELLS), (stratum, start)


def test_the_strata_are_the_english_bands_and_the_test_ones_are_kept_apart() -> None:
    document = a.build_document()
    assert list(document["sequence"]) == ["B1-B2", "C1-C2-native"]
    assert list(document["test_sequence"]) == ["test:B1-B2", "test:C1-C2-native"]
    assert document["seed"] != document["test_seed"]


def test_the_sequence_is_fixed_by_its_seed() -> None:
    assert a.build_document() == a.build_document()
    other = a.build_sequence(a.SEED + 1, a.STRATA, a.BLOCKS_PER_STRATUM)
    assert other != a.build_document()["sequence"]


def test_the_two_strata_are_not_the_same_order() -> None:
    sequence = a.build_document()["sequence"]
    assert sequence["B1-B2"] != sequence["C1-C2-native"]


def test_the_sql_loads_exactly_the_committed_sequence() -> None:
    document = a.build_document()
    rows = re.findall(r"\('([^']+)', (\d+), '([^']+)'\)", a.build_sql(document))
    loaded: dict[str, list[str]] = {}
    for stratum, index, cell in rows:
        loaded.setdefault(stratum, []).append(cell)
        assert int(index) == len(loaded[stratum]) - 1
    assert loaded == {**document["sequence"], **document["test_sequence"]}


def test_the_sql_never_rewrites_or_removes_a_claim() -> None:
    sql = a.build_sql(a.build_document()).lower()
    assert "delete from public.v3_allocation_slots" not in sql
    assert "truncate" not in sql
    assert "set cell" not in sql
    assert "on conflict (stratum, idx) do nothing" in sql


def test_the_committed_files_are_current() -> None:
    assert a.check() == []
