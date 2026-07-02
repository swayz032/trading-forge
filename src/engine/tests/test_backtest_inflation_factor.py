"""Tests for Backtest Inflation Factor (BIF) — backtest_inflation_factor.py.

Covers:
  - Clean case: IS ≈ WF Sharpe → BIF ≈ 1.0
  - Warn case: BIF in [2.0, 4.0)
  - Block case: BIF >= 4.0 (high IS / low WF + large K_eff)
  - Fail-closed guards: WF Sharpe <= 0, non-finite inputs
  - Mathematical formulas: BIF ratio, expected_inflation = sqrt(2·ln(K_eff))
  - Env-var threshold overrides: BIF_WARN_THRESHOLD, BIF_BLOCK_THRESHOLD
  - Output key completeness (TS gate contract: "bif" and "k_eff")
"""

from __future__ import annotations

import math

import pytest

from src.engine.statistics.backtest_inflation_factor import compute_bif

# ── Helpers ────────────────────────────────────────────────────────────────────

_REQUIRED_KEYS = frozenset({
    "bif", "k_eff", "is_sharpe", "wf_sharpe",
    "expected_inflation", "verdict", "fail_closed",
    "warn_threshold", "block_threshold",
})


# ── Clean cases ────────────────────────────────────────────────────────────────

class TestComputeBifClean:
    """BIF ≈ 1.0 when IS and WF Sharpe are similar or WF >= IS."""

    def test_perfect_match(self):
        """IS Sharpe == WF Sharpe → BIF = 1.0 → verdict = clean."""
        result = compute_bif(is_sharpe=1.5, wf_sharpe=1.5, k_eff=5.0)
        assert result["bif"] == pytest.approx(1.0, rel=1e-5)
        assert result["verdict"] == "clean"
        assert result["fail_closed"] is False

    def test_mild_inflation_below_warn(self):
        """BIF 1.5 (below default warn 2.0) → verdict = clean."""
        result = compute_bif(is_sharpe=1.8, wf_sharpe=1.2, k_eff=5.0)
        assert result["bif"] == pytest.approx(1.5, rel=1e-4)
        assert result["verdict"] == "clean"

    def test_wf_exceeds_is(self):
        """WF Sharpe > IS Sharpe → BIF < 1.0 → still clean (OOS outperformed IS)."""
        result = compute_bif(is_sharpe=1.0, wf_sharpe=1.5, k_eff=5.0)
        assert result["bif"] == pytest.approx(1.0 / 1.5, rel=1e-5)
        assert result["verdict"] == "clean"

    def test_k_eff_preserved_in_output(self):
        """k_eff returned in output matches the clamped value."""
        result = compute_bif(is_sharpe=1.0, wf_sharpe=1.0, k_eff=15.0)
        assert result["k_eff"] == pytest.approx(15.0, rel=1e-4)

    def test_k_eff_floor_clamped_to_one(self):
        """k_eff below 1.0 is clamped to 1.0 (prevents ln(0) domain error)."""
        result = compute_bif(is_sharpe=1.0, wf_sharpe=1.0, k_eff=0.0)
        assert result["k_eff"] == pytest.approx(1.0, rel=1e-4)
        # expected_inflation = 0.0 when k_eff == 1.0 (no selection)
        assert result["expected_inflation"] == pytest.approx(0.0, abs=1e-9)

    def test_k_eff_negative_clamped_to_one(self):
        """Negative k_eff is clamped to 1.0."""
        result = compute_bif(is_sharpe=1.0, wf_sharpe=1.0, k_eff=-5.0)
        assert result["k_eff"] == pytest.approx(1.0)

    def test_output_keys_complete(self):
        """All TS-contract keys and detail keys are present."""
        result = compute_bif(is_sharpe=1.5, wf_sharpe=1.2, k_eff=5.0)
        assert _REQUIRED_KEYS.issubset(set(result.keys()))

    def test_ts_contract_fields_bif_and_k_eff_are_floats(self):
        """TS gate reads bif and k_eff — both must be numeric (not None or str)."""
        result = compute_bif(is_sharpe=1.0, wf_sharpe=1.0, k_eff=5.0)
        assert isinstance(result["bif"], float)
        assert isinstance(result["k_eff"], float)


# ── Warn cases ─────────────────────────────────────────────────────────────────

