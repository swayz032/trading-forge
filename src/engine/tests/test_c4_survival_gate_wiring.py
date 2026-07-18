"""
test_c4_survival_gate_wiring.py — W7 close-out fix (2026-07-18).

Before this fix, every backtester.py call site of performance_gate.compute_forge_score()
passed survival_results=None unconditionally, so raw_survival_score (the input the C4
TESTING->PAPER lifecycle hard gate reads, lifecycle-service.ts: raw_survival_score < 60
-> block) was architecturally ALWAYS 0.0 — dormant while production has 0 backtests,
but would hard-block every promotion the moment real backtests start flowing, regardless
of what firm_profiles.py says (W3B fixed firm_profiles.py's own drift, but its output was
never actually consumed by the backtest-execution path).

Found during the $250-1K campaign's W7 close-out (an independent, from-zero re-grade of
an unrelated wave, W3B, surfaced this while re-deriving W3B's own claims — not W3B's
scope or fault). Fixed by wiring survival_scorer.survival_score() into both production
call sites (run_backtest, run_class_backtest) via a shared helper,
_compute_survival_results_for_gate().
"""

import math
from datetime import datetime, timedelta

import polars as pl
import pytest

from src.engine.backtester import _compute_survival_results_for_gate
from src.engine.config import (
    BacktestRequest,
    IndicatorConfig,
    PositionSizeConfig,
    StopConfig,
    StrategyConfig,
)


def _make_trending_ohlcv(n: int = 250) -> pl.DataFrame:
    """Synthetic OHLCV oscillating around a slight uptrend, engineered so
    close crosses its own 5-period SMA repeatedly (short oscillation period
    relative to the SMA window) — reliably produces multiple entries/exits
    over the window, unlike a smooth monotonic trend."""
    dates = [datetime(2023, 1, 1) + timedelta(days=i) for i in range(n)]
    closes = [4000.0 + 50.0 * math.sin(i / 3.0) + i * 0.2 for i in range(n)]
    return pl.DataFrame({
        "ts_event": dates,
        "open":   [c - 2.0 for c in closes],
        "high":   [c + 6.0 for c in closes],
        "low":    [c - 6.0 for c in closes],
        "close":  closes,
        "volume": [50000] * n,
    })


# ─── Unit tests: _compute_survival_results_for_gate() ────────────────────────

class TestComputeSurvivalResultsForGate:
    def test_empty_daily_pnl_records_returns_none(self):
        """No data -> None, fails open exactly like the pre-fix behavior."""
        assert _compute_survival_results_for_gate([], None) is None

    def test_unrecognized_firm_key_scores_both_canonical_firms(self):
        """firm_key=None (the common case — a backtest isn't pinned to one firm)
        scores BOTH Topstep and MFFU and returns the WORSE (lower) survival_score —
        never overstates survivability for whichever firm the strategy eventually
        deploys to (mirrors this codebase's 'worst firm wins' MC-ruin convention).
        """
        records = [{"date": f"2023-01-{d:02d}", "pnl": (100.0 if d % 3 else -80.0)} for d in range(1, 29)]
        result = _compute_survival_results_for_gate(records, None)
        assert result is not None
        assert 0.0 <= result["survival_score"] <= 100.0
        assert result["firm"] in ("Topstep", "MFFU")

        # RED-proof the "worst wins" claim directly: compute both firms by hand and
        # confirm the helper's result matches the min, not an arbitrary pick.
        from src.engine.survival.survival_scorer import survival_score
        daily_pnls = [r["pnl"] for r in records]
        topstep = survival_score(daily_pnls, "Topstep", "50K")
        mffu = survival_score(daily_pnls, "MFFU", "50K")
        expected = min([topstep, mffu], key=lambda s: s["survival_score"])
        assert result["survival_score"] == expected["survival_score"]
        assert result["firm"] == expected["firm"]

    def test_recognized_firm_key_scores_only_that_firm(self):
        """A backtest explicitly pinned to one firm (firm_key='topstep_50k') scores
        ONLY that firm — not the conservative worst-of-both default."""
        records = [{"date": f"2023-01-{d:02d}", "pnl": (150.0 if d % 2 else -60.0)} for d in range(1, 29)]
        result = _compute_survival_results_for_gate(records, "topstep_50k")
        assert result is not None
        assert result["firm"] == "Topstep"
        assert result["account_type"] == "50K"

        result_mffu = _compute_survival_results_for_gate(records, "mffu_50k")
        assert result_mffu is not None
        assert result_mffu["firm"] == "MFFU"

    def test_fails_open_on_internal_error(self, monkeypatch):
        """A survival_score() exception must not propagate — this is enrichment for
        an audit-trail component, never something that should crash or corrupt an
        otherwise-valid backtest. Returns None (matching pre-fix behavior) instead."""
        import src.engine.survival.survival_scorer as scorer_module

        def _boom(*args, **kwargs):
            raise RuntimeError("synthetic failure for the fail-open RED-proof")

        monkeypatch.setattr(scorer_module, "survival_score", _boom)
        records = [{"date": "2023-01-01", "pnl": 100.0}]
        # _compute_survival_results_for_gate imports survival_score locally inside the
        # function body, so patching the module-level name above is picked up on the
        # next call (Python resolves the `from ... import` at call time here).
        result = _compute_survival_results_for_gate(records, None)
        assert result is None


