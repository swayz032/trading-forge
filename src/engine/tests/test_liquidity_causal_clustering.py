"""Regression coverage for the causal-clustering fix to detect_buyside_liquidity /
detect_sellside_liquidity (packet: docs/designs/packet-liquidity-causal-clustering-fix-2026-07-20.md).

Background (AR-107 diagnosis, see liquidity.py's _cluster_swings_causal docstring):
the pre-fix algorithm used `index = max(cluster_indices)` to identify a cluster row.
Because a cluster can gain members forever, that index is not stable -- a row visible
with index=73 at an early cutoff could silently become index=135 once a much later
swing joined the same (price-unchanged) cluster, i.e. the row "vanishes" under any
`index < C` visibility query. Cluster MEMBERSHIP itself was already provably
prefix-causal in the old algorithm (see diagnosis below) -- the leak was purely in
which member's index got reported. The fix reports `index = min(cluster_indices)`
(the cluster's creation/first-confirmation bar), which is immutable once assigned.

This file covers:
  - TestCausalMembershipEquivalence: proves old and new algorithms are the same
    partition function (documents why membership was never the actual leak).
  - TestTruncationProbe (V1): >=5 seeds x >=50 cutoffs, naive row-level comparison,
    0 mismatches required.
  - TestPlantCatch (V2): reinstates the exact AR-096 F-1 absorption shape; the
    probe must FIRE against the old (max-index) algorithm and PASS against the
    fixed (min-index) production code, for both detect_buyside_liquidity and
    detect_sellside_liquidity independently.
  - TestCallSiteTruncation (V3): call-site truncation probes for the 5 named
    sweep-consuming strategies (ict_2022, ict_scalp, ict_swing, turtle_soup,
    quarterly_swing). HONEST FINDING: these strategies' sweep_bsl/sweep_ssl output
    is NOT causal even after this fix, and the fix changes it by exactly 0% (see
    test docstring) -- detect_sweep(df, levels) never reads a level's `index`
    field, only `price`, and the old and new clustering algorithms produce
    byte-identical `price` sets (only the `index` label differs). The packet's
    claim that detect_sweep is "cured by inheritance" is FALSE as measured; the
    residual lookahead at these 5 call sites is a pre-existing, separate,
    explicitly out-of-scope gap in detect_sweep's lack of index-gating. This test
    documents/bounds that residual as a known gap, not a regression introduced or
    fixed by this packet.
"""
from __future__ import annotations

from datetime import datetime, timedelta

import numpy as np
import polars as pl
import pytest

from src.engine.indicators.liquidity import (
    detect_buyside_liquidity,
    detect_sellside_liquidity,
    detect_sweep,
)
from src.engine.indicators.market_structure import detect_swings


# ─── shared synthetic data helper ──────────────────────────────────────────
def _make_ohlcv(n: int, seed: int) -> pl.DataFrame:
    rng = np.random.default_rng(seed)
    returns = rng.normal(0, 0.6, n)
    close = 100 + np.cumsum(returns)
    high = close + rng.uniform(0.1, 1.2, n)
    low = close - rng.uniform(0.1, 1.2, n)
    open_ = close + rng.uniform(-0.4, 0.4, n)
    dates = [datetime(2023, 1, 2) + timedelta(hours=h) for h in range(n)]
    return pl.DataFrame({
        "ts_event": dates,
        "open": open_.tolist(),
        "high": high.tolist(),
        "low": low.tolist(),
        "close": close.tolist(),
        "volume": [1000] * n,
    })


def _old_buggy_cluster(swing_type: str, swings: pl.DataFrame) -> pl.DataFrame:
    """Verbatim pre-fix (AR-107 pre-image) clustering, reinstated ONLY for
    contrast/plant-catch purposes in this test file. NEVER used in production."""
    side = swings.filter(pl.col("type") == swing_type).sort("index")
    schema = {"index": pl.Int64, "price": pl.Float64, "level_count": pl.Int64}
    if len(side) == 0:
        return pl.DataFrame(schema=schema)
    prices = side["price"].to_list()
    indices = side["index"].to_list()
    records = []
    used: set[int] = set()
    for i in range(len(prices)):
        if i in used:
            continue
        cluster_price = prices[i]
        cluster_indices = [indices[i]]
        threshold = cluster_price * 0.005
        for j in range(i + 1, len(prices)):
            if j in used:
                continue
            if abs(prices[j] - cluster_price) <= threshold:
                cluster_indices.append(indices[j])
                used.add(j)
        used.add(i)
        records.append({
            "index": max(cluster_indices),  # <-- the pre-fix defect
            "price": cluster_price,
            "level_count": len(cluster_indices),
        })
    return pl.DataFrame(records) if records else pl.DataFrame(schema=schema)


