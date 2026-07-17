"""goalscan-crit 2026-07-16 — RED-proof regression tests for two backtester
defects fixed this session (worktree wt-goalscan-crit-20260716). Scope-locked:
touches only src/engine/backtester.py + src/engine/config.py (source) and this
new test file. vectorbt is mocked at sys.modules level throughout — the tower's
lazy-import-inside-function pattern means importing backtester.py never touches
real vectorbt, but the JIT-triggering call itself (vbt.Portfolio.from_signals)
must be stubbed before it runs.

DEFECT 1 (HIGH): the DSL path (`run_backtest()`, `_apply_trade_management()`
call ~line 5121) wrapped the call in a bare `except Exception`, which silently
swallowed `ZeroVolumeOnTradeCriticalBar` (a RuntimeError subclass raised by the
documented BACKTEST_ZERO_VOLUME_TRADE_CRITICAL_FAIL_LOUD=true fail-loud
contract) along with every other error, reverting the ENTIRE run to unmanaged
vectorbt raw-close exits with no audit trail. The class path
(`run_class_backtest()`, same call ~line 7312) has no such try/except and
already lets the exception propagate — the two paths behaved inconsistently
for the identical trigger. Fix: an `except ZeroVolumeOnTradeCriticalBar: raise`
clause ahead of the generic `except Exception` re-raises the specific
data-integrity signal while preserving the broad catch-all for everything else.

  TestDefect1ZeroVolumeCriticalPropagates::
    test_real_zero_volume_stop_bar_raises_through_run_backtest — end-to-end,
      NOT monkeypatched: a real OHLCV frame with one zero-volume bar sitting
      exactly on the fixed trade's stop-trigger bar. Exercises the actual
      check_zero_volume_trade_critical() guard inside the real
      _apply_trade_management() call, invoked through run_backtest() itself.
    test_generic_error_in_trade_management_still_swallowed — control: any
      OTHER exception type raised inside _apply_trade_management() must still
      be swallowed (non-fatal fallback preserved) — proves the fix narrows the
      except clause rather than breaking the existing resilience contract.
    test_class_path_already_propagates_consistently — documents (does not
      re-fix) that run_class_backtest() has no such try/except and already
      raises — the two paths are now consistent BY CONSTRUCTION, not by a
      second fix.

DEFECT 2 (HIGH): `StrategyConfig.validate_symbol()` accepts "ES"/"NQ"/"CL"
(they're in VALID_SYMBOLS = set(CONTRACT_SPECS.keys()) for S3 data-path
compat), and both `run_backtest()` (~line 3671) and `run_class_backtest()`
(~line 6688) resolved the ContractSpec via a raw `CONTRACT_SPECS[symbol]` dict
index — bypassing the two documented safety helpers (`get_contract_spec()`,
which emits a UserWarning for the 3 micro-alias symbols, and
`resolve_contract_spec()`, the Phase-5-aware gate). Result: a strategy
mis-configured with symbol="ES" backtests at MICRO economics ($5/pt) but is
labeled full-size ES to every downstream consumer, silently, with no warning
and no gate. Fix: both call sites now resolve via `get_contract_spec()` —
byte-identical point values for every symbol (including the 3 aliases), but a
UserWarning now fires for ES/NQ/CL specifically.

  TestDefect2FullSizeSymbolWarns::
    test_es_symbol_warns_on_run_backtest — full end-to-end: StrategyConfig
      symbol="ES" run through run_backtest() emits the UserWarning; the
      backtest still completes (byte-identical continuation, not a hard
      refusal — matches the documented "warn" contract for the current
      PHASE_5_ENABLED=False / no-contract_class-field state).
    test_mes_symbol_does_not_warn_on_run_backtest — control: symbol="MES"
      produces zero UserWarnings and completes identically.
    test_get_contract_spec_point_values_unchanged — unit-level: get_contract_spec
      returns byte-identical point_value for ES/MES/NQ/MNQ/CL/MCL versus the
      raw CONTRACT_SPECS dict (proves the swap is a pure visibility fix, not a
      value change).
"""

from __future__ import annotations

import sys
import warnings
from datetime import datetime, timedelta
from unittest.mock import MagicMock

import pandas as pd
import polars as pl
import pytest

# ─── shared vectorbt mock scaffolding (mirrors test_gate3_sibling_parity_guard.py) ──


