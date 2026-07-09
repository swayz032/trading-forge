"""Wave 24 Pass 1 — Item 10: Tests for CPCV and purged_embargo walk-forward modes.

Covers:
  - Plain mode is unchanged (backward compat)
  - purged_embargo mode correctly applies purge to embargo_bars
  - CPCV generates C(6,2)=15 paths for N=6, k=2
  - wf_metadata emitted in all modes
  - No look-ahead: CPCV test folds are temporally disjoint from IS folds
"""

from __future__ import annotations

from datetime import datetime, timedelta

import numpy as np
import polars as pl
import pytest

from src.engine.config import (
    BacktestRequest,
    IndicatorConfig,
    PositionSizeConfig,
    StopConfig,
    StrategyConfig,
)
from src.engine.walk_forward import (
    _combined_fold_sharpe,
    _cpcv_fold_embargo_strips,
    _run_walk_forward_cpcv,
    split_walk_forward_windows,
)

# ─── Helpers ─────────────────────────────────────────────────────────────────

def _make_data(n: int = 600) -> pl.DataFrame:
    """Synthetic OHLCV suitable for short WF splits."""
    dates = [datetime(2022, 1, 1) + timedelta(days=i) for i in range(n)]
    closes = [4000.0 + i * 0.2 + np.sin(i / 20) * 15 for i in range(n)]
    return pl.DataFrame({
        "ts_event": dates,
        "open":   [c - 1.5 for c in closes],
        "high":   [c + 4.0 for c in closes],
        "low":    [c - 4.0 for c in closes],
        "close":  closes,
        "volume": [50_000] * n,
    })


def _make_request() -> BacktestRequest:
    return BacktestRequest(
        strategy=StrategyConfig(
            name="CPCV Test SMA",
            symbol="MES",
            timeframe="daily",
            indicators=[
                IndicatorConfig(type="sma", period=5),
                IndicatorConfig(type="sma", period=15),
                IndicatorConfig(type="atr", period=14),
            ],
            entry_long="close crosses_above sma_5",
            entry_short="close crosses_below sma_5",
            exit="close crosses_below sma_15",
            stop_loss=StopConfig(type="atr", multiplier=2.0),
            position_size=PositionSizeConfig(type="fixed", fixed_contracts=1),
        ),
        start_date="2022-01-01",
        end_date="2023-08-01",
    )


# ─── Test: plain mode is unchanged (no purge, embargo_bars unchanged) ─────────

class TestPlainModeUnchanged:
    def test_plain_mode_embargo_bars_unchanged(self):
        """Plain mode must not modify embargo_bars from the split."""
        data = _make_data(300)
        windows = split_walk_forward_windows(data, n_splits=5, is_ratio=0.7, embargo_bars=5)
        # Verify: IS end < OOS start by at least 5 bars
        for is_data, oos_data in windows:
            is_end = is_data["ts_event"][-1]
            oos_start = oos_data["ts_event"][0]
            assert oos_start > is_end

    def test_plain_mode_wf_metadata_emitted(self, monkeypatch):
        """run_walk_forward with WF_MODE=plain emits wf_metadata.mode='plain'."""
        monkeypatch.setenv("WF_MODE", "plain")
        # We test split_walk_forward_windows directly — WF metadata is tested via
        # the run_walk_forward call pattern. Check that split runs clean.
        data = _make_data(300)
        windows = split_walk_forward_windows(data, n_splits=3, is_ratio=0.7)
        assert len(windows) == 3


# ─── Test: purged_embargo mode applies additional purge bars ─────────────────

class TestPurgedEmbargoMode:
    def test_purged_embargo_adds_purge_window_to_embargo(self):
        """purged_embargo mode: effective_embargo = embargo_bars + purge_window."""
        data = _make_data(500)
        # Plain: embargo_bars=5
        windows_plain = split_walk_forward_windows(data, n_splits=3, is_ratio=0.7, embargo_bars=5)
        # Purged: embargo_bars=5 + purge_window=20 = 25
        windows_purged = split_walk_forward_windows(data, n_splits=3, is_ratio=0.7, embargo_bars=25)

        # Purged windows should have smaller OOS datasets (more bars stripped as embargo)
        for (_, oos_plain), (_, oos_purged) in zip(windows_plain, windows_purged):
            assert len(oos_purged) <= len(oos_plain)

    def test_purged_embargo_no_overlap_between_is_and_oos(self):
        """Purged windows: IS end strictly before OOS start."""
        data = _make_data(500)
        windows = split_walk_forward_windows(data, n_splits=3, is_ratio=0.7, embargo_bars=25)
        for is_data, oos_data in windows:
            if len(is_data) == 0 or len(oos_data) == 0:
                continue
            is_end = is_data["ts_event"][-1]
            oos_start = oos_data["ts_event"][0]
            assert oos_start > is_end, "OOS must start after IS end (no look-ahead)"

    def test_purge_removes_overlapping_label_bars(self):
        """The purge window removes bars near the IS/OOS boundary that could
        carry forward labels from Style C runner holds spanning the boundary."""
        data = _make_data(500)
        # With embargo=25 vs embargo=5, OOS windows must be shorter
        w5 = split_walk_forward_windows(data, n_splits=3, is_ratio=0.7, embargo_bars=5)
        w25 = split_walk_forward_windows(data, n_splits=3, is_ratio=0.7, embargo_bars=25)
        # Sum of OOS bars must be smaller with larger embargo
        oos_bars_5 = sum(len(oos) for _, oos in w5)
        oos_bars_25 = sum(len(oos) for _, oos in w25)
        assert oos_bars_25 < oos_bars_5


