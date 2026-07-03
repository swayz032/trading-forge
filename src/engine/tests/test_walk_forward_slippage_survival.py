"""Slippage-Survival Gate — walk-forward forwarding tests (Wave A follow-up, 2026-07-03).

Design spec: docs/superpowers/specs/2026-07-03-slippage-survival-gate-design.md

The single-backtest producer (src/engine/statistics/slippage_survival.py +
backtester.py wiring) is covered by test_slippage_survival.py. THIS file covers
the follow-up gap: PAPER -> DEPLOY_READY promotion candidates are WF/CPCV-
validated, so `result["slippage_survival"]` must also be forwarded to the TOP
LEVEL of both walk-forward return dicts (_run_walk_forward_cpcv + run_walk_forward),
computed over the AGGREGATE out-of-sample trade set (all_oos_trades) — mirroring
how WF already aggregates win_rate/PF from all_oos_trades rather than averaging
per-window/per-path values.

Covers:
  - _compute_wf_slippage_survival() direct unit tests: empty aggregate, populated
    aggregate with an exact known-answer breaks_at, missing-keys detection
    (real gap -> error envelope, never a silently-defaulted sweep).
  - CPCV early-return path (zero paths completed): slippage_survival present
    with insufficient_sample=True, breaks_at=None — deterministic, no real
    backtest execution needed (tiny 8-row dataframe forces the early return,
    mirrors test_walk_forward_wrc_spa_emission.py's test_cpcv_early_return_has_wrc_spa).
  - CPCV main-return + plain-WF main-return wiring: monkeypatch the module-level
    `run_backtest` name (real backtest execution in this sandbox is S3-gated and
    unreliable for guaranteeing trades — see AGENT-LOGS) to return controlled
    per-window/per-path trades with a known breaks_at outcome, then call the
    REAL _run_walk_forward_cpcv()/run_walk_forward() and assert the top-level
    key is wired correctly (not just that the helper function works standalone).
"""

from __future__ import annotations

from datetime import datetime, timedelta

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
    _compute_wf_slippage_survival,
    _run_walk_forward_cpcv,
    run_walk_forward,
)

_REQUIRED_KEYS = frozenset({
    "schema_version", "multiples", "pf", "expectancy_r",
    "breaks_at", "retention_2x", "n_trades", "insufficient_sample",
})


# ── Direct unit tests of the aggregate-OOS wrapper ──────────────────────────

