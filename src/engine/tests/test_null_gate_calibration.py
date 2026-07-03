"""Tests for the null-strategy gate calibration harness (Layer 4, item 2).

Coverage:
  1. Null generator determinism: same (index, seed) → same spec
  2. Structural validity: every generated spec passes BacktestRequest.model_validate()
  3. Binomial CI math: wilson_ci() correct known-answer tests
  4. Marker guard: null runs CANNOT persist without null_calibration=True marker
  5. Smoke path: run_battery_for_null() completes on synthetic data (no S3)
  6. Calibration report math: compute_calibration_report() produces valid noise floor
"""

from __future__ import annotations

import math
import os

import pytest

# ─── Env setup ───────────────────────────────────────────────────────────────
# Must be set before any config.py / BacktestRequest import
os.environ.setdefault("TF_ALLOW_FIXED_1", "true")


# ─── 1. Generator determinism ────────────────────────────────────────────────

class TestNullGeneratorDeterminism:
    """Same (index, seed) always produces the same spec."""

    def test_same_seed_same_spec(self):
        from scripts.generate_null_strategies import generate_null_spec

        spec_a = generate_null_spec(strategy_index=0, seed=42)
        spec_b = generate_null_spec(strategy_index=0, seed=42)

        # Strip meta (contains timestamps only if we add them; currently static)
        clean_a = {k: v for k, v in spec_a.items() if not k.startswith("_")}
        clean_b = {k: v for k, v in spec_b.items() if not k.startswith("_")}
        assert clean_a == clean_b

    def test_different_seed_different_spec(self):
        from scripts.generate_null_strategies import generate_null_spec

        spec_a = generate_null_spec(strategy_index=0, seed=42)
        spec_b = generate_null_spec(strategy_index=0, seed=99)

        # Different seeds should produce different strategy names at minimum
        name_a = spec_a["strategy"]["name"]
        name_b = spec_b["strategy"]["name"]
        assert name_a != name_b

    def test_different_index_different_spec(self):
        from scripts.generate_null_strategies import generate_null_spec

        spec_0 = generate_null_spec(strategy_index=0, seed=42)
        spec_1 = generate_null_spec(strategy_index=1, seed=42)

        name_0 = spec_0["strategy"]["name"]
        name_1 = spec_1["strategy"]["name"]
        assert name_0 != name_1

    def test_generate_n_deterministic(self):
        from scripts.generate_null_strategies import generate_null_specs

        specs_a = generate_null_specs(n=5, seed=42)
        specs_b = generate_null_specs(n=5, seed=42)

        names_a = [s["strategy"]["name"] for s in specs_a]
        names_b = [s["strategy"]["name"] for s in specs_b]
        assert names_a == names_b

    def test_index_embedded_in_meta(self):
        from scripts.generate_null_strategies import generate_null_spec

        for idx in range(5):
            spec = generate_null_spec(strategy_index=idx, seed=42)
            meta = spec.get("_null_calibration_meta", {})
            assert meta.get("strategy_index") == idx
            assert meta.get("null_seed") == 42


# ─── 2. Structural validity ──────────────────────────────────────────────────

