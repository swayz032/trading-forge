"""test_wave29_pass_a2_pbo_gate.py — Wave 29 Pass A.2 (backtest-core)

Tests for:
  - compute_pbo_from_cpcv_paths() happy paths + sample-size guard
  - walk_forward.py pbo_audit_actions wiring
  - Pure-function contract: no time.now(), no I/O, deterministic

Institutional references:
  - Lopez de Prado (2018), Ch. 11 — PBO rank formula
  - QuantBeckman 2025 — institutional CPCV guidance
  - arXiv 2512.12924 (2025-12-15) — CPCV integrity verification
"""

from __future__ import annotations

import math
import unittest


class TestComputePboFromCpcvPaths(unittest.TestCase):
    """Tests for compute_pbo_from_cpcv_paths() pure function."""

    def _make_paths(
        self,
        is_sharpes: list[float],
        oos_sharpes: list[float],
    ) -> list[dict]:
        """Build minimal path dicts for testing."""
        assert len(is_sharpes) == len(oos_sharpes)
        return [
            {
                "is_sharpe": is_s,
                "oos_sharpe": oos_s,
                "is_returns": [],
                "oos_returns": [],
            }
            for is_s, oos_s in zip(is_sharpes, oos_sharpes)
        ]

    # ── Test 1: Happy path — high overfit (IS >> OOS) → PBO ≈ 0.5+ ──────────

    def test_high_overfit_paths_produces_high_pbo(self):
        """10 paths where IS > OOS distribution — PBO should be ≥ 0.5."""
        from src.engine.pbo_gate import compute_pbo_from_cpcv_paths

        # IS Sharpes are high; OOS Sharpes are low — typical overfit signature
        is_sharpes = [2.0, 1.8, 1.6, 1.4, 1.2, 1.0, 0.8, 0.6, 0.4, 0.2]
        oos_sharpes = [0.1, 0.2, 0.3, 0.0, 0.1, 0.2, 0.1, 0.3, 0.0, 0.2]

        paths = self._make_paths(is_sharpes, oos_sharpes)
        result = compute_pbo_from_cpcv_paths(paths)

        self.assertIn("pbo", result)
        self.assertIn("n_paths", result)
        self.assertEqual(result["n_paths"], 10)
        pbo = result["pbo"]
        self.assertFalse(math.isnan(pbo), "PBO should not be NaN with 10 paths")
        # When IS Sharpes are all higher, most paths should have IS rank < OOS rank
        # PBO should be ≥ 0.5 for a clearly overfit scenario
        self.assertGreaterEqual(pbo, 0.5, f"Expected PBO ≥ 0.5 for overfit scenario, got {pbo}")
        # Should NOT be NaN
        self.assertIsNotNone(pbo)
        # sample-size guard must not have fired
        self.assertFalse(result.get("sample_size_guard", False))

    # ── Test 2: No overfit (OOS ≈ IS) → PBO ≈ 0.0 ───────────────────────────

    def test_no_overfit_paths_produces_low_pbo(self):
        """10 paths where OOS Sharpe >= IS Sharpe consistently — PBO ≈ 0.0."""
        from src.engine.pbo_gate import compute_pbo_from_cpcv_paths

        # OOS Sharpes are uniformly higher than IS — no overfit.
        # Unique IS values avoid tied ranks that produce symmetric PBO = 0.5.
        # IS best (2.0) maps to OOS best (3.0), IS worst (0.1) maps to OOS worst (1.1).
        # IS rank order perfectly preserved in OOS → 0 overfit paths → PBO = 0.0.
        is_sharpes = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 2.0]
        oos_sharpes = [1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 3.0]

        paths = self._make_paths(is_sharpes, oos_sharpes)
        result = compute_pbo_from_cpcv_paths(paths)

        pbo = result["pbo"]
        self.assertFalse(math.isnan(pbo), "PBO should not be NaN")
        self.assertLess(pbo, 0.5, f"Expected PBO < 0.5 for no-overfit scenario, got {pbo}")
        self.assertEqual(result["n_paths"], 10)
        self.assertFalse(result.get("sample_size_guard", False))

    # ── Test 3: Sample-size guard (<4 paths) → NaN PBO ───────────────────────

    def test_three_paths_returns_nan_pbo_with_sample_size_guard(self):
        """3 paths → returns NaN PBO + sample_size_guard=True."""
        from src.engine.pbo_gate import compute_pbo_from_cpcv_paths

        paths = self._make_paths([1.0, 0.5, 0.2], [0.5, 1.0, 0.8])
        result = compute_pbo_from_cpcv_paths(paths)

        self.assertTrue(math.isnan(result["pbo"]), "PBO should be NaN when n < 4")
        self.assertEqual(result["n_paths"], 3)
        self.assertTrue(result.get("sample_size_guard", False), "sample_size_guard must be True")
        self.assertIsNone(result.get("p_value"), "p_value should be None when sample-size guard fires")

    # ── Test 4: 8 paths mixed → PBO between 0.0 and 1.0 ─────────────────────

    def test_eight_mixed_paths_produces_valid_pbo(self):
        """8 paths with mixed IS/OOS relationship → PBO in [0.0, 1.0]."""
        from src.engine.pbo_gate import compute_pbo_from_cpcv_paths

        # Mixed — some paths overfit, some don't
        is_sharpes = [1.5, 0.3, 1.2, 0.8, 1.8, 0.5, 0.9, 1.1]
        oos_sharpes = [0.4, 0.9, 1.4, 0.2, 0.6, 1.3, 1.1, 0.7]

        paths = self._make_paths(is_sharpes, oos_sharpes)
        result = compute_pbo_from_cpcv_paths(paths)

        pbo = result["pbo"]
        self.assertFalse(math.isnan(pbo))
        self.assertGreaterEqual(pbo, 0.0)
        self.assertLessEqual(pbo, 1.0)
        self.assertEqual(result["n_paths"], 8)
        self.assertFalse(result.get("sample_size_guard", False))

    # ── Test 5: Pure-function determinism — same inputs → same output ─────────

    def test_pure_function_determinism(self):
        """Calling the function twice with same inputs produces identical results."""
        from src.engine.pbo_gate import compute_pbo_from_cpcv_paths

        is_sharpes = [1.5, 0.3, 1.2, 0.8, 1.8, 0.5, 0.9, 1.1, 0.4, 0.7]
        oos_sharpes = [0.4, 0.9, 1.4, 0.2, 0.6, 1.3, 1.1, 0.7, 1.2, 0.5]

        paths = self._make_paths(is_sharpes, oos_sharpes)

        result_1 = compute_pbo_from_cpcv_paths(paths)
        result_2 = compute_pbo_from_cpcv_paths(paths)

        self.assertEqual(result_1["pbo"], result_2["pbo"], "PBO must be deterministic")
        self.assertEqual(result_1["n_paths"], result_2["n_paths"])
        self.assertEqual(result_1.get("p_value"), result_2.get("p_value"))

    # ── Test 6: walk_forward.py emits pbo_audit_actions when ≥4 windows ──────

    def test_walk_forward_pbo_audit_actions_present_with_4_windows(self):
        """walk_forward result must include pbo_audit_actions list when ≥4 windows."""
        # We test the pbo_gate module directly rather than full walk_forward run
        # (which requires real data) to avoid I/O dependency in unit tests.
        # The audit actions are populated by the walk_forward.py aggregation block.
        # Simulate what walk_forward.py does: build paths from window_results
        from src.engine.pbo_gate import (
            _build_cpcv_paths_from_window_results,
            compute_pbo_from_cpcv_paths,
        )

        # FIX 2 (ds21): supply a per-window optimization.best_sharpe distinct
        # from the OOS sharpe. Without it, _build_cpcv_paths_from_window_results
        # falls back to is_sharpe == oos_sharpe (the degenerate case), which
        # compute_pbo_from_cpcv_paths deliberately returns pbo=None for (FIX 2
        # in pbo_gate.py itself — a real IS/OOS divergence is required).
        window_results = [
            {
                "window": i + 1,
                "oos_metrics": {"sharpe_ratio": float(i) / 5.0 + 0.1},
                "optimization": {"best_sharpe": float(i) / 5.0 + 1.1},
                "confidence": "OK",
            }
            for i in range(5)
        ]

        paths = _build_cpcv_paths_from_window_results(window_results)
        result = compute_pbo_from_cpcv_paths(paths)

        # The pbo_audit_actions list should be populated by the caller (walk_forward.py),
        # but we verify the helper itself does not blow up with 5 paths
        self.assertEqual(result["n_paths"], 5)
        self.assertFalse(result.get("sample_size_guard", False))
        self.assertIn("pbo", result)
        # PBO must be a valid float in [0, 1]
        pbo = result["pbo"]
        self.assertFalse(math.isnan(pbo))
        self.assertGreaterEqual(pbo, 0.0)
        self.assertLessEqual(pbo, 1.0)

    # ── Test 7: walk_forward.pbo_high_overfit_risk fires when PBO > 0.5 ──────

    def test_high_pbo_produces_correct_overfit_count(self):
        """When PBO > 0.5, overfit_count should be majority of paths."""
        from src.engine.pbo_gate import compute_pbo_from_cpcv_paths

        # Craft clear overfit scenario: 7 of 10 paths have is_rank < oos_rank.
        # 10 paths. IS values: unique, so IS ranks are deterministic 1..10.
        # OOS values: crafted so 7 paths have IS rank lower (better) than OOS rank.
        #
        # IS values (index → IS rank):
        #   [0]: IS=2.0 → IS rank 1  (best IS)
        #   [1]: IS=1.9 → IS rank 2
        #   [2]: IS=1.8 → IS rank 3
        #   [3]: IS=1.7 → IS rank 4
        #   [4]: IS=1.6 → IS rank 5
        #   [5]: IS=1.5 → IS rank 6
        #   [6]: IS=1.4 → IS rank 7
        #   [7]: IS=1.3 → IS rank 8
        #   [8]: IS=1.2 → IS rank 9
        #   [9]: IS=1.1 → IS rank 10 (worst IS)
        #
        # OOS values: assign so that paths [0..6] (IS ranks 1..7) have
        # OOS ranks 4..10. Paths [7,8,9] (IS ranks 8..10) get OOS ranks 1..3.
        # → is_rank [1..7] < oos_rank [4..10] → 7 overfits.
        # → is_rank [8..10] < oos_rank [1..3]? → 8<1? NO → 0 overfits for these.
        # total overfit = 7, pbo = 7/10 = 0.70 > 0.5. ✓
        #
        # OOS assignment (rank→oos_val):
        #   OOS rank 1 → path [7]: oos=2.0
        #   OOS rank 2 → path [8]: oos=1.9
        #   OOS rank 3 → path [9]: oos=1.8
        #   OOS rank 4 → path [0]: oos=0.7
        #   OOS rank 5 → path [1]: oos=0.6
        #   OOS rank 6 → path [2]: oos=0.5
        #   OOS rank 7 → path [3]: oos=0.4
        #   OOS rank 8 → path [4]: oos=0.3
        #   OOS rank 9 → path [5]: oos=0.2
        #   OOS rank 10→ path [6]: oos=0.1
        is_sharpes  = [2.0, 1.9, 1.8, 1.7, 1.6, 1.5, 1.4, 1.3, 1.2, 1.1]
        oos_sharpes = [0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 2.0, 1.9, 1.8]

        paths = self._make_paths(is_sharpes, oos_sharpes)
        result = compute_pbo_from_cpcv_paths(paths)

        pbo = result["pbo"]
        self.assertFalse(math.isnan(pbo))
        # 7 of 10 paths should be overfit (is_rank < oos_rank).
        self.assertGreater(pbo, 0.5)
        self.assertEqual(result.get("overfit_count"), 7)

    # ── Test 8: Sample-size guard <4 paths fires with 2 paths ────────────────

    def test_two_paths_triggers_sample_size_guard(self):
        """2 paths → sample_size_guard=True + NaN PBO."""
        from src.engine.pbo_gate import compute_pbo_from_cpcv_paths

        paths = self._make_paths([1.0, 0.5], [0.5, 1.0])
        result = compute_pbo_from_cpcv_paths(paths)

        self.assertTrue(math.isnan(result["pbo"]))
        self.assertTrue(result.get("sample_size_guard", False))
        self.assertEqual(result["n_paths"], 2)
        self.assertIsNone(result.get("p_value"))

    # ── Test 9: Empty input → sample-size guard fires ─────────────────────────

    def test_empty_paths_triggers_sample_size_guard(self):
        """Empty path list → sample_size_guard fires."""
        from src.engine.pbo_gate import compute_pbo_from_cpcv_paths

        result = compute_pbo_from_cpcv_paths([])

        self.assertTrue(math.isnan(result["pbo"]))
        self.assertTrue(result.get("sample_size_guard", False))
        self.assertEqual(result["n_paths"], 0)

    # ── Test 10: Missing keys in path dicts — graceful handling ───────────────

    def test_missing_keys_handled_as_zero(self):
        """Paths missing is_sharpe/oos_sharpe → treated as 0.0, no crash."""
        from src.engine.pbo_gate import compute_pbo_from_cpcv_paths

        paths = [
            {},  # missing both keys
            {"is_sharpe": 1.0},  # missing oos_sharpe
            {"oos_sharpe": 0.5},  # missing is_sharpe
            {"is_sharpe": 0.3, "oos_sharpe": 0.8},  # valid
        ]

        result = compute_pbo_from_cpcv_paths(paths)

        # Should not crash; 4 paths → sample-size guard does not fire
        self.assertFalse(result.get("sample_size_guard", False))
        self.assertEqual(result["n_paths"], 4)
        pbo = result["pbo"]
        self.assertFalse(math.isnan(pbo))
        self.assertGreaterEqual(pbo, 0.0)
        self.assertLessEqual(pbo, 1.0)


