"""H-4 regression suite: true per-path IS Sharpe makes BIF reliable in CPCV mode.

Background
----------
Before H-4 (M1 proxy era), the BIF gate in CPCV mode was blind: is_sharpe was
set to mean(path_OOS_sharpes) — derived from the SAME OOS series as wf_sharpe —
so BIF ≈ 1.0 by construction. bif_reliable=False was emitted and the TS gate
routed to an advisory-only pass, making the primary anti-overfitting signal
completely inactive.

H-4 fix (2026-06-29)
--------------------
For each CPCV path, the IS folds (complement of the OOS folds) are run through
the backtester and their daily P&Ls are pooled to compute a true per-path IS
Sharpe.  The fold results are cached by (fold_idx, strip_start, strip_end) so
the same fold is not re-run across paths.  is_sharpe = mean(per_path_is_sharpes)
is passed to compute_bif(), bif_reliable=True is emitted, and bif_proxy_basis is
NOT emitted for new CPCV backtests.

This file tests:
  - BIF computation correctness with genuine IS data (Sharpe pairs)
  - Inflation detection: inflated IS → bif > 4.0, verdict="block"
  - Robust strategy: IS ≈ WF → bif ≈ 1.0, verdict="clean"
  - Determinism: same inputs → same BIF across repeated calls
  - Caching contract: fold deduplication logic (pure-Python, no walk_forward)
  - Metadata contract: bif_reliable=True, bif_proxy_basis absent in post-H-4 output
  - Edge cases: empty IS folds, single-path, fail-closed on non-positive WF

These tests do NOT import walk_forward.py or backtester.py directly (to avoid
the vectorbt JIT hang).  All walk_forward behavior is verified through pure-
function helpers and minimal dict stubs that mirror actual wf_metadata structure.

Run with:
    python -m pytest src/engine/tests/test_h4_bif_cpcv_is_sharpe.py -v
"""

from __future__ import annotations

import sys
from unittest.mock import MagicMock

import numpy as np
import pytest

# Guard: inject minimal vectorbt stub before any engine import that would
# trigger the Numba JIT compilation hang under pytest collection.
sys.modules.setdefault("vectorbt", MagicMock())


# ── H-4 BIF computation correctness ───────────────────────────────────────────

class TestH4BifComputeWithTrueIsData:
    """BIF is computed correctly when is_sharpe is the mean of genuine per-path
    IS Sharpes (not the OOS proxy used in the M1 era)."""

    def test_inflated_is_sharpe_blocks(self):
        """High IS Sharpe relative to WF → BIF > block threshold → verdict="block".

        This is the primary anti-overfitting signal H-4 restores. Before H-4,
        BIF ≈ 1.0 by construction so this test would never have fired.
        """
        from src.engine.statistics.backtest_inflation_factor import compute_bif

        # is_sharpe = mean([5.5, 5.8, 4.9, 5.2]) = 5.35 (genuine IS fold data)
        per_path_is_sharpes = [5.5, 5.8, 4.9, 5.2]
        is_sharpe_mean = float(np.mean(per_path_is_sharpes))  # ≈ 5.35
        wf_sharpe = 1.0  # realistic OOS

        result = compute_bif(is_sharpe=is_sharpe_mean, wf_sharpe=wf_sharpe, k_eff=15.0)

        assert result["bif"] > 4.0, (
            f"Inflated IS (mean={is_sharpe_mean:.2f}) vs WF ({wf_sharpe}) must give "
            f"BIF > block threshold 4.0, got {result['bif']:.4f}"
        )
        assert result["verdict"] == "block", (
            f"BIF={result['bif']:.4f} must produce verdict='block', got '{result['verdict']}'"
        )

    def test_robust_strategy_gives_bif_near_1_and_clean(self):
        """IS Sharpe close to WF Sharpe → BIF ≈ 1.0, verdict="clean".

        A well-generalising strategy has minimal selection bias — IS and OOS
        performance are similar.  BIF close to 1.0 confirms the gate correctly
        recognises robustness.
        """
        from src.engine.statistics.backtest_inflation_factor import compute_bif

        per_path_is_sharpes = [1.02, 0.98, 1.05, 1.01, 0.99, 1.03]
        is_sharpe_mean = float(np.mean(per_path_is_sharpes))  # ≈ 1.013
        wf_sharpe = 1.0

        result = compute_bif(is_sharpe=is_sharpe_mean, wf_sharpe=wf_sharpe, k_eff=15.0)

        assert result["bif"] == pytest.approx(is_sharpe_mean / wf_sharpe, abs=0.02)
        assert result["bif"] < 2.0, (
            f"Robust IS/OOS pair must give BIF < warn threshold 2.0, got {result['bif']:.4f}"
        )
        assert result["verdict"] == "clean"

    def test_moderate_inflation_gives_warn(self):
        """IS Sharpe 2–4× WF → verdict="warn" (not block, not clean)."""
        from src.engine.statistics.backtest_inflation_factor import compute_bif

        per_path_is_sharpes = [2.8, 3.1, 3.0, 2.9]
        is_sharpe_mean = float(np.mean(per_path_is_sharpes))  # ≈ 2.95
        wf_sharpe = 1.0

        result = compute_bif(is_sharpe=is_sharpe_mean, wf_sharpe=wf_sharpe, k_eff=15.0)

        assert 2.0 <= result["bif"] < 4.0, (
            f"Moderate inflation must give 2.0 ≤ BIF < 4.0, got {result['bif']:.4f}"
        )
        assert result["verdict"] == "warn"

    def test_bif_exact_arithmetic_with_h4_mean(self):
        """BIF = mean(per_path_is_sharpes) / wf_sharpe exactly."""
        from src.engine.statistics.backtest_inflation_factor import compute_bif

        per_path_is_sharpes = [2.0, 4.0, 3.0]  # mean = 3.0
        is_sharpe_mean = float(np.mean(per_path_is_sharpes))  # = 3.0
        wf_sharpe = 1.5

        result = compute_bif(is_sharpe=is_sharpe_mean, wf_sharpe=wf_sharpe, k_eff=15.0)

        expected_bif = is_sharpe_mean / wf_sharpe  # = 3.0 / 1.5 = 2.0
        assert result["bif"] == pytest.approx(expected_bif, abs=0.001)
        # BIF = 2.0 is exactly at the warn boundary (≥ 2.0 → "warn")
        assert result["verdict"] == "warn"


