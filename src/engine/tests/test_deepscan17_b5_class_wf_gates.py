"""Deepscan17 B-5 HIGH — run_walk_forward_class() must compute WFE/BIF/PBO/DSR.

BACKGROUND (deepscan17, 2026-07-05): run_walk_forward_class() — the walk-forward
entry point used by archetype/class-based strategies (bounce_off_level,
ict_bias_aligned_continuation, silver_bullet, crt, power_of_3 — i.e. the LIVE
117-strategy library, invoked from backtester.py main() ~line 7507/7638) —
never computed wfe_overall / bif / k_eff / pbo_overall / dsr_pass at all. Its
return dict only carried an unflattened "cross_validation" sub-dict (built via
run_cross_validation(..., is_sharpe=None) — hardcoded None because the
function collected no per-window IS data). The TS promotion gates
(wfe-gate.ts, bif-gate.ts, pbo-gate.ts, the Wave 24 dsr_honest gate) all treat
an ABSENT top-level key as a legacy grandfather-PASS, so every archetype
strategy was PERMANENTLY exempt from these gates.

THE FIX: thread the same base-config-IS-basis WFE/BIF/PBO/DSR computation
run_walk_forward() uses for its plain/purged_embargo path into
run_walk_forward_class(), backed by a new lightweight per-window IS-only
backtest (mirrors the CPCV per-path IS eval pattern already established in
_run_walk_forward_cpcv).

These tests mock run_class_backtest (module-level import in walk_forward.py)
and load_ohlcv (local import inside run_walk_forward_class) — same isolation
pattern as test_class_wf_eligibility_gate_toggle.py — so no real backtest or
market data dependency is needed.

Run targeted:
    python -m pytest src/engine/tests/test_deepscan17_b5_class_wf_gates.py -v
"""

from __future__ import annotations


def _build_synthetic_ohlcv(n: int = 1000):
    from datetime import datetime, timedelta, timezone

    import numpy as np
    import polars as pl

    start = datetime(2026, 1, 5, 9, 30, tzinfo=timezone.utc)
    ts = [start + timedelta(minutes=5 * i) for i in range(n)]
    rng = np.random.default_rng(11)
    close = 5000 + np.cumsum(rng.normal(0, 1.0, n))
    return pl.DataFrame(
        {
            "ts_event": ts,
            "open": close.astype(float),
            "high": (close + 1.0).astype(float),
            "low": (close - 1.0).astype(float),
            "close": close.astype(float),
            "volume": rng.integers(500, 2000, n).astype(int),
        }
    )


def _make_dummy_strategy():
    import polars as pl

    from src.engine.strategy_base import BaseStrategy

    class _DummyStrategy(BaseStrategy):
        name = "silver_bullet"
        symbol = "MES"
        timeframe = "5m"

        def compute(self, df: pl.DataFrame) -> pl.DataFrame:
            return df.with_columns(
                [
                    pl.lit(False).alias("entry_long"),
                    pl.lit(False).alias("entry_short"),
                    pl.lit(False).alias("exit_long"),
                    pl.lit(False).alias("exit_short"),
                ]
            )

        def get_params(self) -> dict:
            return {}

        def get_default_config(self) -> dict:
            return {}

    return _DummyStrategy()


def _install_common_mocks(monkeypatch, oos_daily_pnls, is_daily_pnls):
    """Mocks load_ohlcv + run_class_backtest so run_walk_forward_class() runs
    end-to-end without real data or a real backtest.

    Discriminator: the OOS-eval call always passes warmup_data=<is_data>
    (a real, non-None Polars DataFrame). The new B-5 per-window IS-only call
    never passes warmup_data at all (kwargs.get("warmup_data") is None by
    construction) — this is the exact same distinguishing shape the
    production code uses (is_data is only ever None-free when explicitly
    threaded as warmup).
    """
    synthetic = _build_synthetic_ohlcv()

    def _fake_load_ohlcv(symbol, timeframe, start_date, end_date):
        if timeframe == "daily":
            return synthetic.head(50)  # < 200 rows -> htf_cache stays None
        return synthetic

    monkeypatch.setattr("src.engine.data_loader.load_ohlcv", _fake_load_ohlcv)

    _oos_call_counter = {"n": 0}
    call_log: list[dict] = []

    def _fake_run_class_backtest(**kwargs):
        call_log.append(kwargs)
        is_warmup_call = kwargs.get("warmup_data") is None
        if is_warmup_call:
            daily_pnls = list(is_daily_pnls)
            records = []
        else:
            idx = _oos_call_counter["n"]
            _oos_call_counter["n"] += 1
            daily_pnls = list(oos_daily_pnls)
            records = [
                {"date": f"2026-{(idx % 9) + 1:02d}-{d + 1:02d}", "pnl": p}
                for d, p in enumerate(daily_pnls)
            ]
        total_trades = max(len(daily_pnls) * 3, 1)
        trades = [{"PnL": 5.0} for _ in range(total_trades)]
        return {
            "total_trades": total_trades,
            "total_return": float(sum(daily_pnls) * 3),
            "sharpe_ratio": 1.0,
            "max_drawdown": 5.0,
            "win_rate": 0.6,
            "profit_factor": 1.5,
            "total_trading_days": len(daily_pnls),
            "daily_pnls": daily_pnls,
            "daily_pnl_records": records,
            "trades": trades,
            "equity_bars": [],
            "avg_trade_pnl": 2.0,
            "avg_rr": 1.5,
            "avg_winner_rr": 2.0,
            "avg_loser_rr": 1.0,
        }

    monkeypatch.setattr("src.engine.walk_forward.run_class_backtest", _fake_run_class_backtest)
    return call_log


