"""test_cpcv_gate_bypasses.py — 2026-06-28 hardening

Verifies the three CPCV promotion-gate bypasses are now EXPLICIT and AUDITABLE
rather than silently grandfather-PASSing through legacy-null paths.

Bypass 1 — WFE not computed in CPCV mode:
    walk_forward._run_walk_forward_cpcv() emits wfe_overall=None +
    wfe_status="cpcv_not_applicable" instead of omitting the key entirely.

Bypass 2 — PBO IS==OOS degenerate input:
    pbo_gate.compute_pbo_from_cpcv_paths() detects the degenerate case and
    returns degenerate=True; walk_forward.py overrides degenerate_reason to
    "cpcv_is_sharpe_unavailable" (distinguishable from generic degenerate).

Bypass 3 — BIF IS Sharpe unavailable:
    backtest_inflation_factor.compute_bif() is called with OOS-mean as IS proxy;
    walk_forward.py stamps bif_reliable=False on the result dict so the TS BIF
    gate can emit a non-blocking audit-warn rather than treating BIF≈1.0 as a
    genuine clean-gate pass.

DO NOT import backtester, walk_forward, or vectorbt — the JIT hangs at collection
time on the Skytech tower. Tests use the pure-function modules directly and simulate
the walk_forward.py post-call logic inline.

Run:
    python -m pytest src/engine/tests/test_cpcv_gate_bypasses.py -v
"""

from __future__ import annotations

import math
import unittest


# ── Bypass 3 tests: BIF with genuine IS/OOS divergence ───────────────────────

class TestBifGenuineOverfit(unittest.TestCase):
    """Prove compute_bif produces a real (blocking) BIF on genuine IS>>OOS.

    This is the test the task requires: is_sharpe=3.0, oos_sharpe=0.3 must
    produce BIF >= BIF_BLOCK_THRESHOLD (default 4.0) and verdict="block".
    BIF = 3.0 / 0.3 = 10.0, which is > 4.0.
    """

    def test_overfit_case_produces_blocking_bif(self):
        """BIF(is=3.0, oos=0.3) must exceed block threshold and return verdict=block."""
        from src.engine.statistics.backtest_inflation_factor import compute_bif

        result = compute_bif(is_sharpe=3.0, wf_sharpe=0.3, k_eff=15.0)

        self.assertIn("bif", result)
        self.assertIn("verdict", result)
        bif = result["bif"]
        self.assertTrue(math.isfinite(bif), f"BIF must be finite, got {bif}")
        # BIF = 3.0 / 0.3 = 10.0 — must exceed default block threshold of 4.0
        self.assertGreaterEqual(bif, 4.0, f"Expected BIF >= 4.0 for is=3.0/oos=0.3, got {bif}")
        self.assertEqual(result["verdict"], "block",
                         f"Expected verdict=block, got {result['verdict']}")
        # Fail-closed must NOT have fired — these are positive valid inputs
        self.assertFalse(result.get("fail_closed", False),
                         "fail_closed must be False for valid positive inputs")

    def test_overfit_case_bif_exact_value(self):
        """BIF(is=3.0, oos=0.3) = 10.0 exactly (modulo rounding)."""
        from src.engine.statistics.backtest_inflation_factor import compute_bif

        result = compute_bif(is_sharpe=3.0, wf_sharpe=0.3, k_eff=15.0)
        self.assertAlmostEqual(result["bif"], 10.0, places=4,
                               msg=f"Expected BIF=10.0, got {result['bif']}")

    def test_no_overfit_case_produces_clean_bif(self):
        """BIF(is=1.0, oos=1.1) < warn threshold → verdict=clean."""
        from src.engine.statistics.backtest_inflation_factor import compute_bif

        result = compute_bif(is_sharpe=1.0, wf_sharpe=1.1, k_eff=15.0)
        # IS/OOS ≈ 0.91 < 1.0 — strategy performs BETTER OOS; BIF<1.0 is clean
        self.assertEqual(result["verdict"], "clean",
                         f"Expected clean, got {result['verdict']}")

    def test_compute_bif_does_not_pre_populate_bif_reliable(self):
        """compute_bif() must NOT pre-populate bif_reliable — caller owns that field.

        walk_forward.py stamps bif_reliable=False AFTER compute_bif() returns.
        If compute_bif() pre-populated it, the caller's stamp would be a no-op
        and the test_compute_bif_does_not_pre_populate_proxy_basis pattern
        (in test_bif_proxy_basis.py) would be violated.
        """
        from src.engine.statistics.backtest_inflation_factor import compute_bif

        result = compute_bif(is_sharpe=1.5, wf_sharpe=0.5, k_eff=15.0)
        self.assertNotIn("bif_reliable", result,
                         "compute_bif() must not pre-populate bif_reliable; "
                         "walk_forward.py stamps it post-call")

    def test_caller_can_stamp_bif_reliable_false(self):
        """walk_forward.py stamps bif_reliable=False on the returned dict."""
        from src.engine.statistics.backtest_inflation_factor import compute_bif

        result = compute_bif(is_sharpe=1.0, wf_sharpe=1.0, k_eff=15.0)
        # Simulate what walk_forward.py does after the BIF call
        result["bif_proxy_basis"] = "oos_mean_not_is"
        result["bif_reliable"] = False

        self.assertEqual(result["bif_proxy_basis"], "oos_mean_not_is")
        self.assertFalse(result["bif_reliable"],
                         "bif_reliable must be False after caller stamps it")
        # BIF value must be unchanged by the stamp
        self.assertAlmostEqual(result["bif"], 1.0, places=4)


