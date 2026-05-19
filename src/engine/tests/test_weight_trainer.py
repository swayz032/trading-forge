"""Tests for skip engine weight trainer (Phase 4.5).

Tests:
- Feature vector construction: length, total, non-negative, clean signals
- Bounded step function: degenerate, max up/down, midpoint, floor/ceiling clamp, 10% cap
- Insufficient data: below minimum, null PnL excluded, empty list
- Single-class dataset: all wins, all losses → insufficient_data (not crash)
- Successful training: status ok, weight keys, weights within ±10%, abs floor, sample size, accuracy range
- Learned weight feedback: weights_source tag, identity weights, up/downweight effect,
  FOMC hard-skip invariance, qubo_timing exclusion
"""

import pytest

from src.engine.skip_engine.weight_trainer import (
    train_weights,
    _build_feature_vector,
    _apply_bounded_step,
    BASE_WEIGHTS,
    SIGNAL_KEYS,
    MIN_DECISIONS,
    MAX_STEP_FRACTION,
    WEIGHT_ABS_MIN,
    WEIGHT_ABS_MAX,
)
from src.engine.skip_engine.skip_classifier import classify_session


# ─── Fixtures ──────────────────────────────────────────────────────


def _make_decision(pnl: float, vix: float = 15.0) -> dict:
    """Minimal resolved decision dict — clean signals, no triggers."""
    return {
        "signals": {
            "vix": vix,
            "overnight_gap_atr": 0.3,
            "premarket_volume_pct": 0.8,
            "day_of_week": "Tuesday",
            "consecutive_losses": 0,
            "monthly_dd_usage_pct": 0.1,
            "portfolio_correlation": 0.2,
            "calendar": {
                "holiday_proximity": 20,
                "triple_witching": False,
                "roll_week": False,
            },
        },
        "actualPnl": pnl,
    }


def _make_loss_decision(vix: float = 32.0) -> dict:
    """Decision with strongly negative conditions and a loss outcome."""
    return {
        "signals": {
            "vix": vix,
            "overnight_gap_atr": 1.8,
            "premarket_volume_pct": 0.2,
            "day_of_week": "Friday",
            "bad_days": ["Friday"],
            "consecutive_losses": 4,
            "monthly_dd_usage_pct": 0.7,
            "portfolio_correlation": 0.6,
            "calendar": {
                "holiday_proximity": 1,
                "triple_witching": False,
                "roll_week": True,
            },
        },
        "actualPnl": -400.0,
    }


def _make_sufficient_dataset(n: int = 40) -> list:
    """Alternating win/loss dataset — guarantees 2 classes for LogisticRegression."""
    decisions = []
    for i in range(n):
        if i % 2 == 0:
            decisions.append(_make_decision(pnl=300.0, vix=15.0))
        else:
            decisions.append(_make_loss_decision())
    return decisions


@pytest.fixture
def fomc_day_signals():
    return {
        "event_proximity": {"event": "FOMC", "days_until": 0, "impact": "high"},
        "vix": 22.0,
        "overnight_gap_atr": 0.5,
        "premarket_volume_pct": 0.6,
        "day_of_week": "Wednesday",
        "consecutive_losses": 1,
        "monthly_dd_usage_pct": 0.3,
        "portfolio_correlation": 0.3,
        "calendar": {"holiday_proximity": 10, "triple_witching": False, "roll_week": False},
    }


@pytest.fixture
def clean_signals():
    return {
        "vix": 15.0,
        "overnight_gap_atr": 0.3,
        "premarket_volume_pct": 0.8,
        "day_of_week": "Tuesday",
        "consecutive_losses": 0,
        "monthly_dd_usage_pct": 0.1,
        "portfolio_correlation": 0.2,
        "calendar": {"holiday_proximity": 20, "triple_witching": False, "roll_week": False},
    }


# ─── Feature vector tests ──────────────────────────────────────────