class TestStructuralValidity:
    """Every generated spec passes BacktestRequest.model_validate()."""

    def test_single_spec_validates(self):
        from scripts.generate_null_strategies import generate_null_spec, validate_spec

        spec = generate_null_spec(strategy_index=0, seed=42, smoke=True)
        ok, err = validate_spec(spec, allow_fixed_1=True)
        assert ok, f"Spec validation failed: {err}"

    def test_batch_all_validate(self):
        from scripts.generate_null_strategies import generate_null_specs, validate_spec

        specs = generate_null_specs(n=15, seed=42, smoke=True)
        errors = []
        for i, spec in enumerate(specs):
            ok, err = validate_spec(spec, allow_fixed_1=True)
            if not ok:
                errors.append(f"spec {i}: {err}")
        assert not errors, "Validation errors:\n" + "\n".join(errors)

    def test_symbol_in_valid_set(self):
        from scripts.generate_null_strategies import _SYMBOL_POOL, generate_null_specs

        specs = generate_null_specs(n=len(_SYMBOL_POOL) * 3, seed=42, smoke=True)
        for spec in specs:
            assert spec["strategy"]["symbol"] in _SYMBOL_POOL

    def test_firm_key_is_topstep(self):
        from scripts.generate_null_strategies import generate_null_specs

        specs = generate_null_specs(n=5, seed=42, smoke=True)
        for spec in specs:
            assert spec["firm_key"] == "topstep_50k"

    def test_exit_engine_is_static_style_c(self):
        from scripts.generate_null_strategies import generate_null_specs

        specs = generate_null_specs(n=5, seed=42, smoke=True)
        for spec in specs:
            assert spec["exit_engine"] == "static_styleC"

    def test_overnight_hold_is_false(self):
        from scripts.generate_null_strategies import generate_null_specs

        specs = generate_null_specs(n=5, seed=42, smoke=True)
        for spec in specs:
            assert spec["strategy"]["overnight_hold"] is False

    def test_max_trades_per_day_is_one(self):
        from scripts.generate_null_strategies import generate_null_specs

        specs = generate_null_specs(n=5, seed=42, smoke=True)
        for spec in specs:
            assert spec["max_trades_per_day"] == 1

    def test_null_calibration_meta_present(self):
        from scripts.generate_null_strategies import generate_null_specs

        specs = generate_null_specs(n=5, seed=42, smoke=True)
        for spec in specs:
            meta = spec.get("_null_calibration_meta", {})
            assert meta.get("null_calibration") is True
            assert "null_seed" in meta
            assert "strategy_index" in meta

    def test_no_indicators_needed_for_entry_expressions(self):
        """Entry expressions 'close > open' / 'open > close' need no indicators."""
        from scripts.generate_null_strategies import generate_null_specs

        specs = generate_null_specs(n=10, seed=42, smoke=True)
        for spec in specs:
            # Verify indicators can be empty (the entry expressions don't reference
            # computed column names)
            indicators = spec["strategy"]["indicators"]
            assert isinstance(indicators, list)
            # For specs using 'close > open' style entries, no indicators are needed
            entry_long = spec["strategy"]["entry_long"]
            entry_short = spec["strategy"]["entry_short"]
            # Ensure expressions only reference raw OHLCV columns
            ohlcv_cols = {"open", "high", "low", "close", "volume"}
            tokens = set(entry_long.split() + entry_short.split())
            non_ops = {t for t in tokens if t not in (">", "<", ">=", "<=", "==", "!=", "AND", "OR", "NOT")}
            try:
                floats = {float(t) for t in non_ops}
            except ValueError:
                floats = set()
            col_refs = non_ops - {str(f) for f in floats}
            assert col_refs.issubset(ohlcv_cols), (
                f"Entry expressions reference non-OHLCV columns: {col_refs - ohlcv_cols}. "
                f"Must add corresponding indicators."
            )


# ─── 3. Binomial CI math ─────────────────────────────────────────────────────

class TestWilsonCI:
    """Known-answer tests for the Wilson score confidence interval."""

    def _ci(self, k, n, conf=0.95):
        from scripts.null_gate_calibration import wilson_ci
        return wilson_ci(k, n, conf)

    def test_zero_zero(self):
        lo, hi = self._ci(0, 0)
        assert lo == 0.0
        assert hi == 1.0

    def test_zero_successes(self):
        """0/100 → CI upper bound ≈ 3.6% at 95%."""
        lo, hi = self._ci(0, 100)
        assert lo == 0.0
        assert 0.03 < hi < 0.05, f"Expected hi ≈ 0.036, got {hi:.4f}"

    def test_all_successes(self):
        """100/100 → CI lower bound ≈ 96.4% at 95%."""
        lo, hi = self._ci(100, 100)
        # Wilson CI upper bound for k==n is numerically 1.0 but floating-point
        # precision may yield 0.9999…; use isclose rather than exact equality.
        assert math.isclose(hi, 1.0, rel_tol=1e-9), f"Expected hi ≈ 1.0, got {hi:.15f}"
        assert 0.95 < lo < 0.98, f"Expected lo ≈ 0.964, got {lo:.4f}"

    def test_half_successes(self):
        """50/100 → CI roughly [0.40, 0.60]."""
        lo, hi = self._ci(50, 100)
        assert 0.38 < lo < 0.46
        assert 0.54 < hi < 0.62

    def test_bounds_in_range(self):
        """CI bounds always in [0, 1]."""
        from scripts.null_gate_calibration import wilson_ci
        for k in (0, 1, 5, 10, 50):
            for n in (10, 50, 100, 200):
                if k > n:
                    continue
                lo, hi = wilson_ci(k, n)
                assert 0.0 <= lo <= 1.0
                assert 0.0 <= hi <= 1.0
                assert lo <= hi

    def test_width_narrows_with_n(self):
        """Wider CI at N=10 than N=100 for same observed rate."""
        lo_small, hi_small = self._ci(k=2, n=10)
        lo_large, hi_large = self._ci(k=20, n=100)
        width_small = hi_small - lo_small
        width_large = hi_large - lo_large
        assert width_small > width_large

    def test_90pct_tighter_than_95pct(self):
        """90% CI is narrower than 95% CI for same data."""
        lo_90, hi_90 = self._ci(k=5, n=50, conf=0.90)
        lo_95, hi_95 = self._ci(k=5, n=50, conf=0.95)
        assert (hi_90 - lo_90) < (hi_95 - lo_95)