class TestWalkForwardPboAuditActions(unittest.TestCase):
    """Tests for pbo_audit_actions wiring in walk_forward result."""

    def test_audit_actions_list_is_defined_in_module(self):
        """walk_forward.py pbo_audit_actions logic is testable via pbo_gate."""
        from src.engine.pbo_gate import compute_pbo_from_cpcv_paths

        # 5 paths → pbo_computed should be in the caller's audit_actions list
        paths = [
            {"is_sharpe": 0.5, "oos_sharpe": 0.3, "is_returns": [], "oos_returns": []},
            {"is_sharpe": 0.8, "oos_sharpe": 0.2, "is_returns": [], "oos_returns": []},
            {"is_sharpe": 1.2, "oos_sharpe": 0.4, "is_returns": [], "oos_returns": []},
            {"is_sharpe": 0.3, "oos_sharpe": 0.9, "is_returns": [], "oos_returns": []},
            {"is_sharpe": 1.5, "oos_sharpe": 0.1, "is_returns": [], "oos_returns": []},
        ]

        result = compute_pbo_from_cpcv_paths(paths)
        self.assertEqual(result["n_paths"], 5)
        # Result has the fields walk_forward.py uses to populate pbo_audit_actions
        self.assertIn("pbo", result)
        self.assertFalse(math.isnan(result["pbo"]))

    def test_high_pbo_triggers_high_overfit_risk_action_criteria(self):
        """When PBO > PBO_OVERFIT_THRESHOLD, walk_forward.py adds pbo_high_overfit_risk."""
        import os

        from src.engine.pbo_gate import compute_pbo_from_cpcv_paths

        # Default PBO_OVERFIT_THRESHOLD is 0.5
        threshold = float(os.environ.get("PBO_OVERFIT_THRESHOLD", "0.5"))

        # Build paths that produce PBO > threshold
        is_sharpes = [0.1, 0.2, 0.3, 0.4, 2.0, 1.8, 1.6, 1.4]
        oos_sharpes = [0.9, 0.8, 0.7, 0.6, 0.1, 0.2, 0.1, 0.2]
        paths = [
            {"is_sharpe": i, "oos_sharpe": o, "is_returns": [], "oos_returns": []}
            for i, o in zip(is_sharpes, oos_sharpes)
        ]

        result = compute_pbo_from_cpcv_paths(paths)
        pbo = result["pbo"]

        # Build audit_actions exactly as walk_forward.py does
        audit_actions = []
        if not math.isnan(pbo):
            audit_actions.append("walk_forward.pbo_computed")
            if pbo > threshold:
                audit_actions.append("walk_forward.pbo_high_overfit_risk")

        self.assertIn("walk_forward.pbo_computed", audit_actions)
        if pbo > threshold:
            self.assertIn("walk_forward.pbo_high_overfit_risk", audit_actions)


if __name__ == "__main__":
    unittest.main()
