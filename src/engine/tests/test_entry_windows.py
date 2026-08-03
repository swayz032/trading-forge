"""
test_entry_windows.py — W23H.3

Tests for:
  1. entry_windows.py parser + checker
  2. pine_compiler.py _build_session_filter() with allowed_entry_windows
  3. backtester.py window mask applied + metadata emitted

Coverage:
  PARSER
  - Valid: "09:45-12:00 ET" → correct start/end/tz
  - Valid: "13:30-15:30 ET"
  - Valid: "09:00-17:00 UTC"
  - Valid: IANA passthrough ("America/Chicago")
  - Valid: all TZ shorthands
  - Malformed: minute=60 throws
  - Malformed: missing colon throws
  - Malformed: missing TZ throws
  - Malformed: end <= start throws
  - Malformed: hour > 23 throws
  - Malformed: unknown TZ throws
  - parse_entry_windows: empty/None → []
  - parse_entry_windows: raises on first malformed

  CHECKER
  - is_bar_in_window: inside, outside, left-boundary, right-boundary
  - is_bar_in_any_window: empty=False, multi-window logic
  - DST correctness (summer/winter ET)

  PINE CODEGEN
  - No windows → original session filter line unchanged
  - One window → in_window emitted with correct time string
  - Two windows → OR-combined
  - Window strings contain correct Pine time() format

  BACKTESTER (integration test via minimal df)
  - Empty windows → same result as no allowed_entry_windows field
  - Window applied → entry count reduced
  - metadata.engine_audit.skipped_outside_window_count > 0 when windows active
  - skipped_outside_window_count = 0 when no windows configured
"""

from __future__ import annotations

import datetime as dt
import pathlib
import sys

import pytest

from src.engine.entry_windows import (
    is_bar_in_any_window,
    is_bar_in_window,
    parse_entry_window,
    parse_entry_windows,
    window_to_pine_time_string,
)
from src.engine.pine_compiler import _build_session_filter

# ─── Parser tests ─────────────────────────────────────────────────────────────

class TestParseEntryWindow:

    def test_09_45_to_12_00_et(self):
        w = parse_entry_window("09:45-12:00 ET")
        assert w.start_minutes_of_day == 9 * 60 + 45   # 585
        assert w.end_minutes_of_day == 12 * 60          # 720
        assert w.timezone == "America/New_York"
        assert w.spec == "09:45-12:00 ET"

    def test_13_30_to_15_30_et(self):
        w = parse_entry_window("13:30-15:30 ET")
        assert w.start_minutes_of_day == 13 * 60 + 30   # 810
        assert w.end_minutes_of_day == 15 * 60 + 30     # 930

    def test_utc(self):
        w = parse_entry_window("09:00-17:00 UTC")
        assert w.timezone == "UTC"
        assert w.start_minutes_of_day == 9 * 60
        assert w.end_minutes_of_day == 17 * 60

    def test_iana_passthrough(self):
        w = parse_entry_window("09:30-16:00 America/Chicago")
        assert w.timezone == "America/Chicago"

    def test_pt_shorthand(self):
        assert parse_entry_window("09:00-10:00 PT").timezone == "America/Los_Angeles"

    def test_ct_shorthand(self):
        assert parse_entry_window("09:00-10:00 CT").timezone == "America/Chicago"

    def test_mt_shorthand(self):
        assert parse_entry_window("09:00-10:00 MT").timezone == "America/Denver"

    def test_malformed_minute_60(self):
        with pytest.raises(ValueError, match="out of range|minute"):
            parse_entry_window("09:60-12:00 ET")

    def test_malformed_missing_colon(self):
        with pytest.raises(ValueError):
            parse_entry_window("9-12 ET")

    def test_malformed_missing_tz(self):
        with pytest.raises(ValueError):
            parse_entry_window("09:45-12:00")

    def test_malformed_end_le_start(self):
        with pytest.raises(ValueError):
            parse_entry_window("12:00-09:45 ET")

    def test_malformed_equal_start_end(self):
        with pytest.raises(ValueError):
            parse_entry_window("10:00-10:00 ET")

    def test_malformed_hour_gt_23(self):
        with pytest.raises(ValueError):
            parse_entry_window("25:00-26:00 ET")

    def test_malformed_unknown_tz(self):
        with pytest.raises(ValueError, match="timezone"):
            parse_entry_window("09:00-10:00 FAKEZONE")

    def test_malformed_empty_string(self):
        with pytest.raises(ValueError):
            parse_entry_window("")

    def test_leading_trailing_whitespace(self):
        w = parse_entry_window("  09:45-12:00 ET  ")
        assert w.start_minutes_of_day == 585