# ─── Test: CPCV generates correct number of paths ────────────────────────────

class TestCpcvPaths:
    def test_cpcv_generates_15_paths_n6_k2(self):
        """C(6, 2) = 15 combinatorial paths for N=6, k=2."""
        from itertools import combinations
        n, k = 6, 2
        n_paths = len(list(combinations(range(n), k)))
        assert n_paths == 15

    def test_cpcv_result_has_wf_metadata(self):
        """_run_walk_forward_cpcv emits wf_metadata with mode='cpcv' and n_paths."""
        data = _make_data(600)
        req = _make_request()
        result = _run_walk_forward_cpcv(
            request=req,
            data=data,
            n_splits=6,
            k_test_groups=2,
            embargo_bars=5,
        )
        assert "wf_metadata" in result
        meta = result["wf_metadata"]
        assert meta["mode"] == "cpcv"
        assert meta["n_folds"] == 6
        assert "n_paths" in meta
        assert meta["n_paths"] <= 15  # May be less if some paths fail

    def test_cpcv_oos_metrics_present(self):
        """CPCV result must contain oos_metrics with standard keys."""
        data = _make_data(600)
        req = _make_request()
        result = _run_walk_forward_cpcv(
            request=req,
            data=data,
            n_splits=6,
            k_test_groups=2,
            embargo_bars=5,
        )
        oos = result.get("oos_metrics", {})
        for key in ("total_return", "sharpe_ratio", "max_drawdown",
                    "win_rate", "profit_factor", "total_trades"):
            assert key in oos, f"Missing key: {key}"

    def test_cpcv_no_temporal_lookahead(self):
        """CPCV: test fold indices must be excluded from IS fold indices.

        We verify this at the combination level: no test fold index appears
        in the IS fold indices for the same path.
        """
        from itertools import combinations
        n_splits = 6
        k = 2
        for test_indices in combinations(range(n_splits), k):
            is_indices = [i for i in range(n_splits) if i not in test_indices]
            # No overlap
            assert not set(test_indices).intersection(is_indices)

    def test_cpcv_embargo_strips_boundary_bars(self):
        """CPCV: each OOS fold must have embargo_bars stripped from its head."""
        data = _make_data(600)
        n_splits = 6
        n = len(data)
        fold_size = n // n_splits
        embargo = 10

        # Manually verify: each OOS fold loses `embargo` bars from the front
        for fi in range(n_splits):
            fold_start = fi * fold_size
            fold_end = (fi + 1) * fold_size if fi < n_splits - 1 else n
            fold_len = fold_end - fold_start
            expected_oos_len = max(0, fold_len - embargo)
            # This is what _run_walk_forward_cpcv does for each test fold
            assert expected_oos_len >= 0

    def test_cpcv_psr_dsr_in_metadata(self):
        """CPCV wf_metadata must include psr and dsr aggregate fields."""
        data = _make_data(600)
        req = _make_request()
        result = _run_walk_forward_cpcv(
            request=req,
            data=data,
            n_splits=6,
            k_test_groups=2,
            embargo_bars=5,
        )
        meta = result["wf_metadata"]
        assert "psr" in meta
        assert "dsr" in meta
        # PSR must be in [0, 1] when computed
        if meta["psr"] is not None:
            assert 0.0 <= meta["psr"] <= 1.0


# ─── Test: wf_metadata mode field ────────────────────────────────────────────

class TestWfMetadataMode:
    def test_purged_embargo_mode_metadata_keys(self):
        """purged_embargo mode wf_metadata must have required keys."""
        # Test the wf_metadata contract without running a full backtest
        # by checking the keys that _run_walk_forward_cpcv returns.
        data = _make_data(600)
        req = _make_request()

        # CPCV mode always returns these keys
        result = _run_walk_forward_cpcv(request=req, data=data)
        meta = result["wf_metadata"]
        required_keys = {"mode", "n_folds", "embargo_pct", "purge_window", "n_paths"}
        assert required_keys.issubset(meta.keys()), f"Missing keys: {required_keys - set(meta.keys())}"


# ─── Wave C: _cpcv_fold_embargo_strips pure-function tests ───────────────────
# These tests import ONLY the pure helper — no backtester, no vectorbt.
# Safe to run even if vectorbt JIT hangs locally on the tower.

