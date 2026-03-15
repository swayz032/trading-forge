"""Tests for Day Archetype Engine (Phase 4.13).

Tests:
- Classify TREND_DAY_UP (close near high, range > 1.5 ATR)
- Classify TREND_DAY_DOWN (close near low, range > 1.5 ATR)
- Classify RANGE_DAY (tight range < 0.7 ATR)
- Classify INSIDE_DAY (contained within prev range)
- Classify GAP_AND_GO (gap > 0.5 ATR, continues)
- Classify EXPANSION_DAY (range > 2x prev)
- Feature extractor returns all 13 features
- KNN predictor returns valid archetype with probabilities summing to ~1.0
- Strategy mapper identifies best/worst archetypes
- Historical labeler processes series correctly
- Archetype distribution percentages sum to 100%
"""

import pytest

from src.engine.archetypes.classifier import (
    ARCHETYPES,
    classify_day,
    classify_day_series,
)
from src.engine.archetypes.feature_extractor import (
    PREMARKET_FEATURES,
    extract_features,
)
from src.engine.archetypes.predictor import predict_archetype
from src.engine.archetypes.strategy_mapper import map_strategy_to_archetypes
from src.engine.archetypes.historical_labeler import (
    label_history,
    archetype_distribution,
)


# ─── Fixtures ────────────────────────────────────────────────────

@pytest.fixture
def atr_value():
    """Typical ATR for ES futures (~20 points)."""
    return 20.0


@pytest.fixture
def prev_day():
    """A normal previous day bar."""
    return {"open": 5000, "high": 5025, "low": 4980, "close": 5010, "volume": 100000}


# ─── Classification Tests ────────────────────────────────────────

class TestClassifyDay:
    def test_trend_day_up(self, atr_value, prev_day):
        """Strong up move: range > 1.5 ATR, close near high."""
        day = {"open": 5010, "high": 5055, "low": 5005, "close": 5052, "volume": 150000}
        # Range = 50, ATR = 20, ratio = 2.5 (> 1.5)
        # Close position = (5052-5005)/(5055-5005) = 47/50 = 0.94 (> 0.80)
        result = classify_day(day, prev_day, atr_value)
        assert result["archetype"] == "TREND_DAY_UP"
        assert 0 < result["confidence"] <= 1.0
        assert result["metrics"]["range_atr_ratio"] > 1.5
        assert result["metrics"]["close_position"] > 0.80

    def test_trend_day_down(self, atr_value, prev_day):
        """Strong down move: range > 1.5 ATR, close near low."""
        day = {"open": 5010, "high": 5015, "low": 4960, "close": 4963, "volume": 150000}
        # Range = 55, ATR = 20, ratio = 2.75 (> 1.5)
        # Close position = (4963-4960)/(5015-4960) = 3/55 = 0.055 (< 0.20)
        result = classify_day(day, prev_day, atr_value)
        assert result["archetype"] == "TREND_DAY_DOWN"
        assert 0 < result["confidence"] <= 1.0
        assert result["metrics"]["range_atr_ratio"] > 1.5
        assert result["metrics"]["close_position"] < 0.20

    def test_range_day(self, atr_value, prev_day):
        """Tight range day: range < 0.7 ATR."""
        # Ensure NOT inside prev range (prev: high=5025, low=4980)
        # low=4975 < prev_low=4980 so it's not an inside day
        day = {"open": 4980, "high": 4988, "low": 4975, "close": 4982, "volume": 50000}
        # Range = 13, ATR = 20, ratio = 0.65 (< 0.7)
        result = classify_day(day, prev_day, atr_value)
        assert result["archetype"] == "RANGE_DAY"
        assert result["metrics"]["range_atr_ratio"] < 0.7

    def test_inside_day(self, prev_day):
        """High/low contained within previous day's range."""
        # prev: high=5025, low=4980
        day = {"open": 5000, "high": 5020, "low": 4985, "close": 5005, "volume": 60000}
        # 5020 < 5025 AND 4985 > 4980 => inside day
        result = classify_day(day, prev_day, atr=20.0)
        assert result["archetype"] == "INSIDE_DAY"
        assert result["metrics"]["is_inside"] is True
        assert result["confidence"] >= 0.85

    def test_gap_and_go(self, atr_value):
        """Gap > 0.5 ATR and continues in gap direction."""
        prev = {"open": 5000, "high": 5020, "low": 4980, "close": 5010, "volume": 100000}
        # Gap up: open = 5025, prev_close = 5010 => gap = 15, ATR = 20 => gap_atr = 0.75 (> 0.5)
        # Continues: close > open
        day = {"open": 5025, "high": 5045, "low": 5020, "close": 5040, "volume": 120000}
        result = classify_day(day, prev, atr_value)
        assert result["archetype"] == "GAP_AND_GO"
        assert result["metrics"]["gap_size_atr"] > 0.5

    def test_expansion_day(self, atr_value):
        """Range > 2x previous day range."""
        prev = {"open": 5000, "high": 5010, "low": 4995, "close": 5005, "volume": 80000}
        # Prev range = 15
        # Day range needs to be > 30
        day = {"open": 5005, "high": 5045, "low": 4995, "close": 5020, "volume": 200000}
        # Range = 50, prev range = 15, ratio = 3.33 (> 2.0)
        result = classify_day(day, prev, atr_value)
        assert result["archetype"] == "EXPANSION_DAY"
        assert result["confidence"] > 0.5

    def test_all_archetypes_are_valid(self, atr_value, prev_day):
        """Any classification must return a valid archetype."""
        day = {"open": 5000, "high": 5010, "low": 4990, "close": 5005, "volume": 100000}
        result = classify_day(day, prev_day, atr_value)
        assert result["archetype"] in ARCHETYPES
        assert 0 <= result["confidence"] <= 1.0
        assert "metrics" in result

    def test_classify_without_prev_day(self, atr_value):
        """Classification works without previous day data."""
        day = {"open": 5000, "high": 5050, "low": 4960, "close": 5045, "volume": 100000}
        result = classify_day(day, None, atr_value)
        assert result["archetype"] in ARCHETYPES

    def test_classify_without_atr(self, prev_day):
        """Classification works without ATR (uses day range)."""
        day = {"open": 5000, "high": 5050, "low": 4960, "close": 5045, "volume": 100000}
        result = classify_day(day, prev_day, None)
        assert result["archetype"] in ARCHETYPES


