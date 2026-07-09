"""Failure-injection regression test — deep-scan #22 FIX 2 (CRITICAL).

BUG: `run_walk_forward_class()` — the PRIMARY product path used by every
archetype/class-based strategy (bounce_off_level, ict_bias_aligned_continuation,
silver_bullet, crt, power_of_3, i.e. the live 117-strategy library, invoked
from backtester.py main()) — called `split_walk_forward_windows()`
UNCONDITIONALLY, completely ignoring `WF_MODE=cpcv` (the documented
institutional default `run_walk_forward()`/the DSL path already honors since
the 2026-06-22 hardening pass). Every class-strategy walk-forward silently
downgraded to plain WF with embargo/purge NEVER applied via CPCV, and with
NO audit trail of the downgrade.

FIX: `run_walk_forward_class()` now resolves `WF_MODE` exactly like
`run_walk_forward()` (explicit `wf_mode` param > `WF_MODE` env > "cpcv"
default), dispatches to the new `_run_walk_forward_cpcv_class()` when CPCV
is resolved and data is sufficient, and auto-falls-back to plain with an
explicit `walk_forward.cpcv_insufficient_data_fallback` audit signal when
data is too short for CPCV — never a silent downgrade.

These tests mock `load_ohlcv` + `run_class_backtest` (same isolation pattern
as `test_deepscan17_b5_class_wf_gates.py`) — no real backtest or market data
dependency, no vectorbt/vectorbt-JIT import hang risk.

Run targeted:
    python -m pytest src/engine/tests/test_deepscan22_fix2_class_cpcv_routing.py -v
"""
from __future__ import annotations


def _build_synthetic_ohlcv(n: int):
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
        name = "bounce_off_level"
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


def _install_common_mocks(monkeypatch, oos_bars_len: int, oos_daily_pnls, is_daily_pnls):
    """Mocks load_ohlcv + run_class_backtest so run_walk_forward_class() runs
    end-to-end without real data or a real backtest — same discriminator
    pattern as test_deepscan17_b5_class_wf_gates.py: OOS calls always pass
    warmup_data (non-None); the lightweight per-path IS-only call never does.
    """
    synthetic = _build_synthetic_ohlcv(oos_bars_len)

    def _fake_load_ohlcv(symbol, timeframe, start_date, end_date):
        if timeframe == "daily":
            return synthetic.head(50)  # < 200 rows -> htf_cache stays None
        return synthetic

    monkeypatch.setattr("src.engine.data_loader.load_ohlcv", _fake_load_ohlcv)

    call_log: list[dict] = []

    def _fake_run_class_backtest(**kwargs):
        call_log.append(kwargs)
        is_warmup_call = kwargs.get("warmup_data") is None
        if is_warmup_call:
            daily_pnls = list(is_daily_pnls)
            records = []
        else:
            daily_pnls = list(oos_daily_pnls)
            records = [
                {"date": f"2026-{(d % 9) + 1:02d}-{(d % 27) + 1:02d}", "pnl": p}
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
        }

    monkeypatch.setattr("src.engine.walk_forward.run_class_backtest", _fake_run_class_backtest)
    return call_log


