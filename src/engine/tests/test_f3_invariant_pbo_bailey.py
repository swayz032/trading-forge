"""F-3 (2026-06-29): Invariant PBO path now uses Bailey rank-based algorithm.

Verifies:
  1. risk_metrics.compute_pbo is GONE (tombstone).
  2. Bailey path (pbo_gate.compute_pbo_from_cpcv_paths) emits the correct schema.
  3. Known-answer: clear overfit input (IS >> OOS) → pbo > 0.5.
  4. Known-answer: clear robust input (OOS ≥ IS) → pbo = 0.0.
  5. Degenerate guard: IS==OOS for all paths → pbo=None, degenerate=True.
  6. Sample-size guard: < 4 paths → pbo=float('nan'), sample_size_guard=True.
  7. _build_cpcv_paths_from_window_results correctly uses optimizer IS Sharpe.
  8. _build_cpcv_paths_from_window_results falls back to OOS when no optimizer score.
  9. walk_forward.py result dict: pbo field sourced from pbo_gate_result.
  10. Backtester invariant: algorithm key is "bailey_rank_based" (schema contract).

NOTE: All backtester.py imports are LAZY (inside test methods) to prevent pytest
collection from triggering vectorbt JIT compilation (hangs on this tower).
vectorbt is mocked at module import via sys.modules.setdefault.
"""
from __future__ import annotations

import math
import sys
from unittest.mock import MagicMock

# ── vectorbt mock must be in place before any backtester.py import ────────────
sys.modules.setdefault("vectorbt", MagicMock())


# ─── Test 1: tombstone ────────────────────────────────────────────────────────

class TestF3Tombstone:
    """F-3: risk_metrics.compute_pbo must not exist."""

    def test_compute_pbo_is_gone_from_risk_metrics(self):
        """ImportError or AttributeError if caller tries to import compute_pbo."""
        import src.engine.risk_metrics as rm
        assert not hasattr(rm, "compute_pbo"), (
            "compute_pbo must not exist in risk_metrics after F-3 removal. "
            "Found it still present — revert was not applied."
        )

    def test_risk_metrics_tombstone_comment_noted(self):
        """Tombstone comment exists in risk_metrics.py source."""
        import inspect

        import src.engine.risk_metrics as rm
        src_text = inspect.getsource(rm)
        assert "F-3" in src_text and "compute_pbo" in src_text, (
            "Expected F-3 tombstone comment in risk_metrics.py source."
        )


# ─── Test 2: Bailey schema ────────────────────────────────────────────────────

class TestBaileySchema:
    """compute_pbo_from_cpcv_paths returns the correct schema keys."""

    def _make_distinct_paths(self, n: int = 6) -> list[dict]:
        """Build n paths with distinct IS/OOS Sharpes (non-degenerate)."""
        return [
            {"is_sharpe": float(i + 1), "oos_sharpe": float(n - i), "is_returns": [], "oos_returns": []}
            for i in range(n)
        ]

    def test_result_has_pbo_key(self):
        from src.engine.pbo_gate import compute_pbo_from_cpcv_paths  # lazy
        result = compute_pbo_from_cpcv_paths(self._make_distinct_paths())
        assert "pbo" in result

    def test_result_has_n_paths_key(self):
        from src.engine.pbo_gate import compute_pbo_from_cpcv_paths
        result = compute_pbo_from_cpcv_paths(self._make_distinct_paths())
        assert "n_paths" in result
        assert result["n_paths"] == 6

    def test_result_has_p_value_key(self):
        from src.engine.pbo_gate import compute_pbo_from_cpcv_paths
        result = compute_pbo_from_cpcv_paths(self._make_distinct_paths())
        assert "p_value" in result

    def test_result_pbo_is_float_or_none(self):
        from src.engine.pbo_gate import compute_pbo_from_cpcv_paths
        result = compute_pbo_from_cpcv_paths(self._make_distinct_paths())
        pbo = result["pbo"]
        assert pbo is None or isinstance(pbo, float), (
            f"pbo must be float or None, got {type(pbo)}"
        )

    def test_no_n_combinations_key(self):
        """Bailey result emits n_paths (not n_combinations from the old API)."""
        from src.engine.pbo_gate import compute_pbo_from_cpcv_paths
        result = compute_pbo_from_cpcv_paths(self._make_distinct_paths())
        assert "n_combinations" not in result, (
            "Bailey result must not emit n_combinations (old API key); "
            "downstream consumers must read n_paths."
        )