def _new_causal_partition(prices: list[float], indices: list[int]) -> set[tuple[float, tuple[int, ...]]]:
    """Local replica of the production _cluster_swings_causal's MEMBERSHIP
    (anchor_price, sorted member indices) -- used only to prove old/new
    equivalence of partitions; independent of the reported `index` field."""
    clusters: list[dict] = []
    for price, idx in zip(prices, indices, strict=True):
        target = None
        for c in clusters:
            threshold = c["anchor_price"] * 0.005
            if abs(price - c["anchor_price"]) <= threshold:
                target = c
                break
        if target is None:
            clusters.append({"anchor_price": price, "indices": [idx]})
        else:
            target["indices"].append(idx)
    return {(c["anchor_price"], tuple(sorted(c["indices"]))) for c in clusters}


def _old_buggy_partition(prices: list[float], indices: list[int]) -> set[tuple[float, tuple[int, ...]]]:
    n = len(prices)
    used: set[int] = set()
    clusters = []
    for i in range(n):
        if i in used:
            continue
        cluster_price = prices[i]
        cluster_indices = [indices[i]]
        threshold = cluster_price * 0.005
        for j in range(i + 1, n):
            if j in used:
                continue
            if abs(prices[j] - cluster_price) <= threshold:
                cluster_indices.append(indices[j])
                used.add(j)
        used.add(i)
        clusters.append((cluster_price, tuple(sorted(cluster_indices))))
    return set(clusters)


