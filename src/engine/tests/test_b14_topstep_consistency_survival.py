"""B14 Survival Twin — Topstep 50% consistency rule fix, 2026-06-22.

Tests cover all 4 confirmed gaps from the B14 audit:

  Gap 1 (CRITICAL): _consistency_map missing "topstep_50pct" → spiky Topstep
         distribution must yield HIGH consistency_fail_rate (NOT near 0).

  Gap 2: Trailing-DD breach fires on EOD basis for Topstep.
         Paths that trip the EOD $2000 floor must register in breach_mask.

  Gap 3: payout_denial rate exposed in simulate_firm_survival output.
         "consistency_fail_rate" is the documented output field; it must be
         non-zero on a spiky distribution for Topstep.

  Gap 4: MFFU parity unchanged — MFFU consistency enforcement is unaffected.

  Determinism: same seeded paths → same result (replay determinism).

NOTE: vectorbt is NOT imported here.  simulate_firm_survival is a pure
numpy path — no backtester import required.  If a bare "import
src.engine.monte_carlo" hangs your collection (JIT warmup), mock sys.modules
for the heavy backtester dep BEFORE this file is collected.  See conftest.
"""
from __future__ import annotations

import numpy as np
import pytest


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _make_spiky_paths(n_sims: int, n_steps: int, seed: int) -> np.ndarray:
    """Build paths with a single-day spike > 50% of cumulative profit.

    Day 0: +2000  (large spike)
    Days 1-N: small positive returns (+50 each)
    Total profit over eval period: 2000 + 50*(n_steps-1)
    Day 0 fraction = 2000 / total_profit > 50% when n_steps <= 40

    All sims are identical so the effect is deterministic and total.
    """
    returns = np.full((n_sims, n_steps), 50.0)
    returns[:, 0] = 2000.0  # spike on day 0
    return np.cumsum(returns, axis=1)


def _make_flat_paths(n_sims: int, n_steps: int, seed: int) -> np.ndarray:
    """Paths with even daily P&L — no consistency violation."""
    rng = np.random.default_rng(seed)
    # Narrow variance so DD breach is unlikely; consistent daily profit
    returns = rng.normal(100.0, 20.0, size=(n_sims, n_steps))
    return np.cumsum(returns, axis=1)


def _make_dd_breach_paths(n_sims: int, n_steps: int, seed: int) -> np.ndarray:
    """Paths that trip Topstep $2000 EOD trailing DD early then recover.

    Phase 1 (steps 0-9): -300/step → -3000 cumulative (beyond $2000 floor)
    Phase 2 (steps 10-N): +200/step → strong recovery to positive terminal
    """
    phase1 = np.full((n_sims, 10), -300.0)
    phase2 = np.full((n_sims, n_steps - 10), 200.0)
    returns = np.concatenate([phase1, phase2], axis=1)
    return np.cumsum(returns, axis=1)


# ─── Gap 1: Topstep spiky distribution → high consistency_fail_rate ───────────