class TestFix2CpcvIsAppliedWhenRequested:
    """Core FIX 2 contract: WF_MODE=cpcv (or unset -> default) must route the
    class path through the new CPCV splitter with real purge/embargo, not
    silently run plain WF."""

    def test_default_wf_mode_routes_to_cpcv_with_sufficient_data(self, monkeypatch):
        """Sufficient data (1000 bars / 6 folds ~= 166 bars/fold >= 60 min) +
        WF_MODE unset (institutional default 'cpcv') MUST produce
        wf_metadata.mode == 'cpcv' with n_paths > 0 (real CPCV combinatorial
        paths, not the plain windows engine).

        THIS IS THE FAILURE-INJECTION ASSERTION: pre-FIX-2 code always
        returns wf_metadata.mode == 'plain' here regardless of WF_MODE —
        proven by the before/after run recorded in the fix commit message.
        """
        from src.engine.walk_forward import run_walk_forward_class

        monkeypatch.delenv("WF_MODE", raising=False)
        _install_common_mocks(
            monkeypatch,
            oos_bars_len=1000,
            oos_daily_pnls=[6.0, -4.0, 7.0, 3.0, -1.0, 5.0],
            is_daily_pnls=[4.0, -3.0, 5.0, 2.0, -2.0, 3.0],
        )
        result = run_walk_forward_class(
            strategy=_make_dummy_strategy(),
            start_date="2026-01-01", end_date="2026-04-01",
        )
        assert result["wf_metadata"]["mode"] == "cpcv", (
            "FIX 2 REGRESSION: run_walk_forward_class() did not route to CPCV "
            "despite sufficient data and no explicit plain override — the "
            "class path (the PRIMARY archetype/class-strategy product path) "
            "is silently downgrading WF_MODE=cpcv again."
        )
        assert result["wf_metadata"]["n_paths"] > 0, (
            "CPCV mode must report n_paths > 0 (C(6,2)=15 combinatorial paths "
            "by default) — 0 paths means the CPCV splitter silently produced "
            "nothing usable."
        )
        assert result["wf_metadata"].get("purge_window") is not None, (
            "CPCV mode must carry an embargo/purge_window value in wf_metadata."
        )

    def test_explicit_wf_mode_cpcv_routes_to_cpcv(self, monkeypatch):
        """Explicit wf_mode='cpcv' must also route to CPCV (not just the env default)."""
        from src.engine.walk_forward import run_walk_forward_class

        _install_common_mocks(
            monkeypatch,
            oos_bars_len=1000,
            oos_daily_pnls=[6.0, -4.0, 7.0, 3.0, -1.0, 5.0],
            is_daily_pnls=[4.0, -3.0, 5.0, 2.0, -2.0, 3.0],
        )
        result = run_walk_forward_class(
            strategy=_make_dummy_strategy(),
            start_date="2026-01-01", end_date="2026-04-01",
            wf_mode="cpcv",
        )
        assert result["wf_metadata"]["mode"] == "cpcv"

    def test_explicit_wf_mode_plain_still_works_backward_compat(self, monkeypatch):
        """Explicit wf_mode='plain' must preserve the legacy plain-WF path
        byte-identically (backward compat for existing callers/tests)."""
        from src.engine.walk_forward import run_walk_forward_class

        _install_common_mocks(
            monkeypatch,
            oos_bars_len=1000,
            oos_daily_pnls=[6.0, -4.0, 7.0, 3.0, -1.0, 5.0],
            is_daily_pnls=[4.0, -3.0, 5.0, 2.0, -2.0, 3.0],
        )
        result = run_walk_forward_class(
            strategy=_make_dummy_strategy(),
            start_date="2026-01-01", end_date="2026-04-01",
            n_splits=4, is_ratio=0.5,
            wf_mode="plain",
        )
        assert result["wf_metadata"]["mode"] == "plain"
        assert len(result["windows"]) == 4


class TestFix2InsufficientDataFallsBackNotSilently:
    """CPCV requested but data too short for CPCV MUST fall back to plain —
    never silently error, and never silently stay on an unrequested mode
    without an audit trail (the audit itself is best-effort/non-blocking per
    the existing `_run_walk_forward_cpcv`'s established pattern — this test
    verifies the FUNCTIONAL fallback, which is the promotion-safety-critical
    half of the contract)."""

    def test_short_data_auto_falls_back_to_plain(self, monkeypatch):
        """200 bars / 6 folds = 33 bars/fold < 60 min -> must fall back to
        plain WF (not raise, not silently produce a broken CPCV result)."""
        from src.engine.walk_forward import run_walk_forward_class

        monkeypatch.setenv("WF_MODE", "cpcv")
        _install_common_mocks(
            monkeypatch,
            oos_bars_len=200,
            oos_daily_pnls=[6.0, -4.0, 7.0, 3.0, -1.0, 5.0],
            is_daily_pnls=[4.0, -3.0, 5.0, 2.0, -2.0, 3.0],
        )
        result = run_walk_forward_class(
            strategy=_make_dummy_strategy(),
            start_date="2026-01-01", end_date="2026-04-01",
            n_splits=3, is_ratio=0.5,
        )
        assert result["wf_metadata"]["mode"] == "plain", (
            "Insufficient data for CPCV must fall back to plain WF, not error "
            "and not silently emit a degenerate CPCV result."
        )