class TestParseEntryWindows:

    def test_empty_list(self):
        assert parse_entry_windows([]) == []

    def test_none(self):
        assert parse_entry_windows(None) == []

    def test_two_windows(self):
        ws = parse_entry_windows(["09:45-12:00 ET", "13:30-15:30 ET"])
        assert len(ws) == 2
        assert ws[0].start_minutes_of_day == 585
        assert ws[1].start_minutes_of_day == 810

    def test_raises_on_malformed_in_list(self):
        with pytest.raises(ValueError):
            parse_entry_windows(["09:45-12:00 ET", "bad spec"])


# ─── Checker tests ────────────────────────────────────────────────────────────

def _make_et_utc(et_hour: int, et_min: int, summer: bool = False) -> dt.datetime:
    """Build a UTC datetime that represents et_hour:et_min in Eastern Time.

    January = EST (UTC-5); July = EDT (UTC-4).
    """
    offset = 4 if summer else 5
    utc_h = et_hour + offset
    date = dt.date(2025, 7, 15) if summer else dt.date(2025, 1, 15)
    return dt.datetime(date.year, date.month, date.day, utc_h, et_min, 0,
                       tzinfo=dt.timezone.utc)


class TestIsBarInWindow:

    w = parse_entry_window("09:45-12:00 ET")

    def test_inside(self):
        bar = _make_et_utc(10, 0)
        assert is_bar_in_window(bar, self.w) is True

    def test_outside_before_start(self):
        bar = _make_et_utc(9, 30)
        assert is_bar_in_window(bar, self.w) is False

    def test_left_inclusive_boundary(self):
        bar = _make_et_utc(9, 45)
        assert is_bar_in_window(bar, self.w) is True

    def test_right_exclusive_boundary(self):
        bar = _make_et_utc(12, 0)
        assert is_bar_in_window(bar, self.w) is False

    def test_just_before_end(self):
        bar = _make_et_utc(11, 59)
        assert is_bar_in_window(bar, self.w) is True

    def test_after_window(self):
        bar = _make_et_utc(13, 0)
        assert is_bar_in_window(bar, self.w) is False

    def test_dst_summer_inside(self):
        bar = _make_et_utc(10, 0, summer=True)
        assert is_bar_in_window(bar, self.w) is True

    def test_dst_winter_inside(self):
        bar = _make_et_utc(10, 0, summer=False)
        assert is_bar_in_window(bar, self.w) is True

    def test_dst_summer_outside(self):
        bar = _make_et_utc(9, 30, summer=True)
        assert is_bar_in_window(bar, self.w) is False

    def test_dst_transition_spring_forward_inside(self):
        # March 9, 2025 — after spring-forward: UTC 14:00 = 10:00 EDT
        bar = dt.datetime(2025, 3, 9, 14, 0, 0, tzinfo=dt.timezone.utc)
        assert is_bar_in_window(bar, self.w) is True

    def test_dst_transition_fall_back_inside(self):
        # November 2, 2025 — after fall-back: UTC 15:00 = 10:00 EST
        bar = dt.datetime(2025, 11, 2, 15, 0, 0, tzinfo=dt.timezone.utc)
        assert is_bar_in_window(bar, self.w) is True


class TestIsBarInAnyWindow:

    windows = parse_entry_windows(["09:45-12:00 ET", "13:30-15:30 ET"])

    def test_empty_returns_false(self):
        bar = _make_et_utc(10, 0)
        assert is_bar_in_any_window(bar, []) is False

    def test_inside_first_window(self):
        assert is_bar_in_any_window(_make_et_utc(10, 0), self.windows) is True

    def test_inside_second_window(self):
        assert is_bar_in_any_window(_make_et_utc(14, 0), self.windows) is True

    def test_between_windows(self):
        assert is_bar_in_any_window(_make_et_utc(12, 15), self.windows) is False

    def test_before_both_windows(self):
        assert is_bar_in_any_window(_make_et_utc(9, 0), self.windows) is False

    def test_after_both_windows(self):
        assert is_bar_in_any_window(_make_et_utc(16, 0), self.windows) is False

    def test_left_edge_second_window(self):
        assert is_bar_in_any_window(_make_et_utc(13, 30), self.windows) is True

    def test_right_edge_second_window_exclusive(self):
        assert is_bar_in_any_window(_make_et_utc(15, 30), self.windows) is False