# ─── Test 3 & 4: known-answer ────────────────────────────────────────────────

class TestBaileyKnownAnswer:
    """Known-answer tests: overfit and robust inputs."""

    def test_clear_overfit_produces_high_pbo(self):
        """5 of 6 paths have IS rank < OOS rank → PBO = 5/6 ≈ 0.833.

        Construction (verified by hand):
          Path 0: IS rank 3, OOS rank 4 → 3<4 overfit
          Path 1: IS rank 4, OOS rank 5 → 4<5 overfit
          Path 2: IS rank 5, OOS rank 6 → 5<6 overfit
          Path 3: IS rank 2, OOS rank 3 → 2<3 overfit
          Path 4: IS rank 1, OOS rank 2 → 1<2 overfit
          Path 5: IS rank 6, OOS rank 1 → 6>1 NOT overfit (compensating path)

        PBO = 5/6 ≈ 0.833 — clearly above 0.5 threshold.
        """
        from src.engine.pbo_gate import compute_pbo_from_cpcv_paths
        paths = [
            {"is_sharpe": 6.0, "oos_sharpe": 4.0},   # IS rank 3, OOS rank 4
            {"is_sharpe": 4.0, "oos_sharpe": 2.0},   # IS rank 4, OOS rank 5
            {"is_sharpe": 2.0, "oos_sharpe": 0.0},   # IS rank 5, OOS rank 6
            {"is_sharpe": 8.0, "oos_sharpe": 6.0},   # IS rank 2, OOS rank 3
            {"is_sharpe": 10.0, "oos_sharpe": 8.0},  # IS rank 1, OOS rank 2
            {"is_sharpe": 0.0, "oos_sharpe": 10.0},  # IS rank 6, OOS rank 1
        ]
        result = compute_pbo_from_cpcv_paths(paths)
        pbo = result.get("pbo")
        assert pbo is not None and not math.isnan(pbo), (
            f"Expected finite PBO for known-overfit input, got {pbo}"
        )
        expected = 5.0 / 6.0
        assert abs(pbo - expected) < 1e-9, (
            f"Known-overfit PBO should be {expected:.4f}, got {pbo:.4f}"
        )

    def test_clear_robust_produces_low_pbo(self):
        """IS rank == OOS rank for every path → pbo = 0.0 (no overfitting).

        When IS-best is also OOS-best, IS rank < OOS rank is never true → overfit_count=0.
        """
        from src.engine.pbo_gate import compute_pbo_from_cpcv_paths
        # IS[0]=6.0 (best IS rank=1), OOS[0]=6.0 (best OOS rank=1) → not overfit
        paths = [
            {"is_sharpe": float(6 - i), "oos_sharpe": float(6 - i)}
            for i in range(6)
        ]
        # NOTE: this is technically the degenerate case (IS==OOS). But the expected
        # result from the degenerate guard is pbo=None. pbo=0.0 would be the "lie".
        # The correct assertion for IS==OOS is degenerate=True.
        result = compute_pbo_from_cpcv_paths(paths)
        assert result.get("degenerate") is True, (
            "IS==OOS for all paths must trigger the degenerate guard (pbo=None). "
            f"Got: {result}"
        )
        assert result.get("pbo") is None

    def test_perfect_robust_with_distinct_values(self):
        """IS-best is OOS-best (distinct values) → pbo = 0.0.

        When IS rank == OOS rank for every path (IS-winners == OOS-winners),
        overfit_count = 0 → pbo = 0.0.
        """
        from src.engine.pbo_gate import compute_pbo_from_cpcv_paths
        # IS and OOS perfectly correlated but not equal → non-degenerate
        # IS[0]=6.0 → IS rank=1; OOS[0]=3.0 → OOS rank=1 (best)
        # Perfect positive correlation → IS rank == OOS rank for all paths
        paths = [
            {"is_sharpe": float(6 - i) * 1.5, "oos_sharpe": float(6 - i) * 0.8}
            for i in range(6)
        ]
        result = compute_pbo_from_cpcv_paths(paths)
        pbo = result.get("pbo")
        assert pbo is not None and not math.isnan(pbo), (
            f"Expected finite PBO for perfectly correlated IS/OOS, got {pbo}"
        )
        assert pbo == 0.0, (
            f"IS-best == OOS-best (perfect correlation) should give pbo=0.0, got {pbo}"
        )


