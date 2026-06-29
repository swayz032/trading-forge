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

# F-3 (2026-06-29): compute_pbo removed from risk_metrics.
# TestPBOKnownOverfit / TestPBOKnownStable classes removed — they called
# the dead OOS-as-IS-proxy implementation directly.  Bailey path coverage
# lives in test_f3_invariant_pbo_bailey.py and test_wave29_pass_a2_pbo_gate.py.


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



# F-3 (2026-06-29): TestPBOKnownStable removed — called dead compute_pbo() directly.


# ── Test: PBO wired into walk_forward result ──────────────────────────────────

class TestPBOWiredIntoWalkForward:
    def test_pbo_field_present_in_wf_result(self):
        """Full walk-forward run must emit 'pbo' key in result."""
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
        """pbo value must be in [0, 1] or None (not an error float)."""
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

        result = run_walk_forward(request, data=data, n_splits=2, wf_mode="plain")
        # With 2 splits, PBO cannot be computed (needs >= 4 windows)
        # pbo key must exist in result; value may be None
        assert "pbo" in result
        # When n_windows < 4, pbo must be None
        if result.get("n_splits", 0) < 4:
            assert result["pbo"] is None
