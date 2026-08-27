"""The ledger/corpus join guard must REFUSE on disjoint sets and PERMIT on overlapping ones.

A guard with no path to green is as useless as one with no path to red: if it refused
unconditionally it would be a constant, not a measurement, and it would keep refusing after the
operator supplied the data that fixes it.
"""
from __future__ import annotations

import csv
import io
import json

import pytest

from research import current_mnq_strategy_v2_4_ledger_corpus_join as J


def _scorecard(tmp_path, sessions):
    p = tmp_path / "sc.json"
    p.write_text(json.dumps({"cases": [{"session": s} for s in sessions]}), encoding="utf-8")
    return p


def _ledger(tmp_path, dates, name="led.csv"):
    p = tmp_path / name
    with io.open(p, "w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["dateStart", "dateEnd", "amount"])
        for d in dates:
            y, m, dd = d.split("-")
            w.writerow([f"{y}/{m}/{dd}", f"{y}/{m}/{dd}", "30"])
    return p


def test_the_real_pair_is_disjoint_and_the_guard_refuses():
    """The measured fact this module exists for. Skips rather than lies if the CSV is absent."""
    m = J.measure()
    if not m["ledger_present"]:
        pytest.skip("the ledger CSV is not committed and is absent on this machine")
    assert m["overlap_count"] == 0, (
        f"the sets now overlap on {m['overlapping_dates']} - the documented finding has "
        f"changed and this module's docstring is stale"
    )
    with pytest.raises(RuntimeError, match="LEDGER_AND_CORPUS_ARE_DISJOINT"):
        J.assert_ledger_can_ground_truth_the_corpus(m)


def test_the_guard_PERMITS_when_the_sets_overlap(tmp_path):
    """POSITIVE WITNESS. Without this the refusal above proves only that it always refuses."""
    sc = _scorecard(tmp_path, ["2026-03-23", "2026-03-24"])
    led = _ledger(tmp_path, ["2026-03-23", "2025-01-02"])
    m = J.measure(sc, led)
    assert m["overlap_count"] == 1 and m["overlapping_dates"] == ["2026-03-23"]
    assert J.assert_ledger_can_ground_truth_the_corpus(m) is m


def test_a_missing_ledger_is_not_reported_as_no_overlap(tmp_path):
    """Absence of the file is not absence of overlap - they must not collapse to one verdict."""
    sc = _scorecard(tmp_path, ["2026-03-23"])
    m = J.measure(sc, tmp_path / "does_not_exist.csv")
    assert m["ledger_present"] is False
    with pytest.raises(RuntimeError, match="LEDGER_NOT_PRESENT"):
        J.assert_ledger_can_ground_truth_the_corpus(m)


def test_unparsed_date_cells_are_counted_not_swallowed(tmp_path):
    """A join that silently drops rows it cannot read reports a small overlap as a measurement."""
    sc = _scorecard(tmp_path, ["2026-03-23"])
    p = tmp_path / "bad.csv"
    with io.open(p, "w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["dateStart", "dateEnd"])
        w.writerow(["2026/03/23", "not-a-date"])
        w.writerow(["", "13/13/9999"])
    m = J.measure(sc, p)
    assert m["ledger_date_cells_unparsed"] == 3, m
    assert m["overlap_count"] == 1


def test_the_guard_gates_on_the_measurement_not_a_hardcoded_verdict():
    """It must stop refusing on its own once the data changes - no literal answer in the code."""
    src = io.open(J.__file__, encoding="utf-8").read()
    body = src.split("def assert_ledger_can_ground_truth_the_corpus")[1]
    assert 'm["can_ground_truth_the_corpus"]' in body
    for banned in ("2025-04-02", "2026-03-23", "return False", "raise RuntimeError('always"):
        assert banned not in body, f"the guard hardcodes {banned!r} instead of measuring"


def test_it_is_diagnostic_only():
    assert "DIAGNOSTIC_ONLY" in J.DIAGNOSTIC_ONLY
    src = io.open(J.__file__, encoding="utf-8").read()
    for banned in ("pnl", "realized", "profit"):
        assert f"row[{banned!r}]" not in src.lower()