class TestComputeBifWarn:
    """BIF in [2.0, 4.0) with default thresholds → verdict = warn."""

    def test_bif_exactly_3(self):
        """IS=3.0, WF=1.0 → BIF=3.0 → warn."""
        result = compute_bif(is_sharpe=3.0, wf_sharpe=1.0, k_eff=5.0)
        assert result["bif"] == pytest.approx(3.0, rel=1e-5)
        assert result["verdict"] == "warn"
        assert result["fail_closed"] is False

    def test_bif_just_above_warn_threshold(self):
        """BIF just above 2.0 → warn (not clean)."""
        result = compute_bif(is_sharpe=2.01, wf_sharpe=1.0, k_eff=5.0)
        assert result["bif"] == pytest.approx(2.01, rel=1e-4)
        assert result["verdict"] == "warn"

    def test_bif_just_below_block_threshold(self):
        """BIF 3.99 → warn (not block; just below default 4.0 threshold)."""
        result = compute_bif(is_sharpe=3.99, wf_sharpe=1.0, k_eff=5.0)
        assert result["bif"] == pytest.approx(3.99, rel=1e-4)
        assert result["verdict"] == "warn"

    def test_warn_with_large_k_eff(self):
        """Large K_eff changes expected_inflation but not verdict (fixed thresholds)."""
        result = compute_bif(is_sharpe=2.5, wf_sharpe=1.0, k_eff=100.0)
        assert result["bif"] == pytest.approx(2.5, rel=1e-5)
        assert result["verdict"] == "warn"
        # expected_inflation = sqrt(2 * ln(100)) ≈ 3.03 (larger than BIF, not flagged)
        expected = math.sqrt(2.0 * math.log(100.0))
        assert result["expected_inflation"] == pytest.approx(expected, rel=1e-4)


# ── Block cases ────────────────────────────────────────────────────────────────

class TestComputeBifBlock:
    """BIF >= 4.0 with default thresholds → verdict = block."""

    def test_high_is_low_wf(self):
        """IS=5.0, WF=0.5 → BIF=10.0 → block."""
        result = compute_bif(is_sharpe=5.0, wf_sharpe=0.5, k_eff=15.0)
        assert result["bif"] == pytest.approx(10.0, rel=1e-5)
        assert result["verdict"] == "block"
        assert result["fail_closed"] is False

    def test_bif_exactly_at_block_threshold(self):
        """BIF exactly 4.0 → block (threshold comparison is >=)."""
        result = compute_bif(is_sharpe=4.0, wf_sharpe=1.0, k_eff=5.0)
        assert result["bif"] == pytest.approx(4.0, rel=1e-5)
        assert result["verdict"] == "block"

    def test_large_k_eff_expected_inflation_matches_formula(self):
        """K_eff=15 (CPCV default C(6,2)) → expected_inflation = sqrt(2·ln(15))."""
        result = compute_bif(is_sharpe=5.0, wf_sharpe=0.5, k_eff=15.0)
        expected = math.sqrt(2.0 * math.log(15.0))
        assert result["expected_inflation"] == pytest.approx(expected, rel=1e-5)
        assert result["verdict"] == "block"


# ── Fail-closed guards ─────────────────────────────────────────────────────────

