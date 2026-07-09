"""Defect-9: class-path macro-blackout mask parity.

`run_class_backtest()` previously had ZERO macro-blackout mask while
`run_backtest()` (and live) blacked out FOMC/CPI/NFP/EIA windows. This suite
proves the class-path mask (`economic_calendar.apply_class_event_mask` +
`assert_events_present_in_window`, called from `run_class_backtest`) is
byte-identical to the DSL path's event-mask suppression, product-scoped, and
fail-closed on a wiped calendar.

IMPORTANT — no vectorbt: these tests exercise the mask at the
`economic_calendar` level (numpy/polars only). Importing the vectorbt engine
under pytest collection HANGS on the tower, so the class-path masking logic was
factored into `economic_calendar.apply_class_event_mask` (pure) precisely so it
is unit-testable here without importing `backtester`. The signature-contract
test uses AST parsing (also no import).
"""
from __future__ import annotations

import ast
import os
from datetime import datetime

import numpy as np
import polars as pl
import pytest

import src.engine.economic_calendar as ec


# ─── Helpers ──────────────────────────────────────────────────────────────
def _et_series(et_datetimes: list[str]) -> pl.Series:
    """Build a tz-aware America/New_York Series from 'YYYY-MM-DD HH:MM' strings.

    Casting to America/New_York directly means generate_event_mask reads ET with
    zero DST math — 08:30 in the string is 08:30 ET in EST or EDT alike.
    """
    naive = [datetime.strptime(d, "%Y-%m-%d %H:%M") for d in et_datetimes]
    return (
        pl.Series("ts", naive)
        .cast(pl.Datetime("us"))
        .dt.replace_time_zone("America/New_York")
    )


def _find_event(event_type: str, months: set[int]) -> dict:
    """Return the first calendar event of `event_type` whose month ∈ months."""
    for evt in ec._events_for_type(event_type):
        try:
            d = datetime.strptime(evt["date"], "%Y-%m-%d").date()
        except (ValueError, KeyError):
            continue
        if d.month in months:
            return evt
    pytest.skip(f"no {event_type} event in months {months} in calendar")


_WINTER = {1, 2, 12}  # EST season
_SUMMER = {6, 7, 8}   # EDT season


def _policy(event_type: str, action: str = "SIT_OUT", window: int = 30) -> dict:
    return {"event_type": event_type, "action": action, "window_minutes": window}


# ─── 1. PARITY: class mask == DSL path's `entry & ~generate_event_mask` ────
class TestClassEventMaskParity:
    """Acceptance #1: byte-identical suppression vs run_backtest's event mask.

    run_backtest applies the mask inside generate_signals as `entry & ~event_mask`
    (signals.py:288-290). The class helper must reproduce that exactly for the
    same (policies, calendar, symbol).
    """

    def test_suppression_byte_identical_to_dsl_reference(self):
        fomc = _find_event("FOMC", _WINTER)
        # event bar (14:00 ET) + a same-day quiet bar (07:00 ET) + an off-day bar
        ts = _et_series([
            f"{fomc['date']} 14:00",
            f"{fomc['date']} 07:00",
            f"{fomc['date']} 03:00",
        ])
        policies = [_policy("FOMC")]
        symbol = "MES"
        long = np.ones(len(ts), dtype=bool)
        short = np.ones(len(ts), dtype=bool)

        # DSL reference: exactly signals.py:288-290
        ref_mask = ec.generate_event_mask(ts, policies, symbol)
        ref_block = ~ref_mask.astype(bool)
        ref_long = long & ref_block
        ref_short = short & ref_block

        # Class path
        cls_long, cls_short, cls_mask = ec.apply_class_event_mask(
            long, short, ts, policies, symbol, fomc["date"], fomc["date"],
        )

        assert np.array_equal(cls_mask, ref_mask)
        assert np.array_equal(cls_long, ref_long)
        assert np.array_equal(cls_short, ref_short)
        # The 14:00 event bar must be suppressed; the 07:00/03:00 bars must not.
        assert cls_long.tolist() == [False, True, True]
        assert cls_short.tolist() == [False, True, True]

    def test_window_minutes_is_policy_driven_not_hardcoded(self):
        cpi = _find_event("CPI", _WINTER)  # 08:30 ET
        # Bar at 08:50 ET is 20 min after the release: inside a 30-min window,
        # OUTSIDE a 10-min window. Prove the window comes from the policy.
        ts = _et_series([f"{cpi['date']} 08:50"])
        long = np.ones(1, dtype=bool)
        short = np.ones(1, dtype=bool)

        _, _, mask_30 = ec.apply_class_event_mask(
            long, short, ts, [_policy("CPI", window=30)], "MES", cpi["date"], cpi["date"],
        )
        _, _, mask_10 = ec.apply_class_event_mask(
            long, short, ts, [_policy("CPI", window=10)], "MES", cpi["date"], cpi["date"],
        )
        assert mask_30.tolist() == [True]
        assert mask_10.tolist() == [False]


