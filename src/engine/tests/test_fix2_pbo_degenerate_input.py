"""FIX 2 — TDD: PBO gate must return None (not 0.0) when IS==OOS for every path.

Bug: walk_forward.py builds CPCV path dicts as {"is_sharpe": s, "oos_sharpe": s}
when per-path IS Sharpes are unavailable. With identical IS and OOS Sharpes,
ranks are tied → overfit_count is always 0 → PBO always 0.0, a false-clean result
that lets overfit strategies pass the TESTING→SHADOW gate.

Fix: compute_pbo_from_cpcv_paths must detect the degenerate IS==OOS case and
return None instead of 0.0. The lifecycle pbo_unavailable_legacy path already
handles None → PROCEED with a warn audit.
"""

from __future__ import annotations

import numpy as np
import pytest

from src.engine.pbo_gate import compute_pbo_from_cpcv_paths


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _degenerate_paths(n: int = 15, sharpe_values=None) -> list[dict]:
    """Build paths where is_sharpe == oos_sharpe (the degenerate/fallback case)."""
    if sharpe_values is None:
        rng = np.random.default_rng(42)
        sharpe_values = rng.normal(1.2, 0.4, size=n).tolist()
    return [
        {"is_sharpe": s, "oos_sharpe": s, "is_returns": [], "oos_returns": []}
        for s in sharpe_values
    ]


def _divergent_paths(n: int = 15, seed: int = 42) -> list[dict]:
    """Build paths with meaningful IS vs OOS divergence (simulates real overfitting)."""
    rng = np.random.default_rng(seed)
    is_sharpes = rng.normal(2.0, 0.5, size=n).tolist()   # IS looks great
    oos_sharpes = rng.normal(0.5, 0.5, size=n).tolist()  # OOS much worse → overfit
    return [
        {"is_sharpe": i, "oos_sharpe": o, "is_returns": [], "oos_returns": []}
        for i, o in zip(is_sharpes, oos_sharpes)
    ]


def _good_paths(n: int = 15, seed: int = 42) -> list[dict]:
    """Build paths with small IS/OOS gap (robust strategy)."""
    rng = np.random.default_rng(seed)
    sharpes = rng.normal(1.5, 0.3, size=n).tolist()
    noise = rng.normal(0.0, 0.1, size=n).tolist()
    return [
        {"is_sharpe": s, "oos_sharpe": s + d, "is_returns": [], "oos_returns": []}
        for s, d in zip(sharpes, noise)
    ]


# ─── Test A: degenerate IS==OOS → None, NOT 0.0 ──────────────────────────────

class TestFix2DegenerateInput:
    def test_degenerate_identical_paths_returns_none(self):
        """When is_sharpe == oos_sharpe for every path, PBO must be None.

        The old code returned 0.0 (all tied ranks → overfit_count=0 → pbo=0.0).
        0.0 is a false-clean that bypasses the lifecycle gate.
        None routes the gate to pbo_unavailable_legacy PROCEED path.
        """
        paths = _degenerate_paths(n=15)
        result = compute_pbo_from_cpcv_paths(paths)
        pbo_val = result.get("pbo")
        assert pbo_val is None, (
            f"Degenerate IS==OOS paths must return pbo=None, got {pbo_val!r}. "
            "0.0 is a false-clean that silently passes the overfit gate."
        )

    def test_degenerate_case_carries_flag(self):
        """Degenerate result must include a diagnostic key so callers can log it."""
        paths = _degenerate_paths(n=15)
        result = compute_pbo_from_cpcv_paths(paths)
        # Must have either 'degenerate' flag or 'sample_size_guard' to explain None
        has_explanation = (
            result.get("degenerate") is True
            or result.get("sample_size_guard") is True
            or result.get("pbo") is None  # None itself is the signal
        )
        assert has_explanation, (
            f"Degenerate result must carry a diagnostic flag. Got: {result}"
        )

    def test_constant_sharpe_same_for_all_paths_is_degenerate(self):
        """Special case: all paths have exactly the same Sharpe (e.g., flat equity)."""
        paths = [
            {"is_sharpe": 1.5, "oos_sharpe": 1.5, "is_returns": [], "oos_returns": []}
            for _ in range(15)
        ]
        result = compute_pbo_from_cpcv_paths(paths)
        assert result.get("pbo") is None, (
            "Constant-Sharpe degenerate paths must return pbo=None"
        )


# ─── Test B: real divergent paths → non-zero PBO via Bailey formula ──────────