# ─── window_to_pine_time_string ───────────────────────────────────────────────

class TestWindowToPineTimeString:

    def test_09_45_to_12_00(self):
        w = parse_entry_window("09:45-12:00 ET")
        assert window_to_pine_time_string(w) == "0945-1200"

    def test_13_30_to_15_30(self):
        w = parse_entry_window("13:30-15:30 ET")
        assert window_to_pine_time_string(w) == "1330-1530"

    def test_zero_padded(self):
        w = parse_entry_window("09:00-09:30 ET")
        assert window_to_pine_time_string(w) == "0900-0930"


# ─── Pine codegen tests ───────────────────────────────────────────────────────

class TestBuildSessionFilterWithWindows:

    def test_no_windows_unchanged(self):
        result = _build_session_filter("RTH_ONLY", allowed_entry_windows=None)
        assert result == 'in_session = not na(time(timeframe.period, "0930-1600", "America/New_York"))'

    def test_empty_windows_unchanged(self):
        result = _build_session_filter("RTH_ONLY", allowed_entry_windows=[])
        assert result == 'in_session = not na(time(timeframe.period, "0930-1600", "America/New_York"))'

    def test_single_window_emits_in_window_line(self):
        result = _build_session_filter("RTH_ONLY", allowed_entry_windows=["09:45-12:00 ET"])
        assert "in_window" in result
        assert "0945-1200" in result
        assert "America/New_York" in result

    def test_single_window_and_combines(self):
        result = _build_session_filter("RTH_ONLY", allowed_entry_windows=["09:45-12:00 ET"])
        assert "in_session := in_session and in_window" in result

    def test_two_windows_or_combined(self):
        result = _build_session_filter("RTH_ONLY",
                                       allowed_entry_windows=["09:45-12:00 ET", "13:30-15:30 ET"])
        assert "0945-1200" in result
        assert "1330-1530" in result
        assert " or " in result

    def test_two_windows_correct_pine_format(self):
        result = _build_session_filter("RTH_ONLY",
                                       allowed_entry_windows=["09:45-12:00 ET", "13:30-15:30 ET"])
        # Both time() calls should use America/New_York
        assert result.count('"America/New_York"') >= 3  # base + 2 windows

    def test_all_sessions_no_base_restriction(self):
        result = _build_session_filter("ALL_SESSIONS", allowed_entry_windows=["09:45-12:00 ET"])
        assert result.startswith("in_session = true")
        assert "in_window" in result
        assert "in_session := in_session and in_window" in result

    def test_malformed_window_raises_at_codegen_time(self):
        with pytest.raises(ValueError):
            _build_session_filter("RTH_ONLY", allowed_entry_windows=["bad spec"])


# ─── Backtester integration tests ─────────────────────────────────────────────
# These tests use a minimal df + config to verify the window mask is applied
# without the full S3 data load chain.