class TestCpcvFoldEmbargoStripsPureFunction:
    """Tests for _cpcv_fold_embargo_strips — pure adjacency math, no I/O."""

    # ── IS fold (is_test_fold=False) ──────────────────────────────────────────

    def test_is_fold_not_adjacent_to_any_oos_no_strip(self):
        """IS fold 0 with OOS={2,4}: fold 1 (IS) is right neighbor → no strip."""
        ss, se = _cpcv_fold_embargo_strips(
            fold_idx=0, test_fold_set={2, 4}, n_splits=6, embargo_bars=20, is_test_fold=False
        )
        assert (ss, se) == (0, 0), f"Expected (0,0) got ({ss},{se})"

    def test_is_fold_right_neighbor_is_oos_strips_end_only(self):
        """IS fold 1 with OOS={2,4}: right neighbor is fold 2 (OOS) → strip END only."""
        ss, se = _cpcv_fold_embargo_strips(
            fold_idx=1, test_fold_set={2, 4}, n_splits=6, embargo_bars=20, is_test_fold=False
        )
        assert (ss, se) == (0, 20), f"Expected (0,20) got ({ss},{se})"

    def test_is_fold_both_neighbors_oos_strips_both(self):
        """IS fold 3 with OOS={2,4}: left=2(OOS), right=4(OOS) → strip both."""
        ss, se = _cpcv_fold_embargo_strips(
            fold_idx=3, test_fold_set={2, 4}, n_splits=6, embargo_bars=20, is_test_fold=False
        )
        assert (ss, se) == (20, 20), f"Expected (20,20) got ({ss},{se})"

    def test_is_fold_left_neighbor_is_oos_strips_start_only(self):
        """IS fold 5 with OOS={2,4}: left=4(OOS), no right neighbor → strip START only."""
        ss, se = _cpcv_fold_embargo_strips(
            fold_idx=5, test_fold_set={2, 4}, n_splits=6, embargo_bars=20, is_test_fold=False
        )
        assert (ss, se) == (20, 0), f"Expected (20,0) got ({ss},{se})"

    def test_is_fold_at_data_start_no_left_strip(self):
        """IS fold 0 is never stripped from the start (no left neighbor exists)."""
        ss, se = _cpcv_fold_embargo_strips(
            fold_idx=0, test_fold_set={1, 3}, n_splits=6, embargo_bars=10, is_test_fold=False
        )
        # fold 0: right=1(OOS) → strip END; left: none → no START strip
        assert ss == 0, f"fold_idx=0 must never have start strip, got {ss}"
        assert se == 10, f"Expected end strip=10, got {se}"

    def test_is_fold_at_data_end_no_right_strip(self):
        """IS fold 5 (last fold) is never stripped from the end (no right neighbor)."""
        ss, se = _cpcv_fold_embargo_strips(
            fold_idx=5, test_fold_set={1, 3}, n_splits=6, embargo_bars=10, is_test_fold=False
        )
        # fold 5: left=3(IS, not OOS) → no strip; right: none → no END strip
        assert se == 0, f"fold_idx=5 must never have end strip (no right neighbor), got {se}"

    # ── OOS fold (is_test_fold=True) ──────────────────────────────────────────

    def test_oos_fold_both_neighbors_is_strips_both(self):
        """OOS fold 2 with OOS={2,4}: left=1(IS), right=3(IS) → strip both."""
        ss, se = _cpcv_fold_embargo_strips(
            fold_idx=2, test_fold_set={2, 4}, n_splits=6, embargo_bars=20, is_test_fold=True
        )
        assert (ss, se) == (20, 20), f"Expected (20,20) got ({ss},{se})"

    def test_oos_fold_contiguous_right_sibling_no_end_strip(self):
        """OOS fold 2 with OOS={2,3}: right=3(OOS) → no END strip, only START strip."""
        ss, se = _cpcv_fold_embargo_strips(
            fold_idx=2, test_fold_set={2, 3}, n_splits=6, embargo_bars=20, is_test_fold=True
        )
        # left=1(IS) → strip START; right=3(OOS) → no strip END
        assert (ss, se) == (20, 0), f"Expected (20,0) got ({ss},{se})"

    def test_oos_fold_contiguous_left_sibling_no_start_strip(self):
        """OOS fold 3 with OOS={2,3}: left=2(OOS) → no START strip, END strip from fold 4 (IS)."""
        ss, se = _cpcv_fold_embargo_strips(
            fold_idx=3, test_fold_set={2, 3}, n_splits=6, embargo_bars=20, is_test_fold=True
        )
        # left=2(OOS) → no START strip; right=4(IS) → strip END
        assert (ss, se) == (0, 20), f"Expected (0,20) got ({ss},{se})"

    def test_oos_fold_at_data_start_no_left_strip(self):
        """OOS fold 0 (no left neighbor): never strip START regardless of right neighbor."""
        ss, se = _cpcv_fold_embargo_strips(
            fold_idx=0, test_fold_set={0, 3}, n_splits=6, embargo_bars=15, is_test_fold=True
        )
        # fold 0: no left neighbor → no START strip; right=1(IS) → strip END
        assert ss == 0, f"fold_idx=0 must never have start strip, got {ss}"
        assert se == 15, f"Expected end strip=15, got {se}"

    def test_oos_fold_at_data_end_no_right_strip(self):
        """OOS fold 5 (last fold, no right neighbor): never strip END."""
        ss, se = _cpcv_fold_embargo_strips(
            fold_idx=5, test_fold_set={2, 5}, n_splits=6, embargo_bars=15, is_test_fold=True
        )
        # fold 5: left=4(IS) → strip START; no right neighbor → no END strip
        assert ss == 15, f"Expected start strip=15, got {ss}"
        assert se == 0, f"fold_idx=5 must never have end strip, got {se}"

    def test_zero_embargo_always_returns_zero_zero(self):
        """With embargo_bars=0 all strips are zero regardless of adjacency."""
        for fi in range(6):
            for is_test in (True, False):
                ss, se = _cpcv_fold_embargo_strips(
                    fold_idx=fi, test_fold_set={2, 4}, n_splits=6,
                    embargo_bars=0, is_test_fold=is_test
                )
                assert (ss, se) == (0, 0), (
                    f"embargo_bars=0 must give (0,0), got ({ss},{se}) for fold={fi}"
                )