# ─── Test 5: degenerate guard ────────────────────────────────────────────────

class TestBaileyDegenerateGuard:
    """Degenerate IS==OOS input → pbo=None, degenerate=True."""

    def test_all_is_equal_oos_returns_none_pbo(self):
        from src.engine.pbo_gate import compute_pbo_from_cpcv_paths
        paths = [{"is_sharpe": 1.0, "oos_sharpe": 1.0} for _ in range(6)]
        result = compute_pbo_from_cpcv_paths(paths)
        assert result.get("pbo") is None
        assert result.get("degenerate") is True

    def test_degenerate_result_has_n_paths(self):
        from src.engine.pbo_gate import compute_pbo_from_cpcv_paths
        paths = [{"is_sharpe": 0.5, "oos_sharpe": 0.5} for _ in range(5)]
        result = compute_pbo_from_cpcv_paths(paths)
        assert result.get("n_paths") == 5


# ─── Test 6: sample-size guard ───────────────────────────────────────────────

class TestBaileySampleSizeGuard:
    """Fewer than 4 paths → pbo=NaN, sample_size_guard=True."""

    def test_three_paths_fires_sample_guard(self):
        from src.engine.pbo_gate import compute_pbo_from_cpcv_paths
        paths = [{"is_sharpe": 1.0, "oos_sharpe": 0.5} for _ in range(3)]
        result = compute_pbo_from_cpcv_paths(paths)
        pbo = result.get("pbo")
        assert isinstance(pbo, float) and math.isnan(pbo), (
            f"< 4 paths must return pbo=NaN (sample-size guard), got {pbo}"
        )
        assert result.get("sample_size_guard") is True

    def test_zero_paths_fires_sample_guard(self):
        from src.engine.pbo_gate import compute_pbo_from_cpcv_paths
        result = compute_pbo_from_cpcv_paths([])
        pbo = result.get("pbo")
        assert isinstance(pbo, float) and math.isnan(pbo)
        assert result.get("sample_size_guard") is True


# ─── Tests 7 & 8: _build_cpcv_paths_from_window_results ─────────────────────