class TestFix2ProducerKeysStillEmitOnCpcvPath:
    """Mandate: wfe_overall / pbo_overall / bif / k_eff must all still emit
    at the TOP LEVEL on the CPCV class path so wfe-gate.ts / bif-gate.ts /
    pbo-gate.ts keep reading them (same contract the 2026-07-05 B-5 fix
    established for the plain-mode class path)."""

    def test_wfe_overall_bif_k_eff_pbo_overall_present(self, monkeypatch):
        from src.engine.walk_forward import run_walk_forward_class

        _install_common_mocks(
            monkeypatch,
            oos_bars_len=1000,
            oos_daily_pnls=[6.0, -4.0, 7.0, 3.0, -1.0, 5.0],
            is_daily_pnls=[4.0, -3.0, 5.0, 2.0, -2.0, 3.0],
        )
        result = run_walk_forward_class(
            strategy=_make_dummy_strategy(),
            start_date="2026-01-01", end_date="2026-04-01",
            wf_mode="cpcv",
        )
        assert result["wf_metadata"]["mode"] == "cpcv"
        assert "wfe_overall" in result, (
            "wfe_overall absent on CPCV class path — wfe-gate.ts will "
            "grandfather-pass every archetype strategy walk-forwarded via CPCV."
        )
        assert "pbo_overall" in result, (
            "pbo_overall absent on CPCV class path — pbo-gate.ts will "
            "grandfather-pass."
        )
        assert "bif" in result, (
            "bif absent on CPCV class path — bif-gate.ts will grandfather-pass."
        )
        assert "k_eff" in result and result["k_eff"] is not None and result["k_eff"] >= 1
        assert isinstance(result["wf_metadata"].get("n_paths"), int)
        assert "dsr" in result["wf_metadata"]
        assert "dsr_pass" in result["wf_metadata"]

    def test_run_class_backtest_actually_invoked_for_oos_and_is(self, monkeypatch):
        """Confirms the CPCV class path really dispatches through
        run_class_backtest() (both OOS-per-path and lightweight IS-per-path
        calls) rather than falling through to a no-op."""
        from src.engine.walk_forward import run_walk_forward_class

        call_log = _install_common_mocks(
            monkeypatch,
            oos_bars_len=1000,
            oos_daily_pnls=[6.0, -4.0, 7.0, 3.0, -1.0, 5.0],
            is_daily_pnls=[4.0, -3.0, 5.0, 2.0, -2.0, 3.0],
        )
        run_walk_forward_class(
            strategy=_make_dummy_strategy(),
            start_date="2026-01-01", end_date="2026-04-01",
            wf_mode="cpcv",
        )
        oos_calls = [c for c in call_log if c.get("warmup_data") is not None]
        is_calls = [c for c in call_log if c.get("warmup_data") is None]
        # C(6,2) = 15 combinatorial paths -> up to 15 OOS calls (some may be
        # skipped if a fold purges to zero-length, which should not happen
        # with 1000 bars / 6 folds).
        assert len(oos_calls) > 0, "No OOS run_class_backtest() calls made — CPCV path did not execute."
        assert len(is_calls) > 0, "No per-path IS run_class_backtest() calls made — BIF/PBO IS basis unavailable."