# ─── Feature Extractor Tests ─────────────────────────────────────

class TestFeatureExtractor:
    def test_returns_all_13_features(self):
        """Feature extractor returns exactly 13 features."""
        premarket = {
            "open": 5025,
            "overnight_high": 5030,
            "overnight_low": 5010,
            "premarket_volume": 5000,
            "avg_premarket_volume": 4000,
            "day_of_week": 2,
            "vix": 18.5,
            "prev_vix": 17.0,
        }
        prev = {
            "open": 5000,
            "high": 5020,
            "low": 4980,
            "close": 5010,
            "volume": 100000,
            "vwap": 5005,
            "archetype": "GRIND_DAY",
            "atr": 20.0,
        }
        ctx = {
            "days_to_fomc": 12,
            "days_to_opex": 5,
            "atr_history_20d": [18, 19, 20, 21, 22, 19, 17, 20, 21, 18, 19, 20, 22, 23, 18, 19, 20, 21, 19, 20],
            "consecutive_same_type": 2,
        }

        features = extract_features(premarket, prev, ctx)

        assert len(features) == 13
        for fname in PREMARKET_FEATURES:
            assert fname in features, f"Missing feature: {fname}"
            assert isinstance(features[fname], (int, float)), f"Feature {fname} is not numeric"

    def test_gap_size_computed_correctly(self):
        """Gap = |open - prev_close| / ATR."""
        premarket = {"open": 5025, "overnight_high": 5030, "overnight_low": 5010,
                     "premarket_volume": 5000, "avg_premarket_volume": 4000,
                     "day_of_week": 1, "vix": 20, "prev_vix": 20}
        prev = {"close": 5010, "high": 5020, "low": 4980, "open": 5000, "atr": 20.0}
        features = extract_features(premarket, prev)
        # Gap = |5025 - 5010| / 20 = 0.75
        assert abs(features["gap_size_atr"] - 0.75) < 0.01

    def test_default_values_without_context(self):
        """Features have sensible defaults when historical context is missing."""
        premarket = {"open": 5000, "day_of_week": 0, "vix": 20, "prev_vix": 20}
        prev = {"close": 5000, "high": 5010, "low": 4990, "open": 5000, "atr": 20.0}
        features = extract_features(premarket, prev)
        assert len(features) == 13
        assert features["days_to_fomc"] == 30  # default
        assert features["atr_percentile_20d"] == 0.5  # default