def _install_vbt_mock(portfolio_factory):
    """Install a vectorbt stub whose Portfolio.from_signals() is driven by
    `portfolio_factory(**kwargs)`. Covers vectorbt / vectorbt.portfolio /
    vectorbt.portfolio.base — the same trio the tower's other mocked-vectorbt
    engine tests stub, since backtester.py's lazy `import vectorbt as vbt`
    resolves against whichever of these sys.modules entries it hits first.
    """
    _vbt_mock = MagicMock()
    _vbt_mock.Portfolio.from_signals = MagicMock(side_effect=lambda **kw: portfolio_factory(**kw))
    for mod in ("vectorbt", "vectorbt.portfolio", "vectorbt.portfolio.base"):
        sys.modules[mod] = _vbt_mock
    return _vbt_mock


class _FakeTrades:
    def __init__(self, records_df):
        self._df = records_df

    def count(self):
        return len(self._df)

    @property
    def records_readable(self):
        return self._df


class _FakePortfolio:
    def __init__(self, records_df):
        self.trades = _FakeTrades(records_df)


def _zero_trade_portfolio(**_kw):
    """Fake portfolio with zero trades — records_readable never accessed."""
    return _FakePortfolio(pd.DataFrame())


def _fixed_trade_portfolio_factory(entry_idx: int, exit_idx: int, entry_price: float, exit_price: float):
    def _factory(**_kw):
        df = pd.DataFrame([{
            "Entry Idx": entry_idx,
            "Exit Idx": exit_idx,
            "Avg Entry Price": entry_price,
            "Avg Exit Price": exit_price,
            "Size": 1.0,
            "Direction": "Long",
        }])
        return _FakePortfolio(df)
    return _factory


def _make_shared_config(symbol: str = "MES"):
    from src.engine.config import IndicatorConfig, PositionSizeConfig, StopConfig, StrategyConfig

    return StrategyConfig(
        name="goalscan-crit defect regression",
        symbol=symbol,
        timeframe="daily",
        indicators=[
            IndicatorConfig(type="sma", period=5),
            IndicatorConfig(type="sma", period=15),
            IndicatorConfig(type="atr", period=14),
        ],
        entry_long="close > 9999999",  # never fires — fixed/zero trades come from the vbt mock
        entry_short="high < low",  # never-true sentinel (W23F.L convention)
        exit="close crosses_below sma_15",
        stop_loss=StopConfig(type="atr", multiplier=2.0),
        position_size=PositionSizeConfig(type="dynamic_atr", target_risk_dollars=500),
    )


def _run(monkeypatch, config, df: pl.DataFrame):
    import src.engine.backtester as backtester_module
    from src.engine.config import BacktestRequest

    def _raise_load_ohlcv(*a, **k):
        raise FileNotFoundError("test: no real data source available")

    monkeypatch.setattr(backtester_module, "load_ohlcv", _raise_load_ohlcv)

    request = BacktestRequest(strategy=config, start_date="2023-01-01", end_date="2023-12-31")
    return backtester_module.run_backtest(request, data=df, use_eligibility_gate=False)


# ─── Defect 1 fixtures: real OHLCV with a genuine zero-volume stop-trigger bar ──

_ENTRY_IDX = 20
_STOP_BAR = 21  # entry_idx + 1 -> first bar the management loop evaluates
_EXIT_IDX = 35
_N_BARS = 45
_ENTRY_PRICE = 5000.0


def _make_zero_volume_stop_scenario() -> pl.DataFrame:
    """A flat OHLCV series (TR=2.0 constant -> stable ATR after warmup) with a
    single deliberate low-side spike at `_STOP_BAR` that breaches the initial
    stop (risk_points = min(14, ATR*1.5) ~= 3.0 on this fixture — the spike
    drops 10pts, far beyond any plausible stop distance the ceiling allows) —
    and `_STOP_BAR` carries volume=0. All other bars carry nonzero volume and
    stay well inside both the stop and TP1 bands so the guard fires on
    exactly the one bar under test, not earlier.
    """
    dates = [datetime(2023, 1, 1) + timedelta(days=i) for i in range(_N_BARS)]
    closes = [_ENTRY_PRICE] * _N_BARS
    highs = [_ENTRY_PRICE + 1.0] * _N_BARS
    lows = [_ENTRY_PRICE - 1.0] * _N_BARS
    volumes = [5000.0] * _N_BARS

    lows[_STOP_BAR] = _ENTRY_PRICE - 10.0  # breaches any plausible stop
    volumes[_STOP_BAR] = 0.0

    return pl.DataFrame({
        "ts_event": dates,
        "open": closes,
        "high": highs,
        "low": lows,
        "close": closes,
        "volume": volumes,
    })