class TestTopstepConsistencyInSurvivalSim:
    """Gap 1 (CRITICAL): topstep_50pct missing from _consistency_map.

    Before the fix: consistency_ratio == None for Topstep → the check block
    is never entered → consistency_fail_rate == 0 even with a 2000-dollar
    single-day spike that is >50% of cumulative profit.

    After the fix: consistency_fail_rate must be near 1.0 (every spiky path
    fails — all n_sims identical).

    FINDING-4 note: Topstep standard lane (default) disables the consistency cap.
    These tests verify consistency-lane behavior, so they force TOPSTEP_PAYOUT_LANE=consistency.
    """

    @pytest.fixture(autouse=True)
    def _force_consistency_lane(self, monkeypatch):
        """Force Topstep consistency payout lane so the 50% cap is active."""
        monkeypatch.setenv("TOPSTEP_PAYOUT_LANE", "consistency")

    def test_topstep_spiky_paths_yield_high_consistency_fail_rate(self):
        """[FAILING BEFORE FIX] Spiky paths (day-0 = 60%+ of profit) → high consistency breach."""
        from src.engine.monte_carlo import simulate_firm_survival

        n_sims, n_steps = 500, 30
        # Day 0 = 2000; total = 2000 + 29*50 = 3450; 2000/3450 = 58% > 50%
        paths = _make_spiky_paths(n_sims, n_steps, seed=1)
        result = simulate_firm_survival(paths, "topstep_50k", account_size=50000)

        # Must NOT be an error dict
        assert "error" not in result, f"simulate_firm_survival returned error: {result}"

        cfr = result["consistency_fail_rate"]
        assert cfr > 0.80, (
            f"[GAP 1 UNFIXED] Topstep consistency_fail_rate={cfr:.3f}. "
            f"Expected > 0.80 on paths where single day is ~58% of total profit. "
            f"Before fix: cfr == 0.0 because 'topstep_50pct' absent from _consistency_map."
        )

    def test_topstep_spiky_consistency_breach_reason_count(self):
        """[FAILING BEFORE FIX] breach_reasons['consistency'] must be high on spiky paths."""
        from src.engine.monte_carlo import simulate_firm_survival

        n_sims, n_steps = 200, 30
        paths = _make_spiky_paths(n_sims, n_steps, seed=2)
        result = simulate_firm_survival(paths, "topstep_50k", account_size=50000)

        consistency_count = result["breach_reasons"].get("consistency", 0)
        # Most sims complete the eval (positive path) but are denied on consistency
        # We assert at least 50% trigger the consistency breach
        assert consistency_count > n_sims * 0.50, (
            f"[GAP 1 UNFIXED] breach_reasons['consistency']={consistency_count} "
            f"out of {n_sims} sims. Expected > {n_sims * 0.50:.0f}. "
            f"Before fix: always 0 because topstep_50pct absent from _consistency_map."
        )

    def test_topstep_consistency_breach_in_breach_mask(self):
        """[FAILING BEFORE FIX] Consistency breaches must set breach_mask=1."""
        from src.engine.monte_carlo import simulate_firm_survival

        n_sims, n_steps = 200, 30
        paths = _make_spiky_paths(n_sims, n_steps, seed=3)
        result = simulate_firm_survival(paths, "topstep_50k", account_size=50000)

        mask = result["breach_mask"]
        consistency_count = result["breach_reasons"].get("consistency", 0)
        breach_count = int(np.sum(mask))

        # breach_mask count must be >= consistency count (consistency is always in breach_mask)
        assert breach_count >= consistency_count, (
            f"breach_mask sum ({breach_count}) < consistency breach count ({consistency_count}). "
            "Consistency breaches must always set breach_mask=1."
        )
        # And must be substantial (not zero)
        assert breach_count > n_sims * 0.50, (
            f"[GAP 1 UNFIXED] breach_mask sum={breach_count}. Before fix: 0 because "
            "Topstep consistency was never enforced in simulate_firm_survival."
        )

    def test_topstep_flat_paths_pass_consistency(self):
        """Flat paths (25% max day) must NOT trigger consistency breach for Topstep."""
        from src.engine.monte_carlo import simulate_firm_survival

        n_sims, n_steps = 200, 60
        paths = _make_flat_paths(n_sims, n_steps, seed=4)
        result = simulate_firm_survival(paths, "topstep_50k", account_size=50000)

        cfr = result["consistency_fail_rate"]
        # On evenly-distributed paths, consistency should be very low (< 5%)
        assert cfr < 0.05, (
            f"Flat paths (narrow spread) should have very low Topstep consistency_fail_rate. "
            f"Got: {cfr:.3f}. Something is wrong with the 50% threshold logic."
        )

    def test_topstep_consistency_ratio_in_map_is_0_50(self):
        """Verify _consistency_map directly — topstep_50pct must map to 0.50.

        Build paths that EXCEED the $3000 profit target (so passed_eval fires and
        the consistency check is entered), then verify the 50% threshold fires/passes
        at the correct boundary.

        Structure:
          day 0: large spike (+1530)  → 51% of total positive P&L
          days 1-59: +50 each         → 59 × 50 = +2950
          Total positive P&L = 1530 + 2950 = 4480  (exceeds $3000 target)
          Spike fraction = 1530/4480 = 34.2%  — wait, that's < 50%.

        Better structure:
          day 0: +2550 spike
          days 1-9: +50 each (total +500)
          Total = 3050, passes $3000 target.
          Spike fraction = 2550/3050 = 83.6% → clear violation.
        """
        from src.engine.monte_carlo import simulate_firm_survival

        n_sims = 50

        # Case 1: spike = 83.6% of total → violation
        n_steps = 10
        returns = np.zeros((n_sims, n_steps))
        returns[:, 0] = 2550.0   # spike
        returns[:, 1:] = 50.0    # small even trickle fills out the eval
        paths = np.cumsum(returns, axis=1)
        # paths[:, -1] cumulative = 2550 + 9*50 = 3000 on step 9 (exactly at target).
        # Actually cumsum means path hits 2550 on step 0, 2600 on step 1, ..., 3000 on step 9.
        # passed_eval fires when balance - account_size >= 3000 → balance >= 53000.
        # balance starts at 50000; reaches 53000 when cumsum = 3000, which is step 9.
        # So passed_eval = True, consistency check fires, spike = 83.6% → violation.

        result = simulate_firm_survival(paths, "topstep_50k", account_size=50000)
        cfr = result["consistency_fail_rate"]
        assert cfr > 0.80, (
            f"[GAP 1 UNFIXED] 83%-spike paths: consistency_fail_rate={cfr:.3f}. "
            f"Expected > 0.80. Before fix: 0.0 because topstep_50pct absent from map."
        )

        # Case 2: even distribution (each day = 300/10 = 10% of profit) → pass
        returns2 = np.zeros((n_sims, n_steps))
        returns2[:, :] = 305.0   # 10 days × $305 = $3050 total profit
        paths2 = np.cumsum(returns2, axis=1)
        result2 = simulate_firm_survival(paths2, "topstep_50k", account_size=50000)
        cfr2 = result2["consistency_fail_rate"]
        # 10% per day is well under 50% → should pass consistency
        assert cfr2 < 0.10, (
            f"Even-distribution paths (10% per day) should PASS Topstep consistency. "
            f"Got consistency_fail_rate={cfr2:.3f}."
        )