# ─── 4. Marker guard ─────────────────────────────────────────────────────────

class TestNullCalibrationGuard:
    """Null runs CANNOT persist without null_calibration=True marker."""

    def test_valid_labels_pass(self):
        from src.engine.null_calibration_guard import (
            build_null_calibration_labels,
            validate_null_calibration_labels,
        )
        labels = build_null_calibration_labels(null_seed=42, strategy_index=0)
        # Should not raise
        validate_null_calibration_labels(labels)

    def test_empty_dict_rejected(self):
        from src.engine.null_calibration_guard import validate_null_calibration_labels
        with pytest.raises(ValueError, match="null_calibration"):
            validate_null_calibration_labels({})

    def test_missing_marker_rejected(self):
        from src.engine.null_calibration_guard import validate_null_calibration_labels
        with pytest.raises(ValueError, match="null_calibration"):
            validate_null_calibration_labels({"null_seed": 42})

    def test_false_marker_rejected(self):
        from src.engine.null_calibration_guard import validate_null_calibration_labels
        with pytest.raises(ValueError, match="null_calibration"):
            validate_null_calibration_labels({"null_calibration": False, "null_seed": 42})

    def test_missing_null_seed_rejected(self):
        from src.engine.null_calibration_guard import validate_null_calibration_labels
        with pytest.raises(ValueError, match="null_seed"):
            validate_null_calibration_labels({"null_calibration": True})

    def test_non_dict_rejected(self):
        from src.engine.null_calibration_guard import validate_null_calibration_labels
        with pytest.raises(ValueError, match="must be a dict"):
            validate_null_calibration_labels("null_calibration=true")

    def test_is_null_calibration_row(self):
        from src.engine.null_calibration_guard import (
            build_null_calibration_labels,
            is_null_calibration_row,
        )
        real_labels = build_null_calibration_labels(null_seed=1, strategy_index=0)
        assert is_null_calibration_row(real_labels) is True

    def test_is_not_null_calibration_row(self):
        from src.engine.null_calibration_guard import is_null_calibration_row
        assert is_null_calibration_row({"replay_mode": True}) is False
        assert is_null_calibration_row({}) is False
        assert is_null_calibration_row(None) is False

    def test_build_labels_has_required_keys(self):
        from src.engine.null_calibration_guard import build_null_calibration_labels
        labels = build_null_calibration_labels(null_seed=7, strategy_index=3)
        assert labels["null_calibration"] is True
        assert labels["null_seed"] == 7
        assert labels["strategy_index"] == 3

    def test_build_labels_extra_keys_merged(self):
        from src.engine.null_calibration_guard import build_null_calibration_labels
        labels = build_null_calibration_labels(
            null_seed=1, strategy_index=0, extra={"symbol": "MES"}
        )
        assert labels["symbol"] == "MES"

    def test_replay_mode_does_not_satisfy_null_guard(self):
        """replay_mode=True is NOT a valid null_calibration marker (different contract)."""
        from src.engine.null_calibration_guard import validate_null_calibration_labels
        with pytest.raises(ValueError):
            validate_null_calibration_labels({"replay_mode": True, "null_seed": 1})