class TestB5WfeBifPboKeysPresent:
    """Core B-5 contract: the return dict must carry wfe_overall/bif/k_eff/
    pbo_overall/wf_metadata.dsr_pass as TOP-LEVEL keys the TS gates read —
    not just buried inside the unflattened 'cross_validation' sub-dict."""

    def test_wfe_overall_present_and_not_none(self, monkeypatch):
        from src.engine.walk_forward import run_walk_forward_class

        _install_common_mocks(
            monkeypatch,
            oos_daily_pnls=[6.0, -4.0, 7.0, 3.0, -1.0, 5.0],
            is_daily_pnls=[4.0, -3.0, 5.0, 2.0, -2.0, 3.0],
        )
        result = run_walk_forward_class(
            strategy=_make_dummy_strategy(),
            start_date="2026-01-01", end_date="2026-04-01",
            n_splits=4, is_ratio=0.5,
            # deep-scan #22 FIX 2 (2026-07-06): run_walk_forward_class() now
            # honors WF_MODE (institutional default "cpcv") instead of
            # silently always running plain WF. This suite tests the B-5
            # PLAIN-mode WFE/BIF/PBO/DSR aggregation contract specifically
            # (window-count assertions, plain-mode wfe_status vocabulary) —
            # pin wf_mode="plain" explicitly so it keeps testing that path
            # regardless of the new default. CPCV-mode's parallel contract is
            # covered by test_deepscan22_fix2_class_cpcv_routing.py.
            wf_mode="plain",
        )
        assert "wfe_overall" in result, (
            "B-5 REGRESSION: wfe_overall key absent — TS wfe-gate.ts will "
            "grandfather-pass every archetype strategy"
        )
        assert result["wfe_overall"] is not None, (
            "wfe_overall must be a real computed value (or the explicit "
            "degenerate_is 0.0 sentinel), never a bare absent/None key"
        )
        assert isinstance(result["wfe_overall"], float)

    def test_wfe_status_present(self, monkeypatch):
        from src.engine.walk_forward import run_walk_forward_class

        _install_common_mocks(
            monkeypatch,
            oos_daily_pnls=[6.0, -4.0, 7.0, 3.0, -1.0, 5.0],
            is_daily_pnls=[4.0, -3.0, 5.0, 2.0, -2.0, 3.0],
        )
        result = run_walk_forward_class(
            strategy=_make_dummy_strategy(),
            start_date="2026-01-01", end_date="2026-04-01",
            n_splits=4, is_ratio=0.5,
            # deep-scan #22 FIX 2 (2026-07-06): run_walk_forward_class() now
            # honors WF_MODE (institutional default "cpcv") instead of
            # silently always running plain WF. This suite tests the B-5
            # PLAIN-mode WFE/BIF/PBO/DSR aggregation contract specifically
            # (window-count assertions, plain-mode wfe_status vocabulary) —
            # pin wf_mode="plain" explicitly so it keeps testing that path
            # regardless of the new default. CPCV-mode's parallel contract is
            # covered by test_deepscan22_fix2_class_cpcv_routing.py.
            wf_mode="plain",
        )
        assert result.get("wfe_status") in ("pass", "warn", "fail", "degenerate_is")

    def test_bif_and_k_eff_present(self, monkeypatch):
        from src.engine.walk_forward import run_walk_forward_class

        _install_common_mocks(
            monkeypatch,
            oos_daily_pnls=[6.0, -4.0, 7.0, 3.0, -1.0, 5.0],
            is_daily_pnls=[4.0, -3.0, 5.0, 2.0, -2.0, 3.0],
        )
        result = run_walk_forward_class(
            strategy=_make_dummy_strategy(),
            start_date="2026-01-01", end_date="2026-04-01",
            n_splits=4, is_ratio=0.5,
            # deep-scan #22 FIX 2 (2026-07-06): run_walk_forward_class() now
            # honors WF_MODE (institutional default "cpcv") instead of
            # silently always running plain WF. This suite tests the B-5
            # PLAIN-mode WFE/BIF/PBO/DSR aggregation contract specifically
            # (window-count assertions, plain-mode wfe_status vocabulary) —
            # pin wf_mode="plain" explicitly so it keeps testing that path
            # regardless of the new default. CPCV-mode's parallel contract is
            # covered by test_deepscan22_fix2_class_cpcv_routing.py.
            wf_mode="plain",
        )
        assert "bif" in result, (
            "B-5 REGRESSION: bif key absent — TS bif-gate.ts will "
            "grandfather-pass every archetype strategy"
        )
        assert "k_eff" in result
        assert result["k_eff"] is not None
        assert result["k_eff"] >= 1

    def test_pbo_overall_present_with_four_plus_windows(self, monkeypatch):
        from src.engine.walk_forward import run_walk_forward_class

        _install_common_mocks(
            monkeypatch,
            oos_daily_pnls=[6.0, -4.0, 7.0, 3.0, -1.0, 5.0],
            is_daily_pnls=[4.0, -3.0, 5.0, 2.0, -2.0, 3.0],
        )
        result = run_walk_forward_class(
            strategy=_make_dummy_strategy(),
            start_date="2026-01-01", end_date="2026-04-01",
            n_splits=4, is_ratio=0.5,
            # deep-scan #22 FIX 2 (2026-07-06): run_walk_forward_class() now
            # honors WF_MODE (institutional default "cpcv") instead of
            # silently always running plain WF. This suite tests the B-5
            # PLAIN-mode WFE/BIF/PBO/DSR aggregation contract specifically
            # (window-count assertions, plain-mode wfe_status vocabulary) —
            # pin wf_mode="plain" explicitly so it keeps testing that path
            # regardless of the new default. CPCV-mode's parallel contract is
            # covered by test_deepscan22_fix2_class_cpcv_routing.py.
            wf_mode="plain",
        )
        assert "pbo_overall" in result, (
            "B-5 REGRESSION: pbo_overall key absent — TS pbo-gate.ts will "
            "grandfather-pass every archetype strategy at TESTING -> SHADOW/PAPER"
        )
        assert "pbo_degenerate" in result

    def test_wf_metadata_dsr_pass_present(self, monkeypatch):
        from src.engine.walk_forward import run_walk_forward_class

        _install_common_mocks(
            monkeypatch,
            oos_daily_pnls=[6.0, -4.0, 7.0, 3.0, -1.0, 5.0],
            is_daily_pnls=[4.0, -3.0, 5.0, 2.0, -2.0, 3.0],
        )
        result = run_walk_forward_class(
            strategy=_make_dummy_strategy(),
            start_date="2026-01-01", end_date="2026-04-01",
            n_splits=4, is_ratio=0.5,
            # deep-scan #22 FIX 2 (2026-07-06): run_walk_forward_class() now
            # honors WF_MODE (institutional default "cpcv") instead of
            # silently always running plain WF. This suite tests the B-5
            # PLAIN-mode WFE/BIF/PBO/DSR aggregation contract specifically
            # (window-count assertions, plain-mode wfe_status vocabulary) —
            # pin wf_mode="plain" explicitly so it keeps testing that path
            # regardless of the new default. CPCV-mode's parallel contract is
            # covered by test_deepscan22_fix2_class_cpcv_routing.py.
            wf_mode="plain",
        )
        assert "wf_metadata" in result
        meta = result["wf_metadata"]
        assert "dsr_pass" in meta, (
            "B-5 REGRESSION: wf_metadata.dsr_pass absent — the Wave 24 "
            "dsr_honest-style consumers will grandfather-pass"
        )
        assert "dsr" in meta
        assert isinstance(meta.get("dsr_unavailable"), bool)


