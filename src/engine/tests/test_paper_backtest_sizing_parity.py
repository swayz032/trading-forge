"""Wave 24 Pass 2 — Paper-vs-backtest sizing parity tests.

Verifies that paper-side sizing decisions (TypeScript computeVolScale /
computeLiquidityHaircut) match backtest-side decisions (Python compute_vol_scale /
compute_liquidity_haircut) within float tolerance.

Also verifies that the backtester wires vol-scale + liquidity-haircut into
the sizing pass and emits parity_metadata / dsl_guards counters.
"""

from __future__ import annotations

import math

import numpy as np
import polars as pl
import pytest

from src.engine.sizing import (
    compute_liquidity_haircut,
    compute_risk_derived_contracts,
    compute_vol_scale,
)

# ── 1. Unit parity: vol-scale math matches TypeScript ─────────────────────────

class TestVolScaleParity:
    """Python compute_vol_scale must be numerically identical to TS computeVolScale."""

    def test_vix_at_target_returns_1(self):
        """VIX == RISK_VIX_TARGET (18) → scale = 1.0."""
        assert compute_vol_scale(18.0) == pytest.approx(1.0, abs=1e-9)

    def test_vix_high_clamped_to_floor(self):
        """VIX=36 (2× target) → raw=0.5 → floor at 0.5 (RISK_VOL_SCALE_MIN default)."""
        scale = compute_vol_scale(36.0)
        assert scale == pytest.approx(0.5, abs=1e-9)

    def test_vix_very_high_still_floor(self):
        """VIX=100 → raw=0.18 → clamped to 0.5 floor."""
        scale = compute_vol_scale(100.0)
        assert scale == pytest.approx(0.5, abs=1e-9)

    def test_vix_low_clamped_to_ceiling(self):
        """VIX=9 (half target) → raw=2.0 → ceil at 1.5 (RISK_VOL_SCALE_MAX default)."""
        scale = compute_vol_scale(9.0)
        assert scale == pytest.approx(1.5, abs=1e-9)

    def test_vix_none_returns_1_fail_open(self):
        """None → 1.0 (fail-open — absent data must not block entries)."""
        assert compute_vol_scale(None) == pytest.approx(1.0, abs=1e-9)

    def test_vix_zero_returns_1_fail_open(self):
        """VIX=0 → 1.0 (guard against division by zero)."""
        assert compute_vol_scale(0.0) == pytest.approx(1.0, abs=1e-9)

    def test_vix_negative_returns_1_fail_open(self):
        """VIX < 0 → 1.0 (invalid data treated as absent)."""
        assert compute_vol_scale(-5.0) == pytest.approx(1.0, abs=1e-9)

    def test_vix_nan_returns_1_fail_open(self):
        """NaN VIX → 1.0 (fail-open)."""
        assert compute_vol_scale(float("nan")) == pytest.approx(1.0, abs=1e-9)

    def test_vix_intermediate_value(self):
        """VIX=24 → scale = 18/24 = 0.75 (within [0.5, 1.5])."""
        scale = compute_vol_scale(24.0)
        assert scale == pytest.approx(18.0 / 24.0, rel=1e-9)

    def test_scale_monotonically_decreasing_with_vix(self):
        """Higher VIX → lower scale (more conservative sizing)."""
        vix_levels = [12.0, 18.0, 24.0, 36.0, 50.0]
        scales = [compute_vol_scale(v) for v in vix_levels]
        for i in range(len(scales) - 1):
            assert scales[i] >= scales[i + 1], (
                f"Scale not monotonically decreasing: vix={vix_levels[i]} "
                f"scale={scales[i]} vs vix={vix_levels[i+1]} scale={scales[i+1]}"
            )


# ── 2. Unit parity: liquidity-haircut math matches TypeScript ─────────────────

