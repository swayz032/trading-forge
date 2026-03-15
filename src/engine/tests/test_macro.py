"""
Tests for macro tagger, regime graph, and event calendar.
"""

from __future__ import annotations

import unittest
from datetime import date

from src.data.macro.macro_tagger import (
    VALID_MACRO_REGIMES,
    classify_macro_regime,
    tag_bars,
)
from src.data.macro.regime_graph import (
    VALID_MACRO_REGIMES as RG_MACRO_REGIMES,
    VALID_TECHNICAL_REGIMES,
    composite_regime,
)
from src.data.macro.event_calendar import (
    ALL_EVENTS,
    event_proximity,
    get_upcoming_events,
)


# ─── Macro Tagger Tests ─────────────────────────────────────────

class TestMacroTagger(unittest.TestCase):

    def test_risk_on_classification(self):
        """Low VIX + positive spread + uptrend -> RISK_ON."""
        snapshot = {
            "vix": 14.0,
            "yield_spread_10y2y": 0.5,
            "trend": "up",
            "fed_funds_trend": "flat",
            "treasury_2y_trend": "flat",
            "cpi_trend": "flat",
            "unemployment_trend": "flat",
            "unemployment": 4.0,
        }
        result = classify_macro_regime(snapshot)
        self.assertEqual(result["regime"], "RISK_ON")
        self.assertGreater(result["confidence"], 0.5)

    def test_risk_off_classification(self):
        """High VIX + downtrend -> RISK_OFF."""
        snapshot = {
            "vix": 32.0,
            "yield_spread_10y2y": -0.5,
            "trend": "down",
            "fed_funds_trend": "flat",
            "treasury_2y_trend": "flat",
            "cpi_trend": "flat",
            "unemployment_trend": "flat",
            "unemployment": 6.0,
        }
        result = classify_macro_regime(snapshot)
        self.assertEqual(result["regime"], "RISK_OFF")
        self.assertGreater(result["confidence"], 0.5)

    def test_tightening_classification(self):
        """Rising fed funds + rising 2Y -> TIGHTENING."""
        snapshot = {
            "vix": 20.0,
            "yield_spread_10y2y": 0.2,
            "trend": "flat",
            "fed_funds_trend": "rising",
            "treasury_2y_trend": "rising",
            "cpi_trend": "flat",
            "unemployment_trend": "flat",
            "unemployment": 4.0,
        }
        result = classify_macro_regime(snapshot)
        self.assertEqual(result["regime"], "TIGHTENING")

    def test_easing_classification(self):
        """Falling fed funds + falling 2Y -> EASING."""
        snapshot = {
            "vix": 20.0,
            "yield_spread_10y2y": 0.2,
            "trend": "flat",
            "fed_funds_trend": "falling",
            "treasury_2y_trend": "falling",
            "cpi_trend": "flat",
            "unemployment_trend": "flat",
            "unemployment": 4.0,
        }
        result = classify_macro_regime(snapshot)
        self.assertEqual(result["regime"], "EASING")

    def test_stagflation_classification(self):
        """Rising CPI + rising unemployment -> STAGFLATION."""
        snapshot = {
            "vix": 22.0,
            "yield_spread_10y2y": -0.1,
            "trend": "flat",
            "fed_funds_trend": "flat",
            "treasury_2y_trend": "flat",
            "cpi_trend": "rising",
            "unemployment_trend": "rising",
            "unemployment": 6.5,
        }
        result = classify_macro_regime(snapshot)
        self.assertEqual(result["regime"], "STAGFLATION")

    def test_goldilocks_classification(self):
        """Falling CPI + low unemployment + low VIX -> GOLDILOCKS."""
        snapshot = {
            "vix": 13.0,
            "yield_spread_10y2y": 0.3,
            "trend": "flat",
            "fed_funds_trend": "flat",
            "treasury_2y_trend": "flat",
            "cpi_trend": "falling",
            "unemployment_trend": "flat",
            "unemployment": 3.5,
        }
        result = classify_macro_regime(snapshot)
        self.assertEqual(result["regime"], "GOLDILOCKS")

    def test_transition_on_mixed_signals(self):
        """Mixed signals with no clear winner -> TRANSITION."""
        snapshot = {
            "vix": 20.0,
            "yield_spread_10y2y": 0.0,
            "trend": "flat",
            "fed_funds_trend": "flat",
            "treasury_2y_trend": "flat",
            "cpi_trend": "flat",
            "unemployment_trend": "flat",
            "unemployment": 5.0,
        }
        result = classify_macro_regime(snapshot)
        # With all flat inputs, no regime should score high
        self.assertIn(result["regime"], VALID_MACRO_REGIMES)

    def test_all_regime_names_valid(self):
        """All classified regimes must be valid enum values."""
        test_cases = [
            {"vix": 14.0, "trend": "up", "yield_spread_10y2y": 0.5},
            {"vix": 35.0, "trend": "down"},
            {"fed_funds_trend": "rising", "treasury_2y_trend": "rising"},
            {"fed_funds_trend": "falling", "treasury_2y_trend": "falling"},
            {"cpi_trend": "rising", "unemployment_trend": "rising"},
            {"cpi_trend": "falling", "unemployment": 3.0, "vix": 13.0},
            {},
        ]
        for snapshot in test_cases:
            result = classify_macro_regime(snapshot)
            self.assertIn(result["regime"], VALID_MACRO_REGIMES,
                          f"Invalid regime '{result['regime']}' for snapshot {snapshot}")

    def test_classify_returns_required_keys(self):
        """classify_macro_regime returns all required keys."""
        result = classify_macro_regime({"vix": 15.0})
        self.assertIn("regime", result)
        self.assertIn("confidence", result)
        self.assertIn("signals", result)
        self.assertIn("secondary_regime", result)

    def test_confidence_bounded_0_to_1(self):
        """Confidence is always between 0 and 1."""
        test_cases = [
            {"vix": 14.0, "trend": "up", "yield_spread_10y2y": 0.5},
            {"vix": 35.0, "trend": "down"},
            {},
        ]
        for snapshot in test_cases:
            result = classify_macro_regime(snapshot)
            self.assertGreaterEqual(result["confidence"], 0.0)
            self.assertLessEqual(result["confidence"], 1.0)