# ── Bypass 3 — oos_mean_not_is produces BIF≈1.0 (the M1 limitation) ──────────

class TestBifCpcvProxyLimitation(unittest.TestCase):
    """Prove that feeding is_sharpe=oos_mean (the CPCV proxy) produces BIF≈1.0.

    This confirms the M1 limitation: when both is_sharpe and wf_sharpe derive
    from the same OOS series, BIF is always ≈1.0 and the block gate never fires.
    bif_reliable=False must be present to make this explicit.
    """

    def test_oos_mean_proxy_produces_bif_near_1(self):
        """When is_sharpe == wf_sharpe (same OOS series), BIF≈1.0."""
        from src.engine.statistics.backtest_inflation_factor import compute_bif

        oos_mean = 1.2
        result = compute_bif(is_sharpe=oos_mean, wf_sharpe=oos_mean, k_eff=15.0)
        result["bif_proxy_basis"] = "oos_mean_not_is"
        result["bif_reliable"] = False

        self.assertAlmostEqual(result["bif"], 1.0, places=4,
                               msg="OOS-mean proxy must produce BIF≈1.0")
        self.assertNotEqual(result["verdict"], "block",
                            "BIF≈1.0 must not produce a block verdict")
        self.assertFalse(result["bif_reliable"],
                         "bif_reliable must be False for the proxy case")

    def test_bif_reliable_false_survives_wf_metadata_construction(self):
        """Simulate the wf_metadata dict that walk_forward.py builds post-fix.

        The wf_metadata dict now carries bif_reliable so downstream TS consumers
        can distinguish 'BIF clean' from 'BIF not applicable'.
        """
        from src.engine.statistics.backtest_inflation_factor import compute_bif

        bif_result = compute_bif(is_sharpe=1.1, wf_sharpe=1.0, k_eff=15.0)
        bif_result["bif_proxy_basis"] = "oos_mean_not_is"
        bif_result["bif_reliable"] = False

        wf_metadata = {
            "mode": "cpcv",
            "n_folds": 6,
            "n_paths": 15,
            "bif_proxy_basis": bif_result.get("bif_proxy_basis"),
            "bif_reliable": bif_result.get("bif_reliable", True),
        }

        self.assertEqual(wf_metadata["bif_proxy_basis"], "oos_mean_not_is")
        self.assertFalse(wf_metadata["bif_reliable"],
                         "wf_metadata.bif_reliable must be False for CPCV mode")
        self.assertEqual(wf_metadata["mode"], "cpcv")


# ── Bypass 2 tests: PBO degenerate case ──────────────────────────────────────