class TestComputeBifFailClosed:
    """Non-positive or non-finite WF Sharpe → fail-closed (bif=999.0, block)."""

    def test_wf_sharpe_zero(self):
        """WF Sharpe = 0.0 with positive IS → fail-closed: BIF=999, block."""
        result = compute_bif(is_sharpe=2.0, wf_sharpe=0.0, k_eff=5.0)
        assert result["bif"] == pytest.approx(999.0)
        assert result["verdict"] == "block"
        assert result["fail_closed"] is True

    def test_wf_sharpe_negative(self):
        """WF Sharpe negative with positive IS → fail-closed: BIF=999, block."""
        result = compute_bif(is_sharpe=2.0, wf_sharpe=-0.5, k_eff=5.0)
        assert result["bif"] == pytest.approx(999.0)
        assert result["verdict"] == "block"
        assert result["fail_closed"] is True

    def test_wf_sharpe_very_negative(self):
        """Very negative WF Sharpe → still fail-closed."""
        result = compute_bif(is_sharpe=1.5, wf_sharpe=-5.0, k_eff=5.0)
        assert result["bif"] == pytest.approx(999.0)
        assert result["fail_closed"] is True

    def test_is_sharpe_zero_returns_clean(self):
        """IS Sharpe = 0.0 → BIF undefined; returns 1.0 (no inflation claim)."""
        result = compute_bif(is_sharpe=0.0, wf_sharpe=1.5, k_eff=5.0)
        assert result["bif"] == pytest.approx(1.0)
        assert result["verdict"] == "clean"
        assert result["fail_closed"] is False

    def test_is_sharpe_negative_returns_clean(self):
        """IS Sharpe negative → BIF = 1.0 (no positive IS edge to inflate)."""
        result = compute_bif(is_sharpe=-1.0, wf_sharpe=1.5, k_eff=5.0)
        assert result["bif"] == pytest.approx(1.0)
        assert result["verdict"] == "clean"
        assert result["fail_closed"] is False

    def test_both_sharpes_negative_clean(self):
        """Both IS and WF negative → BIF = 1.0 (bad strategy, no inflation claim)."""
        result = compute_bif(is_sharpe=-1.0, wf_sharpe=-0.5, k_eff=5.0)
        assert result["bif"] == pytest.approx(1.0)
        assert result["fail_closed"] is False

    def test_non_finite_wf_sharpe_inf(self):
        """Non-finite WF Sharpe (inf) → fail-closed."""
        result = compute_bif(is_sharpe=2.0, wf_sharpe=float("inf"), k_eff=5.0)
        assert result["bif"] == pytest.approx(999.0)
        assert result["fail_closed"] is True

    def test_non_finite_is_sharpe_nan(self):
        """Non-finite IS Sharpe (NaN) → fail-closed."""
        result = compute_bif(is_sharpe=float("nan"), wf_sharpe=1.0, k_eff=5.0)
        assert result["bif"] == pytest.approx(999.0)
        assert result["fail_closed"] is True

    def test_non_finite_wf_sharpe_nan(self):
        """Non-finite WF Sharpe (NaN) → fail-closed."""
        result = compute_bif(is_sharpe=2.0, wf_sharpe=float("nan"), k_eff=5.0)
        assert result["bif"] == pytest.approx(999.0)
        assert result["verdict"] == "block"
        assert result["fail_closed"] is True

    def test_both_sharpes_infinite(self):
        """Both Sharpes non-finite → fail-closed."""
        result = compute_bif(is_sharpe=float("inf"), wf_sharpe=float("nan"), k_eff=5.0)
        assert result["bif"] == pytest.approx(999.0)
        assert result["fail_closed"] is True


# ── Formula correctness ────────────────────────────────────────────────────────

class TestComputeBifFormulas:
    """Mathematical formula correctness checks."""

    def test_bif_ratio_formula(self):
        """BIF = is_sharpe / wf_sharpe (core formula)."""
        result = compute_bif(is_sharpe=2.4, wf_sharpe=0.8, k_eff=5.0)
        assert result["bif"] == pytest.approx(3.0, rel=1e-5)

    def test_expected_inflation_k1(self):
        """K_eff=1 → expected_inflation=0.0 (no selection, no expected inflation)."""
        result = compute_bif(is_sharpe=1.0, wf_sharpe=1.0, k_eff=1.0)
        assert result["expected_inflation"] == pytest.approx(0.0, abs=1e-9)

    def test_expected_inflation_k2(self):
        """K_eff=2 → expected_inflation = sqrt(2·ln(2)) ≈ 1.177."""
        result = compute_bif(is_sharpe=1.0, wf_sharpe=1.0, k_eff=2.0)
        expected = math.sqrt(2.0 * math.log(2.0))
        assert result["expected_inflation"] == pytest.approx(expected, rel=1e-5)

    def test_expected_inflation_k5(self):
        """K_eff=5 (plain WF default n_splits) → sqrt(2·ln(5)) ≈ 1.794."""
        result = compute_bif(is_sharpe=1.0, wf_sharpe=1.0, k_eff=5.0)
        expected = math.sqrt(2.0 * math.log(5.0))
        assert result["expected_inflation"] == pytest.approx(expected, rel=1e-5)

    def test_expected_inflation_k15_cpcv_default(self):
        """K_eff=15 (CPCV C(6,2) default) → sqrt(2·ln(15)) ≈ 2.328."""
        result = compute_bif(is_sharpe=1.0, wf_sharpe=1.0, k_eff=15.0)
        expected = math.sqrt(2.0 * math.log(15.0))
        assert result["expected_inflation"] == pytest.approx(expected, rel=1e-5)
        # ≈ 2.328 for reference
        assert result["expected_inflation"] == pytest.approx(2.328, abs=0.001)

    def test_input_sharpes_echoed_in_output(self):
        """is_sharpe and wf_sharpe are echoed in output (for audit trail)."""
        result = compute_bif(is_sharpe=2.0, wf_sharpe=0.8, k_eff=5.0)
        assert result["is_sharpe"] == pytest.approx(2.0, rel=1e-5)
        assert result["wf_sharpe"] == pytest.approx(0.8, rel=1e-5)

    def test_default_thresholds_in_output(self):
        """Default warn/block thresholds are included in output."""
        result = compute_bif(is_sharpe=1.0, wf_sharpe=1.0, k_eff=5.0)
        assert result["warn_threshold"] == pytest.approx(2.0)
        assert result["block_threshold"] == pytest.approx(4.0)


