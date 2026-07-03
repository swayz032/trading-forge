"""deepscan14 Track 4 — regression tests for:

B1 — DSL 15:55 ET hard-flatten never fired for exec timeframes whose bar grid
     doesn't land on the :55 minute (15m/30m/1h/4h grids run
     ...15:30, 15:45, 16:00 — the literal "15:55" substring never appears).
     Fixed via `_et_time_ge_flatten()` (inequality, not equality) in
     `_apply_dsl_stop_loss_and_time_stop()`.

B2 — Commission sentinel ambiguity: `commission_per_side` default 0.62 collided
     with an explicit `commission_per_side=0.62` (no firm_key), silently
     overriding the explicit value with the contract-spec default. Fixed via
     `model_fields_set` disambiguation (run_backtest) and an unambiguous
     `None` default (run_class_backtest).

NOTE: backtester.py imports vectorbt — mock before importing (mirrors the
existing pattern in test_fix6_dsl_dst_time_stop.py).
"""

from __future__ import annotations

import sys
from unittest.mock import MagicMock


def _install_vbt_mock():
    _vbt_mock = MagicMock()
    _vbt_mock.Portfolio = MagicMock()
    for mod in ("vectorbt", "vectorbt.portfolio", "vectorbt.portfolio.base"):
        if mod not in sys.modules:
            sys.modules[mod] = _vbt_mock
    return _vbt_mock


_install_vbt_mock()

import numpy as np  # noqa: E402
import polars as pl  # noqa: E402
import pytest  # noqa: E402


def _make_arrays(
    n: int,
    entry_bar: int,
    entry_p: float = 5000.0,
    risk_points: float = 4.0,
):
    """Build minimal signal arrays + price arrays for _apply_dsl_stop_loss_and_time_stop.

    Mirrors the helper in test_fix6_dsl_dst_time_stop.py.
    """
    entry_long = np.zeros(n, dtype=bool)
    exit_long = np.zeros(n, dtype=bool)
    entry_short = np.zeros(n, dtype=bool)
    exit_short = np.zeros(n, dtype=bool)

    entry_long[entry_bar] = True

    # ATR that yields a stop distance well below the MES ceiling (14pt).
    atr_np = np.full(n, risk_points / 1.5)  # stop_dist = 1.5 * ATR = risk_points

    close_np = np.full(n, entry_p)
    high_np = np.full(n, entry_p + 0.5)
    low_np = np.full(n, entry_p - 0.5)

    return entry_long, exit_long, entry_short, exit_short, high_np, low_np, atr_np, close_np


def _make_controlled_ohlcv(closes: list[float], spread: float = 5.0) -> pl.DataFrame:
    """Create daily OHLCV data with exact controlled closes for deterministic
    testing. Mirrors test_pnl_accuracy.py::_make_controlled_ohlcv (same
    fixture shape already proven to produce closeable trades via
    run_backtest for this exact SMA-crossover strategy config)."""
    from datetime import datetime, timedelta
    base_date = datetime(2023, 6, 1)
    n = len(closes)
    dates = [base_date + timedelta(days=i) for i in range(n)]
    return pl.DataFrame({
        "ts_event": dates,
        "open": [c - 1.0 for c in closes],
        "high": [c + spread for c in closes],
        "low": [c - spread for c in closes],
        "close": closes,
        "volume": [100_000] * n,
    })