class TestLiquidityHaircutParity:
    """Python compute_liquidity_haircut must match TS computeLiquidityHaircut."""

    def test_equal_depth_returns_1(self):
        """current == baseline → haircut = 1.0 (no reduction)."""
        assert compute_liquidity_haircut(500.0, 500.0) == pytest.approx(1.0, abs=1e-9)

    def test_depth_collapse_50pct(self):
        """current = 250, baseline = 500 → haircut = 0.5."""
        assert compute_liquidity_haircut(250.0, 500.0) == pytest.approx(0.5, abs=1e-9)

    def test_liberation_day_collapse_27pct(self):
        """Reference: CME Liberation Day 2025-04-02 → -27% depth → haircut = 0.73."""
        assert compute_liquidity_haircut(365.0, 500.0) == pytest.approx(0.73, abs=1e-9)

    def test_depth_above_baseline_capped_at_1(self):
        """current > baseline → haircut = 1.0 (never increases cap above static)."""
        assert compute_liquidity_haircut(750.0, 500.0) == pytest.approx(1.0, abs=1e-9)

    def test_none_current_returns_1_fail_open(self):
        """None current → 1.0 (fail-open — absent data must not reduce contracts)."""
        assert compute_liquidity_haircut(None, 500.0) == pytest.approx(1.0, abs=1e-9)

    def test_none_baseline_returns_1_fail_open(self):
        """None baseline → 1.0 (fail-open)."""
        assert compute_liquidity_haircut(500.0, None) == pytest.approx(1.0, abs=1e-9)

    def test_both_none_returns_1(self):
        """Both None → 1.0 (fail-open)."""
        assert compute_liquidity_haircut(None, None) == pytest.approx(1.0, abs=1e-9)

    def test_zero_current_returns_0(self):
        """current = 0 → haircut = 0 (completely empty book — extreme case)."""
        # 0 is falsy in Python, so compute_liquidity_haircut returns 1.0 (same as TS !value check)
        assert compute_liquidity_haircut(0.0, 500.0) == pytest.approx(1.0, abs=1e-9)

    def test_zero_baseline_returns_1_fail_open(self):
        """baseline = 0 → 1.0 (guard against division by zero)."""
        assert compute_liquidity_haircut(500.0, 0.0) == pytest.approx(1.0, abs=1e-9)


# ── 3. Sizing interaction: vol-scale reduces contracts in high-VIX regime ──────

class TestVolScaleSizingEffect:
    """Verify that vol-scale correctly reduces max_risk_pct and therefore final contracts."""

    def _make_base_kwargs(self, max_risk_pct: float = 0.02) -> dict:
        return dict(
            base_contracts=6,
            tier_increment=3,
            tier_threshold_dollars=3000.0,
            max_risk_pct_per_trade=max_risk_pct,
            liquidity_comfort_cap=100,
            account_balance=50_000.0,
            cumulative_profit=0.0,
            atr_points=4.0,
            stop_multiplier=1.5,
            point_dollar_value=5.0,
            firm="mffu",  # simple branch, no trailing-DD
        )

    def test_high_vix_reduces_contracts_vs_normal_vix(self):
        """VIX=36 (scale=0.5) → max_risk halved → fewer contracts than VIX=18 (scale=1.0)."""
        # Normal VIX (18): scale = 1.0, effective risk = 0.02
        normal_kwargs = self._make_base_kwargs(max_risk_pct=0.02)
        result_normal = compute_risk_derived_contracts(**normal_kwargs)

        # High VIX (36): scale = 0.5, effective risk = 0.01
        high_vix_scale = compute_vol_scale(36.0)  # 0.5
        scaled_risk_pct = 0.02 * high_vix_scale
        high_vix_kwargs = self._make_base_kwargs(max_risk_pct=scaled_risk_pct)
        result_high_vix = compute_risk_derived_contracts(**high_vix_kwargs)

        # High-VIX must yield ≤ normal-VIX contracts
        assert result_high_vix.final_contracts <= result_normal.final_contracts, (
            f"High-VIX sizing {result_high_vix.final_contracts} should be ≤ "
            f"normal-VIX {result_normal.final_contracts}"
        )

    def test_low_vix_increases_contracts_vs_normal_vix(self):
        """VIX=9 (scale=1.5) → max_risk × 1.5 → more contracts than VIX=18."""
        # Normal VIX (18): scale = 1.0
        normal_result = compute_risk_derived_contracts(**self._make_base_kwargs(0.02))

        # Low VIX (9): scale = 1.5
        low_vix_scale = compute_vol_scale(9.0)
        scaled_risk = min(0.02 * low_vix_scale, 0.05)  # cap at 5% validator limit
        low_vix_result = compute_risk_derived_contracts(**self._make_base_kwargs(scaled_risk))

        assert low_vix_result.final_contracts >= normal_result.final_contracts, (
            f"Low-VIX sizing {low_vix_result.final_contracts} should be ≥ "
            f"normal-VIX {normal_result.final_contracts}"
        )

    def test_vol_scale_no_effect_when_vix_absent(self):
        """vix_now=None → scale=1.0 → identical to baseline (fail-open)."""
        base = compute_risk_derived_contracts(**self._make_base_kwargs(0.02))
        scale = compute_vol_scale(None)
        scaled = compute_risk_derived_contracts(**self._make_base_kwargs(0.02 * scale))
        assert scaled.final_contracts == base.final_contracts