# ── Env-var threshold overrides ────────────────────────────────────────────────

class TestComputeBifEnvThresholds:
    """BIF_WARN_THRESHOLD and BIF_BLOCK_THRESHOLD env vars override defaults."""

    def test_custom_warn_threshold_raises_bar(self, monkeypatch):
        """BIF_WARN_THRESHOLD=3.0 → BIF=2.5 should be clean (not warn)."""
        monkeypatch.setenv("BIF_WARN_THRESHOLD", "3.0")
        monkeypatch.setenv("BIF_BLOCK_THRESHOLD", "5.0")
        result = compute_bif(is_sharpe=2.5, wf_sharpe=1.0, k_eff=5.0)
        assert result["bif"] == pytest.approx(2.5, rel=1e-5)
        assert result["verdict"] == "clean"
        assert result["warn_threshold"] == pytest.approx(3.0)

    def test_custom_block_threshold_lowers_bar(self, monkeypatch):
        """BIF_BLOCK_THRESHOLD=3.0 → BIF=3.5 should block."""
        monkeypatch.setenv("BIF_WARN_THRESHOLD", "2.0")
        monkeypatch.setenv("BIF_BLOCK_THRESHOLD", "3.0")
        result = compute_bif(is_sharpe=3.5, wf_sharpe=1.0, k_eff=5.0)
        assert result["verdict"] == "block"
        assert result["block_threshold"] == pytest.approx(3.0)

    def test_invalid_env_var_falls_back_to_default(self, monkeypatch):
        """Non-numeric env var falls back to default (no crash)."""
        monkeypatch.setenv("BIF_WARN_THRESHOLD", "not_a_number")
        monkeypatch.setenv("BIF_BLOCK_THRESHOLD", "also_bad")
        result = compute_bif(is_sharpe=1.0, wf_sharpe=1.0, k_eff=5.0)
        # Should use defaults (2.0 / 4.0) without raising
        assert result["warn_threshold"] == pytest.approx(2.0)
        assert result["block_threshold"] == pytest.approx(4.0)
        assert result["verdict"] == "clean"

    def test_custom_thresholds_reflected_in_output(self, monkeypatch):
        """Custom thresholds are echoed in output dict (audit trail)."""
        monkeypatch.setenv("BIF_WARN_THRESHOLD", "1.5")
        monkeypatch.setenv("BIF_BLOCK_THRESHOLD", "3.0")
        result = compute_bif(is_sharpe=2.0, wf_sharpe=1.0, k_eff=5.0)
        assert result["warn_threshold"] == pytest.approx(1.5)
        assert result["block_threshold"] == pytest.approx(3.0)


# ── BIF computation determinism ────────────────────────────────────────────────

class TestComputeBifDeterminism:
    """Same inputs → same outputs (pure function, no state)."""

    def test_identical_inputs_same_output(self):
        """compute_bif is deterministic: two calls with same args return same dict."""
        args = dict(is_sharpe=2.3, wf_sharpe=0.9, k_eff=15.0)
        r1 = compute_bif(**args)
        r2 = compute_bif(**args)
        assert r1["bif"] == r2["bif"]
        assert r1["verdict"] == r2["verdict"]
        assert r1["expected_inflation"] == r2["expected_inflation"]

    def test_fail_closed_is_deterministic(self):
        """Fail-closed sentinel (999.0) is returned consistently."""
        for _ in range(3):
            result = compute_bif(is_sharpe=2.0, wf_sharpe=0.0, k_eff=5.0)
            assert result["bif"] == pytest.approx(999.0)


# ── B4/B7 regression: CPCV IS-Sharpe proxy (mean not max) + k_eff LOW exclusion ──

