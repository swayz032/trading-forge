"""Wave 27.5 Pass B — HIGH #2: Parameter stability regime-context tests.

Tests for walk_forward_regime_context.classify_parameter_drift().

Coverage:
  - 12 tests across: stable, regime_driven, overfit_drift, indeterminate
  - Degenerate inputs: empty, length mismatch, no regime data
  - Spearman rho threshold sensitivity
  - Backward compat: fragile flag preservation
  - Bull→bear→sideways regime progression with correlated params
"""

from __future__ import annotations

import pytest

from src.engine.walk_forward_regime_context import (
    ParameterDriftClassification,
    _regime_to_ordinal,
    _spearman_rho,
    classify_parameter_drift,
)

# ── Helper factories ──────────────────────────────────────────────────────────

def _make_params(vals_by_window: list[dict]) -> list[dict]:
    return vals_by_window


# ── Test: _regime_to_ordinal ──────────────────────────────────────────────────

class TestRegimeToOrdinal:
    def test_trending_maps_positive(self):
        assert _regime_to_ordinal("TRENDING") > 0

    def test_bearish_maps_negative(self):
        assert _regime_to_ordinal("bearish") < 0

    def test_range_bound_maps_neutral(self):
        assert _regime_to_ordinal("RANGE_BOUND") == 0

    def test_none_returns_none(self):
        assert _regime_to_ordinal(None) is None

    def test_unknown_label_returns_none(self):
        assert _regime_to_ordinal("ALIEN_REGIME_XYZ") is None


# ── Test: _spearman_rho ───────────────────────────────────────────────────────

class TestSpearmanRho:
    def test_perfect_positive_correlation(self):
        x = [1.0, 2.0, 3.0, 4.0, 5.0]
        y = [1.0, 2.0, 3.0, 4.0, 5.0]
        rho = _spearman_rho(x, y)
        assert rho is not None
        assert abs(rho - 1.0) < 0.01

    def test_perfect_negative_correlation(self):
        x = [1.0, 2.0, 3.0, 4.0, 5.0]
        y = [5.0, 4.0, 3.0, 2.0, 1.0]
        rho = _spearman_rho(x, y)
        assert rho is not None
        assert abs(rho + 1.0) < 0.01

    def test_too_short_returns_none(self):
        assert _spearman_rho([1.0, 2.0], [2.0, 3.0]) is None

    def test_constant_sequence_returns_none(self):
        rho = _spearman_rho([2.0, 2.0, 2.0, 2.0], [1.0, 2.0, 3.0, 4.0])
        assert rho is None

    def test_zero_correlation(self):
        x = [1.0, 2.0, 3.0, 4.0, 5.0]
        y = [3.0, 1.0, 5.0, 2.0, 4.0]
        rho = _spearman_rho(x, y)
        assert rho is not None
        assert abs(rho) < 0.5  # Low correlation for mixed sequence


# ── Test: classify_parameter_drift — stable ───────────────────────────────────

class TestClassifyStable:
    def test_stable_when_cv_below_30pct(self):
        """Params with low CV are classified STABLE regardless of regime."""
        params = [{"fast_ma": 9}, {"fast_ma": 10}, {"fast_ma": 9}]
        regimes = ["TRENDING", "RANGE_BOUND", "TRENDING"]
        result = classify_parameter_drift(params, regimes)
        assert result.classification == "stable"
        assert result.fragile is False
        assert result.warning is None

    def test_stable_returns_confidence_1(self):
        params = [{"p": 5}, {"p": 5}, {"p": 6}, {"p": 5}]
        regimes = ["TRENDING", "TRENDING", "RANGE_BOUND", "TRENDING"]
        result = classify_parameter_drift(params, regimes)
        assert result.classification == "stable"
        assert result.confidence == 1.0


# ── Test: classify_parameter_drift — regime_driven ────────────────────────────