class TestBuildCpcvPathsFromWindowResults:
    """_build_cpcv_paths_from_window_results correctly sources IS Sharpe."""

    def test_uses_optimizer_best_sharpe_when_present(self):
        """When optimization.best_sharpe is set, IS Sharpe comes from optimizer."""
        from src.engine.pbo_gate import _build_cpcv_paths_from_window_results
        windows = [
            {
                "oos_metrics": {"sharpe_ratio": 0.5},
                "optimization": {"best_sharpe": 2.0},
            }
            for _ in range(4)
        ]
        paths = _build_cpcv_paths_from_window_results(windows)
        assert all(p["is_sharpe"] == 2.0 for p in paths), (
            "When optimization.best_sharpe is present, IS Sharpe must come from optimizer."
        )

    def test_falls_back_to_oos_when_no_optimizer(self):
        """Without optimization.best_sharpe, IS Sharpe equals OOS Sharpe (degenerate fallback)."""
        from src.engine.pbo_gate import _build_cpcv_paths_from_window_results
        windows = [
            {"oos_metrics": {"sharpe_ratio": 1.2}}
            for _ in range(4)
        ]
        paths = _build_cpcv_paths_from_window_results(windows)
        assert all(p["is_sharpe"] == p["oos_sharpe"] for p in paths), (
            "Without optimizer score, IS Sharpe must fall back to OOS Sharpe."
        )

    def test_path_count_matches_window_count(self):
        from src.engine.pbo_gate import _build_cpcv_paths_from_window_results
        windows = [{"oos_metrics": {"sharpe_ratio": float(i)}} for i in range(8)]
        paths = _build_cpcv_paths_from_window_results(windows)
        assert len(paths) == 8

    def test_path_has_required_keys(self):
        from src.engine.pbo_gate import _build_cpcv_paths_from_window_results
        windows = [{"oos_metrics": {"sharpe_ratio": 1.0}, "optimization": {"best_sharpe": 1.5}}]
        path = _build_cpcv_paths_from_window_results(windows)[0]
        assert "is_sharpe" in path
        assert "oos_sharpe" in path


# ─── Test 9: walk_forward.py result dict ─────────────────────────────────────

class TestWalkForwardPboResultDict:
    """walk_forward.py result dict sources pbo from pbo_gate_result (not pbo_result)."""

    def test_pbo_result_is_never_used(self):
        """Verify pbo_result is not in the result-building logic after F-3."""
        import inspect

        import src.engine.walk_forward as wf
        src_text = inspect.getsource(wf)
        # After F-3, all result dict pbo fields come from pbo_gate_result.
        # The old "pbo_result.get(..." pattern should not appear.
        assert "pbo_result.get(" not in src_text, (
            "F-3 left a pbo_result.get() reference in walk_forward.py — "
            "all PBO output must be sourced from pbo_gate_result."
        )

    def test_walk_forward_imports_pbo_gate_not_risk_metrics(self):
        """walk_forward.py must import from pbo_gate, not risk_metrics.compute_pbo."""
        import inspect

        import src.engine.walk_forward as wf
        src_text = inspect.getsource(wf)
        # Should not import compute_pbo from risk_metrics
        assert "from src.engine.risk_metrics import compute_pbo" not in src_text, (
            "walk_forward.py must not import the removed compute_pbo from risk_metrics."
        )


# ─── Test 10: backtester invariant algorithm tag ─────────────────────────────

class TestBacktesterInvariantAlgorithmTag:
    """Invariant PBO harness in backtester.py emits algorithm='bailey_rank_based'."""

    def test_backtester_invariant_imports_pbo_gate(self):
        """backtester.py invariant section imports from pbo_gate, not risk_metrics."""
        import inspect

        # Lazy import with vectorbt mocked
        import src.engine.backtester as bt
        src_text = inspect.getsource(bt)
        assert "pbo_gate" in src_text, (
            "backtester.py must import from pbo_gate for invariant PBO computation."
        )
        # Must NOT import compute_pbo from risk_metrics
        assert "from src.engine.risk_metrics import compute_pbo" not in src_text, (
            "backtester.py must not import the removed compute_pbo from risk_metrics."
        )

    def test_backtester_invariant_uses_bailey_algorithm_tag(self):
        """Algorithm tag 'bailey_rank_based' must be in the invariant harness."""
        import inspect

        import src.engine.backtester as bt
        src_text = inspect.getsource(bt)
        assert "bailey_rank_based" in src_text, (
            "invariant PBO result must tag algorithm='bailey_rank_based' "
            "so downstream consumers can detect the algorithm version."
        )