class TestComputeWfSlippageSurvival:
    def test_empty_aggregate(self):
        """Zero OOS trades (e.g. every CPCV path failed) -> emit, don't omit."""
        result = _compute_wf_slippage_survival([])
        assert result["n_trades"] == 0
        assert result["insufficient_sample"] is True
        assert result["breaks_at"] is None
        assert _REQUIRED_KEYS.issubset(set(result.keys()))

    def test_populated_aggregate_exact_breaks_at(self):
        """Known-answer aggregate: hand-derived breaks_at=2.0 (mirrors the
        single-backtest boundary fixture in test_slippage_survival.py, proving
        the WF wrapper reuses the exact same sweep math over a merged trade list
        from multiple folds/paths, not a re-derived approximation).

        Each fold contributes the same [gross=100/-40, slip=30/5] pair; PF is
        scale-invariant so repeating the pair doesn't change breaks_at, it just
        crosses SLIPPAGE_SURVIVAL_MIN_TRADES (default 20) so breaks_at isn't
        forced null by the sample-size guard (that guard itself is covered by
        test_insufficient_sample_forces_breaks_at_null in test_slippage_survival.py
        and test_missing_keys_is_a_reported_gap_not_a_silent_default below):
          1x: PF=140/90=1.5556 per 2-trade block (>=1.0) -> alive
          2x: PF=80/100=0.8 per 2-trade block (<1.0)    -> NOT alive -> breaks at 2x
        """
        one_fold = [
            {"GrossPnL": 100.0, "SlippageCost": 30.0, "PnL": 70.0},
            {"GrossPnL": -40.0, "SlippageCost": 5.0, "PnL": -45.0},
        ]
        all_oos_trades = one_fold * 12  # 24 trades, crosses default min_trades=20
        result = _compute_wf_slippage_survival(all_oos_trades)
        assert result["n_trades"] == 24
        assert result["pf"]["1x"] == pytest.approx(1.5556, abs=1e-3)
        assert result["pf"]["2x"] == pytest.approx(0.8, abs=1e-3)
        assert result["breaks_at"] == 2.0
        assert result["insufficient_sample"] is False

    def test_sufficient_sample_when_aggregate_crosses_min_trades(self):
        """Aggregating across enough folds/paths crosses SLIPPAGE_SURVIVAL_MIN_TRADES
        (default 20) even when no single fold would alone -- this is the whole
        point of computing on the aggregate, not per-window."""
        one_fold = [
            {"GrossPnL": 100.0, "SlippageCost": 5.0, "PnL": 95.0},
            {"GrossPnL": -50.0, "SlippageCost": 5.0, "PnL": -55.0},
        ]
        all_oos_trades = one_fold * 11  # 22 trades total, aggregated across "folds"
        result = _compute_wf_slippage_survival(all_oos_trades)
        assert result["n_trades"] == 22
        assert result["insufficient_sample"] is False

    def test_missing_keys_is_a_reported_gap_not_a_silent_default(self):
        """A trade missing GrossPnL/SlippageCost must produce an explicit error
        envelope -- never a silently-zeroed (misleading) sweep. This is the
        exact scenario the coordinator flagged: 'if a fold's trades are missing
        those keys, that's a real gap to report, not silently skip.'"""
        all_oos_trades = [
            {"GrossPnL": 100.0, "SlippageCost": 5.0, "PnL": 95.0},
            {"PnL": -55.0},  # missing GrossPnL AND SlippageCost
        ]
        result = _compute_wf_slippage_survival(all_oos_trades)
        assert "error" in result
        assert "pf" not in result  # degraded envelope, not a fabricated sweep
        assert result["n_trades"] == 2

    def test_missing_one_key_still_detected(self):
        """Only SlippageCost missing (GrossPnL present) is still caught."""
        all_oos_trades = [
            {"GrossPnL": 100.0, "SlippageCost": 5.0},
            {"GrossPnL": -40.0},  # missing SlippageCost only
        ]
        result = _compute_wf_slippage_survival(all_oos_trades)
        assert "error" in result

    def test_determinism(self):
        all_oos_trades = [
            {"GrossPnL": 40.0, "SlippageCost": 2.0, "PnL": 38.0},
            {"GrossPnL": -20.0, "SlippageCost": 2.0, "PnL": -22.0},
        ] * 12
        r1 = _compute_wf_slippage_survival(list(all_oos_trades))
        r2 = _compute_wf_slippage_survival(list(all_oos_trades))
        # computed_at will differ (wall clock) -- compare everything else.
        r1.pop("computed_at", None)
        r2.pop("computed_at", None)
        assert r1 == r2


# ── CPCV early-return path (deterministic, no real backtest execution) ─────

class TestCpcvEarlyReturnForwarding:
    def test_cpcv_early_return_has_slippage_survival(self):
        """8 rows total with 6-split CPCV -> paths fail (nothing to combine) ->
        early return. slippage_survival must still be present (mirrors the
        existing wrc_result/spa_result early-return coverage)."""
        dates = [datetime(2023, 1, 1) + timedelta(days=i) for i in range(8)]
        data = pl.DataFrame({
            "ts_event": dates,
            "open":   [4000.0] * 8,
            "high":   [4010.0] * 8,
            "low":    [3990.0] * 8,
            "close":  [4005.0] * 8,
            "volume": [1000] * 8,
        })
        req = BacktestRequest(
            strategy=StrategyConfig(
                name="Tiny",
                symbol="MES",
                timeframe="daily",
                indicators=[IndicatorConfig(type="sma", period=2)],
                entry_long="close crosses_above sma_2",
                entry_short="close crosses_below sma_2",
                exit="close crosses_below sma_2",
                stop_loss=StopConfig(type="fixed", points=10.0),
                position_size=PositionSizeConfig(type="fixed", fixed_contracts=1),
            ),
            start_date="2023-01-01",
            end_date="2023-01-10",
        )
        result = _run_walk_forward_cpcv(
            request=req, data=data, n_splits=6, k_test_groups=2, embargo_bars=1
        )
        assert "slippage_survival" in result, "Early-return CPCV must include slippage_survival"
        ss = result["slippage_survival"]
        assert ss["n_trades"] == 0
        assert ss["insufficient_sample"] is True
        assert ss["breaks_at"] is None