class TestBuildFeatureVector:
    def test_length(self):
        """Feature vector must always have 10 elements (9 signals + total)."""
        signals = _make_decision(100.0)["signals"]
        fv = _build_feature_vector(signals)
        assert len(fv) == 10

    def test_total_is_sum(self):
        """10th element must equal the sum of the first 9."""
        signals = _make_decision(100.0)["signals"]
        fv = _build_feature_vector(signals)
        assert fv[9] == pytest.approx(sum(fv[:9]), abs=1e-9)

    def test_non_negative(self):
        """All feature scores must be non-negative."""
        signals = _make_loss_decision()["signals"]
        fv = _build_feature_vector(signals)
        assert all(s >= 0 for s in fv)

    def test_clean_signals_all_zero(self):
        """Signals with no triggers should produce all-zero feature vector."""
        signals = {
            "vix": 15.0,
            "overnight_gap_atr": 0.3,
            "premarket_volume_pct": 0.8,
            "day_of_week": "Tuesday",
            "consecutive_losses": 0,
            "monthly_dd_usage_pct": 0.1,
            "portfolio_correlation": 0.1,
            "calendar": {"holiday_proximity": 20, "triple_witching": False, "roll_week": False},
        }
        fv = _build_feature_vector(signals)
        assert all(s == 0.0 for s in fv)


# ─── Bounded step tests ─────────────────────────────────────────────


class TestApplyBoundedStep:
    def test_no_change_when_all_coeffs_equal(self):
        """Degenerate case: all coefficients equal → return base weight unchanged."""
        result = _apply_bounded_step(2.5, 1.0, [1.0, 1.0, 1.0])
        assert result == pytest.approx(2.5)

    def test_max_positive_step(self):
        """Highest coefficient should produce +10% step from base weight."""
        base = 2.5
        result = _apply_bounded_step(base, 1.0, [-1.0, 0.0, 1.0])
        expected = base + base * MAX_STEP_FRACTION
        assert result == pytest.approx(expected, rel=1e-6)

    def test_max_negative_step(self):
        """Lowest coefficient should produce -10% step from base weight."""
        base = 2.5
        result = _apply_bounded_step(base, -1.0, [-1.0, 0.0, 1.0])
        expected = base - base * MAX_STEP_FRACTION
        assert result == pytest.approx(expected, rel=1e-6)

    def test_midpoint_no_change(self):
        """Coefficient at exact midpoint → step = 0 → unchanged weight."""
        base = 2.0
        result = _apply_bounded_step(base, 0.0, [-1.0, 0.0, 1.0])
        assert result == pytest.approx(base)

    def test_abs_floor_clamp(self):
        """Result must never go below WEIGHT_ABS_MIN."""
        result = _apply_bounded_step(WEIGHT_ABS_MIN, -10.0, [-10.0, 0.0, 10.0])
        assert result >= WEIGHT_ABS_MIN

    def test_abs_ceiling_clamp(self):
        """Result must never exceed WEIGHT_ABS_MAX."""
        result = _apply_bounded_step(WEIGHT_ABS_MAX, 100.0, [-100.0, 0.0, 100.0])
        assert result <= WEIGHT_ABS_MAX

    def test_step_bounded_to_10_pct(self):
        """Change must never exceed ±10% of base in absolute value."""
        base = 3.0
        coeffs = [-5.0, 0.0, 5.0]
        up = _apply_bounded_step(base, 5.0, coeffs)
        dn = _apply_bounded_step(base, -5.0, coeffs)
        assert up <= base * (1 + MAX_STEP_FRACTION) + 1e-9
        assert dn >= base * (1 - MAX_STEP_FRACTION) - 1e-9


# ─── Insufficient data guard tests ─────────────────────────────────


class TestTrainWeightsInsufficientData:
    def test_returns_insufficient_data_below_minimum(self):
        """Fewer than MIN_DECISIONS resolved decisions → status insufficient_data."""
        decisions = [_make_decision(100.0) for _ in range(MIN_DECISIONS - 1)]
        result = train_weights(decisions)
        assert result["status"] == "insufficient_data"
        assert result["sampleSize"] < MIN_DECISIONS
        assert result["weights"] == {}

    def test_null_pnl_excluded_from_sample_count(self):
        """Decisions with null actualPnl are excluded; single-class → insufficient_data."""
        # 35 valid all-wins + 10 null
        decisions = [_make_decision(100.0) for _ in range(35)]
        decisions += [{"signals": _make_decision(0.0)["signals"], "actualPnl": None}] * 10
        result = train_weights(decisions)
        # Only 35 resolved rows, all wins → single class → insufficient_data
        assert result["sampleSize"] == 35
        assert result["status"] == "insufficient_data"

    def test_empty_list(self):
        """Empty decisions list → status insufficient_data."""
        result = train_weights([])
        assert result["status"] == "insufficient_data"
        assert result["sampleSize"] == 0

    def test_pure_winners_dataset(self):
        """All-wins dataset → single class → insufficient_data, no crash."""
        decisions = [_make_decision(300.0, vix=15.0) for _ in range(50)]
        result = train_weights(decisions)
        assert result["status"] == "insufficient_data"
        assert result["sampleSize"] == 50
        assert result["weights"] == {}

    def test_pure_losers_dataset(self):
        """All-losses dataset → single class → insufficient_data, no crash."""
        decisions = [_make_loss_decision() for _ in range(50)]
        result = train_weights(decisions)
        assert result["status"] == "insufficient_data"
        assert result["sampleSize"] == 50
        assert result["weights"] == {}