# ─── Gap 2: Topstep EOD trailing-DD breach fires correctly ────────────────────

class TestTopstepEodTrailingDdBreach:
    """Gap 2: EOD trailing drawdown must fire for Topstep.

    Topstep trailing DD = EOD. Paths that drop $2100 from HWM within the
    first 10 days must trigger a breach even if they recover later.
    """

    def test_topstep_dd_breach_detected(self):
        """Paths with early -$3000 loss trip EOD trailing DD → breach_mask = 1."""
        from src.engine.monte_carlo import simulate_firm_survival

        n_sims, n_steps = 200, 40
        paths = _make_dd_breach_paths(n_sims, n_steps, seed=5)

        # Most paths will trip the $2000 trailing DD in the early phase
        result = simulate_firm_survival(paths, "topstep_50k", account_size=50000)
        assert "error" not in result

        dd_count = result["breach_reasons"].get("trailing_dd", 0)
        mask_sum = int(np.sum(result["breach_mask"]))

        # Phase 1 is -300/step × 10 steps = -3000 from start = $47,000 balance.
        # HWM = 50,000 (locked at start). Floor = 50,000 - 2,000 = 48,000.
        # After step 6 (balance = 50,000 - 6*300 = 48,200 > 48,000), step 7
        # (balance = 47,900 < 48,000) → breach fires.
        # EVERY path (identical construction) must breach.
        assert dd_count >= n_sims * 0.95, (
            f"Expected nearly all {n_sims} paths to breach trailing DD. "
            f"breach_reasons['trailing_dd']={dd_count}. "
            "If EOD trailing DD is not correctly modeled, this count will be low."
        )
        assert mask_sum >= n_sims * 0.95, (
            f"breach_mask sum={mask_sum}. Expected ≥ 95% of {n_sims} sims breached."
        )

    def test_topstep_eod_trailing_is_eod_not_realtime(self):
        """Topstep trailing mode must be 'eod', not 'realtime'."""
        from src.engine.monte_carlo import simulate_firm_survival

        n_sims, n_steps = 100, 60
        paths = _make_flat_paths(n_sims, n_steps, seed=6)
        result = simulate_firm_survival(paths, "topstep_50k", account_size=50000)

        # realtime_trailing must be False for Topstep
        assert result["realtime_trailing"] is False, (
            f"Topstep must use EOD trailing DD, not realtime. "
            f"realtime_trailing={result['realtime_trailing']}"
        )

    def test_topstep_never_hit_target_not_in_breach_mask(self):
        """Paths that never hit profit target must NOT be in breach_mask
        (account not closed — just never profitable enough to pass).
        """
        from src.engine.monte_carlo import simulate_firm_survival

        # Flat +$0 paths → never hit $3000 profit target, never breach DD
        n_sims, n_steps = 200, 60
        returns = np.full((n_sims, n_steps), 0.0)
        paths = np.cumsum(returns, axis=1)

        result = simulate_firm_survival(paths, "topstep_50k", account_size=50000)
        mask_sum = int(np.sum(result["breach_mask"]))
        nht = result["breach_reasons"].get("never_hit_target", 0)

        assert mask_sum == 0, (
            f"never_hit_target paths must NOT be in breach_mask. "
            f"breach_mask sum={mask_sum}, never_hit_target count={nht}"
        )