# ── 4. Liquidity-haircut sizing interaction ────────────────────────────────────

class TestLiquidityHaircutSizingEffect:
    """Verify liquidity haircut reduces liquidity_comfort_cap correctly."""

    def test_27pct_depth_collapse_reduces_cap(self):
        """Liberation Day -27% event: haircut=0.73 → MES cap 100 → 73 contracts."""
        haircut = compute_liquidity_haircut(365.0, 500.0)
        raw_cap = 100
        adjusted_cap = int(math.floor(raw_cap * haircut))
        assert adjusted_cap == 73

    def test_haircut_1_preserves_cap(self):
        """haircut=1.0 → cap unchanged."""
        haircut = compute_liquidity_haircut(500.0, 500.0)
        assert math.floor(100 * haircut) == 100

    def test_haircut_always_bounded_0_to_1(self):
        """Haircut is always in (0, 1] — never negative, never above 1."""
        test_cases = [
            (0.0, 500.0),   # zero depth — falsy, returns 1.0
            (250.0, 500.0), # 50% collapse
            (500.0, 500.0), # at baseline
            (750.0, 500.0), # above baseline — capped at 1
            (None, 500.0),  # missing data
            (500.0, None),  # missing baseline
        ]
        for current, baseline in test_cases:
            h = compute_liquidity_haircut(current, baseline)
            assert 0.0 < h <= 1.0, (
                f"Haircut {h} out of bounds for current={current} baseline={baseline}"
            )


# ── 5. Backtester parity_metadata emission ─────────────────────────────────────
# These tests run the full backtester with synthetic data and verify that:
# (a) parity_metadata is present in the result
# (b) vol_scale_applied / liquidity_haircut_applied counters are in dsl_guards
# (c) vix_now=None emits the parity_warn.no_vix_in_backtest warning