def _make_minimal_backtest_result(
    allowed_entry_windows: list[str] | None,
) -> dict:
    """Run a minimal backtest with a trivially always-true entry condition.

    We use a tiny synthetic df with timestamps spread across different hours.
    The strategy is MES with a simple RSI-based entry that always fires on
    every bar so we can count how many are masked.
    """
    import polars as pl

    from src.engine.backtester import run_backtest
    from src.engine.config import (
        BacktestRequest,
        IndicatorConfig,
        PositionSizeConfig,
        StopConfig,
        StrategyConfig,
    )

    # Build a synthetic DataFrame. Winter dates, so EST = UTC-5 throughout.
    #
    # R-635 §4.1 (grader findings F-A + F-B) — TWO DEFECTS IN THIS FIXTURE:
    #
    #   F-A: it emitted `ts_event` but NO `ts_et`, so backtester.py:3953
    #        (`if "ts_et" in df.columns`) took the ELSE branch and these tests
    #        exercised `_build_default_event_mask_utc` — the LEGACY FALLBACK —
    #        and NEVER `_build_default_event_mask_et`, the production builder.
    #        Re-inverting the ET builder's polarity left the suite 4/4 GREEN.
    #        A `ts_et` column is now emitted so the production path is under test.
    #
    #   F-B: no bar fell inside either blackout window, so the ET builder's
    #        `mask[i] = True` line NEVER EXECUTED. A fixture can be
    #        mutation-sensitive and still never run the line it is guarding;
    #        the 08:45 ET bars below exist to execute it.
    #
    # Per day, three bars:
    #   08:45 ET (13:45 UTC) — INSIDE the 8:30-9:00 blackout → exercises the
    #                          in-window branch of the ET builder (F-B)
    #   09:00 ET (14:00 UTC) — outside the blackout (window end is exclusive),
    #                          and outside "09:45-12:00 ET" → counted as skipped
    #   10:00 ET (15:00 UTC) — outside the blackout, INSIDE "09:45-12:00 ET"
    #
    # 10 days x 1 bar at 09:00 ET = 10 skipped, so `assert skipped >= 10` holds
    # on the 09:00 bars ALONE — deliberately not relying on the 08:45 bars,
    # whose entries the blackout suppresses before the window mask counts them.
    n_days = 10
    et_times = [(8, 45), (9, 0), (10, 0)]
    timestamps_utc = []
    timestamps_et = []
    for d in range(n_days):
        day = dt.date(2024, 1, 2 + d)
        for et_h, et_m in et_times:
            utc = dt.datetime(day.year, day.month, day.day, et_h + 5, et_m, 0,
                              tzinfo=dt.timezone.utc)
            # ts_et must be OFFSET-AWARE, not naive: liquidity.py:55 casts this
            # column to Datetime(time_zone="UTC") and a naive string fails that
            # cast for every row. EST = UTC-5 for these January dates.
            # isoformat() gives "2024-01-02T08:45:00-05:00", so the builder's
            # ts_str[11:16] slice still reads "08:45" as ET local time.
            et_aware = dt.datetime(day.year, day.month, day.day, et_h, et_m, 0,
                                   tzinfo=dt.timezone(dt.timedelta(hours=-5)))
            timestamps_utc.append(utc.isoformat())
            timestamps_et.append(et_aware.isoformat())
    n_bars = len(timestamps_utc)

    price = 5000.0
    data = pl.DataFrame({
        "timestamp": timestamps_utc,
        "ts_event": timestamps_utc,
        "ts_et": timestamps_et,
        "open": [price] * n_bars,
        "high": [price + 5.0] * n_bars,
        "low": [price - 5.0] * n_bars,
        "close": [price + 1.0] * n_bars,
        "volume": [1000] * n_bars,
    })

    strategy_cfg = StrategyConfig(
        name="test_window_mask",
        symbol="MES",
        timeframe="1m",
        indicators=[IndicatorConfig(type="atr", period=14)],
        entry_long="close > open",   # always true (close = price+1 > price)
        # Fixture repair (R-623 §7.2), SECOND blocker: entry_short="" made
        # signals.py:157 raise `Cannot parse expression: ''`, which the
        # try/except below SWALLOWED — returning the stub
        # {"skipped_outside_window_count": 0}. That stub is why three of these
        # four tests passed VACUOUSLY and the fourth failed with "got 0":
        # none of them ever reached mask logic. Use the same never-true
        # sentinel this fixture already uses for `exit`.
        entry_short="high < low",    # never true (sentinel)
        exit="high < low",           # never true (sentinel)
        stop_loss=StopConfig(type="atr", multiplier=1.5),
        # Fixture repair (R-623 §7.2), THIRD blocker: type="risk_derived_pyramid"
        # with only base_contracts set crashed compute_position_sizes
        # (backtester.py:4326) with "'>' not supported between NoneType and int"
        # — the pyramid fields (tier_increment, tier_threshold_dollars,
        # max_risk_pct_per_trade) are Optional[...] = None, so that config is
        # constructible but not runnable. Sizing is incidental scaffolding for a
        # WINDOW-MASK test, so use the simple documented "fixed" type rather than
        # invent pyramid tuning values.
        # FOURTH blocker: a validator rejects fixed_contracts=1 as a probable
        # misconfiguration and offers TF_ALLOW_FIXED_1=true as a test-only
        # bypass. Setting an EXPLICIT size satisfies the guard on its own terms
        # instead of switching it off — the guard's own message names 6 as the
        # MES base. Contract size does not affect what this test counts (bars
        # skipped outside the entry window), only position sizing.
        position_size=PositionSizeConfig(
            type="fixed",
            fixed_contracts=6,
        ),
        allowed_entry_windows=allowed_entry_windows,
    )

    # Fixture repair (R-623 §7.2): `start_date`/`end_date` became REQUIRED on
    # BacktestRequest and this helper was never updated, so all four
    # TestBacktesterWindowMask tests died here with a pydantic ValidationError
    # BEFORE reaching any mask logic — note this construction sits OUTSIDE the
    # try/except below, so the error escaped instead of being swallowed.
    # Derived from the synthetic bars above rather than hardcoded, so the dates
    # cannot drift away from the data they describe.
    request = BacktestRequest(
        strategy=strategy_cfg,
        start_date=timestamps_utc[0][:10],
        end_date=timestamps_utc[-1][:10],
    )
    try:
        return run_backtest(request, data=data)
    except Exception as exc:
        # R-630 §4.1 (grader finding F-2) — THE SWALLOW IS REMOVED, NOT JUST LOGGED.
        #
        # HISTORY, because this took three passes to get right:
        #   Originally this returned a STUB
        #   {"engine_audit": {"skipped_outside_window_count": 0}, "_error": ...}
        #   "so the field is still tested". That stub SATISFIES the three
        #   assertions that check `skipped == 0` or merely that the key exists —
        #   so a crashed run_backtest produced THREE GREEN TESTS.
        #   R-623 §7.2 added a traceback print, which made the failure VISIBLE
        #   but still returned the stub, so the vacuous passes survived. The
        #   class sweep caught that (F-2).
        #
        # PROPERTY NOW ENFORCED: a swallowed run_backtest failure cannot produce
        # a passing test — with or without a failing sibling in the same run.
        # Failing here closes the hole at the SOURCE rather than at three
        # separate call sites, so a future test added to this class inherits the
        # protection instead of having to remember it.
        import traceback as _tb
        _tb.print_exc(file=sys.stderr)
        pytest.fail(
            f"run_backtest() raised, so nothing was measured: {exc!r}. "
            "This helper no longer returns a stub result — a crashed backtest "
            "must not be reportable as skipped_outside_window_count=0.",
            pytrace=False,
        )