# ─── Gap 3: payout_denial exposure ────────────────────────────────────────────

class TestPayoutDenialExposed:
    """Gap 3: consistency_fail_rate must be non-zero for Topstep on spiky paths.

    This is the payout_denial metric: consistency violation = payout denied.
    The field is named "consistency_fail_rate" in the output schema.
    It must be non-zero when Topstep's 50% rule is violated.

    FINDING-4 note: Standard lane (default) disables Topstep consistency cap.
    These tests verify the rule fires when requested, so force consistency lane.
    """

    @pytest.fixture(autouse=True)
    def _force_consistency_lane(self, monkeypatch):
        """Force Topstep consistency payout lane so the 50% cap is active."""
        monkeypatch.setenv("TOPSTEP_PAYOUT_LANE", "consistency")

    def test_consistency_fail_rate_key_present(self):
        """consistency_fail_rate must exist in simulate_firm_survival output."""
        from src.engine.monte_carlo import simulate_firm_survival

        n_sims, n_steps = 100, 30
        paths = _make_spiky_paths(n_sims, n_steps, seed=7)
        result = simulate_firm_survival(paths, "topstep_50k", account_size=50000)

        assert "consistency_fail_rate" in result, (
            "consistency_fail_rate (payout_denial_probability) missing from output"
        )

    def test_consistency_fail_rate_nonzero_on_spiky_topstep(self):
        """[FAILING BEFORE FIX] consistency_fail_rate must be > 0 for Topstep on spiky paths."""
        from src.engine.monte_carlo import simulate_firm_survival

        n_sims, n_steps = 300, 30
        paths = _make_spiky_paths(n_sims, n_steps, seed=8)
        result = simulate_firm_survival(paths, "topstep_50k", account_size=50000)

        cfr = result["consistency_fail_rate"]
        assert cfr > 0.0, (
            f"[GAP 3 UNFIXED] consistency_fail_rate={cfr}. "
            "Expected > 0.0 for Topstep on paths with day-0 spike > 50% of total profit. "
            "Before fix: 0.0 because topstep_50pct absent from _consistency_map."
        )

    def test_consistency_fail_rate_is_fraction_in_range(self):
        """consistency_fail_rate must be in [0, 1]."""
        from src.engine.monte_carlo import simulate_firm_survival

        n_sims, n_steps = 200, 30
        paths = _make_spiky_paths(n_sims, n_steps, seed=9)
        result = simulate_firm_survival(paths, "topstep_50k", account_size=50000)

        cfr = result["consistency_fail_rate"]
        assert 0.0 <= cfr <= 1.0, f"consistency_fail_rate={cfr} out of [0,1]"


# ─── Gap 4: MFFU parity unchanged ─────────────────────────────────────────────

