"""Tests for src/engine/invariant_harness — Pass B-2.

Each of the 14 invariants gets one positive test (holds on good data) and one
negative test (catches a deliberately-broken case).  Total: 28 unit tests plus
one integration regression test for the DLL-cap bug class.

All tests use synthetic dict fixtures — no real backtest data required.
"""
from __future__ import annotations

import math

import pytest

from src.engine.invariant_harness import InvariantHarness, run_invariants
from src.engine.invariant_harness.core import (
    _check_avg_trade_pnl_consistent,
    _check_balance_arithmetic,
    _check_commission_per_trade_reasonable,
    _check_daily_pnl_sum,
    _check_equity_curve_continuous,
    _check_long_short_count,
    _check_long_short_split_sum,
    _check_max_drawdown_non_negative,
    _check_peak_equity_at_least_starting,
    _check_per_firm_endings,
    _check_profit_factor_finite,
    _check_sharpe_finite,
    _check_trade_pnl_sum,
    _check_win_rate_in_range,
)

# ─── Shared fixtures ─────────────────────────────────────────────────────────

STARTING = 50_000.0


def _make_good_result(
    *,
    total_return: float = 2_000.0,
    total_trades: int = 10,
    win_rate: float = 0.6,
    profit_factor: float = 1.8,
    sharpe: float = 1.5,
    max_drawdown: float = 800.0,
) -> dict:
    """Build a self-consistent synthetic backtest result dict."""
    avg_pnl = total_return / total_trades if total_trades > 0 else 0.0
    per_trade = [avg_pnl] * total_trades
    long_trades = total_trades // 2
    short_trades = total_trades - long_trades
    long_pnl = avg_pnl * long_trades
    short_pnl = avg_pnl * short_trades

    # Equity bars: start at 50k, end at 50k + total_return
    n_bars = 100
    step = total_return / n_bars if n_bars > 0 else 0.0
    equity_bars = [STARTING + step * i for i in range(n_bars + 1)]

    # Daily pnls: N days, sum == total_return
    n_days = 10
    daily_per = total_return / n_days if n_days > 0 else 0.0
    daily_pnls = [daily_per] * n_days if total_trades > 0 else []

    trades = []
    for i, pnl in enumerate(per_trade):
        direction = "Long" if i < long_trades else "Short"
        trades.append({
            "Direction": direction,
            "PnL": round(pnl, 2),
            "CommissionCost": 1.24,   # $0.62/side × 2 = $1.24 roundtrip (1 contract)
            "Size": 1.0,
        })

    return {
        "starting_balance": STARTING,
        "ending_balance": round(STARTING + total_return, 2),
        "total_return": round(total_return, 6),
        "total_trades": total_trades,
        "win_rate": win_rate,
        "profit_factor": profit_factor,
        "sharpe_ratio": sharpe,
        "max_drawdown": max_drawdown,
        "avg_trade_pnl": round(avg_pnl, 2),
        "trades": trades,
        "daily_pnls": daily_pnls,
        "equity_bars": equity_bars,
        "equity_curve": [{"time": f"2025-01-{i+1:02d}", "value": v} for i, v in enumerate(equity_bars[::10])],
        "long_short_split": {
            "long": {"trades": long_trades, "pnl": round(long_pnl, 2)},
            "short": {"trades": short_trades, "pnl": round(short_pnl, 2)},
        },
        "prop_compliance": {
            "topstep": {
                "starting_balance": STARTING,
                "ending_balance": round(STARTING + total_return, 2),
                "ending_balance_uncapped": round(STARTING + total_return, 2),
            }
        },
    }


# ─── INV-1 balance_arithmetic ────────────────────────────────────────────────

class TestBalanceArithmetic:
    def test_passes_on_consistent_result(self):
        result = _make_good_result(total_return=2000.0)
        check = _check_balance_arithmetic(result)
        assert check.passed
        assert check.severity == "CRITICAL"

    def test_catches_dll_cap_inflation(self):
        """Mirrors the Topstep +$7K bug: ending_balance >> starting + total_return."""
        result = _make_good_result(total_return=-3_000.0)
        # Artificially inflate ending_balance as the DLL-cap bug did
        result["ending_balance"] = STARTING + 7_000.0   # should be 47_000
        check = _check_balance_arithmetic(result)
        assert not check.passed
        assert "CRITICAL" == check.severity
        assert "drift" in check.evidence.lower() or "diff" in check.evidence.lower()

    def test_allows_rounding_within_tolerance(self):
        result = _make_good_result(total_return=1234.567)
        result["ending_balance"] = STARTING + 1234.57   # $0.003 rounding delta
        check = _check_balance_arithmetic(result)
        assert check.passed

    def test_fails_outside_tolerance(self):
        result = _make_good_result(total_return=1000.0)
        result["ending_balance"] = STARTING + 1001.50  # $1.50 > $1.00 tolerance
        check = _check_balance_arithmetic(result)
        assert not check.passed


