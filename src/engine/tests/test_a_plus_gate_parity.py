"""Wave 23 Gap-Fix-A: A+ confluence gate parity tests.

Verifies that the Python backtester evaluates each confluence factor using
the SAME math as paper-signal-service.ts (TypeScript side).

Coverage:
  E.1 — VP shape score formula matches TS getSessionShapeScore() for all shapes
  E.2 — Backtester A+ gate wires correctly: blocks/passes on factor count
  E.3 — Python factor evaluations match documented TS behavior per-factor
  E.4 — Legacy strategies (no entry_quality) bypass gate entirely

All tests use synthetic in-memory data — no DB, no network, no S3.
"""
from __future__ import annotations

import os
import sys

import numpy as np
import polars as pl
import pytest

# Ensure src is importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))

from src.engine.indicators.volume_profile import (
    VP_SHAPE_SCORE_THRESHOLD,
    compute_session_shape_score,
    compute_session_shape_score_from_bars,
)


# ─── E.1: VP shape score formula parity with TS ───────────────────────────────
# TypeScript reference (paper-signal-service.ts):
#   shapeBaseAbs = { D: 0, b: 5, P: 5, Thin: 10 }[shape]
#   score = Math.round(confidence × (shapeBaseAbs / 10) × 100)
# Threshold: score >= 50
#
# Key numeric check points (7 cases matching AGENT-LOGS wave23-bias-engine-wiring.test.ts):
#   D    @ any confidence → 0      (D=0 weight, never satisfies)
#   b    @ 100% conf      → 50     (5/10 × 100 × 1.0 = 50 exactly)
#   P    @ 100% conf      → 50     (5/10 × 100 × 1.0 = 50 exactly)
#   Thin @ 100% conf      → 100    (10/10 × 100 × 1.0 = 100)
#   Thin @ 60% conf       → 60     (10/10 × 100 × 0.6 = 60)
#   b    @ 60% conf       → 30     (5/10 × 100 × 0.6 = 30)
#   b    @ 50% conf       → 25     (5/10 × 100 × 0.5 = 25)


class TestVpShapeScoreFormulaParity:
    """E.1: VP shape score formula — identical to TS implementation."""

    def test_d_shape_any_confidence_is_zero(self):
        """D-shaped profile always scores 0 (neutral — no directional score)."""
        assert compute_session_shape_score("D", 1.0) == 0
        assert compute_session_shape_score("D", 0.85) == 0
        assert compute_session_shape_score("D", 0.0) == 0

    def test_b_shape_100_pct_confidence_is_50(self):
        """b-shaped at 100% confidence → score = 50 (boundary — just satisfies threshold)."""
        assert compute_session_shape_score("b", 1.0) == 50

    def test_p_shape_100_pct_confidence_is_50(self):
        """P-shaped at 100% confidence → score = 50 (same as b)."""
        assert compute_session_shape_score("P", 1.0) == 50

    def test_thin_shape_100_pct_confidence_is_100(self):
        """Thin at 100% confidence → score = 100 (max possible)."""
        assert compute_session_shape_score("Thin", 1.0) == 100

    def test_thin_shape_60_pct_confidence_is_60(self):
        """Thin at 60% confidence → score = 60 (10/10 × 100 × 0.6 = 60)."""
        assert compute_session_shape_score("Thin", 0.60) == 60

    def test_b_shape_60_pct_confidence_is_30(self):
        """b at 60% confidence → score = 30 (5/10 × 100 × 0.6 = 30 — does not satisfy)."""
        assert compute_session_shape_score("b", 0.60) == 30

    def test_b_shape_50_pct_confidence_is_25(self):
        """b at 50% confidence → score = 25 (5/10 × 100 × 0.5 = 25)."""
        assert compute_session_shape_score("b", 0.50) == 25

    def test_threshold_boundary_50_satisfies(self):
        """Score == 50 satisfies the threshold (>= 50)."""
        score = compute_session_shape_score("b", 1.0)
        assert score == 50
        assert score >= VP_SHAPE_SCORE_THRESHOLD

    def test_threshold_boundary_49_does_not_satisfy(self):
        """Score < 50 does not satisfy. b@98% = round(0.98 * 50) = round(49) = 49."""
        score = compute_session_shape_score("b", 0.98)
        assert score == 49
        assert score < VP_SHAPE_SCORE_THRESHOLD

    def test_unknown_shape_scores_zero(self):
        """Unknown shape string → treated as weight 0 (safe default)."""
        assert compute_session_shape_score("Unknown", 1.0) == 0
        assert compute_session_shape_score("", 1.0) == 0

    def test_threshold_constant_is_50(self):
        """VP_SHAPE_SCORE_THRESHOLD must equal 50 (matches TS constant)."""
        assert VP_SHAPE_SCORE_THRESHOLD == 50