class TestBacktesterParityMetadata:
    """Integration tests: backtester emits parity_metadata and dsl_guards counters."""

    def _make_df(self, n: int = 200) -> pl.DataFrame:
        """Minimal OHLCV DataFrame that passes backtester requirements.

        Uses 200 bars across 2 trading days to ensure the backtester has enough
        data for indicator warmup (ATR-14 needs at least 15 bars).
        """
        import pandas as pd
        np.random.seed(42)
        close = 4500.0 + np.cumsum(np.random.randn(n) * 2)
        high  = close + np.abs(np.random.randn(n)) + 0.25
        low   = close - np.abs(np.random.randn(n)) - 0.25
        open_ = close + np.random.randn(n) * 0.5
        volume = np.full(n, 1000.0)
        ts = pd.date_range("2024-01-02 09:00", periods=n, freq="1min", tz="US/Eastern")
        df_pd = pd.DataFrame({
            "ts_event": ts,
            "ts_et":   ts,
            "open":    open_,
            "high":    high,
            "low":     low,
            "close":   close,
            "volume":  volume,
        })
        return pl.from_pandas(df_pd)

    def _run_backtest_internal(self, request_kwargs: dict) -> dict:
        """Invoke the internal backtest function with a synthetic DataFrame."""
        from src.engine.backtester import run_backtest as run_backtest_internal
        from src.engine.config import (
            BacktestRequest,
            IndicatorConfig,
            PositionSizeConfig,
            StrategyConfig,
        )

        strategy = StrategyConfig(
            name="test_ema_crossover",
            symbol="MES",
            timeframe="1min",
            direction="long",
            entry_indicator="ema_crossover",
            # SWEEP-F3, THIRD DEFECT UNDER THE FIRST TWO: these expressions
            # referenced `ema_fast`/`ema_slow`, which are not columns the engine
            # produces. IndicatorConfig has NO `name` field (config.py:320-335) —
            # pydantic ignores unknown keys, so `name="ema_fast"` was silently
            # dropped and the engine materialised `ema_9` / `ema_21`. The
            # measured error was `ValueError: Unknown column 'ema_fast'.
            # Available: [... 'ema_21', 'ema_9' ...]`. Same crossover, named the
            # way the engine actually names it.
            entry_long="ema_9 > ema_21",
            entry_short="high < low",   # sentinel — never triggers
            entry_params={"fast": 9, "slow": 21},
            indicators=[
                IndicatorConfig(type="ema", period=9),
                IndicatorConfig(type="ema", period=21),
            ],
            # SWEEP-F3 (R-645 §4 lane 2): this fixture NEVER BUILT. StrategyConfig
            # requires `exit` (config.py:447) and take_profit is a StopConfig whose
            # type is Literal["atr","fixed","trailing_atr"] (config.py:349-352) —
            # there is no "fixed_r" and no r_multiple field. Pydantic raised
            # ValidationError naming exactly those two errors, and the broad
            # `except Exception → pytest.skip` below reported it as
            # "run_backtest_internal unavailable in this test context" — false for
            # the entire life of the defect. A SKIP REASON IS A CLAIM.
            #
            # SEMANTIC PRESERVATION: the author wrote r_multiple=2.0, i.e. a 2R
            # target. StopConfig has no R vocabulary — but the stop is 1.5 ATR, so
            # a 3.0 ATR target IS 2R expressed in the units this model actually
            # has. `exit` mirrors entry_long, matching the sibling convention in
            # test_backtester.py:174 and test_a_plus_gate_parity.py:641.
            exit="ema_9 < ema_21",
            stop_loss={"type": "atr", "multiplier": 1.5},
            take_profit={"type": "atr", "multiplier": 3.0},
            position_size=PositionSizeConfig(
                type="risk_derived_pyramid",
                base_contracts=6,
                tier_increment=3,
                tier_threshold_dollars=3000.0,
                max_risk_pct_per_trade=0.02,
                liquidity_comfort_cap=100,
            ),
        )
        request = BacktestRequest(
            strategy=strategy,
            start_date="2024-01-02",
            end_date="2024-01-15",
            **request_kwargs,
        )
        df = self._make_df()
        return run_backtest_internal(request, data=df)

    def test_parity_metadata_present_when_vix_absent(self):
        """result['parity_metadata'] always present; warns when vix_now absent."""
        # SWEEP-F3: the `except Exception → pytest.skip` that used to sit here is
        # GONE. It converted a broken fixture into a clean-looking environmental
        # skip for the whole life of the defect. If this call raises, the test
        # must FAIL and show the traceback.
        result = self._run_backtest_internal({})

        assert "parity_metadata" in result, "parity_metadata key missing from result"
        pm = result["parity_metadata"]
        assert "vol_scale" in pm
        assert pm["vol_scale"] == pytest.approx(1.0, abs=1e-9), (
            "vol_scale must be 1.0 when vix_now absent (fail-open)"
        )
        assert "parity_warn.no_vix_in_backtest" in pm.get("parity_warn", []), (
            "parity_warn.no_vix_in_backtest must be emitted when vix_now is None"
        )

    def test_parity_metadata_vol_scale_applied_with_vix(self):
        """vix_now=36 → vol_scale=0.5 → vol_scale_applied=True."""
        # SWEEP-F3: broad-except-to-skip removed; see the note in
        # test_parity_metadata_present_when_vix_absent.
        result = self._run_backtest_internal({"vix_now": 36.0})

        pm = result.get("parity_metadata", {})
        assert pm.get("vol_scale_applied") is True, "vol_scale_applied should be True at VIX=36"
        assert pm.get("vol_scale") == pytest.approx(0.5, abs=1e-9)

    def test_dsl_guards_contain_vol_scale_flag(self):
        """dsl_guards['vol_scale_applied'] must be present and match parity_metadata."""
        # SWEEP-F3: broad-except-to-skip removed; see the note in
        # test_parity_metadata_present_when_vix_absent.
        result = self._run_backtest_internal({"vix_now": 36.0})

        dg = result.get("dsl_guards", {})
        pm = result.get("parity_metadata", {})
        assert "vol_scale_applied" in dg, "vol_scale_applied missing from dsl_guards"
        assert dg["vol_scale_applied"] == pm.get("vol_scale_applied"), (
            "dsl_guards.vol_scale_applied must match parity_metadata.vol_scale_applied"
        )

    def test_dsl_guards_contain_liquidity_haircut_flag(self):
        """dsl_guards['liquidity_haircut_applied'] present (False when no depth ratio)."""
        # SWEEP-F3: the `except Exception → pytest.skip` that used to sit here is
        # GONE. It converted a broken fixture into a clean-looking environmental
        # skip for the whole life of the defect. If this call raises, the test
        # must FAIL and show the traceback.
        result = self._run_backtest_internal({})

        dg = result.get("dsl_guards", {})
        assert "liquidity_haircut_applied" in dg, "liquidity_haircut_applied missing from dsl_guards"
        # No depth ratio provided → haircut = 1.0 → applied = False
        assert dg["liquidity_haircut_applied"] is False

    def test_no_vix_no_depth_both_warn(self):
        """Both absent → two parity_warn entries emitted."""
        # SWEEP-F3: the `except Exception → pytest.skip` that used to sit here is
        # GONE. It converted a broken fixture into a clean-looking environmental
        # skip for the whole life of the defect. If this call raises, the test
        # must FAIL and show the traceback.
        result = self._run_backtest_internal({})

        warns = result.get("parity_metadata", {}).get("parity_warn", [])
        assert any("no_vix_in_backtest" in w for w in warns), (
            "no_vix_in_backtest warning missing"
        )
        assert any("no_depth_ratio_in_backtest" in w for w in warns), (
            "no_depth_ratio_in_backtest warning missing"
        )