# ─── INV-2 trade_pnl_sum_matches_total_return ────────────────────────────────

class TestTradePnlSum:
    def test_passes_on_consistent_result(self):
        result = _make_good_result(total_trades=10, total_return=2_000.0)
        check = _check_trade_pnl_sum(result)
        assert check.passed

    def test_catches_drift(self):
        """Mirrors the $1,320 drift bug found on BB-MES strategy."""
        result = _make_good_result(total_trades=10, total_return=2_000.0)
        # Each trade reports correct PnL, but total_return is wrong
        result["total_return"] = 3_320.0   # $1,320 inflated
        check = _check_trade_pnl_sum(result)
        assert not check.passed
        assert "drift" in check.evidence.lower() or "1320" in check.evidence or "1320" in check.actual

    def test_empty_trades_with_zero_return(self):
        result = _make_good_result(total_return=0.0, total_trades=0)
        result["trades"] = []
        check = _check_trade_pnl_sum(result)
        assert check.passed


# ─── INV-3 daily_pnl_sum_matches_total_return ────────────────────────────────

class TestDailyPnlSum:
    def test_passes_on_consistent_result(self):
        result = _make_good_result(total_return=500.0)
        check = _check_daily_pnl_sum(result)
        assert check.passed

    def test_catches_eod_drift(self):
        result = _make_good_result(total_return=500.0)
        # Daily pnls sum to 510 but total_return is 500 — exceeds $5 tolerance
        result["daily_pnls"] = [51.0] * 10   # sum = 510, diff = 10 > 5
        check = _check_daily_pnl_sum(result)
        assert not check.passed

    def test_empty_daily_pnls_no_trades_passes(self):
        result = _make_good_result(total_return=0.0, total_trades=0)
        result["daily_pnls"] = []
        result["total_trades"] = 0
        check = _check_daily_pnl_sum(result)
        assert check.passed

    def test_empty_daily_pnls_with_trades_fails(self):
        result = _make_good_result(total_return=1000.0, total_trades=5)
        result["daily_pnls"] = []
        check = _check_daily_pnl_sum(result)
        assert not check.passed


# ─── INV-4 long_short_split_matches_total ────────────────────────────────────

class TestLongShortSplitSum:
    def test_passes_on_balanced_split(self):
        result = _make_good_result(total_return=2000.0, total_trades=10)
        check = _check_long_short_split_sum(result)
        assert check.passed

    def test_catches_direction_mismatch(self):
        result = _make_good_result(total_return=2000.0, total_trades=10)
        # long_pnl + short_pnl = 2500, but total_return = 2000
        result["long_short_split"]["long"]["pnl"] = 1500.0
        result["long_short_split"]["short"]["pnl"] = 1000.0
        check = _check_long_short_split_sum(result)
        assert not check.passed

    def test_skips_gracefully_when_no_split_data(self):
        result = _make_good_result()
        result.pop("long_short_split")
        check = _check_long_short_split_sum(result)
        assert check.passed  # absent data = skip, not fail


# ─── INV-5 long_short_trade_counts_match_total_trades ────────────────────────

class TestLongShortCount:
    def test_passes_on_correct_counts(self):
        result = _make_good_result(total_trades=10)
        check = _check_long_short_count(result)
        assert check.passed

    def test_catches_count_mismatch(self):
        result = _make_good_result(total_trades=10)
        result["long_short_split"]["long"]["trades"] = 7  # 7 + 5 = 12 != 10
        result["long_short_split"]["short"]["trades"] = 5
        check = _check_long_short_count(result)
        assert not check.passed
        assert "12" in check.evidence or "mismatch" in check.evidence.lower()

    def test_skips_gracefully_when_no_split_data(self):
        result = _make_good_result()
        result.pop("long_short_split")
        check = _check_long_short_count(result)
        assert check.passed