class TestB5InternalFieldNotLeaked:
    """Schema stability: the '_is_daily_pnls' internal stash used to compute
    WFE/BIF/PBO must never reach the schema output (mirrors run_walk_forward()'s
    own cleanup contract)."""

    def test_is_daily_pnls_not_in_windows_output(self, monkeypatch):
        from src.engine.walk_forward import run_walk_forward_class

        _install_common_mocks(
            monkeypatch,
            oos_daily_pnls=[6.0, -4.0, 7.0, 3.0, -1.0, 5.0],
            is_daily_pnls=[4.0, -3.0, 5.0, 2.0, -2.0, 3.0],
        )
        result = run_walk_forward_class(
            strategy=_make_dummy_strategy(),
            start_date="2026-01-01", end_date="2026-04-01",
            n_splits=4, is_ratio=0.5,
            # deep-scan #22 FIX 2 (2026-07-06): run_walk_forward_class() now
            # honors WF_MODE (institutional default "cpcv") instead of
            # silently always running plain WF. This suite tests the B-5
            # PLAIN-mode WFE/BIF/PBO/DSR aggregation contract specifically
            # (window-count assertions, plain-mode wfe_status vocabulary) —
            # pin wf_mode="plain" explicitly so it keeps testing that path
            # regardless of the new default. CPCV-mode's parallel contract is
            # covered by test_deepscan22_fix2_class_cpcv_routing.py.
            wf_mode="plain",
        )
        for w in result["windows"]:
            assert "_is_daily_pnls" not in w, (
                "Internal field '_is_daily_pnls' leaked into schema output windows[]"
            )