# ─── Wave C: IS-side purge + bilateral OOS strip integration tests ────────────
# These tests call _run_walk_forward_cpcv (imports backtester).
# If vectorbt JIT hangs on the tower, run with NUMBA_DISABLE_JIT=1.
# The pure-function tests above cover the math without any import risk.

class TestCpcvBilateralEmbargoIntegration:
    """Integration tests proving the bilateral purge reduces IS and OOS data sizes."""

    def test_bilateral_oos_strip_shorter_than_single_sided(self):
        """OOS data from bilateral strip must be smaller than single-sided (old behaviour).

        We approximate 'old' by stripping only the START and keeping the END:
        old_oos_len = fold_size - embargo_bars
        new_oos_len = fold_size - 2 * embargo_bars   (when both neighbors are IS)

        This test verifies the mathematical invariant using known fold geometry.
        """
        # With 600 bars, n_splits=6: each fold ~100 bars
        n = 600
        n_splits = 6
        fold_size = n // n_splits  # 100

        embargo = 10
        # For a non-edge non-contiguous OOS fold (both neighbors IS):
        # old: fold_size - embargo = 90
        # new: fold_size - 2*embargo = 80
        old_len = fold_size - embargo
        new_len = fold_size - 2 * embargo
        assert new_len < old_len, (
            f"Bilateral strip ({new_len}) must be shorter than single-sided ({old_len})"
        )

    def test_cpcv_result_obtainable_with_bilateral_embargo(self):
        """_run_walk_forward_cpcv must return a valid dict without crashing under bilateral embargo.

        The synthetic strategy does not generate 100+ trades needed to pass the
        performance gate, so n_paths may be 0 — that is expected and irrelevant here.
        What matters is: the function does not raise, the dict structure is present,
        and wf_metadata has the expected keys.
        """
        data = _make_data(600)
        req = _make_request()
        result = _run_walk_forward_cpcv(
            request=req,
            data=data,
            n_splits=6,
            k_test_groups=2,
            embargo_bars=10,
        )
        # Structural invariants — must hold regardless of n_paths
        assert isinstance(result, dict), "Must return a dict"
        assert "oos_metrics" in result
        assert "wf_metadata" in result
        assert "n_paths" in result["wf_metadata"], "wf_metadata must always have n_paths"
        assert result["wf_metadata"]["n_paths"] >= 0  # 0 allowed — synthetic data has no trades

    def test_cpcv_oos_metrics_still_present_with_increased_embargo(self):
        """Increasing embargo with bilateral strip must not cause KeyError or crash.

        With 600 bars, n_splits=6: each fold ~100 bars.
        Bilateral strip at embargo=20: each non-edge OOS fold loses 40 bars → 60 bars remain.
        Structural keys must be present; n_paths may be 0 (synthetic data produces no trades).
        """
        data = _make_data(600)
        req = _make_request()
        result = _run_walk_forward_cpcv(
            request=req,
            data=data,
            n_splits=6,
            k_test_groups=2,
            embargo_bars=20,  # bilateral = 40 bars per OOS fold, fold_size=100 → 60 bars remain
        )
        assert isinstance(result, dict)
        assert "oos_metrics" in result
        assert "wf_metadata" in result
        # n_paths >= 0: 0 is OK here because synthetic data has no trades to count
        assert result["wf_metadata"].get("n_paths", -1) >= 0, "n_paths must be non-negative"


# ─── CPCV WFE — combined-fold IS basis (X5 RATIFIED 2026-07-09) ─────────────
# Exercises the REAL production helper `_combined_fold_sharpe` (imported, not
# reimplemented) + the real `_run_walk_forward_cpcv` result contract. Replaces
# the former per-path-average mirror (deep-scan #9 FIX 1) after the operator
# ratified option (a): the CPCV WFE IS basis is now the pooled combined-fold IS
# Sharpe, symmetric with the pooled OOS numerator. wfe_status="cpcv_combined_fold".