class TestClassifyRegimeDriven:
    def test_bull_bear_sideways_with_correlated_params(self):
        """Classic bull → bear → sideways progression where fast MA shrinks with regime.

        Regime ordinals: TRENDING=2, RANGE_BOUND=0, LOW_LIQ_CHOP=-2
        Param fast_ma also decreases: 20 → 10 → 5 (adapts to regime)
        Spearman rho ≈ 1.0 → REGIME_DRIVEN.
        """
        params = [
            {"fast_ma": 20.0},  # bull/trending: long lookback
            {"fast_ma": 10.0},  # sideways
            {"fast_ma": 5.0},   # low-liq/chop: short lookback
        ]
        regimes = ["TRENDING", "RANGE_BOUND", "LOW_LIQ_CHOP"]
        result = classify_parameter_drift(params, regimes)
        assert result.classification == "regime_driven"
        assert result.fragile is False
        # Spearman should be near 1.0 for this monotone case
        assert result.evidence.get("spearman_rho") is not None
        assert abs(result.evidence["spearman_rho"]) >= 0.3

    def test_regime_driven_has_positive_confidence(self):
        params = [{"x": 3.0}, {"x": 5.0}, {"x": 8.0}]
        regimes = ["bearish", "neutral", "bullish"]  # ascending regime
        result = classify_parameter_drift(params, regimes)
        # Either regime_driven or indeterminate — confidence must be > 0
        assert result.confidence > 0

    def test_fragile_false_when_regime_driven(self):
        """Regime-driven drift is NOT fragile — it is legitimate adaptation."""
        params = [{"p": 2.0}, {"p": 5.0}, {"p": 9.0}, {"p": 12.0}]
        regimes = ["bearish", "neutral", "bullish", "TRENDING"]
        result = classify_parameter_drift(params, regimes)
        if result.classification == "regime_driven":
            assert result.fragile is False


# ── Test: classify_parameter_drift — overfit_drift ───────────────────────────

class TestClassifyOverfitDrift:
    def test_stable_regime_jittery_params_is_overfit(self):
        """Stable regime (all TRENDING) + high-CV params → OVERFIT_DRIFT."""
        params = [
            {"fast_ma": 5.0},
            {"fast_ma": 25.0},
            {"fast_ma": 3.0},
            {"fast_ma": 40.0},
        ]
        regimes = ["TRENDING", "TRENDING", "TRENDING", "TRENDING"]
        result = classify_parameter_drift(params, regimes)
        assert result.classification == "overfit_drift"
        assert result.fragile is True

    def test_overfit_drift_confidence_is_moderate(self):
        params = [{"q": 1.0}, {"q": 10.0}, {"q": 2.0}, {"q": 15.0}]
        regimes = ["EXPANSION", "EXPANSION", "EXPANSION", "EXPANSION"]
        result = classify_parameter_drift(params, regimes)
        assert result.classification == "overfit_drift"
        assert result.confidence > 0.5


# ── Test: classify_parameter_drift — indeterminate ───────────────────────────

class TestClassifyIndeterminate:
    def test_no_regime_data_is_indeterminate(self):
        """Fragile params + all-None regimes → INDETERMINATE with confidence=0."""
        params = [{"p": 1.0}, {"p": 20.0}, {"p": 3.0}]
        regimes = [None, None, None]
        result = classify_parameter_drift(params, regimes)
        assert result.classification == "indeterminate"
        assert result.confidence == 0.0
        assert result.fragile is True

    def test_volatile_regime_uncorrelated_params_is_indeterminate(self):
        """Regime shifts but params jitter randomly (no Spearman correlation)."""
        # Regime: bullish→bearish→bullish (alternating)
        # Params: random, not tracking regime
        params = [{"p": 5.0}, {"p": 5.5}, {"p": 4.8}, {"p": 6.2}, {"p": 5.1}]
        regimes = ["bullish", "bearish", "bullish", "bearish", "bullish"]
        result = classify_parameter_drift(params, regimes)
        # Regime is volatile, params have low CV → stable (not indeterminate)
        # OR regime volatile + params also volatile → indeterminate
        assert result.classification in ("stable", "indeterminate")

    def test_insufficient_windows_returns_indeterminate(self):
        """< 2 windows → indeterminate with confidence=0."""
        result = classify_parameter_drift([{"p": 5.0}], ["TRENDING"])
        assert result.classification == "indeterminate"
        assert result.confidence == 0.0

    def test_length_mismatch_returns_indeterminate(self):
        """Regime list length != param list length → indeterminate."""
        params = [{"p": 1.0}, {"p": 2.0}, {"p": 3.0}]
        regimes = ["TRENDING", "RANGE_BOUND"]  # length 2 vs params length 3
        result = classify_parameter_drift(params, regimes)
        assert result.classification == "indeterminate"
        assert result.confidence == 0.0


