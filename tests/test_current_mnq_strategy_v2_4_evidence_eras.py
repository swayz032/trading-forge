"""The evidence base splits into two eras. Pin the split, and pin that the join CAN be found.

The load-bearing risk here is a join predicate that never fires: "no overlap" would then be a
property of the code rather than of the evidence, and it would read identically.
"""
from __future__ import annotations

import csv
import io
import json

import pytest

from research import current_mnq_strategy_v2_4_evidence_eras as E


def _ledger(tmp_path, rows):
    p = tmp_path / "led.csv"
    with io.open(p, "w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["dateStart", "dateEnd", "entryPrice"])
        for d, t, price in rows:
            w.writerow([f"{d} {t}", f"{d} {t}", price])
    return p


def _scorecard(tmp_path, sessions):
    p = tmp_path / "sc.json"
    p.write_text(json.dumps({"cases": [{"session": s} for s in sessions]}), encoding="utf-8")
    return p


# --- discrimination, on synthetic data --------------------------------------------------

def test_an_overlap_between_ledger_and_corpus_IS_detected(tmp_path):
    """POSITIVE WITNESS. Without it, "0 overlap days" only proves the check never fires."""
    led = _ledger(tmp_path, [("2026/03/23", "10:00:00", "24000")])
    sc = _scorecard(tmp_path, ["2026-03-23", "2026-03-24"])
    m = E.measure(led, sc)
    assert m["ledger_x_corpus_overlap_days"] == ["2026-03-23"]


def test_the_in_window_count_discriminates(tmp_path):
    led = _ledger(tmp_path, [("2025/04/11", "09:45:00", "1"),   # in
                             ("2025/04/11", "12:00:00", "1"),   # in, boundary
                             ("2025/04/11", "13:30:00", "1"),   # out
                             ("2025/04/11", "09:00:00", "1")])  # out
    m = E.measure(led, _scorecard(tmp_path, ["2026-03-23"]))
    b = m["observed_behaviour_2025"]
    assert b["entries_inside_0930_1200"] == 2 and b["entries_total"] == 4


def test_a_missing_ledger_is_reported_not_treated_as_empty(tmp_path):
    m = E.measure(tmp_path / "nope.csv", _scorecard(tmp_path, ["2026-03-23"]))
    assert m["ledger_present"] is False
    assert "observed_behaviour_2025" not in m


# --- the measured evidence base ---------------------------------------------------------

def _real():
    m = E.measure()
    if not m.get("ledger_present"):
        pytest.skip("the ledger CSV is not on this machine")
    return m


def test_neither_the_ledger_nor_the_video_overlaps_the_fidelity_corpus():
    m = _real()
    assert m["ledger_x_corpus_overlap_days"] == []
    assert m["video_x_corpus_overlap_days"] == []


def test_the_video_and_the_ledger_DO_join():
    """The first joinable decision/outcome pair in this campaign. If this breaks, say so."""
    m = _real()
    assert m["video_and_ledger_join_on_at_least_one_day"] is True
    apr11 = next(j for j in m["video_x_ledger_join"] if j["date"] == "2025-04-11")
    assert apr11["ledger_trades"] == 4
    assert apr11["all_inside_the_videos_visible_price_band"] is True


def test_the_apr30_join_is_reported_as_out_of_band_rather_than_hidden():
    """At t=12600 the chart is on the DAILY timeframe, a different view and a different band.

    Reporting it False is the honest answer; silently dropping it would inflate the join.
    """
    m = _real()
    apr30 = next(j for j in m["video_x_ledger_join"] if j["date"] == "2025-04-30")
    assert apr30["ledger_trades"] == 1
    assert apr30["all_inside_the_videos_visible_price_band"] is False


def test_the_timezone_is_RESOLVED_by_the_0930_floor():
    """The teaching lane's stated prerequisite (ALGO-020 section 3 item 1).

    A hard floor at exactly the RTH open, with nothing before it across 74 entries, is a
    boundary rather than a tendency. It holds even if FX Replay restricts replay to RTH: a
    UTC export would show the floor at 13:30.
    """
    b = _real()["observed_behaviour_2025"]
    assert b["earliest_entry_clock"] == 9 * 60 + 30
    assert b["entries_before_0930"] == 0
    assert "EASTERN" in b["TIMEZONE_RESOLVED"]
    assert "no longer conditional" in b["TIMEZONE_RESOLVED"]


def test_the_observed_behaviour_figures_stand():
    b = _real()["observed_behaviour_2025"]
    assert b["days_with_exactly_one_trade"] == 41 and b["days"] == 55
    assert b["entries_inside_0930_1200"] == 64 and b["entries_total"] == 74


def test_the_frozen_rules_tighten_rather_than_describe_the_record():
    """Stated as a measurement, not a contradiction - he may have settled the rules later."""
    b = _real()["observed_behaviour_2025"]
    assert b["days_with_exactly_one_trade"] < b["days"], (
        "if every day had exactly one trade the one-trade rule would DESCRIBE the record")
    assert b["entries_inside_0930_1200"] < b["entries_total"]


def test_the_video_observations_declare_their_coverage():
    """9 sampled offsets of a 14027s file bounds the DATES, not the content."""
    v = E.VIDEO_OBSERVATIONS
    assert "UNENUMERATED" in v["coverage"]
    assert len(v["replayed_dates_read_from_the_chart"]) >= 4
    assert set(v["non_trading_content"]) >= {"10800", "12600"}


def test_the_static_screen_measurement_is_recorded_with_its_caveat():
    """71% of the long video is a frozen screen. The bound is on PERSISTENT change only."""
    m = E.VIDEO_OBSERVATIONS["static_screen_measurement"]
    assert m["static_intervals"] == 27 and m["intervals"] == 38
    assert m["longest_static_run_minutes"] == 96
    assert "PERSISTENT change, not all activity" in m["SAMPLING_CAVEAT"]
    assert "transient" in m["SAMPLING_CAVEAT"]


def test_the_clock_dead_end_is_on_the_record():
    """A failed anchor recorded is worth more than a failed anchor quietly retried."""
    m = E.VIDEO_OBSERVATIONS["static_screen_measurement"]
    assert "cannot be used to map video time to replay time" in m["why_the_clock_never_moved"]


def test_the_static_share_is_derived_not_asserted():
    m = E.VIDEO_OBSERVATIONS["static_screen_measurement"]
    pct = round(100 * m["static_intervals"] / m["intervals"])
    assert m["static_share"] == f"{pct}%", (
        f"the recorded share {m['static_share']} does not match the counts {pct}%")