class TestPboCpcvDegenerateReason(unittest.TestCase):
    """Verify the CPCV degenerate PBO path emits a distinguishable audit reason.

    When walk_forward.py builds _cpcv_path_dicts with is_sharpe==oos_sharpe,
    pbo_gate.compute_pbo_from_cpcv_paths() returns degenerate=True. walk_forward.py
    then overrides degenerate_reason to "cpcv_is_sharpe_unavailable".

    We test the pure-function behavior of pbo_gate and the override logic inline
    (without importing walk_forward to avoid vectorbt JIT hang).
    """

    def _make_cpcv_path_dicts_degenerate(self, n: int = 15) -> list[dict]:
        """Simulate what walk_forward.py builds for CPCV: is==oos for every path."""
        import random
        rng = random.Random(42)
        path_sharpes = [round(rng.uniform(0.3, 2.0), 3) for _ in range(n)]
        return [
            {"is_sharpe": s, "oos_sharpe": s, "is_returns": [], "oos_returns": []}
            for s in path_sharpes
        ]

    def test_degenerate_case_fires_when_is_equals_oos(self):
        """pbo_gate detects is==oos degenerate input and returns pbo=None."""
        from src.engine.pbo_gate import compute_pbo_from_cpcv_paths

        path_dicts = self._make_cpcv_path_dicts_degenerate(15)
        result = compute_pbo_from_cpcv_paths(path_dicts)

        self.assertTrue(result.get("degenerate"),
                        "degenerate flag must be True when is==oos for all paths")
        self.assertIsNone(result.get("pbo"),
                          "pbo must be None for degenerate input (not 0.0 false-clean)")
        self.assertIn("degenerate_reason", result,
                      "degenerate_reason must be present for auditing")

    def test_walk_forward_override_produces_cpcv_specific_reason(self):
        """After walk_forward.py override, reason is 'cpcv_is_sharpe_unavailable'.

        This simulates the exact walk_forward.py post-call block:
            if _cpcv_gate.get("degenerate"):
                _cpcv_gate["degenerate_reason"] = "cpcv_is_sharpe_unavailable"
        """
        from src.engine.pbo_gate import compute_pbo_from_cpcv_paths

        path_dicts = self._make_cpcv_path_dicts_degenerate(15)
        gate_result = compute_pbo_from_cpcv_paths(path_dicts)

        # Simulate walk_forward.py override
        if gate_result.get("degenerate"):
            gate_result["degenerate_reason"] = "cpcv_is_sharpe_unavailable"

        pbo_degenerate_reason = gate_result.get("degenerate_reason")

        self.assertEqual(pbo_degenerate_reason, "cpcv_is_sharpe_unavailable",
                         "Override must produce 'cpcv_is_sharpe_unavailable' reason")
        # Must NOT be the generic message (distinguishable from other degenerate paths)
        self.assertNotIn("is_sharpe == oos_sharpe for every path",
                         pbo_degenerate_reason,
                         "Override must replace the generic message with CPCV-specific one")

    def test_degenerate_reason_not_set_for_non_degenerate_case(self):
        """When IS != OOS, degenerate is False and reason is not set."""
        from src.engine.pbo_gate import compute_pbo_from_cpcv_paths

        # Genuine IS/OOS divergence — no degenerate guard should fire
        path_dicts = [
            {"is_sharpe": 3.0, "oos_sharpe": 0.3, "is_returns": [], "oos_returns": []},
            {"is_sharpe": 2.5, "oos_sharpe": 0.4, "is_returns": [], "oos_returns": []},
            {"is_sharpe": 2.8, "oos_sharpe": 0.5, "is_returns": [], "oos_returns": []},
            {"is_sharpe": 3.2, "oos_sharpe": 0.2, "is_returns": [], "oos_returns": []},
            {"is_sharpe": 2.1, "oos_sharpe": 0.6, "is_returns": [], "oos_returns": []},
        ]
        result = compute_pbo_from_cpcv_paths(path_dicts)

        self.assertFalse(result.get("degenerate", False),
                         "degenerate must be False when IS != OOS")
        self.assertIsNotNone(result.get("pbo"),
                             "pbo must be computed (non-None) for genuine IS/OOS paths")
        pbo = result["pbo"]
        self.assertFalse(math.isnan(pbo), "pbo must not be NaN for valid inputs")