# ─── 5. Smoke path ───────────────────────────────────────────────────────────

class TestSmokePath:
    """run_battery_for_null() completes on synthetic data without crashing."""

    @pytest.fixture
    def synthetic_data(self):
        """1 year of synthetic MES 5m data (no S3 needed)."""
        from scripts.null_gate_calibration import _make_synthetic_ohlcv
        return _make_synthetic_ohlcv(n_days=252, symbol="MES", seed=42)

    @pytest.fixture
    def null_spec(self):
        """A single null spec in smoke mode."""
        from scripts.generate_null_strategies import generate_null_spec
        return generate_null_spec(strategy_index=0, seed=42, smoke=True)

    def test_synthetic_data_shape(self, synthetic_data):
        """Synthetic data has sufficient bars for CPCV."""
        # CPCV needs min 6 folds × 60 bars = 360 bars
        assert len(synthetic_data) >= 360
        assert "ts_event" in synthetic_data.columns
        assert "open" in synthetic_data.columns
        assert "close" in synthetic_data.columns

    def test_smoke_run_completes(self, null_spec, synthetic_data):
        """Full battery run completes without exception on synthetic data."""
        from scripts.null_gate_calibration import run_battery_for_null
        result = run_battery_for_null(null_spec, synthetic_data=synthetic_data)

        assert "gate_results" in result
        assert "governance_labels" in result
        assert "elapsed_seconds" in result
        # Should not be an unhandled crash
        assert result.get("error") is None or isinstance(result.get("error"), str)

    def test_smoke_run_has_marker(self, null_spec, synthetic_data):
        """Battery run result always carries null_calibration marker in governance_labels."""
        from scripts.null_gate_calibration import run_battery_for_null
        from src.engine.null_calibration_guard import validate_null_calibration_labels

        result = run_battery_for_null(null_spec, synthetic_data=synthetic_data)
        labels = result.get("governance_labels", {})
        # The guard validates this; no exception means it passed
        validate_null_calibration_labels(labels)

    def test_smoke_run_gate_keys_present(self, null_spec, synthetic_data):
        """Battery result contains all expected gate keys."""
        from scripts.null_gate_calibration import GATE_NAMES, run_battery_for_null
        result = run_battery_for_null(null_spec, synthetic_data=synthetic_data)
        gate_results = result.get("gate_results", {})
        for gate in GATE_NAMES:
            assert gate in gate_results, f"Gate '{gate}' missing from results"
            assert gate_results[gate] in (
                "pass", "fail", "skip", "degenerate", "error"
            ), f"Gate '{gate}' has invalid value: {gate_results[gate]!r}"

    def test_multiple_smoke_nulls_complete(self, synthetic_data):
        """3 nulls with different indices all complete on same synthetic data."""
        from scripts.generate_null_strategies import generate_null_spec
        from scripts.null_gate_calibration import run_battery_for_null

        for idx in range(3):
            spec = generate_null_spec(strategy_index=idx, seed=42, smoke=True)
            result = run_battery_for_null(spec, synthetic_data=synthetic_data)
            assert "gate_results" in result
            labels = result.get("governance_labels", {})
            assert labels.get("null_calibration") is True
            assert labels.get("null_seed") == 42


# ─── 6. Calibration report math ──────────────────────────────────────────────

