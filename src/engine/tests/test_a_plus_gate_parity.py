"""Wave 23 Gap-Fix-A: A+ confluence gate parity tests.

Verifies that the Python backtester's A+ / confluence surface behaves per the
CURRENT documented architecture.

STALE-TEST REALIGNMENT (2026-07-17, test-debt close-out):
  The E.2/E.3/E.4 blocks below were originally written against a Python-side
  per-factor confluence API — `_apply_a_plus_confluence_gate()`,
  `_compute_rolling_volume_mean()` on `src.engine.backtester`, and an
  `entry_quality` FIELD on `StrategyConfig` — that was NEVER built in the Python
  engine (0 hits across the entire git history). The architecture deliberately
  placed per-bar per-factor confluence scoring on the TypeScript side
  (`confluence-score.ts` / paper-signal-service.ts); see CLAUDE.md §2b and
  `src/engine/spec_family_bindings.py:36` ("no standalone per-bar confluence
  primitive exists outside the TS/live-paper confluence-score.ts pipeline").
  The Python engine's A+ gate is the 7-layer `apply_eligibility_gate()`, and the
  only Python volume primitive is `bias_engine._compute_volume_ratio()`. The
  three classes were therefore importing phantom symbols and failing at import.
  They have been realigned to assert the CURRENT real functions with genuine
  regression value. `entry_quality` is a TS/JSONB-side concern read in Python
  only via `cfg_dict.get("entry_quality")` (see exportability.py) — it is NOT a
  modeled `StrategyConfig` field, and the realigned tests lock that contract in.

  KNOWN COVERAGE GAP (honest finding, not fixed here — it is a coverage gap, not
  a code bug): there is no Python-side unit test proving Python↔TS per-factor
  volume_confirmation math parity, because the Python engine has no standalone
  per-factor confluence primitive to compare against. Cross-side parity for the
  confluence factors is exercised on the TS side.

Coverage (current):
  E.1 — VP shape score formula matches TS getSessionShapeScore() (UNCHANGED — real)
  E.2 — apply_eligibility_gate() passthrough/mode contract (realigned)
  E.3 — bias_engine._compute_volume_ratio() behavior (realigned from phantom)
  E.4 — StrategyConfig does not model entry_quality (realigned from phantom)

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
    """E.2: apply_eligibility_gate() passthrough / mode-label contract.

    REALIGNED 2026-07-17: was written against the phantom
    `_apply_a_plus_confluence_gate()`. The real Python A+ gate is the 7-layer
    `apply_eligibility_gate()` in `src.engine.backtester`. These tests lock in
    its DOCUMENTED passthrough contract:
      - htf_cache None/empty  → mode="passthrough_htf_unavailable"        (FIX 2, deep-scan #10)
      - TF_CONFLUENCE_OVERLAY_DISABLED=true → mode="source_entry_only"    (ablation toggle, 2026-06-30)
      - strategy not in ALL_STRATS → mode="passthrough_strategy_unregistered"
                                                                          (HONESTY FIX, Band B / spec-onboarding-bridge, 2026-07-02)
      - gate_stats ALWAYS carries "structural_stop_map"                  (H5 fix, deep-scan #15)
    Each passthrough returns the signals UNCHANGED — a regression that silently
    started filtering in any of these modes (or dropped the mode label / the
    structural_stop_map key) would flip these assertions.
    """

    def _make_df(
        self,
        n_bars: int = 30,
        base_volume: float = 1000.0,
    ) -> pl.DataFrame:
        """Synthetic OHLCV DataFrame (no ts_et needed for passthrough paths)."""
        close = np.linspace(5000.0, 5010.0, n_bars)
        return pl.DataFrame({
            "open": close - 0.5,
            "high": close + 1.0,
            "low": close - 1.0,
            "close": close,
            "volume": np.full(n_bars, base_volume),
        })

    def test_htf_unavailable_passthrough_returns_signals_unchanged(self):
        """htf_cache=None → passthrough_htf_unavailable, signals untouched, no blocks."""
        from src.engine.backtester import apply_eligibility_gate
        df = self._make_df()
        long_entries = np.array([True, False, True, False] + [False] * 26)
        short_entries = np.zeros(30, dtype=bool)

        long_out, short_out, stats = apply_eligibility_gate(
            long_entries, short_entries, df, "long", "MES",
            htf_cache=None, strategy_name="whatever",
        )
        assert stats["mode"] == "passthrough_htf_unavailable"
        assert np.array_equal(long_out, long_entries)
        assert np.array_equal(short_out, short_entries)
        # No signals were skipped in a passthrough (the loop never runs).
        assert stats["skip"] == 0

    def test_overlay_disabled_env_yields_source_entry_only_mode(self):
        """TF_CONFLUENCE_OVERLAY_DISABLED=true → source_entry_only, signals untouched."""
        import os
        from src.engine.backtester import apply_eligibility_gate
        df = self._make_df()
        long_entries = np.array([True, True] + [False] * 28)
        short_entries = np.zeros(30, dtype=bool)

        prev = os.environ.get("TF_CONFLUENCE_OVERLAY_DISABLED")
        os.environ["TF_CONFLUENCE_OVERLAY_DISABLED"] = "true"
        try:
            long_out, short_out, stats = apply_eligibility_gate(
                long_entries, short_entries, df, "long", "MES",
                htf_cache=[1], strategy_name="anything",
            )
        finally:
            if prev is None:
                os.environ.pop("TF_CONFLUENCE_OVERLAY_DISABLED", None)
            else:
                os.environ["TF_CONFLUENCE_OVERLAY_DISABLED"] = prev

        assert stats["mode"] == "source_entry_only"
        assert np.array_equal(long_out, long_entries)

    def test_unregistered_strategy_passthrough_mode(self):
        """A strategy name absent from ALL_STRATS → passthrough_strategy_unregistered.

        Guards the HONESTY FIX (Band B, 2026-07-02): the mode label must be
        stamped 'passthrough_strategy_unregistered' — NOT 'tf_institutional_overlay'
        — when an unregistered strategy bypasses the overlay, so the bypass is
        queryable instead of masquerading as a real overlay run.
        """
        from src.engine.backtester import apply_eligibility_gate
        df = self._make_df()
        long_entries = np.array([True] + [False] * 29)
        short_entries = np.zeros(30, dtype=bool)

        long_out, short_out, stats = apply_eligibility_gate(
            long_entries, short_entries, df, "long", "MES",
            htf_cache=[1], strategy_name="zzz_definitely_not_a_registered_strategy",
        )
        assert stats["mode"] == "passthrough_strategy_unregistered"
        assert np.array_equal(long_out, long_entries)

    def test_gate_stats_always_carries_structural_stop_map(self):
        """H5 fix (deep-scan #15): gate_stats must always expose structural_stop_map."""
        from src.engine.backtester import apply_eligibility_gate
        df = self._make_df()
        long_entries = np.array([True] + [False] * 29)
        short_entries = np.zeros(30, dtype=bool)

        _, _, stats = apply_eligibility_gate(
            long_entries, short_entries, df, "long", "MES",
            htf_cache=None, strategy_name="whatever",
        )
        assert "structural_stop_map" in stats
        assert isinstance(stats["structural_stop_map"], dict)

    def test_short_signals_preserved_in_passthrough(self):
        """Short entry signals are passed through unchanged in passthrough mode."""
        from src.engine.backtester import apply_eligibility_gate
        df = self._make_df(n_bars=10)
        long_entries = np.zeros(10, dtype=bool)
        short_entries = np.array([False, True, False, False, True] + [False] * 5)

        long_out, short_out, stats = apply_eligibility_gate(
            long_entries, short_entries, df, "short", "MES",
            htf_cache=None, strategy_name="whatever",
        )
        assert stats["mode"] == "passthrough_htf_unavailable"
        assert np.array_equal(short_out, short_entries)


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

    # ── Volume primitive parity (REALIGNED 2026-07-17) ──────────────────────
    # These three were written against a phantom `_compute_rolling_volume_mean()`
    # on `src.engine.backtester` (a rolling-mean helper that was never built —
    # per-factor volume_confirmation math lives on the TS side, confluence-score.ts,
    # per CLAUDE.md §2b). The ONLY Python volume primitive is
    # `bias_engine._compute_volume_ratio()` (last-bar volume ÷ prior-lookback mean).
    # Realigned to lock that real primitive's documented behavior.

    def test_volume_ratio_is_last_over_prior_mean(self):
        """_compute_volume_ratio = last-bar volume ÷ mean(prior `lookback` bars)."""
        from src.engine.context.bias_engine import _compute_volume_ratio

        # 30 prior bars at 1000, last bar at 3000 → ratio = 3.0
        bars = pl.DataFrame({"volume": [1000.0] * 30 + [3000.0]})
        assert _compute_volume_ratio(bars, lookback=30) == 3.0

    def test_volume_ratio_none_when_insufficient_or_no_column(self):
        """Fail-soft: returns None when history < lookback+1 or no volume column."""
        from src.engine.context.bias_engine import _compute_volume_ratio

        # Only 5 bars, lookback=30 → insufficient
        assert _compute_volume_ratio(pl.DataFrame({"volume": [100.0] * 5}), lookback=30) is None
        # No volume column at all
        assert _compute_volume_ratio(pl.DataFrame({"x": [1.0] * 40}), lookback=30) is None
        # None input
        assert _compute_volume_ratio(None, lookback=30) is None

    def test_volume_ratio_zero_prior_avg_returns_one(self):
        """Prior mean == 0 → ratio defaults to 1.0 (no divide-by-zero, neutral)."""
        from src.engine.context.bias_engine import _compute_volume_ratio

        bars = pl.DataFrame({"volume": [0.0] * 30 + [500.0]})
        assert _compute_volume_ratio(bars, lookback=30) == 1.0


# ─── E.4: Backward compat — pre-W23 strategies ────────────────────────────────


class TestBackwardCompat:
    """E.4: Python StrategyConfig does NOT model entry_quality (TS/JSONB concern).

    REALIGNED 2026-07-17: the original tests asserted a `StrategyConfig.entry_quality`
    FIELD that was never added to the Python model. `entry_quality` (confluence
    factors / min_factors / provenance) is a TypeScript + strategies-config-JSONB
    concern; the Python engine reads it only opportunistically via
    `cfg_dict.get("entry_quality")` (see `src/engine/exportability.py`), never as a
    typed model field. These tests lock that architectural boundary so a future
    change that silently adds/renames the field is caught, and confirm the
    passthrough backward-compat of the real eligibility gate.
    """

    def test_no_entry_quality_does_not_block_any_entry(self):
        """Legacy path: apply_eligibility_gate passthrough leaves all entries intact."""
        from src.engine.backtester import apply_eligibility_gate

        df = pl.DataFrame({
            "open": [5000.0] * 10,
            "high": [5001.0] * 10,
            "low": [4999.0] * 10,
            "close": [5000.0] * 10,
            "volume": [1000.0] * 10,
        })

        long_entries = np.array([True, True, False, True] + [False] * 6)
        short_entries = np.zeros(10, dtype=bool)

        long_out, short_out, stats = apply_eligibility_gate(
            long_entries, short_entries, df, "long", "MES",
            htf_cache=None, strategy_name="pre_w23_legacy",
        )
        # All 3 entries pass through unchanged; nothing skipped in passthrough.
        assert np.array_equal(long_out, long_entries)
        assert stats["skip"] == 0
        assert stats["mode"] == "passthrough_htf_unavailable"

    def test_StrategyConfig_does_not_model_entry_quality(self):
        """entry_quality is NOT a StrategyConfig field — extra keys are ignored, not stored.

        Passing an entry_quality dict must not raise (pydantic default extra='ignore'),
        but it is silently dropped: the model exposes no `entry_quality` attribute and
        it is absent from model_fields. This is the current, documented contract —
        per-factor confluence lives TS-side (CLAUDE.md §2b).
        """
        import os
        from src.engine.config import (
            StrategyConfig, StopConfig, PositionSizeConfig, IndicatorConfig
        )

        prev = os.environ.get("TF_ALLOW_FIXED_1")
        os.environ["TF_ALLOW_FIXED_1"] = "true"  # unit-test sizing escape (config guard)
        try:
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
        finally:
            if prev is None:
                os.environ.pop("TF_ALLOW_FIXED_1", None)
            else:
                os.environ["TF_ALLOW_FIXED_1"] = prev

        # entry_quality is not a modeled field → not stored, no attribute.
        assert "entry_quality" not in StrategyConfig.model_fields
        assert not hasattr(cfg, "entry_quality")

    def test_StrategyConfig_valid_without_entry_quality(self):
        """A pre-W23 strategy config (no entry_quality) validates cleanly."""
        import os
        from src.engine.config import StrategyConfig, StopConfig, PositionSizeConfig, IndicatorConfig

        prev = os.environ.get("TF_ALLOW_FIXED_1")
        os.environ["TF_ALLOW_FIXED_1"] = "true"
        try:
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
        finally:
            if prev is None:
                os.environ.pop("TF_ALLOW_FIXED_1", None)
            else:
                os.environ["TF_ALLOW_FIXED_1"] = prev

        assert cfg.name == "LegacyStrat"
        assert not hasattr(cfg, "entry_quality")