# ─── INV-6 win_rate_in_range ─────────────────────────────────────────────────

class TestWinRateInRange:
    def test_passes_on_valid_rate(self):
        result = _make_good_result(win_rate=0.6)
        check = _check_win_rate_in_range(result)
        assert check.passed

    def test_passes_at_boundaries(self):
        for rate in (0.0, 1.0):
            result = _make_good_result(win_rate=rate)
            check = _check_win_rate_in_range(result)
            assert check.passed, f"Should pass at {rate}"

    def test_catches_rate_above_one(self):
        result = _make_good_result(win_rate=1.05)
        check = _check_win_rate_in_range(result)
        assert not check.passed

    def test_catches_negative_rate(self):
        result = _make_good_result(win_rate=-0.1)
        check = _check_win_rate_in_range(result)
        assert not check.passed


# ─── INV-7 max_drawdown_non_negative ─────────────────────────────────────────

class TestMaxDrawdownNonNegative:
    def test_passes_on_positive_dd(self):
        result = _make_good_result(max_drawdown=500.0)
        check = _check_max_drawdown_non_negative(result)
        assert check.passed

    def test_passes_on_zero_dd(self):
        result = _make_good_result(max_drawdown=0.0)
        check = _check_max_drawdown_non_negative(result)
        assert check.passed

    def test_catches_negative_dd(self):
        result = _make_good_result(max_drawdown=-200.0)
        check = _check_max_drawdown_non_negative(result)
        assert not check.passed
        assert "sign" in check.evidence.lower() or "negative" in check.evidence.lower()


# ─── INV-8 peak_equity_at_least_starting ────────────────────────────────────

class TestPeakEquityAtLeastStarting:
    def test_passes_when_equity_grows(self):
        result = _make_good_result(total_return=2000.0)
        check = _check_peak_equity_at_least_starting(result)
        assert check.passed

    def test_passes_at_starting_balance(self):
        """Strategy never goes above starting — peak == starting is valid."""
        result = _make_good_result(total_return=-500.0)
        result["equity_bars"] = [STARTING - i * 10 for i in range(51)]  # always declining
        check = _check_peak_equity_at_least_starting(result)
        # peak is STARTING (first bar) which equals starting_balance
        assert check.passed

    def test_catches_equity_below_starting_from_bar_0(self):
        """equity_bars that start below starting_balance — initialization bug."""
        result = _make_good_result()
        result["equity_bars"] = [STARTING - 100.0 - i for i in range(10)]  # always below
        check = _check_peak_equity_at_least_starting(result)
        assert not check.passed


# ─── INV-9 sharpe_finite_if_trades ──────────────────────────────────────────

class TestSharpeFinite:
    def test_passes_on_valid_sharpe(self):
        result = _make_good_result(sharpe=1.5)
        check = _check_sharpe_finite(result)
        assert check.passed
        assert check.severity == "WARNING"

    def test_passes_when_no_trades(self):
        result = _make_good_result(total_trades=0)
        result["sharpe_ratio"] = float("nan")
        check = _check_sharpe_finite(result)
        assert check.passed

    def test_catches_nan_sharpe_with_trades(self):
        result = _make_good_result(total_trades=10)
        result["sharpe_ratio"] = float("nan")
        check = _check_sharpe_finite(result)
        assert not check.passed

    def test_catches_inf_sharpe_with_trades(self):
        result = _make_good_result(total_trades=10)
        result["sharpe_ratio"] = float("inf")
        check = _check_sharpe_finite(result)
        assert not check.passed


# ─── INV-10 profit_factor_finite_if_trades ───────────────────────────────────

class TestProfitFactorFinite:
    def test_passes_on_valid_pf(self):
        result = _make_good_result(profit_factor=1.8)
        check = _check_profit_factor_finite(result)
        assert check.passed
        assert check.severity == "WARNING"

    def test_passes_when_no_trades(self):
        result = _make_good_result(total_trades=0)
        result["profit_factor"] = float("inf")
        check = _check_profit_factor_finite(result)
        assert check.passed

    def test_catches_inf_pf_with_trades(self):
        result = _make_good_result(total_trades=10)
        result["profit_factor"] = float("inf")
        check = _check_profit_factor_finite(result)
        assert not check.passed

    def test_catches_sentinel_999_pf_with_trades(self):
        """Engine caps inf to 999.99 — treat as non-finite for this warning."""
        result = _make_good_result(total_trades=10)
        result["profit_factor"] = 999.99
        check = _check_profit_factor_finite(result)
        assert not check.passed