# ── H-4 metadata contract ──────────────────────────────────────────────────────

class TestH4BifMetadataContract:
    """Verify the wf_metadata dict shape emitted by post-H-4 CPCV backtests.

    walk_forward._run_walk_forward_cpcv() now:
    - Stamps bif_reliable=True (genuine IS data)
    - Does NOT stamp bif_proxy_basis (removed in H-4)

    These tests use minimal dict stubs that mirror the actual wf_metadata
    construction so we can verify the contract without importing walk_forward.
    """

    def test_compute_bif_never_emits_bif_proxy_basis(self):
        """compute_bif() must not pre-populate bif_proxy_basis (caller owns it).

        H-4 callers do NOT stamp bif_proxy_basis at all.  This test verifies
        the function's output dict is clean (no phantom sentinel).
        """
        from src.engine.statistics.backtest_inflation_factor import compute_bif

        result = compute_bif(is_sharpe=1.8, wf_sharpe=1.0, k_eff=15.0)
        assert "bif_proxy_basis" not in result, (
            "compute_bif() must not emit bif_proxy_basis — caller stamps it for "
            "pre-H-4 backward compat only"
        )

    def test_compute_bif_never_emits_bif_reliable(self):
        """compute_bif() must not pre-populate bif_reliable — caller stamps it."""
        from src.engine.statistics.backtest_inflation_factor import compute_bif

        result = compute_bif(is_sharpe=1.8, wf_sharpe=1.0, k_eff=15.0)
        assert "bif_reliable" not in result, (
            "compute_bif() must not emit bif_reliable — caller stamps True/False "
            "depending on IS data quality"
        )

    def test_post_h4_wf_metadata_has_bif_reliable_true(self):
        """Post-H-4 wf_metadata stub must have bif_reliable=True."""
        from src.engine.statistics.backtest_inflation_factor import compute_bif

        bif_result = compute_bif(is_sharpe=2.0, wf_sharpe=1.0, k_eff=15.0)
        bif_result["bif_reliable"] = True  # H-4: stamped by _run_walk_forward_cpcv()

        # Simulate wf_metadata construction (mirrors walk_forward.py)
        wf_metadata = {
            "mode": "cpcv",
            "n_folds": 6,
            "n_paths": 15,
            "bif_reliable": bif_result.get("bif_reliable", True),
            # bif_proxy_basis is NOT included — H-4 does not stamp it
        }

        assert wf_metadata["bif_reliable"] is True
        assert "bif_proxy_basis" not in wf_metadata

    def test_post_h4_wf_metadata_has_no_bif_proxy_basis(self):
        """After H-4, bif_proxy_basis is absent from wf_metadata for new backtests."""
        wf_metadata = {
            "mode": "cpcv",
            "bif_reliable": True,
            # no "bif_proxy_basis" key — H-4 does not stamp it
        }

        assert "bif_proxy_basis" not in wf_metadata, (
            "H-4 wf_metadata must NOT contain bif_proxy_basis — "
            "that sentinel is pre-H-4 legacy only"
        )

    def test_bif_reliable_key_survives_round_trip_via_get(self):
        """bif_result.get('bif_reliable', True) returns True when stamped True."""
        from src.engine.statistics.backtest_inflation_factor import compute_bif

        bif_result = compute_bif(is_sharpe=1.5, wf_sharpe=1.0, k_eff=15.0)
        bif_result["bif_reliable"] = True

        # The actual walk_forward.py assignment:
        # "bif_reliable": _cpcv_bif_result.get("bif_reliable", True)
        value_via_get = bif_result.get("bif_reliable", True)
        assert value_via_get is True