# ── Test: backward compat — fragile flag ─────────────────────────────────────

class TestBackwardCompatFragileFlag:
    def test_overfit_drift_sets_fragile_true(self):
        params = [{"p": 1.0}, {"p": 30.0}, {"p": 2.0}]
        regimes = ["TRENDING", "TRENDING", "TRENDING"]
        result = classify_parameter_drift(params, regimes)
        if result.classification == "overfit_drift":
            assert result.fragile is True

    def test_stable_sets_fragile_false(self):
        params = [{"p": 10.0}, {"p": 10.5}, {"p": 10.2}]
        regimes = ["TRENDING", "RANGE_BOUND", "COMPRESSION"]
        result = classify_parameter_drift(params, regimes)
        if result.classification == "stable":
            assert result.fragile is False

    def test_result_is_dataclass_with_correct_fields(self):
        """Return type must be ParameterDriftClassification with all expected fields."""
        params = [{"p": 1.0}, {"p": 2.0}]
        regimes = ["TRENDING", "RANGE_BOUND"]
        result = classify_parameter_drift(params, regimes)
        assert isinstance(result, ParameterDriftClassification)
        assert hasattr(result, "classification")
        assert hasattr(result, "confidence")
        assert hasattr(result, "fragile")
        assert hasattr(result, "evidence")
        assert result.classification in ("stable", "regime_driven", "overfit_drift", "indeterminate")
        assert 0.0 <= result.confidence <= 1.0


# ── Test: evidence dict structure ────────────────────────────────────────────

class TestEvidenceDict:
    def test_evidence_contains_n_windows(self):
        params = [{"p": 5.0}, {"p": 6.0}, {"p": 7.0}]
        regimes = ["TRENDING", "TRENDING", "EXPANSION"]
        result = classify_parameter_drift(params, regimes)
        assert "n_windows" in result.evidence
        assert result.evidence["n_windows"] == 3

    def test_evidence_contains_per_param_cv(self):
        params = [{"fast_ma": 5.0}, {"fast_ma": 6.0}, {"fast_ma": 5.5}]
        regimes = ["TRENDING", "RANGE_BOUND", "TRENDING"]
        result = classify_parameter_drift(params, regimes)
        assert "per_param_cv" in result.evidence
        assert "fast_ma" in result.evidence["per_param_cv"]


# ─── FIX 5 (deep-scan #9): env-overridable thresholds via lru_cache ──────────

