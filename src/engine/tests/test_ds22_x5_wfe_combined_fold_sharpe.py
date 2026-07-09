"""Deep-scan #22 Track X5 — failure-injection sweep, Control #4 (WFE must use
combined-fold Sharpe, NOT the average of per-fold Sharpe ratios).

CLAUDE.md §4 institutional contract: "WFE uses combined-fold Sharpe (OOS / IS)
per institutional 2026 standard, NOT per-fold average." walk_forward.py's own
comment confirms the implementation intent: "Sharpe: recompute from all daily
P&Ls (not averaged per-window)".

This test constructs 3 walk-forward windows with deliberately UNEQUAL day
counts and volatility per window, so that:
  combined_fold_sharpe = sharpe(concat(all window daily_pnls))
  per_fold_avg_sharpe  = mean(sharpe(window_1), sharpe(window_2), sharpe(window_3))
diverge by a wide, unmistakable margin. It then asserts `run_walk_forward()`'s
top-level `wfe_overall` matches ONLY the combined-fold formula — proving by
real execution (not just source inspection) which formula the engine actually
uses, and that a regression to per-fold averaging would be caught.

Mocks `run_backtest` (forced onto the serial code path via `WF_PARALLEL=0` so
the monkeypatch is visible — the parallel path uses a spawned subprocess and
would silently bypass the patch) so daily_pnls per window are fully
controlled, no vectorbt call, and no real market data dependency.
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


def _make_synthetic_data(n: int = 600) -> pl.DataFrame:
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


def _make_request() -> BacktestRequest:
    return BacktestRequest(
        strategy=StrategyConfig(
            name="WFE Combined-Fold Test",
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
        end_date="2023-08-24",
    )


def _sharpe(pnls: list[float]) -> float:
    arr = np.array(pnls, dtype=float)
    std = float(np.std(arr, ddof=1))
    if std <= 0:
        return 0.0
    return float(np.mean(arr) / std * np.sqrt(252))


# Deliberately unequal window shapes: window 1 is short + high-vol, window 2 is
# long + low-vol, window 3 is medium + high-vol. Per-fold-average Sharpe
# weights every window equally regardless of day count and ignores the joint
# distribution; combined-fold Sharpe recomputes from the pooled series.
_OOS_WINDOWS = [
    [40.0, -180.0, 220.0, -160.0],                                    # n=4, high-vol
    [12.0, 8.0, 15.0, 10.0, 9.0, 14.0, 11.0, 13.0, 9.5, 12.5, 10.5, 11.5],  # n=12, low-vol steady
    [90.0, -70.0, 100.0, -60.0, 80.0],                                 # n=5, high-vol
]
_IS_WINDOWS = [
    [30.0, -140.0, 170.0, -120.0],
    [10.0, 7.0, 13.0, 9.0, 8.0, 12.0, 10.0, 11.0, 8.5, 11.0, 9.5, 10.0],
    [70.0, -55.0, 80.0, -45.0, 65.0],
]


def _install_serial_mocks(monkeypatch):
    """Force the serial WF code path (monkeypatch invisible across the
    parallel spawn()'d subprocess boundary) and capture calls in strict
    OOS-then-IS order, matching run_walk_forward()'s serial assembly."""
    import src.engine.walk_forward as wf_mod

    monkeypatch.setenv("WF_PARALLEL", "0")

    state = {"oos_calls": 0, "is_calls": 0}
    # Globally unique, monotonically-increasing dates across ALL windows so the
    # WF boundary-overlap dedup (which drops duplicate boundary-day P&L records
    # by date string) never touches this fixture's data — each window's daily
    # P&L series must survive assembly byte-for-byte for the ground-truth
    # combined-fold computation below to be valid.
    _date_counter = {"n": 0}

    def _next_date() -> str:
        d = datetime(2022, 1, 1) + timedelta(days=_date_counter["n"])
        _date_counter["n"] += 1
        return d.date().isoformat()

    def _fake_run_backtest(request, data=None, warmup_data=None):
        if warmup_data is not None:
            # OOS call: run_backtest(_opt_req, data=oos_data, warmup_data=is_data)
            idx = state["oos_calls"]
            state["oos_calls"] += 1
            pnls = _OOS_WINDOWS[idx]
        else:
            # IS call: run_backtest(_wfe_is_request, data=is_data_wfe)
            idx = state["is_calls"]
            state["is_calls"] += 1
            pnls = _IS_WINDOWS[idx]
        return {
            "total_trades": len(pnls) * 2,
            "total_return": float(sum(pnls)),
            "sharpe_ratio": _sharpe(pnls),
            "max_drawdown": 10.0,
            "win_rate": 0.55,
            "profit_factor": 1.4,
            "total_trading_days": len(pnls),
            "daily_pnls": list(pnls),
            "daily_pnl_records": [
                {"date": _next_date(), "pnl": p} for p in pnls
            ],
            "trades": [{"PnL": p} for p in pnls for _ in range(2)],
            "equity_bars": [],
            "avg_trade_pnl": float(np.mean(pnls)),
        }

    monkeypatch.setattr(wf_mod, "run_backtest", _fake_run_backtest)
    return state


class TestWfeUsesCombinedFoldNotPerFoldAverage:
    def test_wfe_overall_matches_combined_fold_formula(self, monkeypatch):
        from src.engine.walk_forward import run_walk_forward

        state = _install_serial_mocks(monkeypatch)
        data = _make_synthetic_data(600)
        request = _make_request()

        result = run_walk_forward(request, data=data, n_splits=3, wf_mode="plain")

        assert state["oos_calls"] == 3, f"Expected 3 OOS run_backtest calls, got {state['oos_calls']}"
        assert state["is_calls"] == 3, f"Expected 3 IS run_backtest calls, got {state['is_calls']}"

        # Ground truth: what the engine SHOULD compute (combined-fold, i.e.
        # recompute Sharpe on the pooled/concatenated daily-P&L series).
        combined_oos_pnls = [p for w in _OOS_WINDOWS for p in w]
        combined_is_pnls = [p for w in _IS_WINDOWS for p in w]
        combined_oos_sharpe = _sharpe(combined_oos_pnls)
        combined_is_sharpe = _sharpe(combined_is_pnls)
        expected_wfe_combined = round(combined_oos_sharpe / combined_is_sharpe, 4)

        # The WRONG formula a regression could reintroduce: average of each
        # window's OWN Sharpe ratio (per-fold average), ignoring day-count
        # weighting and pooled distribution shape entirely.
        per_fold_oos_sharpes = [_sharpe(w) for w in _OOS_WINDOWS]
        per_fold_is_sharpes = [_sharpe(w) for w in _IS_WINDOWS]
        per_fold_avg_wfe = round(
            (float(np.mean(per_fold_oos_sharpes)) / float(np.mean(per_fold_is_sharpes))), 4
        )

        # Sanity: the two candidate formulas must genuinely diverge on this
        # fixture, or this test proves nothing (RED-proof precondition).
        assert abs(expected_wfe_combined - per_fold_avg_wfe) > 0.05, (
            f"Fixture did not create enough divergence between combined-fold "
            f"({expected_wfe_combined}) and per-fold-average ({per_fold_avg_wfe}) "
            f"WFE formulas to distinguish them — strengthen the fixture."
        )

        actual_wfe = result.get("wfe_overall")
        assert actual_wfe is not None, "wfe_overall must be computed for this fixture (IS Sharpe > 0)"

        assert actual_wfe == pytest.approx(expected_wfe_combined, abs=0.01), (
            f"wfe_overall={actual_wfe} does not match the combined-fold formula "
            f"({expected_wfe_combined}) — WFE computation may have regressed."
        )
        assert actual_wfe != pytest.approx(per_fold_avg_wfe, abs=0.01), (
            f"RED-PROOF FAILED: wfe_overall={actual_wfe} matches the WRONG "
            f"per-fold-average formula ({per_fold_avg_wfe}) instead of the "
            f"combined-fold formula ({expected_wfe_combined}) — this is exactly "
            "the regression the institutional 'combined-fold, not per-fold "
            "average' contract (CLAUDE.md §4) exists to prevent."
        )

    def test_naive_per_fold_average_would_have_been_caught(self, monkeypatch):
        """Explicit RED-proof: if wfe_overall were (incorrectly) computed as
        mean(per-window Sharpe) instead of combined-fold, this assertion
        pattern would fail loudly rather than silently pass."""
        per_fold_oos_sharpes = [_sharpe(w) for w in _OOS_WINDOWS]
        per_fold_is_sharpes = [_sharpe(w) for w in _IS_WINDOWS]
        naive_wfe = float(np.mean(per_fold_oos_sharpes)) / float(np.mean(per_fold_is_sharpes))

        combined_oos_pnls = [p for w in _OOS_WINDOWS for p in w]
        combined_is_pnls = [p for w in _IS_WINDOWS for p in w]
        combined_wfe = _sharpe(combined_oos_pnls) / _sharpe(combined_is_pnls)

        # This is the actual divergence magnitude the production test above
        # relies on to distinguish the two candidate implementations.
        assert abs(naive_wfe - combined_wfe) > 0.05