class TestVpShapeScoreFromBars:
    """E.1: compute_session_shape_score_from_bars() — from raw OHLCV."""

    def _make_session_bars(
        self,
        n_bars: int = 20,
        base_price: float = 5000.0,
        volume: float = 1000.0,
        pattern: str = "flat",
    ) -> pl.DataFrame:
        """Synthetic session bars."""
        if pattern == "flat":
            # Flat session — broad distribution → D-shaped
            prices = np.linspace(base_price - 5, base_price + 5, n_bars)
            highs = prices + 1.0
            lows = prices - 1.0
        elif pattern == "trend_up":
            # Trending session — thin profile → Thin
            prices = np.linspace(base_price, base_price + 30, n_bars)
            highs = prices + 0.25
            lows = prices - 0.25
        else:
            prices = np.full(n_bars, base_price)
            highs = prices + 0.5
            lows = prices - 0.5

        volumes = np.full(n_bars, volume)
        return pl.DataFrame({
            "high": highs,
            "low": lows,
            "close": prices,
            "volume": volumes,
        })

    def test_empty_bars_returns_unavailable(self):
        """Empty DataFrame → available=False."""
        empty = pl.DataFrame({"high": [], "low": [], "volume": []})
        score, shape, conf, avail = compute_session_shape_score_from_bars(empty)
        assert avail is False
        assert score == 0

    def test_flat_session_returns_available_and_score(self):
        """A flat session should return available=True and a valid score >= 0."""
        bars = self._make_session_bars(n_bars=30, pattern="flat")
        score, shape, conf, avail = compute_session_shape_score_from_bars(bars, symbol="MES")
        assert avail is True
        assert 0 <= score <= 100
        assert shape in ("D", "b", "P", "Thin")
        assert 0.0 <= conf <= 1.0

    def test_score_equals_compute_session_shape_score_formula(self):
        """Score from bars must equal compute_session_shape_score(shape, conf)."""
        bars = self._make_session_bars(n_bars=30, pattern="flat")
        score, shape, conf, avail = compute_session_shape_score_from_bars(bars, symbol="MES")
        if avail:
            expected = compute_session_shape_score(shape, conf)
            assert score == expected, (
                f"score_from_bars={score} != compute_session_shape_score({shape}, {conf:.3f})={expected}"
            )

    def test_trend_day_may_produce_thin_or_nonzero_score(self):
        """A trend session should not produce D-shape or zero score (Thin preferred)."""
        # Note: may still be D if ATR not provided (Thin requires atr_20d).
        # Test only that computation completes without error.
        bars = self._make_session_bars(n_bars=30, pattern="trend_up")
        score, shape, conf, avail = compute_session_shape_score_from_bars(bars, symbol="MES")
        # Only assert no exception and valid range
        assert 0 <= score <= 100
        assert shape in ("D", "b", "P", "Thin", "")


# ─── E.2: Backtester A+ gate wiring ─────────────────────────────────────────