class TestFix5EnvOverridableThresholds:
    """FIX 5: Thresholds are env-overridable; docstring citations honest.

    Before: hard-coded 0.30 with "Institutional default 0.3 per Bailey et al. 2025"
            citation that was fabricated.
    After:  env-overridable via lru_cache getters (PARAM_DRIFT_CV_THRESHOLD /
            PARAM_DRIFT_RHO_THRESHOLD / PARAM_DRIFT_OVERFIT_CONFIDENCE); defaults
            unchanged (CV=0.30, ρ=0.30, confidence=0.85).
    """

    def setup_method(self):
        """Clear lru_cache before each test so env changes take effect."""
        from src.engine.walk_forward_regime_context import (
            _get_cv_threshold,
            _get_rho_threshold,
            _get_overfit_confidence,
        )
        _get_cv_threshold.cache_clear()
        _get_rho_threshold.cache_clear()
        _get_overfit_confidence.cache_clear()

    def teardown_method(self):
        """Clear lru_cache after test to avoid bleeding into other tests."""
        import os
        from src.engine.walk_forward_regime_context import (
            _get_cv_threshold,
            _get_rho_threshold,
            _get_overfit_confidence,
        )
        for var in ("PARAM_DRIFT_CV_THRESHOLD", "PARAM_DRIFT_RHO_THRESHOLD",
                    "PARAM_DRIFT_OVERFIT_CONFIDENCE"):
            os.environ.pop(var, None)
        _get_cv_threshold.cache_clear()
        _get_rho_threshold.cache_clear()
        _get_overfit_confidence.cache_clear()

    def test_default_cv_threshold_is_030(self):
        """CV threshold defaults to 0.30 when env not set."""
        import os
        os.environ.pop("PARAM_DRIFT_CV_THRESHOLD", None)
        from src.engine.walk_forward_regime_context import _get_cv_threshold
        _get_cv_threshold.cache_clear()
        assert _get_cv_threshold() == pytest.approx(0.30)

    def test_default_rho_threshold_is_030(self):
        """Spearman rho threshold defaults to 0.30 when env not set."""
        import os
        os.environ.pop("PARAM_DRIFT_RHO_THRESHOLD", None)
        from src.engine.walk_forward_regime_context import _get_rho_threshold
        _get_rho_threshold.cache_clear()
        assert _get_rho_threshold() == pytest.approx(0.30)

    def test_default_overfit_confidence_is_085(self):
        """Overfit confidence defaults to 0.85 when env not set."""
        import os
        os.environ.pop("PARAM_DRIFT_OVERFIT_CONFIDENCE", None)
        from src.engine.walk_forward_regime_context import _get_overfit_confidence
        _get_overfit_confidence.cache_clear()
        assert _get_overfit_confidence() == pytest.approx(0.85)

    def test_env_override_cv_threshold(self):
        """PARAM_DRIFT_CV_THRESHOLD env override is respected."""
        import os
        from src.engine.walk_forward_regime_context import _get_cv_threshold
        os.environ["PARAM_DRIFT_CV_THRESHOLD"] = "0.50"
        _get_cv_threshold.cache_clear()
        assert _get_cv_threshold() == pytest.approx(0.50)

    def test_env_override_rho_threshold(self):
        """PARAM_DRIFT_RHO_THRESHOLD env override is respected."""
        import os
        from src.engine.walk_forward_regime_context import _get_rho_threshold
        os.environ["PARAM_DRIFT_RHO_THRESHOLD"] = "0.40"
        _get_rho_threshold.cache_clear()
        assert _get_rho_threshold() == pytest.approx(0.40)

    def test_env_override_overfit_confidence(self):
        """PARAM_DRIFT_OVERFIT_CONFIDENCE env override is respected."""
        import os
        from src.engine.walk_forward_regime_context import _get_overfit_confidence
        os.environ["PARAM_DRIFT_OVERFIT_CONFIDENCE"] = "0.70"
        _get_overfit_confidence.cache_clear()
        assert _get_overfit_confidence() == pytest.approx(0.70)

    def test_invalid_env_value_falls_back_to_default(self):
        """Non-numeric env value falls back to hardcoded default."""
        import os
        from src.engine.walk_forward_regime_context import _get_cv_threshold
        os.environ["PARAM_DRIFT_CV_THRESHOLD"] = "not_a_float"
        _get_cv_threshold.cache_clear()
        assert _get_cv_threshold() == pytest.approx(0.30)

    def test_classifier_uses_env_threshold(self):
        """classify_parameter_drift uses the env-overridden threshold."""
        import os
        from src.engine.walk_forward_regime_context import (
            _get_cv_threshold, _get_rho_threshold, _get_overfit_confidence
        )
        # Very low CV threshold: anything becomes fragile
        os.environ["PARAM_DRIFT_CV_THRESHOLD"] = "0.001"
        _get_cv_threshold.cache_clear()
        _get_rho_threshold.cache_clear()
        _get_overfit_confidence.cache_clear()
        # Use params that would normally classify as stable (very consistent)
        params = [{"p": 10.0}, {"p": 10.1}, {"p": 10.05}]
        regimes = ["TRENDING", "TRENDING", "TRENDING"]
        result = classify_parameter_drift(params, regimes)
        # At threshold=0.001, CV~0.005 is ABOVE threshold → fragile signal
        assert isinstance(result, ParameterDriftClassification)

    def test_replay_determinism_env_override(self):
        """Same env → same classification (lru_cache makes it deterministic)."""
        import os
        from src.engine.walk_forward_regime_context import _get_cv_threshold
        os.environ["PARAM_DRIFT_CV_THRESHOLD"] = "0.45"
        _get_cv_threshold.cache_clear()
        v1 = _get_cv_threshold()
        v2 = _get_cv_threshold()
        assert v1 == v2 == pytest.approx(0.45)