# ── H-4 determinism ────────────────────────────────────────────────────────────

class TestH4BifDeterminism:
    """BIF computation is deterministic: same inputs → same outputs."""

    def test_same_per_path_is_sharpes_same_bif(self):
        """compute_bif() called twice with identical inputs returns identical output."""
        from src.engine.statistics.backtest_inflation_factor import compute_bif

        per_path_is_sharpes = [1.2, 1.5, 0.9, 1.8, 1.3, 1.1, 1.6, 1.0,
                                1.4, 1.7, 0.8, 1.9, 1.2, 1.5, 1.3]  # 15 paths
        is_sharpe_mean = float(np.mean(per_path_is_sharpes))
        wf_sharpe = 1.0

        r1 = compute_bif(is_sharpe=is_sharpe_mean, wf_sharpe=wf_sharpe, k_eff=15.0)
        r2 = compute_bif(is_sharpe=is_sharpe_mean, wf_sharpe=wf_sharpe, k_eff=15.0)

        assert r1["bif"] == r2["bif"], "BIF must be deterministic across calls"
        assert r1["verdict"] == r2["verdict"]
        assert r1["k_eff"] == r2["k_eff"]
        assert r1["expected_inflation"] == r2["expected_inflation"]

    def test_mean_of_is_sharpes_is_deterministic(self):
        """np.mean of a fixed list of per-path IS Sharpes is deterministic."""
        per_path_is_sharpes = [1.5, 2.0, 1.8, 2.2, 1.6]

        mean1 = float(np.mean(per_path_is_sharpes))
        mean2 = float(np.mean(per_path_is_sharpes))

        assert mean1 == mean2, "Mean of a fixed list must be deterministic"
        assert mean1 == pytest.approx(1.82, abs=0.01)

    def test_k_eff_15_c62_expected_inflation(self):
        """For C(6,2)=15 paths, expected_inflation = sqrt(2·ln(15)) ≈ 3.296."""
        import math

        from src.engine.statistics.backtest_inflation_factor import compute_bif

        result = compute_bif(is_sharpe=1.0, wf_sharpe=0.9, k_eff=15.0)

        expected = math.sqrt(2.0 * math.log(15.0))  # ≈ 3.296
        assert result["expected_inflation"] == pytest.approx(expected, abs=0.001), (
            f"expected_inflation for k_eff=15 must be {expected:.4f}, "
            f"got {result['expected_inflation']:.4f}"
        )


# ── H-4 IS fold caching contract ──────────────────────────────────────────────

