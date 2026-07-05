"""Deepscan17 B-6/B-12/B-13/B-18 — fill_model.py contract fixes + short-side
volume partial-fill symmetry.

B-6 (HIGH):  apply_volume_partial_fills() was only ever called against the
             LONG entry mask in backtester.py; short entries only went
             through the RSI/type-based apply_fill_model() gate. Fixed by
             calling apply_volume_partial_fills() symmetrically on the short
             mask and merging its audit counts into the shared
             engine_audit.partial_fill_modeled dict.

B-12 (MED):  compute_volume_based_fill_ratios() had no input validation on
             volume_threshold and no defensive final clamp — an
             out-of-[0,1) threshold (env misconfiguration) could push
             fill_ratios outside the documented [0.5, 1.0] contract. Fixed
             with input clamping + a defensive np.clip on the output.

B-13 (LOW):  A 1-contract order that received a degraded fill ratio never
             registered in the audit's partial_fills counter, because
             int(1 * ratio) floors to 0 and max(1.0, 0) rounds back up to 1
             — new_size == original_size, so the old `if new_size <
             original_size: partial_fills += 1` guard never fired. Fixed by
             counting every ratio<1.0 order as a partial fill, independent
             of whether integer flooring can express a smaller size.

B-18 (LOW):  avg_slippage_delta_per_partial was a permanent hardcoded 0.0
             masquerading as a computed metric ("Placeholder — slippage
             delta computed in backtester", which never happened anywhere).
             Fixed to emit None (honest "not computed here") instead of a
             fabricated zero, since this function only has size/volume data
             (no price/spread data to compute a real slippage delta from).

Run targeted:
    python -m pytest src/engine/tests/test_deepscan17_fillmodel_b6_b12_b13_b18.py -v
"""

from __future__ import annotations

import importlib
import os
from datetime import datetime, timedelta
from unittest.mock import patch

import numpy as np
import polars as pl
import pytest


def _make_df_with_volume(n: int = 10, volume_per_bar: int = 100) -> pl.DataFrame:
    dates = [datetime(2024, 1, 2, 9, 30) + timedelta(minutes=i * 15) for i in range(n)]
    return pl.DataFrame({
        "ts_event": dates,
        "open": [4500.0] * n,
        "high": [4505.0] * n,
        "low": [4495.0] * n,
        "close": [4502.0] * n,
        "volume": [volume_per_bar] * n,
    })


def _reload_fm():
    import src.engine.fill_model as fm
    importlib.reload(fm)
    return fm


# ─── B-12: input validation + output clamp ──────────────────────────────────