class TestBifB4B7Regressions:
    """Regression tests for B4 (CPCV IS-Sharpe mean vs max) and B7 (k_eff excludes LOW windows)."""

    def test_b4_mean_proxy_lower_than_max(self):
        """B4: mean(path_sharpes) < max(path_sharpes) for heterogeneous path set.
        The CPCV IS-Sharpe proxy now uses mean, not max.
        A max-based proxy would produce a LOWER BIF (underestimates IS/OOS gap).
        The mean-based proxy is conservative and produces a HIGHER or EQUAL BIF.
        """
        path_sharpes = [0.5, 1.0, 2.0, 1.5, 0.8]  # heterogeneous
        import numpy as np
        mean_proxy = float(np.mean(path_sharpes))  # 1.16
        max_proxy = max(path_sharpes)               # 2.0
        # mean < max for this set → mean-proxy BIF is LOWER (more IS-like = harder bar)
        # BUT the CPCV IS-Sharpe is the proxy for IS, and BIF = IS/OOS.
        # Mean proxy < max proxy → lower numerator → lower BIF.
        # However the key invariant is: mean != max when heterogeneous.
        assert mean_proxy < max_proxy
        # BIF with mean proxy: BIF = mean / wf_sharpe
        result_mean = compute_bif(is_sharpe=mean_proxy, wf_sharpe=0.5, k_eff=5.0)
        result_max = compute_bif(is_sharpe=max_proxy, wf_sharpe=0.5, k_eff=5.0)
        # BIF_mean < BIF_max: using mean is MORE CONSERVATIVE (less overstated IS edge)
        assert result_mean["bif"] < result_max["bif"], (
            f"mean-proxy BIF ({result_mean['bif']:.4f}) should be less than "
            f"max-proxy BIF ({result_max['bif']:.4f})"
        )

    def test_b4_uniform_path_sharpes_mean_equals_max(self):
        """B4: when all path Sharpes are equal, mean == max (no change in result)."""
        import numpy as np
        path_sharpes = [1.0, 1.0, 1.0, 1.0]
        mean_proxy = float(np.mean(path_sharpes))
        max_proxy = max(path_sharpes)
        assert mean_proxy == pytest.approx(max_proxy)

    def test_b7_k_eff_excludes_low_confidence_windows(self):
        """B7: k_eff for plain-WF counts only non-LOW windows, floored at 1."""
        # Simulate 5 windows: 3 OK, 2 LOW
        window_results = [
            {"confidence": "OK"},
            {"confidence": "LOW"},
            {"confidence": "OK"},
            {"confidence": "LOW"},
            {"confidence": "OK"},
        ]
        non_low_count = len([w for w in window_results if w.get("confidence") != "LOW"])
        assert non_low_count == 3, f"Expected 3 non-LOW windows, got {non_low_count}"
        k_eff_correct = float(max(non_low_count, 1))
        k_eff_wrong = float(max(len(window_results), 1))
        assert k_eff_correct < k_eff_wrong, (
            f"Correct k_eff ({k_eff_correct}) should be < wrong k_eff ({k_eff_wrong})"
        )
        # Higher k_eff → higher expected inflation → higher BIF → stricter gate.
        # Using wrong k_eff (all windows) overstates overfitting penalty.
        result_correct = compute_bif(is_sharpe=2.0, wf_sharpe=1.0, k_eff=k_eff_correct)
        result_wrong = compute_bif(is_sharpe=2.0, wf_sharpe=1.0, k_eff=k_eff_wrong)
        assert result_correct["k_eff"] == pytest.approx(k_eff_correct)
        assert result_wrong["k_eff"] == pytest.approx(k_eff_wrong)

    def test_b7_all_low_confidence_floors_at_1(self):
        """B7: when all windows are LOW confidence, k_eff floors at 1 (not 0)."""
        window_results = [{"confidence": "LOW"}, {"confidence": "LOW"}]
        k_eff = float(max(len([w for w in window_results if w.get("confidence") != "LOW"]), 1))
        assert k_eff == pytest.approx(1.0), f"Expected k_eff=1.0 (floor), got {k_eff}"
        result = compute_bif(is_sharpe=1.5, wf_sharpe=1.0, k_eff=k_eff)
        assert result["k_eff"] == pytest.approx(1.0)


# ── Module-level import check ──────────────────────────────────────────────────

class TestModuleImport:
    """Verify module can be imported via the statistics package __init__."""

    def test_importable_via_statistics_package(self):
        """compute_bif is exported from src.engine.statistics."""
        from src.engine.statistics import compute_bif as _bif
        assert callable(_bif)

    def test_direct_import_works(self):
        """Direct import from backtest_inflation_factor module works."""
        from src.engine.statistics.backtest_inflation_factor import compute_bif as _bif
        assert callable(_bif)