class TestDefect1ZeroVolumeCriticalPropagates:
    def test_real_zero_volume_stop_bar_raises_through_run_backtest(self, monkeypatch):
        from src.engine.data_loader import ZeroVolumeOnTradeCriticalBar

        monkeypatch.setenv("BACKTEST_ZERO_VOLUME_TRADE_CRITICAL_FAIL_LOUD", "true")
        _install_vbt_mock(
            _fixed_trade_portfolio_factory(_ENTRY_IDX, _EXIT_IDX, _ENTRY_PRICE, _ENTRY_PRICE)
        )
        config = _make_shared_config("MES")
        df = _make_zero_volume_stop_scenario()

        with pytest.raises(ZeroVolumeOnTradeCriticalBar):
            _run(monkeypatch, config, df)

    def test_generic_error_in_trade_management_still_swallowed(self, monkeypatch):
        """Control: a non-ZeroVolume exception raised inside
        _apply_trade_management() must still be caught by the broad
        `except Exception` fallback — the fix narrows the except clause, it
        does not remove the existing non-fatal-fallback resilience."""
        import src.engine.backtester as backtester_module

        def _raise_generic(*a, **k):
            raise RuntimeError("unrelated internal error")

        monkeypatch.setattr(backtester_module, "_apply_trade_management", _raise_generic)
        _install_vbt_mock(
            _fixed_trade_portfolio_factory(_ENTRY_IDX, _EXIT_IDX, _ENTRY_PRICE, _ENTRY_PRICE)
        )
        config = _make_shared_config("MES")
        df = _make_zero_volume_stop_scenario()

        # Must NOT raise — falls back to unmanaged vectorbt prices, same as
        # pre-fix behavior for any error that is not the fail-loud signal.
        result = _run(monkeypatch, config, df)
        assert result["total_trades"] == 1

    def test_class_path_already_propagates_consistently(self, monkeypatch):
        """Documents (does not re-fix) that run_class_backtest() has no
        try/except around its _apply_trade_management() call — the DSL-path
        fix makes the two paths consistent by construction, not by touching
        the class path a second time."""
        import inspect

        import src.engine.backtester as backtester_module

        source = inspect.getsource(backtester_module.run_class_backtest)
        # The class path's call site must not be preceded by a bare `try:`
        # immediately wrapping it — i.e. no swallow-and-continue behavior.
        call_site_idx = source.index("_apply_trade_management(")
        preceding = source[:call_site_idx]
        # last non-blank line before the call must not open a try-block for it
        last_lines = [ln for ln in preceding.splitlines() if ln.strip()][-3:]
        assert not any(ln.strip() == "try:" for ln in last_lines), (
            "run_class_backtest()'s _apply_trade_management() call appears to "
            "now be wrapped in a try/except — this would reintroduce the "
            "cross-path inconsistency Defect 1 closed."
        )


# ─── Defect 2 ────────────────────────────────────────────────────────────────


def _make_flat_ohlcv(n: int = 30) -> pl.DataFrame:
    dates = [datetime(2023, 1, 1) + timedelta(days=i) for i in range(n)]
    closes = [5000.0 + i * 0.1 for i in range(n)]
    return pl.DataFrame({
        "ts_event": dates,
        "open": [c - 0.25 for c in closes],
        "high": [c + 1.5 for c in closes],
        "low": [c - 1.5 for c in closes],
        "close": closes,
        "volume": [50000.0] * n,
    })


class TestDefect2FullSizeSymbolWarns:
    def test_es_symbol_warns_on_run_backtest(self, monkeypatch):
        _install_vbt_mock(_zero_trade_portfolio)
        config = _make_shared_config("ES")
        df = _make_flat_ohlcv()

        with pytest.warns(UserWarning, match="MICRO"):
            result = _run(monkeypatch, config, df)

        assert result["total_trades"] == 0

    def test_mes_symbol_does_not_warn_on_run_backtest(self, monkeypatch):
        _install_vbt_mock(_zero_trade_portfolio)
        config = _make_shared_config("MES")
        df = _make_flat_ohlcv()

        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            result = _run(monkeypatch, config, df)

        micro_warnings = [w for w in caught if issubclass(w.category, UserWarning) and "MICRO" in str(w.message)]
        assert micro_warnings == [], f"MES must not trigger the micro-alias warning, got: {micro_warnings}"
        assert result["total_trades"] == 0

    def test_get_contract_spec_point_values_unchanged(self):
        """The swap from raw CONTRACT_SPECS[symbol] indexing to
        get_contract_spec(symbol) must be a pure visibility fix — identical
        point_value/tick_size for every symbol the backtester resolves,
        alias or not."""
        from src.engine.config import CONTRACT_SPECS, get_contract_spec

        for symbol in ("MES", "MNQ", "MCL", "ES", "NQ", "CL"):
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                resolved = get_contract_spec(symbol)
            raw = CONTRACT_SPECS[symbol]
            assert resolved.point_value == raw.point_value, symbol
            assert resolved.tick_size == raw.tick_size, symbol