# ─── 2. SCOPE FIXTURES (acceptance #2) ────────────────────────────────────
class TestScopeFixtures:
    def test_1a_mes_not_suppressed_in_eia_window(self):
        eia = _find_event("EIA", _WINTER)  # crude-only event
        ts = _et_series([f"{eia['date']} {eia['time_et']}"])
        long = np.ones(1, dtype=bool)
        short = np.ones(1, dtype=bool)
        m_long, m_short, mask = ec.apply_class_event_mask(
            long, short, ts, [_policy("EIA")], "MES", eia["date"], eia["date"],
        )
        # EIA is crude-scoped — an index symbol must NOT be blacked out.
        assert mask.tolist() == [False]
        assert m_long.tolist() == [True]
        assert m_short.tolist() == [True]

    def test_1b_mcl_not_suppressed_in_cpi_nfp_window(self):
        cpi = _find_event("CPI", _WINTER)  # index-only event
        ts = _et_series([f"{cpi['date']} {cpi['time_et']}"])
        long = np.ones(1, dtype=bool)
        short = np.ones(1, dtype=bool)
        m_long, m_short, mask = ec.apply_class_event_mask(
            long, short, ts,
            [_policy("CPI"), _policy("NFP")],
            "MCL", cpi["date"], cpi["date"],
        )
        # CPI/NFP are index-scoped — crude must NOT be blacked out.
        assert mask.tolist() == [False]
        assert m_long.tolist() == [True]
        assert m_short.tolist() == [True]

    def test_1c_fomc_suppresses_all_products(self):
        fomc = _find_event("FOMC", _WINTER)  # all-products event
        ts = _et_series([f"{fomc['date']} 14:00"])
        for symbol in ("MES", "MNQ", "MCL"):
            long = np.ones(1, dtype=bool)
            short = np.ones(1, dtype=bool)
            m_long, m_short, mask = ec.apply_class_event_mask(
                long, short, ts, [_policy("FOMC")], symbol, fomc["date"], fomc["date"],
            )
            assert mask.tolist() == [True], f"{symbol} not suppressed by FOMC"
            assert m_long.tolist() == [False], f"{symbol} long not suppressed"
            assert m_short.tolist() == [False], f"{symbol} short not suppressed"


# ─── 3. DST BOTH SEASONS (acceptance #3) ──────────────────────────────────
class TestDstBothSeasons:
    def test_winter_est_event_masked(self):
        fomc = _find_event("FOMC", _WINTER)
        ts = _et_series([f"{fomc['date']} 14:00"])
        long = np.ones(1, dtype=bool)
        _, _, mask = ec.apply_class_event_mask(
            long, long.copy(), ts, [_policy("FOMC")], "MES", fomc["date"], fomc["date"],
        )
        assert mask.tolist() == [True]

    def test_summer_edt_event_masked(self):
        fomc = _find_event("FOMC", _SUMMER)
        ts = _et_series([f"{fomc['date']} 14:00"])
        long = np.ones(1, dtype=bool)
        _, _, mask = ec.apply_class_event_mask(
            long, long.copy(), ts, [_policy("FOMC")], "MES", fomc["date"], fomc["date"],
        )
        assert mask.tolist() == [True]

    def test_winter_and_summer_utc_input_both_masked(self):
        """When bars arrive as UTC (not tz-aware ET), DST conversion must still
        land the event bar inside the window in BOTH seasons.

        Winter FOMC 14:00 EST == 19:00 UTC; Summer FOMC 14:00 EDT == 18:00 UTC.
        """
        winter = _find_event("FOMC", _WINTER)
        summer = _find_event("FOMC", _SUMMER)
        utc = pl.Series(
            "ts",
            [
                datetime.strptime(f"{winter['date']} 19:00", "%Y-%m-%d %H:%M"),
                datetime.strptime(f"{summer['date']} 18:00", "%Y-%m-%d %H:%M"),
            ],
        ).cast(pl.Datetime("us", time_zone="UTC"))
        mask = ec.generate_event_mask(utc, [_policy("FOMC")], "MES")
        assert mask.tolist() == [True, True]