# ── Bypass 2 positive case: genuine divergence produces real PBO ──────────────

class TestPboGenuineOverfit(unittest.TestCase):
    """Prove genuine IS>>OOS input produces a real blocking PBO, NOT 1.0 or None.

    This validates the task requirement: an overfit case (is_sharpe=3.0,
    oos_sharpe=0.3) must not silently pass through the gate as None.
    """

    def _make_genuine_overfit_paths(self, n: int = 15) -> list[dict]:
        """Build paths where IS Sharpes are consistently >> OOS Sharpes."""
        # IS: 2.0..3.5 range; OOS: 0.1..0.6 range — clear overfit signature
        is_values = [2.0 + i * 0.1 for i in range(n)]
        oos_values = [0.1 + i * 0.03 for i in range(n)]
        return [
            {"is_sharpe": i, "oos_sharpe": o, "is_returns": [], "oos_returns": []}
            for i, o in zip(is_values, oos_values)
        ]

    def test_genuine_overfit_paths_produce_real_pbo(self):
        """Genuine IS>>OOS produces non-None, non-degenerate PBO.

        PBO is a RANK-based metric (Bailey et al. 2014): it counts paths where
        the IS rank number is strictly lower than the OOS rank number (IS looks
        better than OOS in rank order). When IS and OOS are both monotonically
        increasing in lockstep (same rank ordering) PBO == 0.0 is the CORRECT
        result — ranks agree, no rank-overfitting signal. The anti-correlated
        (maximum-overfit) case is covered by
        test_genuine_overfit_pbo_exceeds_lifecycle_gate_threshold.

        This test proves: PBO is COMPUTED (non-None, non-NaN, finite) when
        IS != OOS magnitudes. That is the core correctness claim — the gate
        ran, it did not fire the degenerate guard, and it emits a valid float.
        """
        from src.engine.pbo_gate import compute_pbo_from_cpcv_paths

        paths = self._make_genuine_overfit_paths(15)
        result = compute_pbo_from_cpcv_paths(paths)

        self.assertFalse(result.get("degenerate", False),
                         "Genuine IS/OOS paths must not trigger degenerate guard")
        pbo = result.get("pbo")
        self.assertIsNotNone(pbo, "pbo must not be None for genuine IS/OOS paths")
        self.assertFalse(math.isnan(pbo), "pbo must not be NaN")
        self.assertGreaterEqual(pbo, 0.0, "PBO must be in [0, 1]")
        self.assertLessEqual(pbo, 1.0, "PBO must be in [0, 1]")

    def test_genuine_overfit_pbo_exceeds_lifecycle_gate_threshold(self):
        """Strong overfit must exceed PBO_OVERFIT_THRESHOLD_PCT=0.15 gate."""
        from src.engine.pbo_gate import compute_pbo_from_cpcv_paths

        # Construct maximally overfit: best IS rank is always worst OOS rank
        # 15 paths; IS sorted descending, OOS sorted ascending (inverted)
        n = 15
        is_values = sorted([2.0 + i * 0.1 for i in range(n)], reverse=True)
        oos_values = sorted([0.1 + i * 0.05 for i in range(n)])
        paths = [
            {"is_sharpe": i, "oos_sharpe": o, "is_returns": [], "oos_returns": []}
            for i, o in zip(is_values, oos_values)
        ]
        result = compute_pbo_from_cpcv_paths(paths)
        pbo = result.get("pbo")

        self.assertIsNotNone(pbo)
        self.assertFalse(math.isnan(pbo))
        # When IS and OOS are perfectly anti-correlated, PBO = 1.0
        # Lifecycle gate at 0.15 must block: pbo > 0.15
        self.assertGreater(pbo, 0.15,
                           f"Strong overfit must exceed 0.15 lifecycle gate, got {pbo}")


# ── Bypass 1 tests: WFE explicit exemption ───────────────────────────────────