class TestCausalMembershipEquivalence:
    """Documents the AR-107 diagnosis: old (used-set greedy) and new (streaming
    causal) algorithms are the SAME partition function. Cluster membership was
    never the leak -- only the reported `index` label was. This is why the fix
    changes `index` semantics (max -> min) rather than the join logic itself."""

    @pytest.mark.parametrize("seed", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    def test_old_and_new_partitions_are_identical(self, seed):
        df = _make_ohlcv(220, seed)
        swings = detect_swings(df, 5)
        for swing_type in ("high", "low"):
            side = swings.filter(pl.col("type") == swing_type).sort("index")
            prices = side["price"].to_list()
            indices = side["index"].to_list()
            old_partition = _old_buggy_partition(prices, indices)
            new_partition = _new_causal_partition(prices, indices)
            assert old_partition == new_partition, (
                f"seed={seed} type={swing_type}: partitions differ -- membership "
                f"logic changed, which was NOT the intended fix"
            )


class TestTruncationProbe:
    """V1: >=5 seeds x >=50 cutoffs, naive row-level truncation probe on the
    real production functions. A row visible in a truncated-at-C run must
    appear, with IDENTICAL index and price, in the full-history run (level_count
    may only grow). 0 mismatches required."""

    SEEDS = [1, 2, 3, 4, 5]
    N = 220
    LOOKBACK = 5

    @staticmethod
    def _probe(fn, df, swings_full, cutoffs):
        mismatches = []
        for C in cutoffs:
            swings_trunc = swings_full.filter(pl.col("index") < C)
            full_out = fn(df, swings_full)
            trunc_out = fn(df, swings_trunc)

            full_map = {(r["index"], r["price"]): r["level_count"] for r in full_out.to_dicts()}
            trunc_map = {(r["index"], r["price"]): r["level_count"] for r in trunc_out.to_dicts()}

            for key, trunc_lc in trunc_map.items():
                if key not in full_map:
                    mismatches.append((C, "row vanished from full run", key))
                elif full_map[key] < trunc_lc:
                    mismatches.append((C, "level_count shrank (impossible)", key))
            for key in full_map:
                if key not in trunc_map and key[0] < C:
                    mismatches.append((C, "row with index<C missing from truncated run", key))
        return mismatches

    def test_bsl_zero_mismatches_across_seeds_and_cutoffs(self):
        total_cutoffs = 0
        all_mismatches = []
        for seed in self.SEEDS:
            df = _make_ohlcv(self.N, seed)
            swings = detect_swings(df, self.LOOKBACK)
            cutoffs = list(range(30, self.N, 3))
            assert len(cutoffs) >= 50
            total_cutoffs += len(cutoffs)
            all_mismatches.extend(self._probe(detect_buyside_liquidity, df, swings, cutoffs))
        assert total_cutoffs >= 5 * 50
        assert all_mismatches == [], f"BSL truncation mismatches found: {all_mismatches[:5]}"

    def test_ssl_zero_mismatches_across_seeds_and_cutoffs(self):
        total_cutoffs = 0
        all_mismatches = []
        for seed in self.SEEDS:
            df = _make_ohlcv(self.N, seed)
            swings = detect_swings(df, self.LOOKBACK)
            cutoffs = list(range(30, self.N, 3))
            assert len(cutoffs) >= 50
            total_cutoffs += len(cutoffs)
            all_mismatches.extend(self._probe(detect_sellside_liquidity, df, swings, cutoffs))
        assert total_cutoffs >= 5 * 50
        assert all_mismatches == [], f"SSL truncation mismatches found: {all_mismatches[:5]}"

    def test_null_baseline_old_algorithm_fails_this_probe(self):
        """V6: the null/baseline rate this probe would show against the KNOWN
        BUGGY pre-fix algorithm -- context for the fixed code's 0 mismatches."""
        old_mismatches = 0
        checked = 0
        for seed in self.SEEDS:
            df = _make_ohlcv(self.N, seed)
            swings = detect_swings(df, self.LOOKBACK)
            cutoffs = list(range(30, self.N, 3))
            for C in cutoffs:
                swings_trunc = swings.filter(pl.col("index") < C)
                for swing_type in ("high", "low"):
                    full_out = _old_buggy_cluster(swing_type, swings)
                    trunc_out = _old_buggy_cluster(swing_type, swings_trunc)
                    checked += 1
                    full_keys = set(zip(full_out["index"].to_list(), full_out["price"].to_list(), strict=True))
                    for row in trunc_out.to_dicts():
                        if (row["index"], row["price"]) not in full_keys:
                            old_mismatches += 1
                            break
        # Empirically ~70% of cutoff-probes show >=1 vanished row under the old
        # algorithm (measured 451/640 during fix development). Assert it's
        # substantial (order-of-magnitude sanity check that the null isn't 0).
        assert old_mismatches > checked * 0.3, (
            f"expected the OLD algorithm to clearly fail this probe as a null baseline, "
            f"got {old_mismatches}/{checked}"
        )


class TestPlantCatch:
    """V2: reinstate the exact AR-096 F-1 absorption shape and show the SAME
    naive visibility probe FIRES on old code and PASSES on fixed code, for both
    functions independently. A probe that cannot fail proves nothing."""

    C = 100  # cutoff: bar 73 is known, bar 135 is NOT

    @staticmethod
    def _build_plant_swings(swing_type: str) -> pl.DataFrame:
        rows = [
            {"index": 10, "type": swing_type, "price": 90.00},    # unrelated filler
            {"index": 73, "type": swing_type, "price": 100.10},   # the swing that "vanishes"
            {"index": 135, "type": swing_type, "price": 100.15},  # absorbs bar 73's cluster once known
            {"index": 200, "type": swing_type, "price": 80.00},   # unrelated filler
        ]
        return pl.DataFrame(rows)

    @staticmethod
    def _dummy_df(n: int = 220) -> pl.DataFrame:
        dates = [datetime(2023, 1, 1) + timedelta(hours=i) for i in range(n)]
        close = [100.0] * n
        return pl.DataFrame({
            "ts_event": dates, "open": close, "high": [c + 1 for c in close],
            "low": [c - 1 for c in close], "close": close, "volume": [1000] * n,
        })

    @staticmethod
    def _visibility_ok(fn, df, swings_full, C) -> bool:
        swings_trunc = swings_full.filter(pl.col("index") < C)
        trunc_out = fn(df, swings_trunc)
        full_out = fn(df, swings_full)
        full_keys = (
            set(zip(full_out["index"].to_list(), full_out["price"].to_list(), strict=True))
            if len(full_out) else set()
        )
        for row in trunc_out.to_dicts():
            if (row["index"], row["price"]) not in full_keys:
                return False
        return True

    def _old_bsl(self, df, swings):
        return _old_buggy_cluster("high", swings)

    def _old_ssl(self, df, swings):
        return _old_buggy_cluster("low", swings)

    def test_bsl_plant_catch_fires_on_old_passes_on_fixed(self):
        df = self._dummy_df(220)
        swings = self._build_plant_swings("high")

        assert not self._visibility_ok(self._old_bsl, df, swings, self.C), (
            "PLANT-CATCH FAILED: probe did not fire against known-buggy old BSL code"
        )
        assert self._visibility_ok(detect_buyside_liquidity, df, swings, self.C), (
            "FIX FAILED: fixed detect_buyside_liquidity still exhibits the vanishing defect"
        )

    def test_ssl_plant_catch_fires_on_old_passes_on_fixed(self):
        df = self._dummy_df(220)
        swings = self._build_plant_swings("low")

        assert not self._visibility_ok(self._old_ssl, df, swings, self.C), (
            "PLANT-CATCH FAILED: probe did not fire against known-buggy old SSL code"
        )
        assert self._visibility_ok(detect_sellside_liquidity, df, swings, self.C), (
            "FIX FAILED: fixed detect_sellside_liquidity still exhibits the vanishing defect"
        )


class TestCallSiteTruncation:
    """V3: consumption-wide verification for the 5 named sweep-consuming
    strategies (ict_2022, ict_scalp, ict_swing, turtle_soup, quarterly_swing).

    HONEST RESULT (measured during fix development, see AR-107 follow-up):
    this fix changes these strategies' sweep_bsl/sweep_ssl output by exactly
    0%. detect_sweep(df, levels) reads ONLY `levels["price"]` -- never
    `levels["index"]` -- and the old (max-index) and new (min-index) clustering
    algorithms produce byte-identical PRICE partitions (see
    TestCausalMembershipEquivalence). So the packet's claim that detect_sweep's
    call-site divergence is "cured by inheritance" does NOT hold: at all 5
    strategies, ~11-22% of (cutoff, bar) pairs show a sweep_bsl/sweep_ssl
    mismatch between the truncated-at-C run and the full run, UNCHANGED before
    and after this fix. Root cause (traced): detect_sweep checks every bar
    against every price level unconditionally, including bars that occur long
    before that level's own (correctly causal, post-fix) creation index -- e.g.
    bar 1 tested against a level not created until bar 85. This is a separate,
    pre-existing, structural gap in detect_sweep's lack of index-gating, and is
    explicitly OUT OF SCOPE for this packet ("do not touch detect_sweep").

    This test documents and bounds that residual gap (so a future change to
    detect_sweep's gating, or a regression that makes the residual materially
    worse, is visible) -- it does NOT assert 0 mismatches, because 0 is not
    achievable within this packet's scope.
    """

    STRATS = [
        ("ict_2022", 20),
        ("ict_scalp", 5),
        ("ict_swing", 10),
        ("turtle_soup", 10),
        ("quarterly_swing", 5),
    ]

    @staticmethod
    def _call_site(df, lookback):
        swings = detect_swings(df, lookback)
        bsl = detect_buyside_liquidity(df, swings)
        ssl = detect_sellside_liquidity(df, swings)
        sweep_bsl = detect_sweep(df, bsl) if len(bsl) > 0 else pl.Series("sweep", [False] * len(df))
        sweep_ssl = detect_sweep(df, ssl) if len(ssl) > 0 else pl.Series("sweep", [False] * len(df))
        return sweep_bsl.to_list(), sweep_ssl.to_list()

    @pytest.mark.parametrize("name,lookback", STRATS)
    def test_documents_residual_detect_sweep_gap_unchanged_by_fix(self, name, lookback):
        # Reduced seeds/cutoffs vs the development-time measurement (5 seeds x
        # ~60 cutoffs each) to keep this test fast; still exercises the exact
        # call-site indicator chain each strategy uses.
        seeds = [1, 2]
        n = 150
        mismatches = 0
        checked = 0
        for seed in seeds:
            df = _make_ohlcv(n, seed * 7 + lookback)
            full_bsl, full_ssl = self._call_site(df, lookback)
            cutoffs = list(range(max(30, 2 * lookback + 5), n, 5))
            for C in cutoffs:
                df_trunc = df[:C]
                if len(df_trunc) < 2 * lookback + 2:
                    continue
                t_bsl, t_ssl = self._call_site(df_trunc, lookback)
                for i in range(C):
                    checked += 1
                    if full_bsl[i] != t_bsl[i] or full_ssl[i] != t_ssl[i]:
                        mismatches += 1

        rate = mismatches / max(checked, 1)
        # Known, documented gap (detect_sweep index-gating) -- not 0, not this
        # packet's to fix. Bound it loosely so a REGRESSION (rate spiking well
        # beyond the documented range) still fails this test.
        assert 0.0 <= rate <= 0.40, (
            f"{name}: call-site sweep truncation mismatch rate {mismatches}/{checked}={rate:.3f} "
            f"is outside the documented range for the known out-of-scope detect_sweep gap"
        )