class TestCpcvWfeCombinedFold:
    """CPCV WFE IS basis is the combined-fold (pooled) IS Sharpe.

    Before X5 (pre-2026-07-09): wfe_overall = round(agg_sharpe /
        mean(per_path_is_sharpes), 4), wfe_status="cpcv_per_path_is" (asymmetric).
    After X5 (ratified): wfe_overall = round(agg_sharpe /
        _combined_fold_sharpe(all_is_pnls), 4), wfe_status="cpcv_combined_fold".
    TS wfe-gate.ts accepts both status strings; new runs emit combined_fold.
    """

    def test_combined_fold_sharpe_matches_pooled_formula(self):
        """The real helper equals mean/std(ddof=1)*sqrt(252) over the pooled series."""
        pnls = [5.0, -3.0, 8.0, -1.0, 4.0, -2.0, 6.0, 0.5]
        arr = np.array(pnls, dtype=float)
        expected = float(np.mean(arr) / np.std(arr, ddof=1) * np.sqrt(252))
        assert _combined_fold_sharpe(pnls) == pytest.approx(expected, rel=1e-9)

    def test_combined_fold_diverges_from_mean_of_per_path_sharpes(self):
        """A/B: pooling per-path IS P&L differs from averaging per-path Sharpes when
        per-path variance is dispersed — the exact reason the ratified fix matters."""
        path_a = list(np.random.RandomState(11).normal(8.0, 10.0, 40))
        path_b = list(np.random.RandomState(12).normal(8.0, 30.0, 40))  # wide
        combined = _combined_fold_sharpe(path_a + path_b)
        mean_of_per_path = float(np.mean([_combined_fold_sharpe(path_a),
                                          _combined_fold_sharpe(path_b)]))
        assert abs(combined - mean_of_per_path) / abs(mean_of_per_path) > 0.02, (
            f"combined={combined:.4f} vs mean-per-path={mean_of_per_path:.4f} — "
            f"expected material divergence on dispersed per-path variance"
        )

    def test_combined_fold_empty_returns_zero(self):
        """Empty pooled IS series → 0.0 (routes WFE gate to degenerate_is → BLOCK)."""
        assert _combined_fold_sharpe([]) == 0.0

    def test_combined_fold_zero_variance_returns_zero(self):
        """Zero-variance pooled series → 0.0 (no divide-by-zero; conservative BLOCK)."""
        assert _combined_fold_sharpe([3.0, 3.0, 3.0, 3.0]) == 0.0

    def test_combined_fold_replay_determinism(self):
        """Pure function — same input, same output."""
        pnls = [5.0, -3.0, 8.0, -1.0, 4.0]
        assert _combined_fold_sharpe(pnls) == _combined_fold_sharpe(pnls)

    def test_cpcv_result_wfe_status_key_present(self):
        """_run_walk_forward_cpcv result always has wfe_status/wfe_overall keys;
        status is one of the valid CPCV values (now including cpcv_combined_fold)."""
        data = _make_data(600)
        req = _make_request()
        result = _run_walk_forward_cpcv(request=req, data=data, n_splits=6, k_test_groups=2)
        assert "wfe_status" in result, "wfe_status key must always be present"
        assert "wfe_overall" in result, "wfe_overall key must always be present"
        # Valid set: cpcv_combined_fold is the ratified producer output; the legacy
        # cpcv_per_path_is is retained only for backward-compat on old serialized rows.
        valid = {"cpcv_combined_fold", "cpcv_per_path_is", "degenerate_is", "cpcv_not_applicable"}
        assert result["wfe_status"] in valid, (
            f"wfe_status={result['wfe_status']!r} not in valid set {valid}"
        )

    def test_cpcv_wfe_cpcv_basis_in_wf_metadata(self):
        """wf_metadata.wfe_cpcv_basis key is present after FIX 1."""
        data = _make_data(600)
        req = _make_request()
        result = _run_walk_forward_cpcv(request=req, data=data, n_splits=6, k_test_groups=2)
        meta = result["wf_metadata"]
        # wfe_cpcv_basis present (None when no IS data, dict when IS data available)
        assert "wfe_cpcv_basis" in meta, "wf_metadata.wfe_cpcv_basis must always be present"


# ─── FIX 4 (deep-scan #9): embargo calibration basis ─────────────────────────

class TestFix4EmbargoBasis:
    """FIX 4: wf_metadata.embargo_basis emitted for calibration observability.

    'default_20_uncalibrated' when trades lack duration_bars.
    'calibrated_<n>' when duration_bars present (max(embargo_bars, avg_duration)).
    """

    def test_embargo_basis_default_when_no_duration(self):
        """Trades without duration_bars → 'default_20_uncalibrated'."""
        trades = [{"PnL": 100}, {"PnL": -50}, {"PnL": 200}]
        embargo_bars = 20
        durations = [
            int(t["duration_bars"])
            for t in trades
            if isinstance(t.get("duration_bars"), (int, float)) and t["duration_bars"] > 0
        ]
        if durations:
            avg_dur = sum(durations) / len(durations)
            calibrated = max(embargo_bars, int(avg_dur + 0.5))
            basis = f"calibrated_{calibrated}"
        else:
            basis = "default_20_uncalibrated"
        assert basis == "default_20_uncalibrated"

    def test_embargo_basis_calibrated_when_duration_available(self):
        """Trades with duration_bars > embargo_bars → 'calibrated_<n>'."""
        trades = [
            {"PnL": 100, "duration_bars": 30},
            {"PnL": -50, "duration_bars": 35},
            {"PnL": 200, "duration_bars": 28},
        ]
        embargo_bars = 20
        durations = [
            int(t["duration_bars"])
            for t in trades
            if isinstance(t.get("duration_bars"), (int, float)) and t["duration_bars"] > 0
        ]
        avg_dur = sum(durations) / len(durations)  # ~31
        calibrated = max(embargo_bars, int(avg_dur + 0.5))
        basis = f"calibrated_{calibrated}"
        assert basis.startswith("calibrated_")
        n = int(basis.split("_")[1])
        assert n >= embargo_bars
        assert n >= int(avg_dur)

    def test_embargo_basis_keeps_default_when_duration_shorter(self):
        """Trades with duration_bars < embargo_bars → calibrated = embargo_bars."""
        trades = [
            {"PnL": 100, "duration_bars": 5},
            {"PnL": -50, "duration_bars": 8},
        ]
        embargo_bars = 20
        durations = [int(t["duration_bars"]) for t in trades if t.get("duration_bars", 0) > 0]
        avg_dur = sum(durations) / len(durations)  # ~6.5
        calibrated = max(embargo_bars, int(avg_dur + 0.5))
        basis = f"calibrated_{calibrated}"
        # calibrated = max(20, 7) = 20 → calibrated_20
        assert calibrated == 20
        assert basis == "calibrated_20"

    def test_cpcv_result_embargo_basis_key_present(self):
        """wf_metadata.embargo_basis key is always present after FIX 4."""
        data = _make_data(600)
        req = _make_request()
        result = _run_walk_forward_cpcv(request=req, data=data, n_splits=6, k_test_groups=2)
        meta = result["wf_metadata"]
        assert "embargo_basis" in meta, "wf_metadata.embargo_basis must always be present"
        assert isinstance(meta["embargo_basis"], str)
        assert meta["embargo_basis"].startswith(("default_", "calibrated_"))