class TestB5DegenerateIsFallback:
    """When the per-window IS-only backtest yields no usable daily P&Ls, the
    function must emit the explicit degenerate_is sentinel (wfe_overall=0.0,
    wfe_status='degenerate_is') — the same fail-CLOSED contract
    run_walk_forward() uses — rather than silently leaving the key absent."""

    def test_empty_is_pnls_yields_degenerate_is_sentinel(self, monkeypatch):
        from src.engine.walk_forward import run_walk_forward_class

        _install_common_mocks(
            monkeypatch,
            oos_daily_pnls=[6.0, -4.0, 7.0, 3.0, -1.0, 5.0],
            is_daily_pnls=[],  # IS backtest returns no daily P&Ls
        )
        result = run_walk_forward_class(
            strategy=_make_dummy_strategy(),
            start_date="2026-01-01", end_date="2026-04-01",
            n_splits=4, is_ratio=0.5,
            # deep-scan #22 FIX 2 (2026-07-06): run_walk_forward_class() now
            # honors WF_MODE (institutional default "cpcv") instead of
            # silently always running plain WF. This suite tests the B-5
            # PLAIN-mode WFE/BIF/PBO/DSR aggregation contract specifically
            # (window-count assertions, plain-mode wfe_status vocabulary) —
            # pin wf_mode="plain" explicitly so it keeps testing that path
            # regardless of the new default. CPCV-mode's parallel contract is
            # covered by test_deepscan22_fix2_class_cpcv_routing.py.
            wf_mode="plain",
        )
        assert result["wfe_overall"] == 0.0
        assert result["wfe_status"] == "degenerate_is"


class TestB5IsBacktestActuallyInvoked:
    """Plumbing proof: run_walk_forward_class must actually call
    run_class_backtest a SECOND time per window (the new IS-only eval),
    not just the pre-existing OOS call."""

    def test_run_class_backtest_called_for_both_is_and_oos_per_window(self, monkeypatch):
        from src.engine.walk_forward import run_walk_forward_class

        call_log = _install_common_mocks(
            monkeypatch,
            oos_daily_pnls=[6.0, -4.0, 7.0, 3.0, -1.0, 5.0],
            is_daily_pnls=[4.0, -3.0, 5.0, 2.0, -2.0, 3.0],
        )
        run_walk_forward_class(
            strategy=_make_dummy_strategy(),
            start_date="2026-01-01", end_date="2026-04-01",
            n_splits=4, is_ratio=0.5,
            # deep-scan #22 FIX 2 (2026-07-06): run_walk_forward_class() now
            # honors WF_MODE (institutional default "cpcv") instead of
            # silently always running plain WF. This suite tests the B-5
            # PLAIN-mode WFE/BIF/PBO/DSR aggregation contract specifically
            # (window-count assertions, plain-mode wfe_status vocabulary) —
            # pin wf_mode="plain" explicitly so it keeps testing that path
            # regardless of the new default. CPCV-mode's parallel contract is
            # covered by test_deepscan22_fix2_class_cpcv_routing.py.
            wf_mode="plain",
        )
        oos_calls = [c for c in call_log if c.get("warmup_data") is not None]
        is_calls = [c for c in call_log if c.get("warmup_data") is None]
        assert len(oos_calls) == 4, f"Expected 4 OOS calls (one per window), got {len(oos_calls)}"
        assert len(is_calls) == 4, (
            f"B-5 REGRESSION: expected 4 IS-only calls (one per window) feeding "
            f"WFE/BIF/PBO, got {len(is_calls)}"
        )