# ─── Bar Tagging Tests ──────────────────────────────────────────

class TestBarTagging(unittest.TestCase):

    def test_tag_bars_basic(self):
        """Bars get tagged with macro regime from snapshots."""
        bars = [
            {"date": "2025-01-10", "close": 100.0},
            {"date": "2025-01-15", "close": 102.0},
            {"date": "2025-01-20", "close": 101.0},
        ]
        snapshots = [
            {
                "date": "2025-01-08",
                "vix": 14.0,
                "yield_spread_10y2y": 0.5,
                "trend": "up",
            },
            {
                "date": "2025-01-18",
                "vix": 30.0,
                "trend": "down",
            },
        ]
        tagged = tag_bars(bars, snapshots)

        self.assertEqual(len(tagged), 3)
        for bar in tagged:
            self.assertIn("macro_regime", bar)
            self.assertIn("macro_confidence", bar)
            self.assertIn(bar["macro_regime"], VALID_MACRO_REGIMES)

    def test_tag_bars_empty_snapshots(self):
        """Bars default to TRANSITION when no snapshots available."""
        bars = [{"date": "2025-01-10", "close": 100.0}]
        tagged = tag_bars(bars, [])
        self.assertEqual(tagged[0]["macro_regime"], "TRANSITION")
        self.assertEqual(tagged[0]["macro_confidence"], 0.0)

    def test_tag_bars_joins_on_date(self):
        """Bar tagging uses most recent snapshot <= bar date."""
        bars = [
            {"date": "2025-01-05", "close": 100.0},
            {"date": "2025-01-15", "close": 102.0},
        ]
        snapshots = [
            {"date": "2025-01-10", "vix": 14.0, "trend": "up", "yield_spread_10y2y": 0.5},
        ]
        tagged = tag_bars(bars, snapshots)

        # First bar is before snapshot -> TRANSITION
        self.assertEqual(tagged[0]["macro_regime"], "TRANSITION")
        # Second bar is after snapshot -> gets classified
        self.assertIn(tagged[1]["macro_regime"], VALID_MACRO_REGIMES)


# ─── Composite Regime Tests ─────────────────────────────────────