# ─── Successful training tests ──────────────────────────────────────


class TestTrainWeightsSuccessful:
    """These tests require scikit-learn and a mixed-class dataset."""

    def test_ok_status_with_sufficient_data(self):
        """Sufficient mixed dataset should produce status ok."""
        result = train_weights(_make_sufficient_dataset(60))
        if result["status"] == "missing_dependency":
            pytest.skip("scikit-learn not installed")
        assert result["status"] == "ok"

    def test_result_structure(self):
        """Result must contain all required keys."""
        result = train_weights(_make_sufficient_dataset(60))
        required = {
            "status", "message", "sampleSize", "windowDays",
            "baselineAccuracy", "trainedAccuracy", "weights",
        }
        assert required.issubset(result.keys())

    def test_weights_keys_match_signal_keys(self):
        """Returned weights dict must have exactly SIGNAL_KEYS as keys."""
        result = train_weights(_make_sufficient_dataset(60))
        if result["status"] != "ok":
            pytest.skip(f"status: {result['status']}")
        assert set(result["weights"].keys()) == set(SIGNAL_KEYS)

    def test_weights_within_10_pct_of_base(self):
        """Every trained weight must be within ±10% of its BASE_WEIGHT."""
        result = train_weights(_make_sufficient_dataset(60))
        if result["status"] != "ok":
            pytest.skip(f"status: {result['status']}")
        for key, learned_w in result["weights"].items():
            base_w = BASE_WEIGHTS[key]
            max_allowed = base_w * (1 + MAX_STEP_FRACTION) + 1e-6
            min_allowed = base_w * (1 - MAX_STEP_FRACTION) - 1e-6
            assert learned_w <= max_allowed, (
                f"{key}: learned {learned_w} > max_allowed {max_allowed}"
            )
            assert learned_w >= min_allowed, (
                f"{key}: learned {learned_w} < min_allowed {min_allowed}"
            )

    def test_weights_above_abs_floor(self):
        """No trained weight should be below WEIGHT_ABS_MIN."""
        result = train_weights(_make_sufficient_dataset(60))
        if result["status"] != "ok":
            pytest.skip(f"status: {result['status']}")
        for key, w in result["weights"].items():
            assert w >= WEIGHT_ABS_MIN, f"{key}: weight {w} < WEIGHT_ABS_MIN {WEIGHT_ABS_MIN}"

    def test_sample_size_matches_resolved_count(self):
        """sampleSize must equal the number of decisions with non-null actualPnl."""
        decisions = _make_sufficient_dataset(50)
        result = train_weights(decisions)
        if result["status"] not in ("ok", "insufficient_data"):
            pytest.skip(f"status: {result['status']}")
        assert result["sampleSize"] == 50

    def test_accuracy_in_range(self):
        """baselineAccuracy and trainedAccuracy must be in [0, 1]."""
        result = train_weights(_make_sufficient_dataset(60))
        if result["status"] != "ok":
            pytest.skip(f"status: {result['status']}")
        assert 0.0 <= result["baselineAccuracy"] <= 1.0
        assert 0.0 <= result["trainedAccuracy"] <= 1.0

    def test_window_days_passthrough(self):
        """windowDays in result must match what was passed in."""
        result = train_weights(_make_sufficient_dataset(60), window_days=120)
        assert result["windowDays"] == 120


# ─── Learned weight feedback tests ─────────────────────────────────


