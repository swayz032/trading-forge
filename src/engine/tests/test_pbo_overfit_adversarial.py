"""deep-scan Backtest failure-injection: the PBO overfit gate must FIRE on fabricated overfit-shaped
CPCV paths (best-IS = worst-OOS rank inversion) and NOT false-alarm on robust (rank-aligned) paths.

This is the accuracy-validator "fabricate a known-bad fixture and confirm the detector catches it"
discipline: the existing pbo tests cover degenerate/happy-path, but none feed a deliberately
overfit-shaped path set and assert the gate separates it from a robust one. Proves the detector is
not a tautology that would pass overfit data too.
"""
from src.engine.pbo_gate import compute_pbo_from_cpcv_paths


def _paths(is_sharpes, oos_sharpes):
    return [{"is_sharpe": a, "oos_sharpe": b} for a, b in zip(is_sharpes, oos_sharpes)]


def _overfit(n=12):
    # best IS is worst OOS (perfect rank inversion) — the textbook overfit signature.
    return _paths([0.5 + i * 0.2 for i in range(n)], [0.5 + (n - 1 - i) * 0.2 for i in range(n)])


def _robust(n=12):
    # IS and OOS ranks aligned (not equal → not degenerate) — a genuinely robust strategy.
    return _paths([0.5 + i * 0.2 for i in range(n)], [0.4 + i * 0.2 for i in range(n)])


class TestPboOverfitAdversarial:
    def test_overfit_paths_yield_high_pbo_blocked_by_institutional_gate(self):
        r = compute_pbo_from_cpcv_paths(_overfit())
        assert r["pbo"] is not None
        assert r["pbo"] == r["pbo"]  # not NaN
        # 0.15 is the Wave-29 institutional PBO block threshold; overfit-shaped data must exceed it.
        assert r["pbo"] >= 0.15, f"overfit-shaped paths must trip the PBO gate, got {r['pbo']}"

    def test_robust_paths_yield_low_pbo_passes_gate(self):
        r = compute_pbo_from_cpcv_paths(_robust())
        assert r["pbo"] is not None
        assert r["pbo"] < 0.15, f"robust paths must pass the PBO gate, got {r['pbo']}"

    def test_overfit_pbo_strictly_exceeds_robust_pbo(self):
        """The core non-tautology: the SAME function separates overfit from robust."""
        overfit_pbo = compute_pbo_from_cpcv_paths(_overfit())["pbo"]
        robust_pbo = compute_pbo_from_cpcv_paths(_robust())["pbo"]
        assert overfit_pbo > robust_pbo, f"overfit {overfit_pbo} must exceed robust {robust_pbo}"