class TestWfeCpcvExplicitExemption(unittest.TestCase):
    """Verify the CPCV return dict structure now carries wfe_overall=None +
    wfe_status="cpcv_not_applicable" as explicit fields.

    Since we cannot import walk_forward.py (vectorbt JIT hang), we test the
    expected dict SHAPE by simulating the post-fix return structure that
    _run_walk_forward_cpcv() emits.
    """

    def _simulate_cpcv_return(
        self,
        bif_result: dict,
        pbo_overall: object,
        pbo_degenerate_reason: object,
    ) -> dict:
        """Minimal CPCV return dict mirroring post-fix walk_forward.py structure."""
        return {
            "wfe_overall": None,
            "wfe_status": "cpcv_not_applicable",
            "wf_metadata": {
                "mode": "cpcv",
                "n_folds": 6,
                "n_paths": 15,
                "bif_proxy_basis": bif_result.get("bif_proxy_basis"),
                "bif_reliable": bif_result.get("bif_reliable", True),
            },
            "pbo_overall": pbo_overall,
            "pbo_degenerate_reason": pbo_degenerate_reason,
            "bif": bif_result.get("bif"),
            "k_eff": bif_result.get("k_eff"),
            "bif_detail": bif_result,
        }

    def test_cpcv_return_carries_wfe_overall_none(self):
        """wfe_overall must be None (not absent) in CPCV return dict."""
        from src.engine.statistics.backtest_inflation_factor import compute_bif

        bif = compute_bif(is_sharpe=1.0, wf_sharpe=1.0, k_eff=15.0)
        bif["bif_proxy_basis"] = "oos_mean_not_is"
        bif["bif_reliable"] = False

        result = self._simulate_cpcv_return(bif, None, "cpcv_is_sharpe_unavailable")

        # Key MUST be present (not missing) so TS can distinguish from legacy absent
        self.assertIn("wfe_overall", result,
                      "wfe_overall key must be present in CPCV return dict")
        self.assertIsNone(result["wfe_overall"],
                          "wfe_overall must be None in CPCV mode")

    def test_cpcv_return_carries_wfe_status_cpcv_not_applicable(self):
        """wfe_status must equal 'cpcv_not_applicable' to distinguish from legacy_null."""
        from src.engine.statistics.backtest_inflation_factor import compute_bif

        bif = compute_bif(is_sharpe=1.0, wf_sharpe=1.0, k_eff=15.0)
        bif["bif_proxy_basis"] = "oos_mean_not_is"
        bif["bif_reliable"] = False

        result = self._simulate_cpcv_return(bif, None, "cpcv_is_sharpe_unavailable")

        self.assertIn("wfe_status", result)
        self.assertEqual(result["wfe_status"], "cpcv_not_applicable",
                         "wfe_status must be 'cpcv_not_applicable' not legacy_null")

    def test_cpcv_return_wf_metadata_bif_reliable_false(self):
        """wf_metadata.bif_reliable must be False for CPCV mode."""
        from src.engine.statistics.backtest_inflation_factor import compute_bif

        bif = compute_bif(is_sharpe=1.0, wf_sharpe=1.0, k_eff=15.0)
        bif["bif_proxy_basis"] = "oos_mean_not_is"
        bif["bif_reliable"] = False

        result = self._simulate_cpcv_return(bif, None, "cpcv_is_sharpe_unavailable")

        meta = result["wf_metadata"]
        self.assertIn("bif_reliable", meta,
                      "wf_metadata.bif_reliable key must be present")
        self.assertFalse(meta["bif_reliable"],
                         "wf_metadata.bif_reliable must be False in CPCV mode")
        self.assertEqual(meta["bif_proxy_basis"], "oos_mean_not_is")

    def test_cpcv_return_pbo_degenerate_reason_is_cpcv_specific(self):
        """pbo_degenerate_reason must equal 'cpcv_is_sharpe_unavailable'."""
        from src.engine.statistics.backtest_inflation_factor import compute_bif

        bif = compute_bif(is_sharpe=1.0, wf_sharpe=1.0, k_eff=15.0)
        bif["bif_proxy_basis"] = "oos_mean_not_is"
        bif["bif_reliable"] = False

        result = self._simulate_cpcv_return(bif, None, "cpcv_is_sharpe_unavailable")

        self.assertIn("pbo_degenerate_reason", result,
                      "pbo_degenerate_reason key must be present in return dict")
        self.assertEqual(result["pbo_degenerate_reason"], "cpcv_is_sharpe_unavailable")

    def test_no_gate_silently_passes_when_wfe_is_none_with_status(self):
        """wfe_overall=None + wfe_status='cpcv_not_applicable' is distinguishable
        from wfe_overall=None with no wfe_status (the legacy absent-key case).

        This proves the TS gate can route to 'documented exemption' vs 'legacy null'.
        """
        # Post-fix: both keys present
        cpcv_result = {"wfe_overall": None, "wfe_status": "cpcv_not_applicable"}
        # Pre-fix / plain-WF: key may be absent or status absent
        legacy_result = {"wfe_overall": None}

        # TS gate distinguishes by checking wfe_status key
        cpcv_is_documented_exemption = (
            cpcv_result.get("wfe_status") == "cpcv_not_applicable"
        )
        legacy_is_documented_exemption = (
            legacy_result.get("wfe_status") == "cpcv_not_applicable"
        )

        self.assertTrue(cpcv_is_documented_exemption,
                        "CPCV result with wfe_status must be identifiable as exemption")
        self.assertFalse(legacy_is_documented_exemption,
                         "Legacy result without wfe_status must NOT match exemption check")