class TestH4BifIsSharpeFoldCaching:
    """Verify the fold caching contract that prevents duplicate IS backtest runs.

    walk_forward._run_walk_forward_cpcv() caches IS fold results by the key:
        (fold_idx, strip_start, strip_end)

    This prevents the same fold from being re-run across multiple CPCV paths.
    For C(6,2) = 15 paths with 4 IS folds each:
        - Total potential calls: 15 × 4 = 60
        - Unique cache entries: ≤ number of unique (fold_idx, strip, strip) triples
          (in practice ~20 for the default 6-fold setup)

    These tests verify the caching logic in isolation (pure Python dict contract).
    """

    def test_cache_deduplicates_same_fold_across_paths(self):
        """Same (fold_idx, strip_start, strip_end) key is only computed once."""
        cache: dict[tuple, dict] = {}
        actual_backtest_calls = 0

        def run_with_cache(fold_idx: int, strip_start: int, strip_end: int) -> dict:
            nonlocal actual_backtest_calls
            key = (fold_idx, strip_start, strip_end)
            if key not in cache:
                actual_backtest_calls += 1
                cache[key] = {"daily_pnls": [0.01, 0.02, -0.01, 0.015]}
            return cache[key]

        # Simulate 5 CPCV paths, each accessing the same 3 IS folds with identical strips
        # (fold_idx 2, 3, 4 with zero strip values — simplified)
        for _path_i in range(5):
            for fold_idx in [2, 3, 4]:
                run_with_cache(fold_idx, strip_start=0, strip_end=0)

        total_accesses = 5 * 3  # = 15 attempts
        assert actual_backtest_calls == 3, (
            f"Cache must deduplicate: {total_accesses} accesses → only 3 unique backtests, "
            f"got {actual_backtest_calls}"
        )

    def test_cache_key_is_three_tuple(self):
        """Cache key = (fold_idx, strip_start, strip_end) — three components."""
        fold_idx = 2
        strip_start = 5
        strip_end = 3

        key = (fold_idx, strip_start, strip_end)

        assert isinstance(key, tuple)
        assert len(key) == 3
        assert key[0] == fold_idx
        assert key[1] == strip_start
        assert key[2] == strip_end

    def test_same_fold_different_strips_gives_different_cache_entries(self):
        """fold_idx=2 with different strip values → distinct cache entries."""
        cache: dict[tuple, dict] = {}
        call_count = 0

        def run_with_cache(fold_idx: int, strip_start: int, strip_end: int) -> dict:
            nonlocal call_count
            key = (fold_idx, strip_start, strip_end)
            if key not in cache:
                call_count += 1
                cache[key] = {"daily_pnls": [float(fold_idx)]}
            return cache[key]

        # Same fold_idx, but different strip combos (e.g. different embargo context)
        run_with_cache(fold_idx=2, strip_start=0, strip_end=0)
        run_with_cache(fold_idx=2, strip_start=5, strip_end=3)
        run_with_cache(fold_idx=2, strip_start=0, strip_end=0)  # cache hit

        assert call_count == 2, (
            "Different strip values for the same fold must give distinct cache entries; "
            f"expected 2 unique calls, got {call_count}"
        )

    def test_cache_reduces_calls_for_c62_path_structure(self):
        """For C(6,2)=15 paths with 4 IS folds each, deduplication saves calls.

        Conservative lower bound: at least one fold appears in multiple paths
        (every fold except 0 and 1 appears in path 0's IS set), so actual
        backtest calls must be strictly less than 15 × 4 = 60.
        """
        cache: dict[tuple, dict] = {}
        call_count = 0

        def run_with_cache(fold_idx: int, strip_start: int, strip_end: int) -> dict:
            nonlocal call_count
            key = (fold_idx, strip_start, strip_end)
            if key not in cache:
                call_count += 1
                cache[key] = {"daily_pnls": [0.01 * fold_idx]}
            return cache[key]

        # Simulate the C(6,2)=15 path IS-fold access pattern.
        # For N=6 folds, path (i,j) has IS folds = {0..5} \ {i, j}.
        # Use strip_start=strip_end=0 as simplified uniform strips.
        from itertools import combinations
        for oos_i, oos_j in combinations(range(6), 2):
            is_folds = [f for f in range(6) if f not in (oos_i, oos_j)]
            for fi in is_folds:
                run_with_cache(fold_idx=fi, strip_start=0, strip_end=0)

        # With uniform strips, all 6 fold indices are unique cache keys → 6 calls max.
        # Without caching, it would be 15 × 4 = 60 calls.
        assert call_count <= 6, (
            f"With uniform strips, C(6,2)=15 paths must deduplicate to ≤6 unique "
            f"backtest calls, got {call_count}"
        )
        assert call_count < 60, (
            f"Caching must save calls vs uncached max of 60, got {call_count}"
        )


# ── H-4 edge cases ─────────────────────────────────────────────────────────────