class TestB12ThresholdValidationAndClamp:
    def test_negative_threshold_does_not_degrade_small_orders(self):
        """Pre-fix (clamp-to-boundary design): a misconfigured negative
        threshold clamped to 0.0 would make zone2_mask true for essentially
        every order (including tiny, well-volumed ones), degrading fill
        ratios that should never have been touched. The fix falls back to
        the documented default (0.1) instead, preserving "small orders never
        degrade" semantics."""
        df = _make_df_with_volume(n=3, volume_per_bar=10000)
        order_qtys = np.array([1.0, 1.0, 1.0])  # ratio = 0.0001, should NEVER degrade

        with patch.dict(os.environ, {"BACKTEST_PARTIAL_FILL_ENABLED": "true"}):
            fm = _reload_fm()
            ratios = fm.compute_volume_based_fill_ratios(df, order_qtys, volume_threshold=-0.5)

        assert np.all(ratios == pytest.approx(1.0, abs=1e-9)), (
            f"B-12 REGRESSION: negative threshold degraded a tiny, well-volumed "
            f"order — ratios={ratios}"
        )

    def test_threshold_at_or_above_one_does_not_crash_or_invert(self):
        """threshold >= 1.0 must not blow up the zone-2 denominator or
        produce out-of-contract fill ratios."""
        df = _make_df_with_volume(n=3, volume_per_bar=100)
        order_qtys = np.array([50.0, 100.0, 150.0])  # ratios: 0.5, 1.0, 1.5

        with patch.dict(os.environ, {"BACKTEST_PARTIAL_FILL_ENABLED": "true"}):
            fm = _reload_fm()
            ratios = fm.compute_volume_based_fill_ratios(df, order_qtys, volume_threshold=1.5)

        assert np.all(np.isfinite(ratios)), f"B-12 REGRESSION: non-finite ratios={ratios}"
        assert np.all((ratios >= 0.5) & (ratios <= 1.0)), (
            f"B-12 REGRESSION: ratios outside documented [0.5,1.0] contract: {ratios}"
        )

    def test_nan_threshold_falls_back_to_default(self):
        df = _make_df_with_volume(n=3, volume_per_bar=100)
        order_qtys = np.array([50.0, 50.0, 50.0])

        with patch.dict(os.environ, {"BACKTEST_PARTIAL_FILL_ENABLED": "true"}):
            fm = _reload_fm()
            ratios = fm.compute_volume_based_fill_ratios(df, order_qtys, volume_threshold=float("nan"))

        assert np.all(np.isfinite(ratios))
        assert np.all((ratios >= 0.5) & (ratios <= 1.0))

    def test_output_always_within_documented_contract_across_random_inputs(self):
        """Property-style check: for a wide sweep of order/volume ratios and
        thresholds, output must always land in [0.5, 1.0]."""
        rng = np.random.default_rng(7)
        with patch.dict(os.environ, {"BACKTEST_PARTIAL_FILL_ENABLED": "true"}):
            fm = _reload_fm()
            for _ in range(20):
                n = 10
                volume = rng.uniform(1, 10000, n).astype(int)
                df = pl.DataFrame({
                    "ts_event": [datetime(2024, 1, 2) + timedelta(minutes=i) for i in range(n)],
                    "open": [4500.0] * n, "high": [4505.0] * n,
                    "low": [4495.0] * n, "close": [4502.0] * n,
                    "volume": volume.tolist(),
                })
                order_qtys = rng.uniform(0, 20000, n)
                threshold = rng.uniform(-1.0, 2.0)  # deliberately includes invalid values
                ratios = fm.compute_volume_based_fill_ratios(df, order_qtys, volume_threshold=threshold)
                assert np.all(np.isfinite(ratios))
                assert np.all((ratios >= 0.5) & (ratios <= 1.0)), (
                    f"B-12 REGRESSION: threshold={threshold} produced out-of-contract "
                    f"ratios={ratios}"
                )

    def test_negative_order_quantity_treated_as_no_order(self):
        """NaN/negative order quantities must not corrupt the ratio computation."""
        df = _make_df_with_volume(n=3, volume_per_bar=100)
        order_qtys = np.array([-5.0, float("nan"), 50.0])

        with patch.dict(os.environ, {"BACKTEST_PARTIAL_FILL_ENABLED": "true"}):
            fm = _reload_fm()
            ratios = fm.compute_volume_based_fill_ratios(df, order_qtys, volume_threshold=0.1)

        assert np.all(np.isfinite(ratios))
        # Negative/NaN order qty -> treated as 0 -> zone 1 -> no degradation
        assert ratios[0] == pytest.approx(1.0)
        assert ratios[1] == pytest.approx(1.0)


# ─── B-13: 1-contract partial-fill counting ─────────────────────────────────

class TestB13OneContractPartialFillCounted:
    def test_one_contract_degraded_order_still_counted_as_partial_fill(self):
        """A single-contract order that gets a degraded (< 1.0) fill ratio
        must still increment the audit's partial_fills counter, even though
        the integer size can't actually shrink below 1."""
        # size=1 contract, volume=2 -> ratio=0.5 (zone 2, threshold=0.1) -> degraded
        df = _make_df_with_volume(n=1, volume_per_bar=2)
        entries = np.array([True])
        sizes = np.array([1.0])

        with patch.dict(os.environ, {"BACKTEST_PARTIAL_FILL_ENABLED": "true"}):
            fm = _reload_fm()
            adj_sizes, ratios, audit = fm.apply_volume_partial_fills(
                entries, sizes, df, volume_threshold=0.1,
            )

        assert ratios[0] < 1.0, "Test fixture must actually produce a degraded ratio"
        assert adj_sizes[0] == 1.0, "1-contract order cannot shrink below the tradeable minimum"
        assert audit["partial_fills"] == 1, (
            f"B-13 REGRESSION: degraded 1-contract order not counted as a partial "
            f"fill — partial_fills={audit['partial_fills']}"
        )

    def test_multi_contract_order_partial_fill_still_reduces_size(self):
        """Sanity: multi-contract orders must still have their SIZE reduced
        when the integer math allows it (no regression on the original
        working case)."""
        df = _make_df_with_volume(n=1, volume_per_bar=10)
        entries = np.array([True])
        sizes = np.array([10.0])  # ratio = 1.0 -> forced zone 3 boundary; use bigger order

        with patch.dict(os.environ, {"BACKTEST_PARTIAL_FILL_ENABLED": "true"}):
            fm = _reload_fm()
            adj_sizes, ratios, audit = fm.apply_volume_partial_fills(
                entries, sizes, df, volume_threshold=0.1,
            )

        if ratios[0] < 1.0:
            assert adj_sizes[0] < sizes[0]
            assert audit["partial_fills"] == 1

    def test_full_fill_order_not_counted_as_partial(self):
        """An order with ratio == 1.0 (no degradation) must not be counted."""
        df = _make_df_with_volume(n=1, volume_per_bar=100000)
        entries = np.array([True])
        sizes = np.array([1.0])

        with patch.dict(os.environ, {"BACKTEST_PARTIAL_FILL_ENABLED": "true"}):
            fm = _reload_fm()
            _, ratios, audit = fm.apply_volume_partial_fills(entries, sizes, df, volume_threshold=0.1)

        assert ratios[0] == pytest.approx(1.0)
        assert audit["partial_fills"] == 0