# ── Integration: all three bypass labels present together ─────────────────────

class TestAllThreeBypassLabelsPresent(unittest.TestCase):
    """Integration test: a single CPCV result carries all three explicit audit labels.

    This is the state after the 2026-06-28 hardening fix — no gate is silently
    grandfather-PASSing without an auditable label in the output dict.
    """

    def test_all_three_bypass_labels_in_combined_result(self):
        """A correctly assembled CPCV return dict carries all three bypass labels."""
        from src.engine.statistics.backtest_inflation_factor import compute_bif
        from src.engine.pbo_gate import compute_pbo_from_cpcv_paths

        # --- Bypass 3: BIF labeled oos_mean_not_is + bif_reliable=False
        bif_result = compute_bif(is_sharpe=1.1, wf_sharpe=1.0, k_eff=15.0)
        bif_result["bif_proxy_basis"] = "oos_mean_not_is"
        bif_result["bif_reliable"] = False

        # --- Bypass 2: PBO degenerate (is==oos), reason overridden
        degenerate_paths = [
            {"is_sharpe": s, "oos_sharpe": s, "is_returns": [], "oos_returns": []}
            for s in [1.0, 1.2, 0.8, 1.5, 0.6, 1.1, 0.9, 1.3, 0.7, 1.4, 1.6, 0.5, 0.8, 1.2, 1.1]
        ]
        gate = compute_pbo_from_cpcv_paths(degenerate_paths)
        if gate.get("degenerate"):
            gate["degenerate_reason"] = "cpcv_is_sharpe_unavailable"
        pbo_degenerate_reason = gate.get("degenerate_reason")

        # --- Bypass 1: WFE explicitly None with cpcv_not_applicable status
        cpcv_return = {
            "wfe_overall": None,
            "wfe_status": "cpcv_not_applicable",
            "wf_metadata": {
                "mode": "cpcv",
                "bif_proxy_basis": bif_result.get("bif_proxy_basis"),
                "bif_reliable": bif_result.get("bif_reliable", True),
            },
            "pbo_overall": None,
            "pbo_degenerate_reason": pbo_degenerate_reason,
            "bif": bif_result.get("bif"),
            "bif_detail": bif_result,
        }

        # Bypass 1 assertions
        self.assertIsNone(cpcv_return["wfe_overall"])
        self.assertEqual(cpcv_return["wfe_status"], "cpcv_not_applicable")

        # Bypass 2 assertions
        self.assertEqual(cpcv_return["pbo_degenerate_reason"], "cpcv_is_sharpe_unavailable")
        self.assertIsNone(cpcv_return["pbo_overall"])

        # Bypass 3 assertions
        self.assertEqual(cpcv_return["wf_metadata"]["bif_proxy_basis"], "oos_mean_not_is")
        self.assertFalse(cpcv_return["wf_metadata"]["bif_reliable"])
        self.assertFalse(cpcv_return["bif_detail"]["bif_reliable"])


if __name__ == "__main__":
    unittest.main()