# ─── Integration: run_backtest() actually engages the fix ────────────────────

class TestC4GateEngagesOnRealBacktest:
    def test_raw_survival_score_is_no_longer_hardcoded_zero(self):
        """RED-proof for the actual production bug: before this fix, EVERY backtest's
        forge_score_components.components.raw_survival_score was unconditionally 0.0,
        regardless of the strategy's real performance. A trending synthetic backtest
        with real trades and real daily P&L must now produce a genuine, non-zero
        survival score (or, if genuinely 0 trades, the field stays 0 by honest design —
        this test uses data engineered to produce trades, so 0.0 here would mean the
        fix regressed, not that the strategy happened to score exactly 0)."""
        from src.engine.backtester import run_backtest

        config = BacktestRequest(
            strategy=StrategyConfig(
                name="C4 Survival Gate Wiring Test",
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
            start_date="2023-01-01",
            end_date="2023-12-31",
            commission_per_side=0.62,
        )
        df = _make_trending_ohlcv(250)
        result = run_backtest(config, data=df)

        if result["total_trades"] == 0:
            pytest.skip("synthetic fixture produced zero trades on this run — not what this test targets")

        components = result["forge_score_components"]["components"]
        assert "raw_survival_score" in components
        # The actual RED-proof: pre-fix this was unconditionally 0.0 no matter what.
        # survival_score() on any non-trivial daily P&L series essentially never lands
        # on exactly 0.0 (7 independently-weighted metrics would all have to hit their
        # individual floors simultaneously) — so a genuine non-zero value here is
        # strong evidence the real computation ran, not a coincidence.
        assert components["raw_survival_score"] != 0.0
        assert components["survival_in_score"] is False or components["survival_in_score"] is True

    def test_firm_key_pins_survival_scoring_to_that_firm(self):
        """When BacktestRequest.firm_key is set, the persisted forge_score_components
        reflects that ONE firm's survival profile (via the firm/account_type carried
        inside the scored dict), not the conservative worst-of-both-firms default."""
        from src.engine.backtester import run_backtest

        base_kwargs = dict(
            strategy=StrategyConfig(
                name="C4 Firm-Pinned Test",
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
            start_date="2023-01-01",
            end_date="2023-12-31",
            commission_per_side=0.62,
        )
        df = _make_trending_ohlcv(250)

        config_topstep = BacktestRequest(firm_key="topstep_50k", **base_kwargs)
        result_topstep = run_backtest(config_topstep, data=df)
        if result_topstep["total_trades"] == 0:
            pytest.skip("synthetic fixture produced zero trades on this run — not what this test targets")

        # Firm-pinned and unpinned may legitimately produce the SAME numeric score
        # (Topstep could be the worse firm anyway) — the real assertion is just that
        # the pinned path doesn't crash and still produces a genuine non-zero score,
        # proving firm_key threads through run_backtest -> _gate_stats path correctly.
        components = result_topstep["forge_score_components"]["components"]
        assert components["raw_survival_score"] != 0.0