class TestBacktesterWindowMask:

    def test_empty_windows_no_skipped(self):
        result = _make_minimal_backtest_result([])
        # R-635 §4.1 (ARM ii): index, never .get(...,0). The defaulting form is
        # satisfied by an EMPTY result, so a run_backtest returning {} passed
        # this test. Asserting the keys EXIST makes absence a failure.
        assert "engine_audit" in result, "no engine_audit — nothing was measured"
        assert "skipped_outside_window_count" in result["engine_audit"]
        assert result["engine_audit"]["skipped_outside_window_count"] == 0

    def test_no_windows_field_no_skipped(self):
        result = _make_minimal_backtest_result(None)
        # R-635 §4.1 (ARM ii): see test_empty_windows_no_skipped — indexing
        # rather than defaulting is what makes an empty result FAIL here.
        assert "engine_audit" in result, "no engine_audit — nothing was measured"
        assert "skipped_outside_window_count" in result["engine_audit"]
        assert result["engine_audit"]["skipped_outside_window_count"] == 0

    def test_window_mask_reduces_entries(self):
        """With "09:45-12:00 ET" window, bars at 09:00 ET should be blocked.

        We have 10 bars at 09:00 ET (blocked) and 10 bars at 10:00 ET (allowed).
        skipped_outside_window_count should be >= 10 (the 09:00 ET bars).
        """
        result = _make_minimal_backtest_result(["09:45-12:00 ET"])
        skipped = result.get("engine_audit", {}).get("skipped_outside_window_count", 0)
        # 10 bars at 09:00 ET should be blocked
        assert skipped >= 10, f"Expected >= 10 skipped bars, got {skipped}"

    def test_engine_audit_key_present(self):
        result = _make_minimal_backtest_result(None)
        assert "engine_audit" in result
        assert "skipped_outside_window_count" in result["engine_audit"]