# ─── 4. TWO-SIDED POLARITY (acceptance #4) ────────────────────────────────
class TestTwoSidedPolarity:
    def test_event_bar_blocked_quiet_bar_allowed(self):
        fomc = _find_event("FOMC", _WINTER)
        ts = _et_series([
            f"{fomc['date']} 14:00",  # known event bar → blocked
            f"{fomc['date']} 03:00",  # known-quiet overnight bar → allowed
        ])
        long = np.ones(2, dtype=bool)
        short = np.ones(2, dtype=bool)
        m_long, m_short, mask = ec.apply_class_event_mask(
            long, short, ts, [_policy("FOMC")], "MES", fomc["date"], fomc["date"],
        )
        assert mask.tolist() == [True, False]
        assert m_long.tolist() == [False, True]
        assert m_short.tolist() == [False, True]


# ─── 5. FAIL-CLOSED COVERAGE GUARD (ADDITION 4) ───────────────────────────
class TestCoverageGuard:
    def test_wiped_calendar_raises_loudly(self):
        # A window with no calendar events (pre-STATIC_EVENTS era) → raise.
        with pytest.raises(ec.EmptyCalendarError):
            ec.assert_events_present_in_window(
                [_policy("FOMC")], "1990-01-01", "1990-01-05",
            )

    def test_apply_class_event_mask_raises_on_wiped_calendar(self):
        long = np.ones(3, dtype=bool)
        ts = _et_series(["1990-01-02 14:00", "1990-01-03 14:00", "1990-01-04 14:00"])
        with pytest.raises(ec.EmptyCalendarError):
            ec.apply_class_event_mask(
                long, long.copy(), ts, [_policy("FOMC")], "MES", "1990-01-01", "1990-01-05",
            )

    def test_populated_window_returns_positive_count(self):
        n = ec.assert_events_present_in_window(
            [_policy("FOMC")], "2026-01-01", "2026-12-31",
        )
        assert n > 0

    def test_count_only_actionable_policies(self):
        # IGNORE/WIDEN policies don't blackout, so they don't count toward liveness.
        fomc = _find_event("FOMC", _WINTER)
        yr = fomc["date"][:4]
        assert ec.count_events_in_window(
            [_policy("FOMC", action="IGNORE")], f"{yr}-01-01", f"{yr}-12-31",
        ) == 0
        assert ec.count_events_in_window(
            [_policy("FOMC", action="SIT_OUT")], f"{yr}-01-01", f"{yr}-12-31",
        ) > 0

    def test_eia_calendar_alive_even_when_symbol_scoped_out(self):
        # MES + EIA-only: mask suppresses nothing (crude-scoped) but the EIA calendar
        # is ALIVE, so the coverage guard must NOT raise — liveness != per-symbol scope.
        eia = _find_event("EIA", _WINTER)
        yr = eia["date"][:4]
        n = ec.assert_events_present_in_window(
            [_policy("EIA")], f"{yr}-01-01", f"{yr}-12-31",
        )
        assert n > 0


# ─── 6. SIGNATURE CONTRACT (no vectorbt import — AST only) ─────────────────
class TestSignatureContract:
    def test_run_class_backtest_has_event_calendar_param_default_none(self):
        src_path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "backtester.py",
        )
        with open(src_path, "r", encoding="utf-8") as fh:
            tree = ast.parse(fh.read())
        func = next(
            (n for n in ast.walk(tree)
             if isinstance(n, ast.FunctionDef) and n.name == "run_class_backtest"),
            None,
        )
        assert func is not None, "run_class_backtest not found"
        arg_names = [a.arg for a in func.args.args + func.args.kwonlyargs]
        assert "event_calendar" in arg_names, "run_class_backtest missing event_calendar param"

        # Default must be None (byte-identical legacy behavior when omitted).
        # event_calendar is the last positional-or-keyword arg → last default.
        defaults = func.args.defaults
        pos_args = func.args.args
        # Map defaults to their args (defaults align to the tail of pos_args).
        default_map = dict(zip([a.arg for a in pos_args[len(pos_args) - len(defaults):]], defaults))
        node = default_map.get("event_calendar")
        assert node is not None, "event_calendar has no default"
        assert isinstance(node, ast.Constant) and node.value is None, (
            "event_calendar default must be None"
        )