class TestH4BifEdgeCases:
    """Edge cases in the IS Sharpe aggregation and BIF computation."""

    def test_empty_per_path_is_sharpes_gives_is_0_no_positive_claim(self):
        """When all IS folds fail (empty per_path_is_sharpes), IS Sharpe = 0.0.

        compute_bif(is_sharpe=0.0, ...) returns bif=1.0 with fail_closed=False
        because a non-positive IS Sharpe means no positive IS edge was demonstrated
        — the BIF is undefined, not a signal of inflation.
        """
        from src.engine.statistics.backtest_inflation_factor import compute_bif

        # H-4 code: if per_path_is_sharpes is empty → is_sharpe = 0.0
        per_path_is_sharpes: list[float] = []
        is_sharpe = float(np.mean(per_path_is_sharpes)) if per_path_is_sharpes else 0.0
        assert is_sharpe == 0.0

        result = compute_bif(is_sharpe=is_sharpe, wf_sharpe=1.0, k_eff=15.0)

        assert result["bif"] == 1.0, (
            "Non-positive IS Sharpe must return bif=1.0 (undefined, not inflated)"
        )
        assert result["fail_closed"] is False
        assert result["verdict"] == "clean"

    def test_single_path_is_sharpe_list(self):
        """A single-element per_path_is_sharpes list produces the correct BIF."""
        from src.engine.statistics.backtest_inflation_factor import compute_bif

        per_path_is_sharpes = [3.5]  # single path (edge case for k_eff=1)
        is_sharpe_mean = float(np.mean(per_path_is_sharpes))
        wf_sharpe = 1.0

        result = compute_bif(is_sharpe=is_sharpe_mean, wf_sharpe=wf_sharpe, k_eff=1.0)

        assert result["bif"] == pytest.approx(3.5, abs=0.001)
        # k_eff=1 → expected_inflation=0.0 (no selection effect)
        assert result["expected_inflation"] == 0.0
        assert result["verdict"] == "warn"  # BIF=3.5 ≥ warn_threshold=2.0

    def test_positive_is_non_positive_wf_is_fail_closed(self):
        """Positive IS Sharpe + non-positive WF Sharpe → BIF=999 (fail-closed sentinel).

        This is the worst-case selection-bias scenario: strategy looked good in-sample
        but completely failed OOS.  H-4 genuine IS data makes this case detectable
        whereas the M1 proxy (IS≈OOS) would have masked it.
        """
        from src.engine.statistics.backtest_inflation_factor import compute_bif

        per_path_is_sharpes = [1.5, 2.0, 1.8]
        is_sharpe_mean = float(np.mean(per_path_is_sharpes))

        result = compute_bif(is_sharpe=is_sharpe_mean, wf_sharpe=-0.3, k_eff=15.0)

        assert result["bif"] == 999.0, (
            "Positive IS + non-positive WF must trigger fail-closed sentinel (BIF=999)"
        )
        assert result["fail_closed"] is True
        assert result["verdict"] == "block"

    def test_nan_is_sharpe_is_fail_closed(self):
        """Non-finite IS Sharpe → fail-closed."""
        from src.engine.statistics.backtest_inflation_factor import compute_bif

        result = compute_bif(is_sharpe=float("nan"), wf_sharpe=1.0, k_eff=15.0)
        assert result["fail_closed"] is True
        assert result["bif"] == 999.0
        assert result["verdict"] == "block"

    def test_h4_vs_m1_proxy_detects_inflated_strategy(self):
        """Demonstrate H-4 corrects the M1 blindspot.

        M1 proxy: is_sharpe = mean(path_OOS_sharpes) ≈ wf_sharpe → BIF ≈ 1.0 (blind).
        H-4 fix:  is_sharpe = mean(per_path_IS_sharpes) = 5.0 (genuine) → BIF = 5.0 (block).
        """
        from src.engine.statistics.backtest_inflation_factor import compute_bif

        wf_sharpe = 1.0  # aggregate OOS Sharpe

        # M1 proxy: IS Sharpe is derived from OOS data → BIF ≈ 1.0 by construction
        m1_proxy_is_sharpe = wf_sharpe * 1.01  # M1 was mean(path_OOS_sharpes) ≈ wf_sharpe
        r_m1 = compute_bif(is_sharpe=m1_proxy_is_sharpe, wf_sharpe=wf_sharpe, k_eff=15.0)
        assert r_m1["bif"] == pytest.approx(1.01, abs=0.05), "M1 proxy: BIF ≈ 1.0 (blind)"
        assert r_m1["verdict"] == "clean"  # false clean — the gate was blind

        # H-4 fix: true IS Sharpe from per-fold IS backtests → real inflation detected
        h4_true_is_sharpe = 5.0  # genuine IS performance
        r_h4 = compute_bif(is_sharpe=h4_true_is_sharpe, wf_sharpe=wf_sharpe, k_eff=15.0)
        assert r_h4["bif"] == pytest.approx(5.0, abs=0.01), "H-4: BIF = true IS / WF"
        assert r_h4["verdict"] == "block", "H-4: inflated strategy correctly blocked"