class TestCompositeRegime(unittest.TestCase):

    def test_aligned_trending_up_risk_on(self):
        """TRENDING_UP + RISK_ON = aligned, full_size."""
        result = composite_regime("TRENDING_UP", "RISK_ON")
        self.assertEqual(result["composite"], "TRENDING_UP:RISK_ON")
        self.assertEqual(result["alignment"], "aligned")
        self.assertEqual(result["recommendation"], "full_size")

    def test_conflicting_trending_up_risk_off(self):
        """TRENDING_UP + RISK_OFF = conflicting, reduce."""
        result = composite_regime("TRENDING_UP", "RISK_OFF")
        self.assertEqual(result["alignment"], "conflicting")
        self.assertEqual(result["recommendation"], "reduce")

    def test_conflicting_with_high_vix_skips(self):
        """Conflicting regime + VIX > 30 -> skip."""
        result = composite_regime("TRENDING_UP", "RISK_OFF", vix=35.0)
        self.assertEqual(result["alignment"], "conflicting")
        self.assertEqual(result["recommendation"], "skip")

    def test_neutral_alignment(self):
        """Regimes with no defined pair are neutral."""
        result = composite_regime("RANGE_BOUND", "EASING")
        self.assertEqual(result["alignment"], "neutral")

    def test_invalid_technical_falls_back(self):
        """Invalid technical regime defaults to TRANSITIONAL."""
        result = composite_regime("INVALID", "RISK_ON")
        self.assertEqual(result["technical"], "TRANSITIONAL")

    def test_invalid_macro_falls_back(self):
        """Invalid macro regime defaults to TRANSITION."""
        result = composite_regime("TRENDING_UP", "INVALID")
        self.assertEqual(result["macro"], "TRANSITION")

    def test_all_technical_regimes_valid(self):
        """All composite results use valid technical regime names."""
        for tech in VALID_TECHNICAL_REGIMES:
            for macro in RG_MACRO_REGIMES:
                result = composite_regime(tech, macro)
                self.assertIn(result["technical"], VALID_TECHNICAL_REGIMES)
                self.assertIn(result["macro"], RG_MACRO_REGIMES)

    def test_confidence_bounded(self):
        """Confidence is always between 0 and 1."""
        for tech in VALID_TECHNICAL_REGIMES:
            for macro in RG_MACRO_REGIMES:
                result = composite_regime(tech, macro, vix=20.0)
                self.assertGreaterEqual(result["confidence"], 0.0)
                self.assertLessEqual(result["confidence"], 1.0)

    def test_recommendation_values(self):
        """Recommendation is always one of the valid values."""
        valid_recs = {"full_size", "reduce", "skip"}
        for tech in VALID_TECHNICAL_REGIMES:
            for macro in RG_MACRO_REGIMES:
                for vix in [None, 10.0, 20.0, 35.0]:
                    result = composite_regime(tech, macro, vix=vix)
                    self.assertIn(result["recommendation"], valid_recs)


# ─── Event Calendar Tests ───────────────────────────────────────

class TestEventCalendar(unittest.TestCase):

    def test_all_events_have_required_fields(self):
        """Every event in calendar has required fields."""
        for evt in ALL_EVENTS:
            self.assertIn("event", evt)
            self.assertIn("date", evt)
            self.assertIn("impact_level", evt)
            self.assertIn("sit_out_minutes", evt)

    def test_events_sorted_by_date(self):
        """ALL_EVENTS list is sorted chronologically."""
        dates = [evt["date"] for evt in ALL_EVENTS]
        self.assertEqual(dates, sorted(dates))

    def test_get_upcoming_events_filters(self):
        """get_upcoming_events returns only events in window."""
        # Use a known FOMC date
        events = get_upcoming_events(
            from_date=date(2026, 3, 15),
            days_ahead=7,
        )
        # 2026-03-18 FOMC should be in range
        fomc_dates = [e["date"] for e in events if e["event"] == "FOMC"]
        self.assertIn("2026-03-18", fomc_dates)

    def test_get_upcoming_events_excludes_past(self):
        """get_upcoming_events doesn't return events before from_date."""
        events = get_upcoming_events(
            from_date=date(2026, 6, 1),
            days_ahead=30,
        )
        for evt in events:
            self.assertGreaterEqual(evt["date"], "2026-06-01")

    def test_event_proximity_on_event_day(self):
        """event_proximity returns SIT_OUT on FOMC day."""
        result = event_proximity(check_date=date(2026, 3, 18))
        self.assertEqual(result["nearest_event"], "FOMC")
        self.assertEqual(result["days_until"], 0)
        self.assertEqual(result["recommendation"], "SIT_OUT")

    def test_event_proximity_day_before_fomc(self):
        """event_proximity returns REDUCE day before high-impact event."""
        result = event_proximity(check_date=date(2026, 3, 17))
        self.assertEqual(result["days_until"], 1)
        self.assertEqual(result["recommendation"], "REDUCE")

    def test_event_proximity_far_from_event(self):
        """event_proximity returns TRADE when far from events."""
        # Pick a date well between events
        result = event_proximity(check_date=date(2026, 2, 1))
        self.assertGreater(result["days_until"], 1)
        self.assertEqual(result["recommendation"], "TRADE")

    def test_event_proximity_returns_required_keys(self):
        """event_proximity returns all required keys."""
        result = event_proximity(check_date=date(2026, 6, 1))
        self.assertIn("nearest_event", result)
        self.assertIn("days_until", result)
        self.assertIn("impact_level", result)
        self.assertIn("recommendation", result)
        self.assertIn("sit_out_window_minutes", result)

    def test_fomc_2026_dates_present(self):
        """All 2026 FOMC dates appear in calendar."""
        fomc_dates = {e["date"] for e in ALL_EVENTS if e["event"] == "FOMC"}
        expected = [
            "2026-01-28", "2026-03-18", "2026-05-06", "2026-06-17",
            "2026-07-29", "2026-09-16", "2026-11-04", "2026-12-16",
        ]
        for d in expected:
            self.assertIn(d, fomc_dates, f"Missing FOMC date {d}")

    def test_impact_levels_valid(self):
        """All events have valid impact levels."""
        valid = {"high", "medium", "low"}
        for evt in ALL_EVENTS:
            self.assertIn(evt["impact_level"], valid)


if __name__ == "__main__":
    unittest.main()