# ─── INV-11 avg_trade_pnl_consistent ────────────────────────────────────────

class TestAvgTradePnlConsistent:
    def test_passes_on_consistent_avg(self):
        result = _make_good_result(total_return=2000.0, total_trades=10)
        # avg_trade_pnl = 200.0 exactly
        check = _check_avg_trade_pnl_consistent(result)
        assert check.passed
        assert check.severity == "WARNING"

    def test_passes_when_no_trades(self):
        result = _make_good_result(total_trades=0)
        result["avg_trade_pnl"] = 0.0
        check = _check_avg_trade_pnl_consistent(result)
        assert check.passed

    def test_catches_large_discrepancy(self):
        result = _make_good_result(total_return=2000.0, total_trades=10)
        result["avg_trade_pnl"] = 50.0   # should be 200; diff = 150 >> $0.50 tolerance
        check = _check_avg_trade_pnl_consistent(result)
        assert not check.passed


# ─── INV-12 commission_per_trade_reasonable ──────────────────────────────────

class TestCommissionReasonable:
    def test_passes_on_standard_commission(self):
        """$1.24/trade roundtrip (Topstep rate) should pass $3 ceiling."""
        result = _make_good_result(total_trades=10)
        check = _check_commission_per_trade_reasonable(result)
        assert check.passed
        assert check.severity == "WARNING"

    def test_passes_when_no_trades(self):
        result = _make_good_result(total_trades=0)
        result["trades"] = []
        check = _check_commission_per_trade_reasonable(result)
        assert check.passed

    def test_catches_commission_per_bar_bug(self):
        """If commission were charged per bar instead of per trade it would be huge."""
        result = _make_good_result(total_trades=5)
        # $100 per trade = $500 total, ceiling = 5 × $3 = $15
        for t in result["trades"]:
            t["CommissionCost"] = 100.0
        result["total_trades"] = 5
        result["trades"] = result["trades"][:5]
        check = _check_commission_per_trade_reasonable(result)
        assert not check.passed
        assert "ceiling" in check.evidence.lower() or "per bar" in check.evidence.lower() or "commission" in check.evidence.lower()


# ─── INV-13 per_firm_endings_consistent ─────────────────────────────────────

class TestPerFirmEndings:
    def test_passes_on_consistent_firm(self):
        result = _make_good_result(total_return=2000.0)
        check = _check_per_firm_endings(result)
        assert check.passed
        assert check.severity == "WARNING"

    def test_passes_when_no_prop_compliance(self):
        result = _make_good_result()
        result.pop("prop_compliance")
        check = _check_per_firm_endings(result)
        assert check.passed

    def test_catches_dll_inflated_uncapped_balance(self):
        """If ending_balance_uncapped itself is wrong, harness must catch it."""
        result = _make_good_result(total_return=-3_000.0)
        # uncapped should be 47_000 but if it's reported as 54_000 (DLL bug leaking into uncapped)
        result["prop_compliance"]["topstep"]["ending_balance_uncapped"] = 54_000.0
        check = _check_per_firm_endings(result)
        assert not check.passed
        assert "topstep" in check.evidence.lower()


# ─── INV-14 equity_curve_monotone_or_continuous ──────────────────────────────

class TestEquityCurveContinuous:
    def test_passes_on_clean_curve(self):
        result = _make_good_result(total_return=1000.0)
        check = _check_equity_curve_continuous(result)
        assert check.passed
        assert check.severity == "WARNING"

    def test_passes_when_no_trades(self):
        result = _make_good_result(total_trades=0)
        result["equity_bars"] = []
        result["equity_curve"] = []
        check = _check_equity_curve_continuous(result)
        assert check.passed

    def test_catches_nan_in_equity_bars(self):
        result = _make_good_result(total_trades=5)
        result["equity_bars"] = [STARTING, float("nan"), STARTING + 100.0, STARTING + 200.0]
        check = _check_equity_curve_continuous(result)
        assert not check.passed
        assert "nan" in check.evidence.lower() or "NaN" in check.evidence

    def test_catches_empty_curve_with_trades(self):
        result = _make_good_result(total_trades=5)
        result["equity_bars"] = []
        result["equity_curve"] = []
        check = _check_equity_curve_continuous(result)
        assert not check.passed
        assert "empty" in check.evidence.lower()