# ─── KNN Predictor Tests ─────────────────────────────────────────

class TestPredictor:
    def test_returns_valid_archetype(self):
        """Prediction returns a valid archetype."""
        features = {f: 0.5 for f in PREMARKET_FEATURES}
        historical = [
            {"features": {f: float(i * 0.1) for f in PREMARKET_FEATURES}, "actual_archetype": ARCHETYPES[i % 8], "date": f"2025-01-{i+1:02d}"}
            for i in range(20)
        ]
        result = predict_archetype(features, historical, k=5)
        assert result["predicted"] in ARCHETYPES

    def test_probabilities_sum_to_one(self):
        """All archetype probabilities should sum to approximately 1.0."""
        features = {f: 0.5 for f in PREMARKET_FEATURES}
        historical = [
            {"features": {f: float(i * 0.1) for f in PREMARKET_FEATURES}, "actual_archetype": ARCHETYPES[i % 8], "date": f"2025-01-{i+1:02d}"}
            for i in range(20)
        ]
        result = predict_archetype(features, historical, k=7)
        total_prob = sum(result["probabilities"].values())
        assert abs(total_prob - 1.0) < 0.01, f"Probabilities sum to {total_prob}, expected ~1.0"

    def test_all_8_archetypes_in_probabilities(self):
        """Output includes probabilities for all 8 archetypes."""
        features = {f: 0.5 for f in PREMARKET_FEATURES}
        historical = [
            {"features": {f: 0.5 for f in PREMARKET_FEATURES}, "actual_archetype": "RANGE_DAY", "date": "2025-01-01"}
        ]
        result = predict_archetype(features, historical, k=1)
        assert len(result["probabilities"]) == 8
        for a in ARCHETYPES:
            assert a in result["probabilities"]

    def test_confidence_between_0_and_1(self):
        """Confidence is a valid probability."""
        features = {f: 0.5 for f in PREMARKET_FEATURES}
        historical = [
            {"features": {f: float(i * 0.1) for f in PREMARKET_FEATURES}, "actual_archetype": ARCHETYPES[i % 8], "date": f"2025-01-{i+1:02d}"}
            for i in range(20)
        ]
        result = predict_archetype(features, historical, k=5)
        assert 0 <= result["confidence"] <= 1.0

    def test_nearest_dates_returned(self):
        """K nearest dates are returned."""
        features = {f: 0.5 for f in PREMARKET_FEATURES}
        historical = [
            {"features": {f: float(i * 0.1) for f in PREMARKET_FEATURES}, "actual_archetype": "RANGE_DAY", "date": f"2025-01-{i+1:02d}"}
            for i in range(10)
        ]
        result = predict_archetype(features, historical, k=5)
        assert len(result["nearest_dates"]) == 5

    def test_empty_history_returns_uniform(self):
        """With no history, return uniform distribution."""
        features = {f: 0.5 for f in PREMARKET_FEATURES}
        result = predict_archetype(features, [], k=5)
        assert result["predicted"] == "RANGE_DAY"
        expected_prob = 1.0 / 8
        for prob in result["probabilities"].values():
            assert abs(prob - expected_prob) < 0.01


# ─── Strategy Mapper Tests ────────────────────────────────────────