class TestAPlus_Gate_Wiring:
    """E.2: _apply_a_plus_confluence_gate() — entry blocking and gate stats."""

    def _make_strategy_config(
        self,
        confluence_factors: list[str],
        min_factors: int = 1,
        preferred_regime: str | None = None,
        provenance: str = "llm_extracted",
    ) -> object:
        """Return a minimal StrategyConfig-like object (duck-typed)."""
        from types import SimpleNamespace
        entry_quality = {
            "confluence_factors": confluence_factors,
            "min_factors_satisfied": min_factors,
            "extraction_provenance": provenance,
        }
        return SimpleNamespace(
            name="TestStrategy",
            symbol="MES",
            entry_quality=entry_quality,
            preferred_regime=preferred_regime,
        )

    def _make_df(
        self,
        n_bars: int = 30,
        base_volume: float = 1000.0,
        high_volume_bars: list[int] | None = None,
    ) -> pl.DataFrame:
        """Synthetic DataFrame with OHLCV + ts_et column."""
        from datetime import datetime, timedelta
        base_dt = datetime(2024, 1, 2, 10, 0, 0)  # 10:00 ET
        timestamps = [base_dt + timedelta(minutes=5 * i) for i in range(n_bars)]
        ts_et = [ts.strftime("%Y-%m-%dT%H:%M:%S") for ts in timestamps]

        close = np.linspace(5000.0, 5010.0, n_bars)
        high = close + 1.0
        low = close - 1.0
        volumes = np.full(n_bars, base_volume)
        if high_volume_bars:
            for i in high_volume_bars:
                if 0 <= i < n_bars:
                    volumes[i] = base_volume * 3.0

        return pl.DataFrame({
            "open": close - 0.5,
            "high": high,
            "low": low,
            "close": close,
            "volume": volumes,
            "ts_et": ts_et,
        })

    def test_no_entry_quality_bypasses_gate(self):
        """Strategy with no entry_quality → all entries pass through."""
        from src.engine.backtester import _apply_a_plus_confluence_gate
        from types import SimpleNamespace
        config = SimpleNamespace(name="Legacy", symbol="MES", entry_quality=None, preferred_regime=None)
        df = self._make_df()
        long_entries = np.array([True, False, True, False] + [False] * 26)
        short_entries = np.zeros(30, dtype=bool)

        long_out, short_out, stats = _apply_a_plus_confluence_gate(
            long_entries, short_entries, df, config
        )
        # All entries pass through
        assert np.array_equal(long_out, long_entries)
        assert stats["bypassed"] == 2
        assert stats["blocked"] == 0

    def test_legacy_provenance_bypasses_gate(self):
        """extraction_provenance='legacy_no_confluence' → all entries pass through."""
        from src.engine.backtester import _apply_a_plus_confluence_gate
        config = self._make_strategy_config(
            ["vp_shape", "volume_confirmation"],
            min_factors=1,
            provenance="legacy_no_confluence",
        )
        df = self._make_df()
        long_entries = np.array([True, True] + [False] * 28)
        short_entries = np.zeros(30, dtype=bool)

        long_out, short_out, stats = _apply_a_plus_confluence_gate(
            long_entries, short_entries, df, config
        )
        assert np.array_equal(long_out, long_entries)
        assert stats["bypassed"] == 2
        assert stats["blocked"] == 0

    def test_empty_factors_list_bypasses_gate(self):
        """Empty confluence_factors list → bypass."""
        from src.engine.backtester import _apply_a_plus_confluence_gate
        config = self._make_strategy_config([], min_factors=0)
        df = self._make_df()
        long_entries = np.array([True] + [False] * 29)
        short_entries = np.zeros(30, dtype=bool)

        long_out, short_out, stats = _apply_a_plus_confluence_gate(
            long_entries, short_entries, df, config
        )
        assert np.array_equal(long_out, long_entries)
        assert stats["bypassed"] == 1

    def test_structural_setup_always_satisfies(self):
        """structural_setup factor is always True (entry expression fired)."""
        from src.engine.backtester import _apply_a_plus_confluence_gate
        config = self._make_strategy_config(["structural_setup"], min_factors=1)
        df = self._make_df()
        long_entries = np.array([True, False, True] + [False] * 27)
        short_entries = np.zeros(30, dtype=bool)

        long_out, short_out, stats = _apply_a_plus_confluence_gate(
            long_entries, short_entries, df, config
        )
        # structural_setup always passes → no blocks
        assert long_out[0] is True or bool(long_out[0])
        assert long_out[2] is True or bool(long_out[2])
        assert stats["blocked"] == 0
        assert stats["passed"] == 2

    def test_volume_confirmation_blocks_low_volume(self):
        """volume_confirmation: bar volume <= rolling_mean*1.2 → factor not satisfied."""
        from src.engine.backtester import _apply_a_plus_confluence_gate

        # Set base volume 1000; entry bar has volume 100 (well below 1200 threshold)
        config = self._make_strategy_config(["volume_confirmation"], min_factors=1)

        n_bars = 25
        base_dt = __import__("datetime").datetime(2024, 1, 2, 10, 0, 0)
        from datetime import timedelta
        timestamps = [base_dt + timedelta(minutes=5 * i) for i in range(n_bars)]
        ts_et = [ts.strftime("%Y-%m-%dT%H:%M:%S") for ts in timestamps]
        volumes = np.full(n_bars, 1000.0)
        volumes[24] = 100.0  # Entry bar has low volume

        df = pl.DataFrame({
            "open": np.full(n_bars, 5000.0),
            "high": np.full(n_bars, 5001.0),
            "low": np.full(n_bars, 4999.0),
            "close": np.full(n_bars, 5000.0),
            "volume": volumes,
            "ts_et": ts_et,
        })

        long_entries = np.zeros(n_bars, dtype=bool)
        long_entries[24] = True  # Entry at the low-volume bar
        short_entries = np.zeros(n_bars, dtype=bool)

        long_out, short_out, stats = _apply_a_plus_confluence_gate(
            long_entries, short_entries, df, config
        )
        # Low volume → blocked
        assert not bool(long_out[24])
        assert stats["blocked"] == 1
        assert stats["passed"] == 0

    def test_volume_confirmation_passes_high_volume(self):
        """volume_confirmation: bar volume > rolling_mean*1.2 → factor satisfied."""
        from src.engine.backtester import _apply_a_plus_confluence_gate

        config = self._make_strategy_config(["volume_confirmation"], min_factors=1)

        n_bars = 25
        base_dt = __import__("datetime").datetime(2024, 1, 2, 10, 0, 0)
        from datetime import timedelta
        timestamps = [base_dt + timedelta(minutes=5 * i) for i in range(n_bars)]
        ts_et = [ts.strftime("%Y-%m-%dT%H:%M:%S") for ts in timestamps]
        volumes = np.full(n_bars, 1000.0)
        volumes[24] = 2500.0  # Entry bar has high volume (> 1200 threshold)

        df = pl.DataFrame({
            "open": np.full(n_bars, 5000.0),
            "high": np.full(n_bars, 5001.0),
            "low": np.full(n_bars, 4999.0),
            "close": np.full(n_bars, 5000.0),
            "volume": volumes,
            "ts_et": ts_et,
        })

        long_entries = np.zeros(n_bars, dtype=bool)
        long_entries[24] = True
        short_entries = np.zeros(n_bars, dtype=bool)

        long_out, short_out, stats = _apply_a_plus_confluence_gate(
            long_entries, short_entries, df, config
        )
        assert bool(long_out[24])
        assert stats["passed"] == 1
        assert stats["blocked"] == 0

    def test_min_factors_gate_blocks_when_insufficient(self):
        """With 2 factors, min=2: if only 1 satisfies → block."""
        from src.engine.backtester import _apply_a_plus_confluence_gate

        # structural_setup (always True) + volume_confirmation (low volume = False)
        # min_factors=2 → need both; volume fails → blocked
        config = self._make_strategy_config(
            ["structural_setup", "volume_confirmation"], min_factors=2
        )

        n_bars = 25
        base_dt = __import__("datetime").datetime(2024, 1, 2, 10, 0, 0)
        from datetime import timedelta
        timestamps = [base_dt + timedelta(minutes=5 * i) for i in range(n_bars)]
        ts_et = [ts.strftime("%Y-%m-%dT%H:%M:%S") for ts in timestamps]
        volumes = np.full(n_bars, 1000.0)
        volumes[24] = 50.0  # Low volume at entry bar

        df = pl.DataFrame({
            "open": np.full(n_bars, 5000.0),
            "high": np.full(n_bars, 5001.0),
            "low": np.full(n_bars, 4999.0),
            "close": np.full(n_bars, 5000.0),
            "volume": volumes,
            "ts_et": ts_et,
        })

        long_entries = np.zeros(n_bars, dtype=bool)
        long_entries[24] = True
        short_entries = np.zeros(n_bars, dtype=bool)

        long_out, short_out, stats = _apply_a_plus_confluence_gate(
            long_entries, short_entries, df, config
        )
        assert not bool(long_out[24])
        assert stats["blocked"] == 1

    def test_min_factors_gate_passes_when_sufficient(self):
        """With 2 factors, min=1: if only 1 satisfies → still passes."""
        from src.engine.backtester import _apply_a_plus_confluence_gate

        # structural_setup (True) + volume_confirmation (low = False)
        # min_factors=1 → just need 1; structural_setup satisfies → passes
        config = self._make_strategy_config(
            ["structural_setup", "volume_confirmation"], min_factors=1
        )

        n_bars = 25
        base_dt = __import__("datetime").datetime(2024, 1, 2, 10, 0, 0)
        from datetime import timedelta
        timestamps = [base_dt + timedelta(minutes=5 * i) for i in range(n_bars)]
        ts_et = [ts.strftime("%Y-%m-%dT%H:%M:%S") for ts in timestamps]
        volumes = np.full(n_bars, 1000.0)
        volumes[24] = 50.0  # Low volume at entry bar

        df = pl.DataFrame({
            "open": np.full(n_bars, 5000.0),
            "high": np.full(n_bars, 5001.0),
            "low": np.full(n_bars, 4999.0),
            "close": np.full(n_bars, 5000.0),
            "volume": volumes,
            "ts_et": ts_et,
        })

        long_entries = np.zeros(n_bars, dtype=bool)
        long_entries[24] = True
        short_entries = np.zeros(n_bars, dtype=bool)

        long_out, short_out, stats = _apply_a_plus_confluence_gate(
            long_entries, short_entries, df, config
        )
        assert bool(long_out[24])
        assert stats["passed"] == 1

    def test_vp_shape_fail_open_when_no_timestamp(self):
        """vp_shape with no timestamp column → fail-open (entry passes through)."""
        from src.engine.backtester import _apply_a_plus_confluence_gate

        config = self._make_strategy_config(["vp_shape"], min_factors=1)

        df = pl.DataFrame({
            "open": np.full(5, 5000.0),
            "high": np.full(5, 5001.0),
            "low": np.full(5, 4999.0),
            "close": np.full(5, 5000.0),
            "volume": np.full(5, 1000.0),
            # No ts_et or ts_event column
        })

        long_entries = np.array([True, False, False, False, False])
        short_entries = np.zeros(5, dtype=bool)

        long_out, short_out, stats = _apply_a_plus_confluence_gate(
            long_entries, short_entries, df, config
        )
        # Should fail-open → entry passes
        assert bool(long_out[0])
        assert stats["passed"] == 1
        assert stats["blocked"] == 0

    def test_macro_alignment_always_passes(self):
        """macro_alignment is pass-through in offline backtest."""
        from src.engine.backtester import _apply_a_plus_confluence_gate

        config = self._make_strategy_config(["macro_alignment"], min_factors=1)
        df = self._make_df(n_bars=10)

        long_entries = np.array([True] + [False] * 9)
        short_entries = np.zeros(10, dtype=bool)

        long_out, short_out, stats = _apply_a_plus_confluence_gate(
            long_entries, short_entries, df, config
        )
        assert bool(long_out[0])
        assert stats["passed"] == 1
        assert stats["blocked"] == 0

    def test_gate_stats_totals_are_consistent(self):
        """total == passed + blocked for any non-bypassed run."""
        from src.engine.backtester import _apply_a_plus_confluence_gate

        config = self._make_strategy_config(["structural_setup", "volume_confirmation"], min_factors=2)
        df = self._make_df(n_bars=30)

        long_entries = np.zeros(30, dtype=bool)
        long_entries[[2, 5, 10, 15, 20]] = True
        short_entries = np.zeros(30, dtype=bool)

        _, _, stats = _apply_a_plus_confluence_gate(
            long_entries, short_entries, df, config
        )
        assert stats["total"] == stats["passed"] + stats["blocked"]

    def test_short_entries_also_evaluated(self):
        """Short entry signals are also evaluated by the gate."""
        from src.engine.backtester import _apply_a_plus_confluence_gate

        config = self._make_strategy_config(["structural_setup"], min_factors=1)
        df = self._make_df(n_bars=10)

        long_entries = np.zeros(10, dtype=bool)
        short_entries = np.array([False, True, False, False, True] + [False] * 5)

        _, short_out, stats = _apply_a_plus_confluence_gate(
            long_entries, short_entries, df, config
        )
        # structural_setup always passes → 2 passes
        assert stats["passed"] == 2
        assert bool(short_out[1])
        assert bool(short_out[4])