class TestLearnedWeightFeedback:
    """Test that classify_session correctly applies learned weights."""

    def test_weights_source_base_by_default(self, clean_signals):
        """Without learned_weights, weights_source must be 'base'."""
        result = classify_session(clean_signals)
        assert result["weights_source"] == "base"

    def test_weights_source_learned_when_provided(self, clean_signals):
        """With learned_weights, weights_source must be 'learned'."""
        result = classify_session(clean_signals, learned_weights=BASE_WEIGHTS.copy())
        assert result["weights_source"] == "learned"

    def test_identity_learned_weights_same_result(self, clean_signals):
        """Passing BASE_WEIGHTS as learned_weights must produce identical scores."""
        base_result = classify_session(clean_signals)
        identity_result = classify_session(clean_signals, learned_weights=BASE_WEIGHTS.copy())
        assert base_result["score"] == pytest.approx(identity_result["score"], abs=1e-6)
        assert base_result["decision"] == identity_result["decision"]

    def test_upweighted_vix_increases_score(self):
        """Upweighting vix_level by +10% should increase the total score when VIX is elevated."""
        signals = {
            "vix": 27.0,  # Produces 1.5 raw score for vix_level
            "overnight_gap_atr": 0.3,
            "premarket_volume_pct": 0.8,
            "day_of_week": "Tuesday",
            "consecutive_losses": 0,
            "monthly_dd_usage_pct": 0.1,
            "portfolio_correlation": 0.2,
            "calendar": {"holiday_proximity": 20, "triple_witching": False, "roll_week": False},
        }
        base_result = classify_session(signals)
        learned = {**BASE_WEIGHTS, "vix_level": BASE_WEIGHTS["vix_level"] * 1.1}
        learned_result = classify_session(signals, learned_weights=learned)
        assert learned_result["score"] > base_result["score"]

    def test_downweighted_vix_decreases_score(self):
        """Downweighting vix_level by -10% should decrease the total score when VIX is elevated."""
        signals = {
            "vix": 27.0,
            "overnight_gap_atr": 0.3,
            "premarket_volume_pct": 0.8,
            "day_of_week": "Tuesday",
            "consecutive_losses": 0,
            "monthly_dd_usage_pct": 0.1,
            "portfolio_correlation": 0.2,
            "calendar": {"holiday_proximity": 20, "triple_witching": False, "roll_week": False},
        }
        base_result = classify_session(signals)
        learned = {**BASE_WEIGHTS, "vix_level": BASE_WEIGHTS["vix_level"] * 0.9}
        learned_result = classify_session(signals, learned_weights=learned)
        assert learned_result["score"] < base_result["score"]

    def test_fomc_hard_skip_unchanged_by_learned_weights(self, fomc_day_signals):
        """FOMC same-day hard SKIP (override_allowed=False) must survive any learned weights."""
        base_result = classify_session(fomc_day_signals)
        # Aggressively downweight event_proximity
        learned = {**BASE_WEIGHTS, "event_proximity": 0.01}
        learned_result = classify_session(fomc_day_signals, learned_weights=learned)
        assert base_result["decision"] == "SKIP"
        assert base_result["override_allowed"] is False
        assert learned_result["decision"] == "SKIP"
        assert learned_result["override_allowed"] is False

    def test_qubo_timing_not_scaled_by_learned_weights(self):
        """qubo_timing is explicitly excluded from learned weight scaling."""
        signals = {
            "vix": 15.0,
            "overnight_gap_atr": 0.3,
            "premarket_volume_pct": 0.8,
            "day_of_week": "Tuesday",
            "consecutive_losses": 0,
            "monthly_dd_usage_pct": 0.1,
            "portfolio_correlation": 0.2,
            "calendar": {"holiday_proximity": 20, "triple_witching": False, "roll_week": False},
            "qubo_timing": {"schedule_active": True, "current_block_trade": False},
        }
        base_result = classify_session(signals)
        # Setting qubo_timing learned weight to zero should NOT remove the qubo score
        learned = {**BASE_WEIGHTS, "qubo_timing": 0.0}
        learned_result = classify_session(signals, learned_weights=learned)
        assert (
            base_result["signal_scores"]["qubo_timing"]
            == learned_result["signal_scores"]["qubo_timing"]
        )