class TestDSLFlattenNonExactMinuteGrids:
    """B1 — 15:55 ET hard flatten must fire on the FIRST bar >= 15:55, not only
    on an exact "15:55" substring match."""

    def _load_fn(self):
        from src.engine.backtester import _apply_dsl_stop_loss_and_time_stop
        return _apply_dsl_stop_loss_and_time_stop

    def test_15m_grid_never_hits_55_minute_flattens_at_1600(self):
        """15m bar grid: ...15:15, 15:30, 15:45, 16:00 — no bar ever reads
        "15:55". Pre-fix: is_1555 was always False, position rides past the
        close. Post-fix: the 16:00 bar (first bar >= 15:55) flattens it."""
        fn = self._load_fn()
        et_timestamps = [
            "2026-01-15 09:30:00",  # entry
            "2026-01-15 15:15:00",  # quiet
            "2026-01-15 15:30:00",  # quiet
            "2026-01-15 15:45:00",  # quiet — must NOT flatten
            "2026-01-15 16:00:00",  # first bar >= 15:55 — MUST flatten here
        ]
        utc_timestamps = et_timestamps  # value irrelevant when ts_et_timestamps supplied
        n = len(et_timestamps)
        entry_bar = 0

        el, xl, es, xs, h, l, atr, c = _make_arrays(n, entry_bar)

        el_out, xl_out, es_out, xs_out, meta = fn(
            entry_long=el,
            exit_long=xl,
            entry_short=es,
            exit_short=xs,
            high_np=h,
            low_np=l,
            atr_np=atr,
            timestamps=np.array(utc_timestamps),
            symbol="MES",
            close_np=c,
            ts_et_timestamps=et_timestamps,
        )

        assert meta["time_stop_exits"] >= 1, (
            "deepscan14 B1 REGRESSION: 15m grid with no :55 bar never flattened — "
            f"time_stop_exits={meta['time_stop_exits']}"
        )
        assert not bool(xl_out[3]), "must NOT flatten early at 15:45"
        assert bool(xl_out[4]), "must flatten at 16:00 (first bar >= 15:55)"

    def test_1h_grid_never_hits_55_minute_flattens_at_1600(self):
        """1h bar grid: ...13:00, 14:00, 15:00, 16:00 — no bar ever reads
        "15:55" either. First bar >= 15:55 is 16:00."""
        fn = self._load_fn()
        et_timestamps = [
            "2026-01-15 09:00:00",  # entry
            "2026-01-15 13:00:00",  # quiet
            "2026-01-15 14:00:00",  # quiet
            "2026-01-15 15:00:00",  # quiet — must NOT flatten
            "2026-01-15 16:00:00",  # first bar >= 15:55 — MUST flatten here
        ]
        n = len(et_timestamps)
        entry_bar = 0

        el, xl, es, xs, h, l, atr, c = _make_arrays(n, entry_bar)

        el_out, xl_out, es_out, xs_out, meta = fn(
            entry_long=el,
            exit_long=xl,
            entry_short=es,
            exit_short=xs,
            high_np=h,
            low_np=l,
            atr_np=atr,
            timestamps=np.array(et_timestamps),
            symbol="MES",
            close_np=c,
            ts_et_timestamps=et_timestamps,
        )

        assert meta["time_stop_exits"] >= 1, (
            "deepscan14 B1 REGRESSION: 1h grid with no :55 bar never flattened — "
            f"time_stop_exits={meta['time_stop_exits']}"
        )
        assert not bool(xl_out[3]), "must NOT flatten early at 15:00"
        assert bool(xl_out[4]), "must flatten at 16:00 (first bar >= 15:55)"

    def test_5m_grid_with_exact_1555_bar_still_flattens_exactly_there(self):
        """Regression: a 5m grid that DOES land on :55 must still flatten
        exactly at that bar — not one bar early, not one bar late."""
        fn = self._load_fn()
        et_timestamps = [
            "2026-01-15 09:30:00",  # entry
            "2026-01-15 15:45:00",  # quiet — must NOT flatten
            "2026-01-15 15:50:00",  # quiet — must NOT flatten
            "2026-01-15 15:55:00",  # exact match — MUST flatten here
            "2026-01-15 16:00:00",  # after close — already flat, no-op
        ]
        n = len(et_timestamps)
        entry_bar = 0

        el, xl, es, xs, h, l, atr, c = _make_arrays(n, entry_bar)

        el_out, xl_out, es_out, xs_out, meta = fn(
            entry_long=el,
            exit_long=xl,
            entry_short=es,
            exit_short=xs,
            high_np=h,
            low_np=l,
            atr_np=atr,
            timestamps=np.array(et_timestamps),
            symbol="MES",
            close_np=c,
            ts_et_timestamps=et_timestamps,
        )

        assert meta["time_stop_exits"] == 1, (
            f"expected exactly 1 time-stop exit, got {meta['time_stop_exits']}"
        )
        assert not bool(xl_out[1]) and not bool(xl_out[2]), "must NOT flatten before 15:55"
        assert bool(xl_out[3]), "must flatten exactly at the 15:55 bar"

    def test_15m_grid_legacy_path_no_ts_et_still_flattens(self):
        """B1 also touched the legacy (ts_et_timestamps=None) branch, which
        DST-converts a raw UTC timestamp via _dst_correct_et_hour() and then
        checked the "15:55" substring. Same non-:55-grid bug applied there.
        Winter (EST, UTC-5): 16:00 ET = 21:00 UTC."""
        fn = self._load_fn()
        utc_timestamps = [
            "2026-01-15 14:30:00+00:00",  # 09:30 ET — entry
            "2026-01-15 20:30:00+00:00",  # 15:30 ET — quiet
            "2026-01-15 20:45:00+00:00",  # 15:45 ET — quiet, must NOT flatten
            "2026-01-15 21:00:00+00:00",  # 16:00 ET — first bar >= 15:55, MUST flatten
        ]
        n = len(utc_timestamps)
        entry_bar = 0

        el, xl, es, xs, h, l, atr, c = _make_arrays(n, entry_bar)

        el_out, xl_out, es_out, xs_out, meta = fn(
            entry_long=el,
            exit_long=xl,
            entry_short=es,
            exit_short=xs,
            high_np=h,
            low_np=l,
            atr_np=atr,
            timestamps=np.array(utc_timestamps),
            symbol="MES",
            close_np=c,
            ts_et_timestamps=None,  # force the legacy DST-conversion branch
        )

        assert meta["time_stop_exits"] >= 1, (
            "deepscan14 B1 REGRESSION (legacy branch): 15m grid with no :55 bar "
            f"never flattened — time_stop_exits={meta['time_stop_exits']}"
        )
        assert not bool(xl_out[2]), "must NOT flatten early at 15:45 ET"
        assert bool(xl_out[3]), "must flatten at 16:00 ET (first bar >= 15:55)"