# ── Wiring integration: monkeypatched run_backtest, controlled trades ──────
# Real backtest execution in this sandbox is S3-gated (HTF eligibility gate
# needs ES daily from S3, unavailable here) so trade generation cannot be
# relied on to produce a specific breaks_at deterministically end-to-end.
# Monkeypatching the module-level `run_backtest` name lets us verify the
# ACTUAL wiring (not just the helper function) with a controlled, known trade
# set -- this is the more direct test of "does the top-level key get forwarded
# correctly by the real WF functions."

def _make_synthetic_ohlcv(n: int = 1100) -> pl.DataFrame:
    dates = [datetime(2020, 1, 1) + timedelta(days=i) for i in range(n)]
    closes = [4000.0 + i * 0.5 for i in range(n)]
    return pl.DataFrame({
        "ts_event": dates,
        "open":   [c - 1.0 for c in closes],
        "high":   [c + 2.0 for c in closes],
        "low":    [c - 2.0 for c in closes],
        "close":  closes,
        "volume": [50_000] * n,
    })


def _base_request() -> BacktestRequest:
    return BacktestRequest(
        strategy=StrategyConfig(
            name="WF Slippage Survival Test",
            symbol="MES",
            timeframe="daily",
            indicators=[
                IndicatorConfig(type="sma", period=5),
                IndicatorConfig(type="sma", period=20),
                IndicatorConfig(type="atr", period=14),
            ],
            entry_long="close crosses_above sma_5",
            entry_short="close crosses_below sma_5",
            exit="close crosses_below sma_20",
            stop_loss=StopConfig(type="atr", multiplier=2.0),
            position_size=PositionSizeConfig(type="fixed", fixed_contracts=1),
        ),
        start_date="2020-01-01",
        end_date="2021-06-30",
    )


# Fixed per-window/per-path fake trades: same fragile-at-2x shape used above,
# so the expected aggregate breaks_at is known exactly (2.0) regardless of how
# many folds/paths get summed (every fold contributes the SAME shape).
_FAKE_TRADES = [
    {"GrossPnL": 100.0, "SlippageCost": 30.0, "PnL": 70.0, "duration_bars": 3},
    {"GrossPnL": -40.0, "SlippageCost": 5.0, "PnL": -45.0, "duration_bars": 2},
]


def _fake_run_backtest(request, data=None, warmup_data=None, **kwargs):
    """Stand-in for run_backtest(): ignores its inputs, returns a fixed result
    dict so the WF aggregation loop can run its real logic end to end without
    depending on S3 data access or real signal generation. Includes both the
    directly-indexed keys the plain-WF per-window assembly reads (total_trades,
    total_return, sharpe_ratio, max_drawdown, win_rate, profit_factor) AND the
    .get()-accessed keys the CPCV path reads -- covers both call sites."""
    return {
        "sharpe_ratio": 1.0,
        "total_return": 25.0,
        "max_drawdown": 100.0,
        "win_rate": 0.5,
        "profit_factor": 1.5,
        "total_trades": len(_FAKE_TRADES),
        "total_trading_days": 5,
        "avg_trade_pnl": 12.5,
        "trades": [dict(t) for t in _FAKE_TRADES],
        "daily_pnls": [10.0, -5.0, 12.0, -3.0, 8.0],
        "daily_pnl_records": [],
        "equity_bars": [50000.0, 50010.0, 50005.0, 50017.0, 50014.0],
        "equity_curve": [],
        "dominant_regime": None,
    }