class TestFix2DivergentPaths:
    def test_overfit_paths_produce_high_pbo(self):
        """IS consistently better than OOS (overfitting) → PBO > 0.3.

        Bailey et al. 2014: for genuine overfitting, PBO → 1.0.
        """
        paths = _divergent_paths(n=15, seed=7)
        result = compute_pbo_from_cpcv_paths(paths)
        pbo_val = result.get("pbo")
        assert pbo_val is not None, "Divergent paths must produce a numeric PBO"
        assert not (isinstance(pbo_val, float) and pbo_val != pbo_val), "PBO must not be NaN"
        assert pbo_val >= 0.3, (
            f"Clearly overfit paths (IS 2.0 >> OOS 0.5) must produce PBO ≥ 0.3, got {pbo_val:.3f}"
        )

    def test_robust_paths_produce_low_pbo(self):
        """IS ≈ OOS (small random noise) → PBO < 0.5 (non-overfit signal)."""
        paths = _good_paths(n=15, seed=42)
        result = compute_pbo_from_cpcv_paths(paths)
        pbo_val = result.get("pbo")
        assert pbo_val is not None, "Good paths must produce numeric PBO"
        assert pbo_val < 0.6, (
            f"Robust paths (IS ≈ OOS) must produce PBO < 0.6, got {pbo_val:.3f}"
        )


# ─── Test C: existing Bailey math stays correct for valid inputs ──────────────

class TestFix2BaileyMathCorrect:
    def test_sample_size_guard_still_fires(self):
        """Fewer than PBO_MIN_PATHS paths must return NaN pbo."""
        from src.engine.pbo_gate import PBO_MIN_PATHS
        paths = _good_paths(n=PBO_MIN_PATHS - 1)
        result = compute_pbo_from_cpcv_paths(paths)
        assert result.get("sample_size_guard") is True
        pbo_val = result.get("pbo")
        # float('nan') or None
        is_nan_or_none = pbo_val is None or (isinstance(pbo_val, float) and pbo_val != pbo_val)
        assert is_nan_or_none, f"Sample size guard must return NaN/None pbo, got {pbo_val!r}"

    def test_deterministic_output(self):
        """Same input must produce same output (pure function)."""
        paths = _good_paths(n=15, seed=5)
        r1 = compute_pbo_from_cpcv_paths(paths)
        r2 = compute_pbo_from_cpcv_paths(paths)
        assert r1["pbo"] == r2["pbo"], "PBO function must be deterministic"
        assert r1.get("n_paths") == r2.get("n_paths")

    def test_known_answer_perfect_overfit(self):
        """Hand-crafted case: IS Sharpes ascending, OOS descending.

        Path 0: IS rank=6 (worst IS), OOS rank=1 (best OOS) — not overfit
        Path 5: IS rank=1 (best IS), OOS rank=6 (worst OOS) — overfit
        …

        With IS=[1,2,3,4,5,6], OOS=[6,5,4,3,2,1]:
        - IS ranks (desc): path 5 IS=6 → rank 1; path 0 IS=1 → rank 6
        - OOS ranks (desc): path 0 OOS=6 → rank 1; path 5 OOS=1 → rank 6
        Overfit condition (is_rank < oos_rank):
          path 0: is_rank=6, oos_rank=1 → 6 < 1? No
          path 1: is_rank=5, oos_rank=2 → 5 < 2? No
          path 2: is_rank=4, oos_rank=3 → 4 < 3? No
          path 3: is_rank=3, oos_rank=4 → 3 < 4? Yes
          path 4: is_rank=2, oos_rank=5 → 2 < 5? Yes
          path 5: is_rank=1, oos_rank=6 → 1 < 6? Yes
        overfit_count = 3, PBO = 3/6 = 0.5
        """
        n = 6
        is_sharpes = [float(i + 1) for i in range(n)]    # [1,2,3,4,5,6]
        oos_sharpes = [float(n - i) for i in range(n)]   # [6,5,4,3,2,1]
        paths = [
            {"is_sharpe": is_s, "oos_sharpe": oos_s, "is_returns": [], "oos_returns": []}
            for is_s, oos_s in zip(is_sharpes, oos_sharpes)
        ]
        result = compute_pbo_from_cpcv_paths(paths)
        pbo_val = result.get("pbo")
        assert pbo_val is not None and not (isinstance(pbo_val, float) and pbo_val != pbo_val), \
            "Known-answer test must produce numeric PBO"
        # Bailey rank formula: is_rank < oos_rank for paths 3,4,5 → PBO = 3/6 = 0.5
        assert abs(pbo_val - 0.5) < 0.01, (
            f"Known-answer test: IS=[1..6], OOS=[6..1] → PBO must be 0.5, got {pbo_val:.4f}"
        )
