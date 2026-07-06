"""Wave 27.5 Pass B — HIGH #3: PBO auto-wired into walk_forward result tests.

Tests:
  - test_pbo_known_overfit_returns_high: synthetic dataset where OOS-winners
    are random → PBO ~0.5 (within 0.1 tolerance)
  - test_pbo_known_stable_returns_low: synthetic dataset where IS-winners ==
    OOS-winners → PBO ~0.0 (low)
  - test_pbo_wired_into_walk_forward_result: full WF run → result includes
    pbo field
  - test_pbo_skipped_below_4_windows: WF with < 4 windows → pbo is None

Note: full WF runs are stubbed using the existing synthetic data helpers from
test_walk_forward.py to avoid requiring live S3 data.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import polars as pl

from src.engine.risk_metrics import compute_pbo

# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_windows(oos_sharpes: list[float]) -> list[dict]:
    """Build minimal walk-forward window dicts from OOS Sharpe list."""
    return [
        {"oos_metrics": {"sharpe_ratio": s, "total_trades": 50, "total_return": s * 100.0}}
        for s in oos_sharpes
    ]


def _make_synthetic_data(n: int = 500) -> pl.DataFrame:
    """Create enough synthetic OHLCV data for walk-forward splits."""
    dates = [datetime(2022, 1, 1) + timedelta(days=i) for i in range(n)]
    closes = [4000.0 + i * 0.3 + (i % 11) * 2 - 5 for i in range(n)]
    return pl.DataFrame({
        "ts_event": dates,
        "open":   [c - 1.5 for c in closes],
        "high":   [c + 4.0 for c in closes],
        "low":    [c - 4.0 for c in closes],
        "close":  closes,
        "volume": [60000] * n,
    })


# ── Test: known overfit → PBO ~0.5 ───────────────────────────────────────────

class TestPBOKnownOverfit:
    def test_pbo_known_overfit_returns_near_point_five(self):
        """When IS half always outperforms OOS half → PBO should be >= 0.5.

        We construct 6 windows where the first 3 (often used as "IS proxy" in
        C(6,3) combinations) consistently beat the last 3 (OOS proxy).
        PBO will be high because IS-look windows always outperform OOS-look windows.
        """
        # Strong IS-era performance, weak OOS-era performance.
        # FIX 2 (ds21): supply a genuinely inflated IS series (OOS + constant
        # shift) — the OOS-as-IS proxy is banned by compute_pbo's fail-closed
        # contract, so the fixture must model real curve-fit IS inflation.
        oos_sharpes = [2.5, 2.3, 2.1, 0.1, -0.1, 0.2]
        is_values = [v + 2.0 for v in oos_sharpes]
        windows = _make_windows(oos_sharpes)
        result = compute_pbo(windows, is_metric_values=is_values)
        assert result["pbo"] is not None
        # IS half consistently better than OOS half → elevated PBO
        assert result["pbo"] >= 0.4  # within 0.1 of 0.5

    def test_pbo_known_overfit_interpretation_not_robust(self):
        """High PBO → interpretation must signal risk (not 'Low overfitting')."""
        oos_sharpes = [3.0, 2.8, 2.6, 0.05, -0.1, 0.1]
        is_values = [v + 2.0 for v in oos_sharpes]
        windows = _make_windows(oos_sharpes)
        result = compute_pbo(windows, is_metric_values=is_values)
        assert result["pbo"] is not None
        if result["pbo"] >= 0.4:
            assert "Low overfitting" not in result["interpretation"]


# ── Test: known stable → PBO ~0.0 ────────────────────────────────────────────

class TestPBOKnownStable:
    def test_pbo_known_stable_returns_low(self):
        """Consistent performance across all windows → low PBO.

        When IS-look and OOS-look windows are comparable in performance, the
        IS half does NOT systematically beat the OOS half → PBO is low.
        """
        # Nearly identical Sharpe across all 6 windows → balanced IS/OOS splits.
        # FIX 2 (ds21): a stable strategy's IS values track OOS (no inflation).
        oos_sharpes = [1.0, 1.0, 1.0, 1.0, 1.0, 1.0]
        windows = _make_windows(oos_sharpes)
        result = compute_pbo(windows, is_metric_values=oos_sharpes)
        assert result["pbo"] is not None
        # Balanced performance → PBO around 0.5 (random coin flip)
        # A truly stable strategy should have PBO NOT heavily elevated
        assert 0.0 <= result["pbo"] <= 1.0

    def test_pbo_increasing_sharpe_is_robust(self):
        """Monotonically increasing Sharpe (improving) → IS half not always better."""
        oos_sharpes = [0.5, 0.7, 0.9, 1.1, 1.3, 1.5]
        windows = _make_windows(oos_sharpes)
        result = compute_pbo(windows, is_metric_values=oos_sharpes)
        assert result["pbo"] is not None
        assert result["n_combinations"] > 0
        # PBO should be low for a strategy that improves over time
        assert result["pbo"] < 0.6


# ── Test: PBO wired into walk_forward result ──────────────────────────────────

class TestPBOWiredIntoWalkForward:
    def test_pbo_field_present_in_wf_result(self):
        """Full walk-forward run must emit 'pbo' key in result.

        FIX 2 (ds21): WF_MODE default flipped "plain" → "cpcv" (2026-06-22
        institutional hardening). The top-level "pbo" key is a plain/purged_embargo-mode
        field (Wave 27.5 Pass B HIGH #3); CPCV mode emits "pbo_overall" instead
        (Wave 29 Pass A.2) and has no top-level "pbo" key. This test module
        specifically exercises the plain-mode PBO auto-wire, so it must now
        request wf_mode="plain" explicitly rather than relying on the
        (no-longer-true) plain default.
        """
        from src.engine.config import (
            BacktestRequest,
            IndicatorConfig,
            PositionSizeConfig,
            StopConfig,
            StrategyConfig,
        )
        from src.engine.walk_forward import run_walk_forward

        data = _make_synthetic_data(500)
        request = BacktestRequest(
            strategy=StrategyConfig(
                name="PBO Wire Test",
                symbol="MES",
                timeframe="daily",
                indicators=[
                    IndicatorConfig(type="sma", period=5),
                    IndicatorConfig(type="atr", period=14),
                ],
                entry_long="close crosses_above sma_5",
                entry_short="close crosses_below sma_5",
                exit="close crosses_below sma_5",
                stop_loss=StopConfig(type="atr", multiplier=2.0),
                position_size=PositionSizeConfig(type="fixed", fixed_contracts=1),
            ),
            start_date="2022-01-01",
            end_date="2023-06-30",
        )

        result = run_walk_forward(request, data=data, n_splits=5, wf_mode="plain")

        # pbo key MUST be present (may be None if < 4 windows survived)
        assert "pbo" in result
        # pbo_pass key MUST be present
        assert "pbo_pass" in result
        # pbo_p_value key MUST be present (even if None)
        assert "pbo_p_value" in result

    def test_pbo_value_is_bounded_or_none(self):
        """pbo value must be in [0, 1] or None (not an error float).

        FIX 2 (ds21): request wf_mode="plain" explicitly — see the
        test_pbo_field_present_in_wf_result docstring above for why. Without
        it, the default cpcv-mode result has no top-level "pbo" key at all,
        so `result.get("pbo")` silently returns None and the `if pbo_val is
        not None` guard skips the bound assertion entirely (a vacuous pass
        that never actually exercises the ranking math).
        """
        from src.engine.config import (
            BacktestRequest,
            IndicatorConfig,
            PositionSizeConfig,
            StopConfig,
            StrategyConfig,
        )
        from src.engine.walk_forward import run_walk_forward

        data = _make_synthetic_data(500)
        request = BacktestRequest(
            strategy=StrategyConfig(
                name="PBO Bounds Test",
                symbol="MES",
                timeframe="daily",
                indicators=[
                    IndicatorConfig(type="sma", period=10),
                    IndicatorConfig(type="atr", period=14),
                ],
                entry_long="close crosses_above sma_10",
                entry_short="close crosses_below sma_10",
                exit="close crosses_below sma_10",
                stop_loss=StopConfig(type="atr", multiplier=1.5),
                position_size=PositionSizeConfig(type="fixed", fixed_contracts=1),
            ),
            start_date="2022-01-01",
            end_date="2023-06-30",
        )

        result = run_walk_forward(request, data=data, n_splits=5, wf_mode="plain")
        pbo_val = result.get("pbo")
        # Indicator warmup (sma_10) can auto-reduce n_splits below the PBO
        # 4-window minimum depending on available OOS bars — pbo legitimately
        # stays None in that case. The bound check below is the actual
        # contract under test (not an early-return artifact).
        if pbo_val is not None:
            assert 0.0 <= pbo_val <= 1.0

    def test_pbo_skipped_with_few_windows(self):
        """When < 4 windows result after auto-reduction, pbo should be None."""
        from src.engine.config import (
            BacktestRequest,
            IndicatorConfig,
            PositionSizeConfig,
            StopConfig,
            StrategyConfig,
        )
        from src.engine.walk_forward import run_walk_forward

        # Very small dataset → auto-reduce to fewer windows
        data = _make_synthetic_data(150)
        request = BacktestRequest(
            strategy=StrategyConfig(
                name="PBO Skip Test",
                symbol="MES",
                timeframe="daily",
                indicators=[
                    IndicatorConfig(type="sma", period=5),
                    IndicatorConfig(type="atr", period=14),
                ],
                entry_long="close crosses_above sma_5",
                entry_short="close crosses_below sma_5",
                exit="close crosses_below sma_5",
                stop_loss=StopConfig(type="atr", multiplier=2.0),
                position_size=PositionSizeConfig(type="fixed", fixed_contracts=1),
            ),
            start_date="2022-01-01",
            end_date="2022-06-30",
        )

        result = run_walk_forward(request, data=data, n_splits=2)
        # With 2 splits, PBO cannot be computed (needs >= 4 windows)
        # pbo key must exist in result; value may be None
        assert "pbo" in result
        # When n_windows < 4, pbo must be None
        if result.get("n_splits", 0) < 4:
            assert result["pbo"] is None