def _extract_builder(func_name: str):
    """Extract a NESTED builder's real source from backtester.py and exec it.

    These builders live inside run_backtest and cannot be imported. Extracting
    the real source by AST (never a hand-copy) is what makes these guards bind
    to shipped code — a copy would assert against a duplicate of the bug.
    """
    import ast

    src_path = pathlib.Path(__file__).resolve().parents[1] / "backtester.py"
    source = src_path.read_text(encoding="utf-8")
    node = next(
        (n for n in ast.walk(ast.parse(source))
         if isinstance(n, ast.FunctionDef) and n.name == func_name),
        None,
    )
    assert node is not None, f"could not extract {func_name}"
    ns: dict = {}
    exec(ast.unparse(node), ns)  # noqa: S102 — the real function under test
    return ns[func_name]


class TestDefaultEventMaskPolarity:
    """R-635 §4.1 (F-A): its own class ON PURPOSE.

    This guard deliberately does NOT call run_backtest — it extracts the
    builder's real source and executes it. Keeping it out of
    TestBacktesterWindowMask preserves that class's property that a broken
    run_backtest turns EVERY member RED.
    """

    def test_default_event_mask_et_polarity_is_sit_out(self):
        """R-635 §4.1 (F-A): guard the ET builder's POLARITY directly.

        WHY THIS TEST EXISTS, and why the other four cannot do its job:
        they all assert on `skipped_outside_window_count`, which is the W23H.3
        ALLOWED-ENTRY-WINDOW mask — a DIFFERENT mask from the event blackout.
        Re-inverting `_build_default_event_mask_et` leaves all four GREEN
        (measured), because the surviving entries land outside the allowed
        window either way and the skip count stays >= 10. A fixture change
        cannot fix that; only an assertion about the event mask can.

        The builder is nested inside run_backtest and cannot be imported, so
        its REAL source is extracted from backtester.py by AST and executed —
        never a hand-copy, which would assert against a duplicate of the bug.
        """
        build_et = _extract_builder("_build_default_event_mask_et")

        in_window = ["2026-03-04T08:30:00-05:00", "2026-03-04T08:59:00-05:00",
                     "2026-03-04T14:00:00-05:00", "2026-03-04T14:29:00-05:00"]
        out_window = ["2026-03-04T08:29:00-05:00", "2026-03-04T09:00:00-05:00",
                      "2026-03-04T10:00:00-05:00", "2026-03-04T14:30:00-05:00"]
        mask = build_et(in_window + out_window)

        # POSITIVE CONTROL: the extraction executed real code.
        assert mask.dtype == bool and mask.shape == (8,)

        # THE POLARITY CONTRACT: True = SIT_OUT. This is what signals.py:288
        # consumes (`block = ~event_mask`, then `entry & block`), and what
        # economic_calendar.generate_event_mask documents.
        assert mask[:4].all(), (
            "blackout-window bars must be True (SIT_OUT); got "
            f"{mask[:4].tolist()} — the ET builder's polarity is INVERTED"
        )
        assert (~mask[4:]).all(), (
            "non-window bars must be False (tradable); got "
            f"{mask[4:].tolist()} — the ET builder's polarity is INVERTED"
        )

    def test_default_event_mask_utc_polarity_is_sit_out(self):
        """R-636 §5.1 (F-C): the LEGACY UTC builder's twin guard.

        AR-666 fixed this builder's polarity alongside the ET one, but nothing
        guarded it: AR-681 §4 named that gap against its own finished work, and
        this closes it. The UTC fallback runs whenever a result has no `ts_et`
        column, so an inversion here is silently reachable in production.

        Its windows are the UTC equivalents: 12:30-14:00 and 18:00-19:30.
        """
        build_utc = _extract_builder("_build_default_event_mask_utc")

        in_window = ["2026-03-04T12:30:00+00:00", "2026-03-04T13:59:00+00:00",
                     "2026-03-04T18:00:00+00:00", "2026-03-04T19:29:00+00:00"]
        out_window = ["2026-03-04T12:29:00+00:00", "2026-03-04T14:00:00+00:00",
                      "2026-03-04T15:00:00+00:00", "2026-03-04T19:30:00+00:00"]
        mask = build_utc(in_window + out_window)

        # POSITIVE CONTROL: the extraction executed real code.
        assert mask.dtype == bool and mask.shape == (8,)

        assert mask[:4].all(), (
            "UTC blackout-window bars must be True (SIT_OUT); got "
            f"{mask[:4].tolist()} — the UTC builder's polarity is INVERTED"
        )
        assert (~mask[4:]).all(), (
            "UTC non-window bars must be False (tradable); got "
            f"{mask[4:].tolist()} — the UTC builder's polarity is INVERTED"
        )