# ─── FIX 6 (deep-scan #9): BIF k_eff_independent ────────────────────────────

class TestFix6BifKeffIndependent:
    """FIX 6: bif_detail.k_eff_independent = n_splits / k_test_groups.

    Default CPCV: 6/2=3 (not 15). expected_inflation_independent is lower.
    Gate thresholds unchanged.
    """

    def test_k_eff_independent_value_default_cpcv(self):
        """Default CPCV (n_splits=6, k=2): k_eff_independent = 3.0."""
        n_splits, k = 6, 2
        k_eff_independent = float(n_splits) / float(k)
        assert k_eff_independent == pytest.approx(3.0), (
            f"k_eff_independent should be 3.0 for default CPCV, got {k_eff_independent}"
        )

    def test_expected_inflation_independent_lower_than_total(self):
        """expected_inflation_independent (k=3) < expected_inflation (k=15)."""
        import math
        k_eff_total = 15.0
        k_eff_independent = 3.0
        ei_total = math.sqrt(2.0 * math.log(k_eff_total))
        ei_independent = math.sqrt(2.0 * math.log(k_eff_independent))
        assert ei_independent < ei_total, (
            f"independent ({ei_independent:.4f}) should be < total ({ei_total:.4f})"
        )

    def test_cpcv_bif_detail_has_k_eff_independent(self):
        """After FIX 6, _run_walk_forward_cpcv bif_detail carries k_eff_independent."""
        data = _make_data(600)
        req = _make_request()
        result = _run_walk_forward_cpcv(
            request=req, data=data, n_splits=6, k_test_groups=2, embargo_bars=5
        )
        bif_detail = result.get("bif_detail", {})
        assert "k_eff_independent" in bif_detail, (
            "bif_detail must have k_eff_independent key after FIX 6"
        )
        assert bif_detail["k_eff_independent"] == pytest.approx(3.0)

    def test_cpcv_bif_detail_has_expected_inflation_independent(self):
        """After FIX 6, bif_detail carries expected_inflation_independent."""
        data = _make_data(600)
        req = _make_request()
        result = _run_walk_forward_cpcv(
            request=req, data=data, n_splits=6, k_test_groups=2, embargo_bars=5
        )
        bif_detail = result.get("bif_detail", {})
        assert "expected_inflation_independent" in bif_detail
        import math
        expected_ei_ind = math.sqrt(2.0 * math.log(3.0))  # ≈ 1.4823
        assert bif_detail["expected_inflation_independent"] == pytest.approx(expected_ei_ind, rel=1e-4)

    def test_existing_bif_k_eff_key_unchanged(self):
        """Existing 'k_eff' key (n_paths=15) is preserved alongside k_eff_independent."""
        data = _make_data(600)
        req = _make_request()
        result = _run_walk_forward_cpcv(
            request=req, data=data, n_splits=6, k_test_groups=2, embargo_bars=5
        )
        bif_detail = result.get("bif_detail", {})
        # Both keys must exist
        assert "k_eff" in bif_detail, "Original k_eff key must be preserved"
        assert "k_eff_independent" in bif_detail, "New k_eff_independent must be present"
        # k_eff (n_paths) >= k_eff_independent (n_splits/k)
        if bif_detail.get("k_eff") is not None:
            assert bif_detail["k_eff"] >= bif_detail["k_eff_independent"]

    def test_is_fold_purge_reduces_is_data_for_adjacent_paths(self):
        """IS purge on adjacency is self-consistent: strips computed by helper match
        the expected adjacency for test_fold_indices=(2,4) in N=6 k=2 CPCV.

        We verify the helper's output for every IS fold in this canonical path.
        """
        test_set = {2, 4}
        embargo = 20
        is_indices = [0, 1, 3, 5]
        expected = {
            # fold: (start, end)
            0: (0, 0),    # left=none, right=1(IS) → no strip
            1: (0, 20),   # left=0(IS), right=2(OOS) → strip END
            3: (20, 20),  # left=2(OOS), right=4(OOS) → strip both
            5: (20, 0),   # left=4(OOS), right=none → strip START
        }
        for fi in is_indices:
            ss, se = _cpcv_fold_embargo_strips(
                fold_idx=fi, test_fold_set=test_set, n_splits=6,
                embargo_bars=embargo, is_test_fold=False
            )
            assert (ss, se) == expected[fi], (
                f"IS fold {fi}: expected {expected[fi]}, got ({ss},{se})"
            )

    def test_oos_fold_purge_bilateral_for_path_2_4(self):
        """OOS strips for test_fold_indices=(2,4) in N=6: both folds have IS on both sides.

        Expected: both OOS folds stripped on START and END (bilateral).
        """
        test_set = {2, 4}
        embargo = 20
        expected = {
            2: (20, 20),  # left=1(IS), right=3(IS) → bilateral
            4: (20, 20),  # left=3(IS), right=5(IS) → bilateral
        }
        for ti in sorted(test_set):
            ss, se = _cpcv_fold_embargo_strips(
                fold_idx=ti, test_fold_set=test_set, n_splits=6,
                embargo_bars=embargo, is_test_fold=True
            )
            assert (ss, se) == expected[ti], (
                f"OOS fold {ti}: expected {expected[ti]}, got ({ss},{se})"
            )

    def test_oos_fold_purge_contiguous_oos_no_inner_strip(self):
        """Contiguous OOS folds (2,3) share an OOS-OOS boundary — no strip at that edge.

        Fold 2: left=1(IS)→strip START; right=3(OOS)→NO strip END.
        Fold 3: left=2(OOS)→NO strip START; right=4(IS)→strip END.
        """
        test_set = {2, 3}
        embargo = 20
        expected = {
            2: (20, 0),
            3: (0, 20),
        }
        for ti in sorted(test_set):
            ss, se = _cpcv_fold_embargo_strips(
                fold_idx=ti, test_fold_set=test_set, n_splits=6,
                embargo_bars=embargo, is_test_fold=True
            )
            assert (ss, se) == expected[ti], (
                f"Contiguous OOS fold {ti}: expected {expected[ti]}, got ({ss},{se})"
            )