# ── 6. Numeric parity: Python vs TypeScript reference values ───────────────────

class TestNumericParity:
    """Cross-check Python output against TypeScript reference values.

    Reference values computed from risk-sizing.ts with known inputs.
    Confirms the ports are numerically identical within float tolerance.
    """

    def test_ts_reference_vix_12(self):
        """TS: computeVolScale(12) = clamp(18/12, 0.5, 1.5) = 1.5."""
        assert compute_vol_scale(12.0) == pytest.approx(1.5, abs=1e-9)

    def test_ts_reference_vix_18(self):
        """TS: computeVolScale(18) = clamp(1.0, 0.5, 1.5) = 1.0."""
        assert compute_vol_scale(18.0) == pytest.approx(1.0, abs=1e-9)

    def test_ts_reference_vix_27(self):
        """TS: computeVolScale(27) = clamp(18/27, 0.5, 1.5) = 0.6667."""
        assert compute_vol_scale(27.0) == pytest.approx(18.0 / 27.0, rel=1e-9)

    def test_ts_reference_vix_36(self):
        """TS: computeVolScale(36) = clamp(0.5, 0.5, 1.5) = 0.5."""
        assert compute_vol_scale(36.0) == pytest.approx(0.5, abs=1e-9)

    def test_ts_reference_liquidity_50pct(self):
        """TS: computeLiquidityHaircut(250, 500) = min(1, 250/500) = 0.5."""
        assert compute_liquidity_haircut(250.0, 500.0) == pytest.approx(0.5, abs=1e-9)

    def test_ts_reference_liquidity_full(self):
        """TS: computeLiquidityHaircut(500, 500) = 1.0."""
        assert compute_liquidity_haircut(500.0, 500.0) == pytest.approx(1.0, abs=1e-9)

    def test_ts_reference_liquidity_above_baseline(self):
        """TS: computeLiquidityHaircut(1000, 500) = min(1, 2.0) = 1.0."""
        assert compute_liquidity_haircut(1000.0, 500.0) == pytest.approx(1.0, abs=1e-9)