# ─── Full harness integration ────────────────────────────────────────────────

class TestInvariantHarnessIntegration:
    def test_all_14_checks_run(self):
        result = _make_good_result()
        report = run_invariants(result)
        assert report.total_checks == 14

    def test_good_result_passes_overall(self):
        result = _make_good_result()
        report = run_invariants(result)
        assert report.overall_passed
        assert report.failed == 0

    def test_harness_class_api(self):
        harness = InvariantHarness()
        result = _make_good_result()
        report = harness.verify(result)
        assert report.total_checks == 14
        assert report.passed + report.failed == report.total_checks

    def test_critical_failure_sets_overall_passed_false(self):
        result = _make_good_result(total_return=2000.0)
        result["ending_balance"] = STARTING + 9_000.0   # $7K inflation
        report = run_invariants(result)
        assert not report.overall_passed
        assert any(c.name == "balance_arithmetic" for c in report.critical_failures)

    def test_warning_does_not_fail_overall(self):
        result = _make_good_result(total_trades=5)
        result["sharpe_ratio"] = float("nan")  # triggers WARNING
        report = run_invariants(result)
        # sharpe_finite_if_trades is WARNING — should not set overall_passed=False
        assert report.overall_passed
        assert any(c.name == "sharpe_finite_if_trades" for c in report.warnings)

    def test_report_fields_shape(self):
        result = _make_good_result()
        report = run_invariants(result)
        assert isinstance(report.critical_failures, list)
        assert isinstance(report.warnings, list)
        assert isinstance(report.all_checks, list)
        assert isinstance(report.backtest_id, str)

    def test_backtest_id_propagated(self):
        result = _make_good_result()
        result["backtest_id"] = "test-uuid-1234"
        report = run_invariants(result)
        assert report.backtest_id == "test-uuid-1234"


# ─── Regression: DLL-cap bug class (2026-05-19 session) ─────────────────────

class TestDllCapBugRegression:
    """Regression test for the Topstep ending_balance +$7K inflation bug.

    A losing strategy with total_return = -$3,000 should have
    ending_balance = $47,000.  If the DLL-cap simulation inflates
    ending_balance to $54,000 (as the historical bug did), the
    balance_arithmetic invariant must catch it.

    Historical context: commits c7ac642 and b8a2140 from the 2026-05-19
    accuracy audit fixed the root cause (DLL-cap firing on EOD MTM swings).
    This test ensures the invariant would have caught the bug class earlier.
    """

    def _make_dll_cap_bug_result(self) -> dict:
        """Construct a result dict mimicking the DLL-cap inflation bug."""
        total_return = -3_000.0
        result = _make_good_result(total_return=total_return, total_trades=8)
        # Simulate the bug: DLL-cap simulation inflates ending_balance
        # by $7,000 relative to what the raw backtest returned
        result["ending_balance"] = STARTING + 7_000.0   # should be $47,000
        # total_return is correct (raw backtest was accurate)
        result["total_return"] = total_return
        return result

    def test_harness_catches_dll_cap_inflation(self):
        result = self._make_dll_cap_bug_result()
        report = run_invariants(result)
        assert not report.overall_passed, (
            "DLL-cap inflation should fail overall_passed via balance_arithmetic"
        )
        critical_names = [c.name for c in report.critical_failures]
        assert "balance_arithmetic" in critical_names, (
            f"balance_arithmetic should be in critical_failures; got: {critical_names}"
        )

    def test_balance_arithmetic_evidence_mentions_drift(self):
        result = self._make_dll_cap_bug_result()
        report = run_invariants(result)
        bal_check = next(c for c in report.critical_failures if c.name == "balance_arithmetic")
        evidence_lower = bal_check.evidence.lower()
        assert "drift" in evidence_lower or "diff" in evidence_lower or "inflation" in evidence_lower, (
            f"Evidence should describe the drift: {bal_check.evidence}"
        )

    def test_drift_magnitude_captured_in_actual_field(self):
        result = self._make_dll_cap_bug_result()
        report = run_invariants(result)
        bal_check = next(c for c in report.critical_failures if c.name == "balance_arithmetic")
        # The actual field should show the diff = $10,000 (54k actual - 44k expected)
        assert "diff" in bal_check.actual.lower(), (
            f"actual field should show diff; got: {bal_check.actual}"
        )