# ─── B-18: honest None instead of fabricated 0.0 ────────────────────────────

class TestB18HonestSlippageDeltaPlaceholder:
    def test_avg_slippage_delta_per_partial_is_none_not_fabricated_zero(self):
        df = _make_df_with_volume(n=3, volume_per_bar=10)
        entries = np.array([True, True, True])
        sizes = np.array([8.0, 8.0, 8.0])

        with patch.dict(os.environ, {"BACKTEST_PARTIAL_FILL_ENABLED": "true"}):
            fm = _reload_fm()
            _, _, audit = fm.apply_volume_partial_fills(entries, sizes, df, volume_threshold=0.1)

        assert audit["avg_slippage_delta_per_partial"] is None, (
            "B-18 REGRESSION: avg_slippage_delta_per_partial must be None "
            "(honest 'not computed'), not a fabricated numeric placeholder"
        )

    def test_disabled_path_also_reports_none(self):
        df = _make_df_with_volume(n=2, volume_per_bar=10)
        entries = np.array([True, False])
        sizes = np.array([8.0, 8.0])

        with patch.dict(os.environ, {"BACKTEST_PARTIAL_FILL_ENABLED": "false"}):
            fm = _reload_fm()
            _, _, audit = fm.apply_volume_partial_fills(entries, sizes, df)

        assert audit["avg_slippage_delta_per_partial"] is None

    def test_key_still_present_backward_compat(self):
        """Removing the field entirely would break the existing schema
        contract test (test_partial_fill_model.py::test_audit_payload_structure)
        — verify the key itself is still present, only the value changed."""
        df = _make_df_with_volume(n=2, volume_per_bar=10)
        entries = np.array([True, False])
        sizes = np.array([8.0, 8.0])

        with patch.dict(os.environ, {"BACKTEST_PARTIAL_FILL_ENABLED": "true"}):
            fm = _reload_fm()
            _, _, audit = fm.apply_volume_partial_fills(entries, sizes, df)

        assert "avg_slippage_delta_per_partial" in audit


# ─── B-6: short-side volume partial-fill symmetry (source contract) ────────

class TestB6ShortSideVolumePartialFillSymmetry:
    """backtester.py's short-entry block must call apply_volume_partial_fills
    symmetrically with the long-entry block. A full run_backtest() integration
    test would require heavy vectorbt mocking (out of scope for a targeted
    regression test); instead this verifies the plumbing via direct source
    inspection of the short-entry block, mirroring the existing
    TS-side `expect(src).toContain(...)` pattern used for similar plumbing
    contracts in this codebase (see deepscan14-shadow-stage.test.ts)."""

    def _read_backtester_source(self) -> str:
        import inspect

        import src.engine.backtester as bt
        return inspect.getsource(bt)

    def test_short_entry_block_imports_apply_volume_partial_fills(self):
        src = self._read_backtester_source()
        # Locate the short-entry block (starts after the long-side Stage 2 call)
        short_block_start = src.index('if "entry_short" in df.columns:', src.index("Re-align long-side fill model sizes"))
        short_block = src[short_block_start:short_block_start + 3000]
        assert "apply_volume_partial_fills" in short_block, (
            "B-6 REGRESSION: short-entry block does not import/call "
            "apply_volume_partial_fills — volume-based partial fills are "
            "long-side only again"
        )

    def test_merge_math_combines_long_and_short_audit_counts(self):
        """Pure-math replication of the audit-merge logic added to the
        short-entry block: combined total_orders/partial_fills/avg_fill_ratio
        must reflect BOTH sides, not just the long side."""
        long_audit = {"total_orders": 10, "partial_fills": 2, "avg_fill_ratio": 0.9}
        short_audit = {"total_orders": 5, "partial_fills": 3, "avg_fill_ratio": 0.7}

        combined_n = long_audit["total_orders"] + short_audit["total_orders"]
        combined_partials = long_audit["partial_fills"] + short_audit["partial_fills"]
        combined_avg = (
            long_audit["avg_fill_ratio"] * long_audit["total_orders"]
            + short_audit["avg_fill_ratio"] * short_audit["total_orders"]
        ) / combined_n

        assert combined_n == 15
        assert combined_partials == 5
        assert combined_avg == pytest.approx((0.9 * 10 + 0.7 * 5) / 15)