class TestMffuParityUnchanged:
    """Gap 4: MFFU must still enforce its 50% consistency rule correctly.

    The fix for Topstep must not regress MFFU.
    MFFU uses sliding-window (payout_cycle_days=14); Topstep uses full-path fallback.
    Both must correctly flag spiky distributions.
    """

    def test_mffu_consistency_explicitly_skipped_in_b14_sim(self):
        """MFFU consistency is an EXPLICIT skip in B14 (deepscan5 2026-06-29).

        W3B 2026-07-17 test-truth fix: this test previously asserted cfr > 0.50
        on spiky paths and had been RED since deepscan5 landed. Canonical
        behavior (monte_carlo.py + firm_config.py): mffu_50pct_sim_payout
        applies ONLY at the discrete SIM-FUNDED payout stage — NONE at eval,
        NONE live — and the B14 eval+funded sim does not model that stage, so
        simulate_firm_survival intentionally sets consistency_ratio=None for
        mffu_50k. Pin the documented skip (cfr == 0.0), so an accidental
        re-enable OR a silent map-miss regression both surface here.
        """
        from src.engine.monte_carlo import simulate_firm_survival

        n_sims, n_steps = 300, 30
        paths = _make_spiky_paths(n_sims, n_steps, seed=10)
        result = simulate_firm_survival(paths, "mffu_50k", account_size=50000)

        assert "error" not in result
        cfr = result["consistency_fail_rate"]
        assert cfr == 0.0, (
            f"MFFU consistency_fail_rate={cfr:.3f} on spiky paths. Expected 0.0 — "
            "B14 explicitly skips MFFU consistency (sim-payout-stage only, deepscan5 "
            "2026-06-29). Re-enabling requires modeling the sim-payout stage."
        )

    def test_mffu_flat_paths_pass_consistency(self):
        """MFFU flat paths must still pass consistency after Topstep fix."""
        from src.engine.monte_carlo import simulate_firm_survival

        n_sims, n_steps = 200, 60
        paths = _make_flat_paths(n_sims, n_steps, seed=11)
        result = simulate_firm_survival(paths, "mffu_50k", account_size=50000)

        cfr = result["consistency_fail_rate"]
        assert cfr < 0.05, (
            f"MFFU flat paths should have very low consistency_fail_rate. Got: {cfr:.3f}"
        )

    def test_mffu_dd_breach_still_fires(self):
        """MFFU EOD trailing DD breach detection unchanged."""
        from src.engine.monte_carlo import simulate_firm_survival

        n_sims, n_steps = 200, 40
        paths = _make_dd_breach_paths(n_sims, n_steps, seed=12)
        result = simulate_firm_survival(paths, "mffu_50k", account_size=50000)

        dd_count = result["breach_reasons"].get("trailing_dd", 0)
        assert dd_count >= n_sims * 0.90, (
            f"MFFU trailing DD breach must still fire on drop-then-recover paths. "
            f"Got dd_count={dd_count} of {n_sims}."
        )

    def test_mffu_realtime_trailing_is_false(self):
        """MFFU must also use EOD trailing, not realtime."""
        from src.engine.monte_carlo import simulate_firm_survival

        n_sims, n_steps = 50, 30
        paths = _make_flat_paths(n_sims, n_steps, seed=13)
        result = simulate_firm_survival(paths, "mffu_50k", account_size=50000)

        assert result["realtime_trailing"] is False, (
            f"MFFU must use EOD trailing DD. Got realtime_trailing={result['realtime_trailing']}"
        )


# ─── Determinism / replay ─────────────────────────────────────────────────────