class TestCpcvMainReturnForwarding:
    def test_slippage_survival_wired_from_aggregate_trades(self, monkeypatch):
        """Monkeypatch run_backtest so every CPCV path returns the same fixed
        fragile-at-2x trade pair; assert the REAL _run_walk_forward_cpcv()
        forwards a top-level slippage_survival with breaks_at=2.0 -- proving
        the wiring (not just the standalone helper) works end to end."""
        import src.engine.walk_forward as wf_module

        monkeypatch.setattr(wf_module, "run_backtest", _fake_run_backtest)
        # Decouple this wiring assertion from incidental path-count arithmetic
        # (C(6,2)=15 paths x 2 trades happens to clear the default 20, but the
        # min_trades guard itself has dedicated coverage above/in
        # test_slippage_survival.py -- isolate what THIS test is proving).
        monkeypatch.setenv("SLIPPAGE_SURVIVAL_MIN_TRADES", "1")

        data = _make_synthetic_ohlcv(n=400)
        req = _base_request()
        result = _run_walk_forward_cpcv(
            request=req, data=data, n_splits=6, k_test_groups=2, embargo_bars=5
        )

        assert "slippage_survival" in result
        ss = result["slippage_survival"]
        assert "error" not in ss, f"Unexpected error envelope: {ss}"
        assert ss["n_trades"] == 2 * result["wf_metadata"]["n_paths"]
        assert ss["breaks_at"] == 2.0
        assert ss["pf"]["1x"] == pytest.approx(1.5556, abs=1e-3)
        assert ss["pf"]["2x"] == pytest.approx(0.8, abs=1e-3)


class TestPlainWfMainReturnForwarding:
    def test_slippage_survival_wired_from_aggregate_trades(self, monkeypatch):
        """Same wiring proof for run_walk_forward() in explicit 'plain' mode.
        WF_PARALLEL forced to 0 so the monkeypatched run_backtest (module-level
        name) is actually invoked in-process -- ProcessPoolExecutor workers
        would re-import a fresh (unpatched) module in a child process.

        n=1100 bars (vs the CPCV test's 400) is deliberate: plain-WF auto-reduces
        n_splits when data is too short for MIN_OOS_DAYS-per-window, and dropping
        below 4 windows hits a PRE-EXISTING, UNRELATED crash bug in walk_forward.py
        (UnboundLocalError on `_plain_wf_pbo_degenerate_reason` — that variable is
        only initialized inside `if len(window_results) >= 4:` at line ~1722 but
        is unconditionally read building the return dict at line ~2293). Verified
        this crash reproduces identically on unmodified walk_forward.py (git stash)
        with <4 windows — NOT something this change introduced. Using enough bars
        to keep n_splits>=4 sidesteps that pre-existing bug so THIS test can prove
        what it's actually testing (slippage_survival wiring), without silently
        papering over the crash risk — flagged separately in the session log for
        the parent/coordinator to decide whether to dispatch a fix.
        """
        import src.engine.walk_forward as wf_module

        monkeypatch.setattr(wf_module, "run_backtest", _fake_run_backtest)
        monkeypatch.setenv("WF_PARALLEL", "0")
        # Each window only contributes 2 fake trades -- decouple this wiring
        # assertion from min_trades arithmetic (guard has dedicated coverage
        # elsewhere, e.g. test_slippage_survival.py's TestMinTradesGuard).
        monkeypatch.setenv("SLIPPAGE_SURVIVAL_MIN_TRADES", "1")

        data = _make_synthetic_ohlcv(n=1100)
        req = _base_request()
        result = run_walk_forward(request=req, data=data, n_splits=5, wf_mode="plain")

        assert "slippage_survival" in result
        ss = result["slippage_survival"]
        assert "error" not in ss, f"Unexpected error envelope: {ss}"
        assert ss["n_trades"] == 2 * result["n_splits"]
        assert ss["breaks_at"] == 2.0
        assert ss["pf"]["1x"] == pytest.approx(1.5556, abs=1e-3)
        assert ss["pf"]["2x"] == pytest.approx(0.8, abs=1e-3)