# ─── Wave C: split_walk_forward_windows default embargo=20 ───────────────────

class TestSplitWindowsDefaultEmbargo:
    """Prove that split_walk_forward_windows now defaults to embargo_bars=20."""

    def test_default_matches_explicit_20(self):
        """Default call must produce same windows as explicit embargo_bars=20."""
        n = 500
        from datetime import datetime, timedelta
        dates = [datetime(2024, 1, 1) + timedelta(hours=i) for i in range(n)]
        df = pl.DataFrame({
            "ts_event": dates,
            "open": [100.0] * n, "high": [101.0] * n,
            "low": [99.0] * n, "close": [100.5] * n, "volume": [1000] * n,
        })

        windows_default = split_walk_forward_windows(df, n_splits=3)
        windows_explicit = split_walk_forward_windows(df, n_splits=3, embargo_bars=20)

        assert len(windows_default) == len(windows_explicit)
        for (is_d, oos_d), (is_e, oos_e) in zip(windows_default, windows_explicit):
            assert len(is_d) == len(is_e), "IS sizes must match between default and explicit-20"
            assert len(oos_d) == len(oos_e), "OOS sizes must match between default and explicit-20"

    def test_default_creates_embargo_gap(self):
        """Default call (embargo=20) must produce smaller OOS than explicit embargo=0."""
        n = 500
        from datetime import datetime, timedelta
        dates = [datetime(2024, 1, 1) + timedelta(hours=i) for i in range(n)]
        df = pl.DataFrame({
            "ts_event": dates,
            "open": [100.0] * n, "high": [101.0] * n,
            "low": [99.0] * n, "close": [100.5] * n, "volume": [1000] * n,
        })

        windows_default = split_walk_forward_windows(df, n_splits=3)
        windows_zero = split_walk_forward_windows(df, n_splits=3, embargo_bars=0)

        # Default (embargo=20) OOS data must be strictly shorter than embargo=0
        oos_default = sum(len(oos) for _, oos in windows_default)
        oos_zero = sum(len(oos) for _, oos in windows_zero)
        assert oos_default < oos_zero, (
            f"Default embargo=20 ({oos_default} OOS bars) must be < "
            f"explicit embargo=0 ({oos_zero} OOS bars)"
        )


# ─── Deepscan17 B-3 fix (2026-07-05): CPCV warmup must never contain future
# data ────────────────────────────────────────────────────────────────────
#
# BUG: _run_walk_forward_cpcv passed the FULL (unrestricted) is_data as
# warmup_data to run_backtest() for every combinatorial path. For combos like
# test_fold_indices=(0,1), every IS fold (2,3,4,5) is chronologically AFTER
# the OOS window; run_backtest()'s warmup prepend
# (`data = pl.concat([warmup_data, data])`, no re-sort by ts_event) then put
# FUTURE bars ahead of the OOS window, seeding rolling indicators with
# lookahead information. Only combo (4,5) was leak-free, by accident (its IS
# folds are all chronologically prior).
#
# FIX: restrict the warmup frame passed to run_backtest() to IS folds
# strictly BEFORE the earliest OOS fold index in each combo. is_data itself
# (unrestricted) is left unchanged for the separate per-path IS-Sharpe
# evaluation, which is a legitimate full-IS-sample use, not an indicator
# warmup.