class TestReplayDeterminism:
    """Seeded identical inputs must produce identical outputs (replay invariant)."""

    def test_topstep_deterministic_on_repeated_call(self):
        """Same paths, same firm → identical result on second call."""
        from src.engine.monte_carlo import simulate_firm_survival

        n_sims, n_steps = 200, 40
        paths = _make_spiky_paths(n_sims, n_steps, seed=99)

        r1 = simulate_firm_survival(paths, "topstep_50k", account_size=50000)
        r2 = simulate_firm_survival(paths, "topstep_50k", account_size=50000)

        assert r1["consistency_fail_rate"] == r2["consistency_fail_rate"], (
            "simulate_firm_survival must be deterministic: same inputs → same consistency_fail_rate"
        )
        assert r1["eval_pass_rate"] == r2["eval_pass_rate"], (
            "simulate_firm_survival must be deterministic: same inputs → same eval_pass_rate"
        )
        assert np.array_equal(r1["breach_mask"], r2["breach_mask"]), (
            "simulate_firm_survival must be deterministic: same inputs → same breach_mask"
        )

    def test_mffu_deterministic_on_repeated_call(self):
        """Same paths, MFFU → identical result on second call."""
        from src.engine.monte_carlo import simulate_firm_survival

        n_sims, n_steps = 200, 40
        paths = _make_flat_paths(n_sims, n_steps, seed=98)

        r1 = simulate_firm_survival(paths, "mffu_50k", account_size=50000)
        r2 = simulate_firm_survival(paths, "mffu_50k", account_size=50000)

        assert r1["consistency_fail_rate"] == r2["consistency_fail_rate"]
        assert np.array_equal(r1["breach_mask"], r2["breach_mask"])

    def test_different_seeds_different_flat_paths_differ(self):
        """Sanity: different RNG seeds produce different flat paths."""
        n_sims, n_steps = 100, 30
        paths_a = _make_flat_paths(n_sims, n_steps, seed=1)
        paths_b = _make_flat_paths(n_sims, n_steps, seed=2)
        assert not np.allclose(paths_a, paths_b), (
            "Sanity: different seeds should produce different paths."
        )


# ─── Both firms parity (combined) ─────────────────────────────────────────────

class TestBothFirmsParityOnSamePaths:
    """Both Topstep and MFFU must enforce the 50% rule on the same spiky paths."""

    def test_both_firms_flag_spiky_distribution(self, monkeypatch):
        """Topstep (consistency lane) flags spiky paths; MFFU is an explicit skip.

        FINDING-4 note: Topstep standard lane (default) disables consistency.
        This test explicitly verifies consistency-lane behavior — force the lane.

        W3B 2026-07-17 test-truth fix: the MFFU half previously asserted
        cfr > 0.50 and had been RED since deepscan5 (2026-06-29) made MFFU
        consistency an EXPLICIT skip in B14 (mffu_50pct_sim_payout applies only
        at the discrete sim-funded payout stage, which this sim does not model).
        The MFFU expectation now pins the documented skip.
        """
        monkeypatch.setenv("TOPSTEP_PAYOUT_LANE", "consistency")

        from src.engine.monte_carlo import simulate_firm_survival

        n_sims, n_steps = 400, 30
        paths = _make_spiky_paths(n_sims, n_steps, seed=20)

        topstep = simulate_firm_survival(paths, "topstep_50k", account_size=50000)
        mffu = simulate_firm_survival(paths, "mffu_50k", account_size=50000)

        assert topstep["consistency_fail_rate"] > 0.50, (
            f"[GAP 1 UNFIXED] Topstep consistency_fail_rate={topstep['consistency_fail_rate']:.3f}. "
            "Should be high on spiky paths."
        )
        assert mffu["consistency_fail_rate"] == 0.0, (
            f"MFFU consistency_fail_rate={mffu['consistency_fail_rate']:.3f}. "
            "Expected 0.0 — B14 explicitly skips MFFU consistency (deepscan5 2026-06-29)."
        )

    def test_both_firms_pass_flat_distribution(self):
        """Flat paths → both firms low consistency_fail_rate."""
        from src.engine.monte_carlo import simulate_firm_survival

        n_sims, n_steps = 300, 60
        paths = _make_flat_paths(n_sims, n_steps, seed=21)

        topstep = simulate_firm_survival(paths, "topstep_50k", account_size=50000)
        mffu = simulate_firm_survival(paths, "mffu_50k", account_size=50000)

        assert topstep["consistency_fail_rate"] < 0.05, (
            f"Topstep should have near-zero consistency_fail_rate on flat paths. "
            f"Got: {topstep['consistency_fail_rate']:.3f}"
        )
        assert mffu["consistency_fail_rate"] < 0.05, (
            f"MFFU should have near-zero consistency_fail_rate on flat paths. "
            f"Got: {mffu['consistency_fail_rate']:.3f}"
        )