class TestStrategyMapper:
    def test_identifies_best_worst_archetypes(self):
        """Mapper correctly ranks archetypes by avg P&L."""
        daily_results = [
            {"date": f"2025-01-{i+1:02d}", "pnl": 500, "archetype": "TREND_DAY_UP"}
            for i in range(10)
        ] + [
            {"date": f"2025-02-{i+1:02d}", "pnl": -200, "archetype": "RANGE_DAY"}
            for i in range(10)
        ] + [
            {"date": f"2025-03-{i+1:02d}", "pnl": 100, "archetype": "GRIND_DAY"}
            for i in range(5)
        ]

        result = map_strategy_to_archetypes("test-strat-1", daily_results)

        assert result["strategy_id"] == "test-strat-1"
        assert result["best_archetypes"][0] == "TREND_DAY_UP"
        assert result["worst_archetypes"][0] == "RANGE_DAY"
        assert result["archetype_stats"]["TREND_DAY_UP"]["avg_pnl"] == 500.0
        assert result["archetype_stats"]["TREND_DAY_UP"]["win_rate"] == 1.0
        assert result["archetype_stats"]["RANGE_DAY"]["avg_pnl"] == -200.0
        assert result["archetype_stats"]["RANGE_DAY"]["win_rate"] == 0.0

    def test_recommendation_generated(self):
        """Mapper generates a recommendation string."""
        daily_results = [
            {"date": "2025-01-01", "pnl": 300, "archetype": "TREND_DAY_UP"},
            {"date": "2025-01-02", "pnl": -100, "archetype": "RANGE_DAY"},
        ]
        result = map_strategy_to_archetypes("strat-2", daily_results)
        assert isinstance(result["recommendation"], str)
        assert len(result["recommendation"]) > 0

    def test_empty_archetype_stats(self):
        """Archetypes with no trades get zero stats."""
        daily_results = [
            {"date": "2025-01-01", "pnl": 300, "archetype": "TREND_DAY_UP"},
        ]
        result = map_strategy_to_archetypes("strat-3", daily_results)
        assert result["archetype_stats"]["INSIDE_DAY"]["count"] == 0
        assert result["archetype_stats"]["INSIDE_DAY"]["avg_pnl"] == 0.0


# ─── Historical Labeler Tests ─────────────────────────────────────

class TestHistoricalLabeler:
    @pytest.fixture
    def sample_bars(self):
        """Generate 30 days of synthetic OHLCV data."""
        import random
        random.seed(42)
        bars = []
        price = 5000.0
        for i in range(30):
            move = random.uniform(-30, 30)
            o = price
            h = o + abs(random.uniform(5, 25))
            l = o - abs(random.uniform(5, 25))
            c = o + move
            # Ensure h >= max(o, c) and l <= min(o, c)
            h = max(h, o, c) + random.uniform(0, 5)
            l = min(l, o, c) - random.uniform(0, 5)
            bars.append({
                "open": round(o, 2),
                "high": round(h, 2),
                "low": round(l, 2),
                "close": round(c, 2),
                "volume": random.randint(50000, 200000),
            })
            price = c
        return bars

    def test_label_history_adds_archetype(self, sample_bars):
        """Every bar gets an archetype label after labeling."""
        labeled = label_history(sample_bars)
        assert len(labeled) == len(sample_bars)
        for bar in labeled:
            assert "archetype" in bar
            assert bar["archetype"] in ARCHETYPES
            assert "archetype_confidence" in bar
            assert 0 <= bar["archetype_confidence"] <= 1.0

    def test_classify_day_series_matches_label_history(self, sample_bars):
        """label_history and classify_day_series produce the same output."""
        labeled = label_history(sample_bars)
        series = classify_day_series(sample_bars)
        assert len(labeled) == len(series)
        for l_bar, s_bar in zip(labeled, series):
            assert l_bar["archetype"] == s_bar["archetype"]

    def test_archetype_distribution_sums_to_100(self, sample_bars):
        """Distribution percentages sum to 100%."""
        labeled = label_history(sample_bars)
        dist = archetype_distribution(labeled)

        total_pct = sum(d["pct"] for d in dist.values())
        assert abs(total_pct - 100.0) < 0.1, f"Distribution sums to {total_pct}%, expected 100%"

    def test_archetype_distribution_counts_match(self, sample_bars):
        """Distribution counts match total number of bars."""
        labeled = label_history(sample_bars)
        dist = archetype_distribution(labeled)

        total_count = sum(d["count"] for d in dist.values())
        assert total_count == len(sample_bars)

    def test_distribution_all_archetypes_present(self, sample_bars):
        """All 8 archetypes appear in the distribution (even with count 0)."""
        labeled = label_history(sample_bars)
        dist = archetype_distribution(labeled)
        for a in ARCHETYPES:
            assert a in dist

    def test_empty_distribution(self):
        """Empty input gives zero distribution."""
        dist = archetype_distribution([])
        for a in ARCHETYPES:
            assert dist[a]["count"] == 0
            assert dist[a]["pct"] == 0.0