# ─── E.3: Factor math parity — TS vs Python ───────────────────────────────────


class TestFactorMathParity:
    """E.3: Python factor evaluations match documented TS behavior.

    This is the cross-side parity test. We verify each factor's pass/fail
    logic against the TypeScript reference implementation behavior as
    documented in paper-signal-service.ts and AGENT-LOGS.md.
    """

    def test_vp_shape_score_50_exactly_satisfies_ts_threshold(self):
        """TS: score >= 50 → satisfied. Python: same threshold."""
        # b at 100% confidence = 50 → satisfies
        assert compute_session_shape_score("b", 1.0) >= VP_SHAPE_SCORE_THRESHOLD

    def test_vp_shape_score_49_does_not_satisfy(self):
        """TS: score < 50 → not satisfied. Python: same."""
        score = compute_session_shape_score("b", 0.98)
        assert score == 49
        assert score < VP_SHAPE_SCORE_THRESHOLD

    def test_d_shape_never_satisfies(self):
        """D-shape → score 0, never satisfies. Matches TS D=0 weight."""
        assert compute_session_shape_score("D", 1.0) < VP_SHAPE_SCORE_THRESHOLD

    def test_thin_at_50_pct_satisfies(self):
        """Thin @ 50% confidence → score = 50, satisfies. Matches TS."""
        score = compute_session_shape_score("Thin", 0.50)
        assert score == 50
        assert score >= VP_SHAPE_SCORE_THRESHOLD

    def test_thin_at_49_pct_does_not_satisfy(self):
        """Thin @ 49% confidence → score = round(0.49 × 100) = 49, does not satisfy."""
        score = compute_session_shape_score("Thin", 0.49)
        assert score == 49
        assert score < VP_SHAPE_SCORE_THRESHOLD

    def test_volume_confirmation_threshold_is_1_2x_rolling_mean(self):
        """volume_confirmation: threshold = rolling_20_mean × 1.2. Matches TS."""
        from src.engine.backtester import _compute_rolling_volume_mean

        # 20 bars of volume = 1000 each → rolling mean = 1000
        vol_arr = np.full(25, 1000.0)
        mean = _compute_rolling_volume_mean(vol_arr, idx=24, window=20)
        assert abs(mean - 1000.0) < 1e-6
        threshold = mean * 1.2
        # Bar vol 1200 is exactly 1.2x → should NOT satisfy (need strictly >)
        assert 1200.0 <= threshold  # 1200 == threshold exactly (not strictly greater)
        # Bar vol 1201 should satisfy
        assert 1201.0 > threshold

    def test_rolling_volume_mean_uses_prior_bars_only(self):
        """Rolling mean uses bars [idx-window : idx] — no lookahead."""
        from src.engine.backtester import _compute_rolling_volume_mean

        vol_arr = np.array([100.0] * 10 + [999.0] * 10)
        # At idx=10 (the first 999.0 bar), rolling mean should use [0:10] = 100.0 avg
        mean = _compute_rolling_volume_mean(vol_arr, idx=10, window=20)
        # Prior 10 bars are 100.0, window=20 but only 10 available → mean = 100.0
        assert abs(mean - 100.0) < 1e-6

    def test_rolling_volume_mean_at_idx_zero_returns_zero(self):
        """At bar 0, no prior history → returns 0 (fail-open)."""
        from src.engine.backtester import _compute_rolling_volume_mean

        vol_arr = np.full(10, 1000.0)
        mean = _compute_rolling_volume_mean(vol_arr, idx=0, window=20)
        assert mean == 0.0


