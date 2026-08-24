"""Guards for the operator's zone-marking pixel measurement (ALGO-088).

THREE DETECTOR FAILURES PRODUCED CONFIDENT, WRONG PRICES BEFORE THIS SETTLED, and each one is
pinned below because each would silently return:

  1. no plot-area bounds  -> the "spike" was browser chrome at row 13 (23,189.85)
  2. bounds too generous  -> it locked onto the chart HEADER's green O/H/L/C caption at row 140
  3. fill instead of stroke -> reading the rectangle's INTERIOR under-measured both edges by the
     border width, producing a symmetric ~1.2-point error that made the RATIFIED construction
     look refuted by roughly two ticks

Only after (3) was fixed did the answer resolve: [wick extreme, close] matches both edges to
within 0.6 points against a 0.63-point tolerance. A measurement that changes its verdict when
the detector is fixed needs its detector pinned, not just its conclusion.
"""
from __future__ import annotations

import io
import json
from pathlib import Path

import pytest

ART = Path("research/current_mnq_strategy_v2_4_zone_marking_pixel_measure_2026_08_24.json")


@pytest.fixture(scope="module")
def art():
    if not ART.exists():
        pytest.skip(f"{ART} not produced yet")
    return json.load(io.open(ART, encoding="utf-8"))


def test_custody_matches_the_ruling(art):
    """A teaching-era source only counts if it is the file the ruling pinned."""
    assert art["custody"]["matches_the_ruling"] is True
    assert art["custody"]["sha256"] == (
        "fce8834f5585c4f73c9604bdf8802d1072321a2c5de3d0462950f31ca70d0af3")
    assert art["custody"]["bytes"] == 113584


def test_the_detector_plausibility_gate_is_present_and_passed(art):
    """Failures 1 and 2 both returned a price no candle on the chart reaches."""
    assert art["detector_plausibility_passed"] is True


def test_edges_are_measured_at_the_border_stroke_not_the_fill(art):
    """Failure 3. The stroke rows must be found, and the edge must sit outside the fill."""
    z = art["zone_pixels"]
    assert z["top_stroke_rows"], "the border stroke was not detected - edges fall back to fill"
    assert z["bottom_stroke_rows"]
    assert z["top_row"] < z["fill_top_row"], "top edge should sit above the fill interior"
    assert z["bottom_row"] > z["fill_bottom_row"]


def test_the_calibration_error_is_published_and_small(art):
    cal = art["calibration"]
    assert cal["max_residual_price_points"] < 1.0
    assert cal["match_tolerance_points"] < 1.5
    assert cal["pixels_per_point"] > 1.0


def test_the_ratified_construction_matches_within_tolerance(art):
    """The headline. Both edges, not one."""
    assert art["BEST_MATCH"] == "A_wick_extreme_to_close_RATIFIED"
    assert art["matches_within_tolerance"] is True
    errs = art["candidate_constructions"]["A_wick_extreme_to_close_RATIFIED"]["edge_error_points"]
    assert len(errs) == 2 and max(errs) <= art["calibration"]["match_tolerance_points"]


def test_the_band_above_the_wick_reading_is_refuted_by_a_wide_margin(art):
    """The desk's provisional eyeball. It must lose on measurement, not on assertion."""
    b = art["candidate_constructions"]["B_band_ABOVE_the_wick"]
    assert b["lower_edge_error_points"] > 10.0, (
        "if B is close, the demonstration does not discriminate and neither reading is settled")


def test_no_rule_was_changed_by_this_measurement(art):
    assert art["no_rule_changed"] is True