class TestCalibrationReport:
    """compute_calibration_report() produces valid noise floor math."""

    def _make_mock_results(self, n: int, passes_per_gate: dict[str, int]) -> list[dict]:
        """Build mock null run results with controlled gate outcomes."""
        from scripts.null_gate_calibration import GATE_NAMES
        results = []
        _gate_order = list(passes_per_gate.keys())  # noqa: F841

        for i in range(n):
            gate_results = {}
            for gate in GATE_NAMES:
                if gate not in passes_per_gate:
                    gate_results[gate] = "skip"
                elif i < passes_per_gate[gate]:
                    gate_results[gate] = "pass"
                else:
                    gate_results[gate] = "fail"
            results.append({
                "gate_results": gate_results,
                "full_battery_pass": gate_results.get("full_battery") == "pass",
                "b14_pass": None,
                "null_meta": {"strategy_index": i, "null_seed": 42},
                "governance_labels": {"null_calibration": True, "null_seed": 42},
                "elapsed_seconds": 1.0,
                "error": None,
            })
        return results

    def test_zero_passes_gives_zero_rate(self):
        from scripts.null_gate_calibration import compute_calibration_report

        results = self._make_mock_results(
            n=10,
            passes_per_gate={"full_battery": 0},
        )
        report = compute_calibration_report(results, n_population=200)
        fb = report["per_gate"]["full_battery"]
        assert fb["passes"] == 0
        assert fb["rate"] == 0.0
        assert fb["trials"] == 10

    def test_all_passes_gives_rate_one(self):
        from scripts.null_gate_calibration import compute_calibration_report

        results = self._make_mock_results(
            n=10,
            passes_per_gate={"full_battery": 10},
        )
        report = compute_calibration_report(results, n_population=200)
        fb = report["per_gate"]["full_battery"]
        assert fb["passes"] == 10
        assert fb["rate"] == 1.0

    def test_noise_floor_projection_math(self):
        """Expected chance passes = rate × population."""
        from scripts.null_gate_calibration import compute_calibration_report

        # 5 out of 100 pass full battery → 5% rate → 200 × 0.05 = 10 expected
        results = self._make_mock_results(
            n=100,
            passes_per_gate={"full_battery": 5},
        )
        report = compute_calibration_report(results, n_population=200)
        fb = report["per_gate"]["full_battery"]
        proj = fb["noise_floor_projection"]
        assert proj["population"] == 200
        assert abs(proj["expected_chance_passes"] - 10.0) < 0.5

    def test_degenerate_excluded_from_trials(self):
        """Degenerate results are not counted as trials."""
        from scripts.null_gate_calibration import GATE_NAMES, compute_calibration_report

        results = []
        for i in range(10):
            gr = {g: "pass" for g in GATE_NAMES}
            gr["pbo"] = "degenerate"  # mark PBO as degenerate for all
            results.append({
                "gate_results": gr,
                "full_battery_pass": False,
                "b14_pass": None,
                "null_meta": {"strategy_index": i, "null_seed": 42},
                "governance_labels": {"null_calibration": True, "null_seed": 42},
                "elapsed_seconds": 1.0,
                "error": None,
            })

        report = compute_calibration_report(results)
        pbo_stats = report["per_gate"]["pbo"]
        assert pbo_stats["trials"] == 0  # all degenerate → no trials counted
        assert report["degenerate_counts"]["pbo"] == 10

    def test_errors_excluded_from_trials(self):
        """Error results are not counted in trials."""
        from scripts.null_gate_calibration import GATE_NAMES, compute_calibration_report

        results = []
        for i in range(5):
            results.append({
                "gate_results": {g: "error" for g in GATE_NAMES},
                "full_battery_pass": False,
                "b14_pass": None,
                "null_meta": {"strategy_index": i, "null_seed": 42},
                "governance_labels": {"null_calibration": True, "null_seed": 42},
                "elapsed_seconds": 0.1,
                "error": "RuntimeError: test error",
            })

        report = compute_calibration_report(results)
        assert report["n_errors"] == 5
        assert report["n_complete"] == 0
        for _gate, stats in report["per_gate"].items():
            assert stats["trials"] == 0

    def test_report_has_required_keys(self):
        from scripts.null_gate_calibration import compute_calibration_report

        results = self._make_mock_results(
            n=5,
            passes_per_gate={"full_battery": 1},
        )
        report = compute_calibration_report(results)
        required = [
            "n_nulls", "n_errors", "n_complete",
            "per_gate", "full_battery", "degenerate_counts",
            "skip_counts", "ci_confidence", "n_population_projection",
            "noise_floor_note", "generated_at", "gate_battery_version",
        ]
        for key in required:
            assert key in report, f"Missing key: {key}"

    def test_gate_battery_version_present(self):
        """gate_battery_version must be present so re-calibration trigger works."""
        from scripts.null_gate_calibration import compute_calibration_report
        results = self._make_mock_results(5, {"full_battery": 0})
        report = compute_calibration_report(results)
        assert "gate_battery_version" in report
        assert report["gate_battery_version"]  # non-empty string