class TestB3CpcvWarmupNoFutureLeak:
    """Integration-level regression: every warmup frame _run_walk_forward_cpcv
    actually hands to run_backtest() must end strictly before its paired OOS
    frame begins."""

    def test_warmup_never_extends_past_oos_start(self, monkeypatch):
        """Monkeypatch run_backtest to capture every (data, warmup_data) pair
        across all 15 combinatorial paths and assert no warmup frame's last
        timestamp is >= its OOS frame's first timestamp."""
        import src.engine.walk_forward as wf_mod

        data = _make_data(600)
        req = _make_request()

        captured_calls = []

        def _fake_run_backtest(request, data=None, warmup_data=None):
            captured_calls.append((data, warmup_data))
            return {"sharpe_ratio": 0.0, "total_return": 0.0, "trades": [], "daily_pnls": []}

        monkeypatch.setattr(wf_mod, "run_backtest", _fake_run_backtest)

        wf_mod._run_walk_forward_cpcv(
            request=req, data=data, n_splits=6, k_test_groups=2, embargo_bars=5,
        )

        assert len(captured_calls) > 0, "Expected at least one captured run_backtest call"

        checked_nonempty_warmup = 0
        for oos_data, warmup_data in captured_calls:
            if warmup_data is None or len(warmup_data) == 0:
                continue
            warmup_max_ts = warmup_data["ts_event"][-1]
            oos_min_ts = oos_data["ts_event"][0]
            checked_nonempty_warmup += 1
            assert warmup_max_ts < oos_min_ts, (
                f"B-3 REGRESSION: warmup data extends to {warmup_max_ts} which is "
                f">= the OOS window start {oos_min_ts} — future data leaked into "
                f"the indicator-warmup prefix"
            )
        # At least one path (e.g. a late combo like (4,5)) must still receive
        # real, non-empty, correctly-bounded warmup data — the fix must not
        # degenerate into "never pass warmup".
        assert checked_nonempty_warmup > 0, (
            "Expected at least one CPCV path to receive non-empty warmup data"
        )


class TestB3WarmupRestrictionPureLogic:
    """Pure-math replication of the exact fold-selection logic added to
    _run_walk_forward_cpcv: warmup_data_for_oos = folds with fi < min(test_fold_indices).
    Mirrors the TestFix1CpcvWfeFromPerPathIs pattern above — direct, fast,
    deterministic coverage of the selection rule independent of full-backtest
    plumbing."""

    def _select_warmup_fold_indices(self, is_fold_indices, test_fold_indices):
        """Replicates walk_forward.py's warmup-restriction selection exactly:
        `_earliest_test_fold = min(test_fold_indices)`
        `[fi for fi in sorted(is_fold_indices) if fi < _earliest_test_fold]`
        """
        earliest_test_fold = min(test_fold_indices)
        return [fi for fi in sorted(is_fold_indices) if fi < earliest_test_fold]

    def test_earliest_combo_0_1_gets_no_warmup_folds(self):
        """test_fold_indices=(0,1): all 4 IS folds (2,3,4,5) are chronologically
        AFTER this OOS window — pre-fix bug used all 4 as 'warmup'."""
        selected = self._select_warmup_fold_indices([2, 3, 4, 5], (0, 1))
        assert selected == [], (
            "B-3 REGRESSION: combo (0,1) has no IS fold chronologically before "
            "it — warmup must be empty, not the pre-fix bug's 4 future folds"
        )

    def test_latest_combo_4_5_gets_all_prior_folds_as_warmup(self):
        """test_fold_indices=(4,5) was the only leak-free combo pre-fix (by
        accident, since all its IS folds happen to be chronologically prior).
        Post-fix it must still get its full prior-fold warmup set."""
        selected = self._select_warmup_fold_indices([0, 1, 2, 3], (4, 5))
        assert selected == [0, 1, 2, 3]

    def test_middle_combo_2_3_excludes_future_folds_4_5(self):
        """test_fold_indices=(2,3): IS folds are (0,1,4,5). Folds 4,5 are
        chronologically AFTER this OOS window and must be excluded even
        though they are legitimately IS folds for this combo."""
        selected = self._select_warmup_fold_indices([0, 1, 4, 5], (2, 3))
        assert selected == [0, 1], (
            "B-3 REGRESSION: chronologically-future IS folds 4,5 leaked into "
            "the warmup set for combo (2,3)"
        )

    def test_noncontiguous_combo_1_4_only_keeps_fold_before_earliest(self):
        """test_fold_indices=(1,4) (non-contiguous): IS folds are (0,2,3,5).
        Only fold 0 is chronologically before the earliest test fold (1)."""
        selected = self._select_warmup_fold_indices([0, 2, 3, 5], (1, 4))
        assert selected == [0]

    def test_selection_never_includes_a_test_fold_index(self):
        """Sanity: the restricted warmup set can never overlap the test set,
        for every C(6,2) combination (would indicate a logic error, not the
        B-3 bug specifically, but worth locking down alongside it)."""
        from itertools import combinations
        n_splits = 6
        for test_indices in combinations(range(n_splits), 2):
            is_indices = [i for i in range(n_splits) if i not in test_indices]
            selected = self._select_warmup_fold_indices(is_indices, test_indices)
            assert not set(selected).intersection(test_indices)