class TestEtTimeGeFlattenHelper:
    """Direct unit tests of the new `_et_time_ge_flatten()` helper — the
    inequality primitive B1 relies on."""

    def _load_fn(self):
        from src.engine.backtester import _et_time_ge_flatten
        return _et_time_ge_flatten

    @pytest.mark.parametrize(
        "et_str,expected",
        [
            ("15:55", True),
            ("15:54", False),
            ("16:00", True),
            ("23:59", True),
            ("00:00", False),
            ("2026-01-15 15:55:00", True),
            ("2026-01-15 15:45:00", False),
            ("2026-01-15T16:00:00-05:00", True),
            ("", False),
            (None, False),
        ],
    )
    def test_ge_flatten_boundary(self, et_str, expected):
        fn = self._load_fn()
        assert fn(et_str) is expected


class TestCommissionSentinelDisambiguation:
    """B2 — explicit commission_per_side=0.62 (no firm_key) must NOT be
    silently overridden by the contract-spec default, distinguishable from
    the caller having omitted the field entirely."""

    def test_model_fields_set_distinguishes_explicit_from_omitted(self):
        """Pure unit test of the pydantic v2 mechanism the run_backtest fix
        relies on: `model_fields_set` reflects keys actually present in the
        validated payload, not the class-level default."""
        from src.engine.config import BacktestRequest, StrategyConfig, IndicatorConfig, StopConfig, PositionSizeConfig

        strategy = StrategyConfig(
            name="Test",
            symbol="MES",
            timeframe="daily",
            indicators=[IndicatorConfig(type="sma", period=5)],
            entry_long="close crosses_above sma_5",
            entry_short="close crosses_below sma_5",
            exit="close crosses_below sma_5",
            stop_loss=StopConfig(type="atr", multiplier=2.0),
            position_size=PositionSizeConfig(type="fixed", fixed_contracts=1),
        )
        base_payload = dict(
            strategy=strategy,
            start_date="2023-01-01",
            end_date="2023-12-31",
        )

        omitted = BacktestRequest.model_validate({**base_payload})
        assert "commission_per_side" not in omitted.model_fields_set

        explicit = BacktestRequest.model_validate({**base_payload, "commission_per_side": 0.62})
        assert "commission_per_side" in explicit.model_fields_set
        assert explicit.commission_per_side == pytest.approx(0.62)

    def test_run_backtest_explicit_0_62_not_overridden_by_spec_default(self, monkeypatch):
        """End-to-end: monkeypatch CONTRACT_SPECS["MES"].default_commission to a
        distinct sentinel value so the two code paths (explicit-preserved vs
        omitted-resolved-to-spec-default) are numerically distinguishable —
        under real production defaults spec.default_commission == 0.62 for
        MES/MNQ/MCL, which would make comparing final numeric commission
        values alone a false-pass either way.

        Reads the resolved `commission` value directly by spying on
        `_apply_dll_halt_to_entries()` — the DSL-guards helper is called
        UNCONDITIONALLY just before the vectorbt run (E.3/E.4/E.5 wiring,
        see backtester.py's "CRITICAL #1" block) with the resolved commission
        as a positional arg, regardless of whether any signal produces a
        closed trade. This sidesteps the flakiness of forcing a fully closed,
        invariant-clean trade out of a synthetic SMA-crossover fixture on
        tiny daily data (observed: DSL/vectorbt fixtures on ~200 synthetic
        daily bars can produce a counted-but-not-closed "phantom" trade that
        never reaches `result["trades"]`, independent of this fix) while
        still exercising the exact real commission-resolution code path.
        """
        import src.engine.backtester as bt_module
        from src.engine.config import (
            BacktestRequest,
            CONTRACT_SPECS,
            IndicatorConfig,
            PositionSizeConfig,
            StopConfig,
            StrategyConfig,
        )

        monkeypatch.setattr(CONTRACT_SPECS["MES"], "default_commission", 99.0)
        assert CONTRACT_SPECS["MES"].default_commission == 99.0  # sanity: monkeypatch took

        captured: dict = {}
        _orig_dll_halt = bt_module._apply_dll_halt_to_entries

        def _spy_dll_halt(*args, **kwargs):
            # commission_per_side is the 12th positional arg (index 11) in the
            # E.3/E.4/E.5 wiring call — see backtester.py's "CRITICAL #1" block.
            captured["commission"] = args[11] if len(args) > 11 else kwargs.get("commission_per_side")
            return _orig_dll_halt(*args, **kwargs)

        monkeypatch.setattr(bt_module, "_apply_dll_halt_to_entries", _spy_dll_halt)

        def _strategy():
            return StrategyConfig(
                name="Test",
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
            )

        df = _make_controlled_ohlcv([4000 + i * 0.5 for i in range(200)])

        # Run A: explicit commission_per_side=0.62, no firm_key — must be preserved.
        req_explicit = BacktestRequest(
            strategy=_strategy(), start_date="2023-01-01", end_date="2023-12-31",
            commission_per_side=0.62,
        )
        assert "commission_per_side" in req_explicit.model_fields_set
        bt_module.run_backtest(req_explicit, data=df)
        assert captured.get("commission") == pytest.approx(0.62), (
            f"deepscan14 B2 REGRESSION: explicit commission_per_side=0.62 (no "
            f"firm_key) was overridden by the contract-spec default — resolved "
            f"commission={captured.get('commission')!r}, expected 0.62"
        )

        # Run B: commission_per_side omitted entirely — must resolve to the
        # (monkeypatched) spec default, 99.0.
        captured.clear()
        req_omitted = BacktestRequest(
            strategy=_strategy(), start_date="2023-01-01", end_date="2023-12-31",
        )
        assert "commission_per_side" not in req_omitted.model_fields_set
        bt_module.run_backtest(req_omitted, data=df)
        assert captured.get("commission") == pytest.approx(99.0), (
            f"omitted commission_per_side must resolve to spec.default_commission "
            f"(monkeypatched to 99.0) — resolved commission={captured.get('commission')!r}"
        )

    def test_run_class_backtest_none_default_no_longer_hardcoded_0_62(self):
        """run_class_backtest's own parameter default changed 0.62 -> None so
        a caller who truly wants "no override, use contract spec" and a caller
        who explicitly wants 0.62 are distinguishable. This directly checks
        the function signature default (regression guard against reverting
        to the old ambiguous 0.62 literal)."""
        import inspect
        from src.engine.backtester import run_class_backtest

        sig = inspect.signature(run_class_backtest)
        assert sig.parameters["commission_per_side"].default is None, (
            "run_class_backtest's commission_per_side default must be None "
            "(deepscan14 B2) — an unambiguous 'not provided' sentinel, distinct "
            "from an explicit commission_per_side=0.62 call."
        )