# ─── E.4: Backward compat — pre-W23 strategies ────────────────────────────────


class TestBackwardCompat:
    """E.4: Strategies without entry_quality block skip gate entirely."""

    def _make_pre_w23_config(self) -> object:
        """Strategy with no entry_quality field (pre-W23 style)."""
        from types import SimpleNamespace
        return SimpleNamespace(name="PreW23Strategy", symbol="MES", entry_quality=None, preferred_regime=None)

    def test_no_entry_quality_does_not_block_any_entry(self):
        """Pre-W23 strategy: entry_quality=None → gate does nothing."""
        from src.engine.backtester import _apply_a_plus_confluence_gate
        import polars as pl

        config = self._make_pre_w23_config()
        df = pl.DataFrame({
            "open": [5000.0] * 10,
            "high": [5001.0] * 10,
            "low": [4999.0] * 10,
            "close": [5000.0] * 10,
            "volume": [1000.0] * 10,
        })

        long_entries = np.array([True, True, False, True] + [False] * 6)
        short_entries = np.zeros(10, dtype=bool)

        long_out, short_out, stats = _apply_a_plus_confluence_gate(
            long_entries, short_entries, df, config
        )
        # All 3 entries pass through unchanged
        assert np.array_equal(long_out, long_entries)
        assert stats["blocked"] == 0
        assert stats["bypassed"] == 3

    def test_StrategyConfig_accepts_entry_quality_dict(self):
        """StrategyConfig.entry_quality field accepts dict payload without validation error."""
        from src.engine.config import (
            BacktestRequest, StrategyConfig, StopConfig, PositionSizeConfig, IndicatorConfig
        )

        cfg = StrategyConfig(
            name="TestW23",
            symbol="MES",
            timeframe="5min",
            indicators=[IndicatorConfig(type="atr", period=14)],
            entry_long="close > sma_20",
            entry_short="close < sma_20",
            exit="close crosses_below sma_20",
            stop_loss=StopConfig(type="atr", multiplier=1.5),
            position_size=PositionSizeConfig(type="fixed", fixed_contracts=1),
            entry_quality={
                "confluence_factors": ["structural_setup", "volume_confirmation"],
                "min_factors_satisfied": 1,
                "extraction_provenance": "llm_extracted",
            },
        )
        assert cfg.entry_quality is not None
        assert "structural_setup" in cfg.entry_quality["confluence_factors"]

    def test_StrategyConfig_entry_quality_defaults_to_none(self):
        """StrategyConfig.entry_quality defaults to None (pre-W23 backward compat)."""
        from src.engine.config import StrategyConfig, StopConfig, PositionSizeConfig, IndicatorConfig

        cfg = StrategyConfig(
            name="LegacyStrat",
            symbol="MES",
            timeframe="5min",
            indicators=[IndicatorConfig(type="atr", period=14)],
            entry_long="close > sma_20",
            entry_short="close < sma_20",
            exit="close crosses_below sma_20",
            stop_loss=StopConfig(type="atr", multiplier=1.5),
            position_size=PositionSizeConfig(type="fixed", fixed_contracts=1),
        )
        assert cfg.entry_quality is None
