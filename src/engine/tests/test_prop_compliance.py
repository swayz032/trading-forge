"""Tests for prop firm compliance simulation — TDD."""

import pytest

from src.engine.prop_compliance import (
    simulate_trailing_drawdown_eod,
    simulate_trailing_drawdown_realtime,
    check_tpt_consistency,
    check_ffn_express_consistency,
    run_prop_compliance,
    rank_firms_for_strategy,
    FIRM_CONFIGS,
)


# ─── Trailing Drawdown (EOD) ──────────────────────────────────────

class TestTrailingDrawdownEOD:
    def test_passes_within_limit(self):
        # Balance goes up, never exceeds $2K DD
        balances = [50000, 50500, 51000, 51200, 51500]
        passed, blown_day, max_dd_used = simulate_trailing_drawdown_eod(
            balances, max_dd=2000, locks_at_start=True
        )
        assert passed is True
        assert blown_day is None

    def test_fails_on_breach(self):
        # Balance drops $2,100 from peak
        balances = [50000, 52000, 51000, 50500, 49900]
        passed, blown_day, max_dd_used = simulate_trailing_drawdown_eod(
            balances, max_dd=2000, locks_at_start=True
        )
        assert passed is False
        assert blown_day is not None

    def test_topstep_50k_2100_fails(self):
        """$2,100 drawdown fails Topstep 50K (max DD $2,000)."""
        balances = [50000, 52100, 50000]  # Drop of $2,100
        passed, _, _ = simulate_trailing_drawdown_eod(balances, max_dd=2000)
        assert passed is False

    def test_locks_at_start_behavior(self):
        """Once HWM pushes floor to starting balance, it stays locked."""
        balances = [50000, 52500, 52000, 51500, 50000]
        # HWM=52500, floor would be 52500-2000=50500 if not locked
        # The Topstep lock caps the floor at the original $50K balance.
        # Hitting that floor is a breach.
        passed, _, _ = simulate_trailing_drawdown_eod(
            balances, max_dd=2000, locks_at_start=True
        )
        assert passed is False

    def test_lock_at_start_allows_pullback_above_starting_balance(self):
        balances = [50000, 52500, 50500]

        passed, _, _ = simulate_trailing_drawdown_eod(
            balances, max_dd=2000, locks_at_start=True
        )

        assert passed is True

    def test_mffu_builder_lock_is_100_above_its_stage_start(self):
        eval_passed, _, _ = simulate_trailing_drawdown_eod(
            [50000, 52500, 50500],
            max_dd=2000,
            locks_at_start=False,
            trailing_lock_floor_offset=100,
        )
        funded_passed, _, _ = simulate_trailing_drawdown_eod(
            [0, 2100, 50],
            max_dd=2000,
            locks_at_start=False,
            trailing_lock_floor_offset=100,
        )

        assert eval_passed is True
        assert funded_passed is False


# ─── Trailing Drawdown (Real-time) ────────────────────────────────

class TestTrailingDrawdownRealtime:
    def test_realtime_more_strict(self):
        """Realtime trailing should catch intraday dips that EOD misses."""
        # Intraday equity path with a deep dip
        equity = [50000, 52000, 49500, 51000, 51500]
        passed_rt, _, _ = simulate_trailing_drawdown_realtime(equity, max_dd=2000)
        passed_eod, _, _ = simulate_trailing_drawdown_eod(
            [50000, 51000, 51500], max_dd=2000  # EOD only sees closing values
        )
        assert passed_eod is True
        assert passed_rt is False  # Caught the 52000→49500 dip


# ─── TPT Consistency Rule ─────────────────────────────────────────

class TestTPTConsistency:
    def test_passes_even_distribution(self):
        daily_pnls = [200, 180, 220, 190, 210, 195, 205, 185, 215, 200]
        passed, worst_pct = check_tpt_consistency(daily_pnls)
        assert passed is True

    def test_fails_single_day_dominance(self):
        # One huge day dominates total profit
        daily_pnls = [100, 50, 2000, 75, 80, -50, 60, 70, 65, 55]
        passed, worst_pct = check_tpt_consistency(daily_pnls)
        assert passed is False
        assert worst_pct > 0.50

    def test_no_profit_passes(self):
        daily_pnls = [-100, -200, -50]
        passed, _ = check_tpt_consistency(daily_pnls)
        assert passed is True


# ─── FFN Express Consistency Rule ─────────────────────────────────

class TestFFNConsistency:
    def test_passes_under_limit(self):
        # $3,000 target → max $450/day
        daily_pnls = [400, 350, 300, 200, 250]
        passed, max_day, limit = check_ffn_express_consistency(daily_pnls, 3000)
        assert passed is True
        assert limit == 450

    def test_fails_over_limit(self):
        daily_pnls = [400, 350, 500, 200, 250]  # $500 > $450 limit
        passed, max_day, limit = check_ffn_express_consistency(daily_pnls, 3000)
        assert passed is False
        assert max_day == 500


# ─── Full Compliance Run ──────────────────────────────────────────

class TestRunPropCompliance:
    # Fresh-scan HIGH#9 (2026-07-12): the 9 legacy firms (tpt/apex/tradeify/alpha/ffn/…) were
    # removed via migration 0097 (CLAUDE.md §6). FIRM_CONFIGS now holds ONLY topstep_50k + mffu_50k.
    # These tests asserted the removed-firm era (len==8, results["tpt_50k"]/["alpha_50k"]) → 3 failures
    # (KeyError) red-lit the whole test-python CI job, which SKIPS `build` → the 6 TS↔Python parity
    # hard gates never ran. Realigned to the current 2-firm roster.
    def test_returns_topstep_and_mffu_only(self):
        daily_pnls = [250] * 20
        stats = {
            "avg_daily_pnl": 250,
            "max_drawdown": 1500,
            "trades_overnight": False,
            "consistency_ratio": 0.10,
        }
        results = run_prop_compliance(daily_pnls, stats)
        assert len(results) == 2
        assert set(results.keys()) == {"topstep_50k", "mffu_50k"}

    def test_high_dd_fails_all_firms(self):
        """$2,100 DD exceeds both firms' $2K limit — all fail."""
        daily_pnls = [500, 500, -700, -700, -700, 500, 500, 500, 500]
        stats = {
            "avg_daily_pnl": 300,
            "max_drawdown": 2100,
            "trades_overnight": False,
            "consistency_ratio": 0.10,
        }
        results = run_prop_compliance(daily_pnls, stats)
        assert results["topstep_50k"]["passed"] is False
        assert results["mffu_50k"]["passed"] is False  # both firms $2K limit

    def test_overnight_flagged_by_both_firms(self):
        """Both Topstep and MFFU are day-trader-only (overnight_ok=False) → overnight positions fail."""
        daily_pnls = [250] * 20
        stats = {
            "avg_daily_pnl": 250,
            "max_drawdown": 1500,
            "trades_overnight": True,
            "consistency_ratio": 0.10,
        }
        results = run_prop_compliance(daily_pnls, stats)
        assert results["topstep_50k"]["passed"] is False
        assert results["mffu_50k"]["passed"] is False

    def test_each_result_has_required_fields(self):
        daily_pnls = [250] * 20
        stats = {
            "avg_daily_pnl": 250,
            "max_drawdown": 1500,
            "trades_overnight": False,
            "consistency_ratio": 0.10,
        }
        results = run_prop_compliance(daily_pnls, stats)
        for firm, result in results.items():
            assert "passed" in result
            assert "expected_eval_cost" in result
            assert "payout_split" in result

    def test_topstep_evaluation_freezes_after_first_passing_day(self):
        results = run_prop_compliance(
            [1500, 1500, 5000, -1000],
            {
                "avg_daily_pnl": 1750,
                "max_drawdown": 1000,
                "trades_overnight": False,
            },
        )

        assert results["topstep_50k"]["passed"] is True
        assert not any(
            "Topstep Combine not yet eligible" in failure
            for failure in results["topstep_50k"]["failures"]
        )


# ─── Firm Ranking ─────────────────────────────────────────────────

class TestRankFirms:
    def test_ranking_returns_sorted(self):
        stats = {
            "avg_daily_pnl": 300,
            "max_daily_pnl": 600,
            "max_drawdown": 1500,
            "avg_days_to_target": 15,
            "trades_overnight": False,
            "consistency_ratio": 0.10,
        }
        rankings = rank_firms_for_strategy(stats)
        assert len(rankings) > 0
        # Should be sorted by ROI descending
        for i in range(len(rankings) - 1):
            assert rankings[i]["roi"] >= rankings[i + 1]["roi"]

    def test_high_dd_excludes_all_firms(self):
        """$2,800 DD exceeds all firms' $2K limit — all excluded."""
        stats = {
            "avg_daily_pnl": 300,
            "max_daily_pnl": 600,
            "max_drawdown": 2800,  # Exceeds all firms ($2K limit)
            "avg_days_to_target": 15,
            "trades_overnight": False,
            "consistency_ratio": 0.10,
        }
        rankings = rank_firms_for_strategy(stats)
        firm_names = [r["firm"] for r in rankings]
        assert len(firm_names) == 0  # All firms now $2K — none survive $2,800 DD


# ─── FIX 4 (2026-07-02): MFFU consistency stage-scoping ──────────────────────

class TestMFFUConsistencyStageScoping:
    """MFFU 50% consistency is SIM-PAYOUT-stage-only (firm_config.py §MFFU).
    MC survival sim skips it; enforce_mffu_consistency=True activates it.
    Topstep Combine's dynamic effective target is evaluated regardless of the
    MFFU payout-stage parameter.
    """

    def _good_stats(self) -> dict:
        """Baseline stats that pass all hard gates except what we test."""
        return {
            "avg_daily_pnl": 250,
            "max_drawdown": 1500,
            "trades_overnight": False,
            "consistency_ratio": 0.10,
        }

    def test_mffu_daily_loss_limit_is_1000_not_none(self):
        """MFFU daily_loss_limit must be 1000 (firm_config.py:148), not None."""
        mffu = FIRM_CONFIGS["mffu_50k"]
        assert mffu["daily_loss_limit"] == 1000, (
            f"MFFU daily_loss_limit must be 1000 (per firm_config.py:148), "
            f"got {mffu['daily_loss_limit']!r}"
        )

    def test_mffu_consistency_skipped_by_default(self):
        """MFFU consistency check is skipped when enforce_mffu_consistency=False (default).

        A strategy with one dominant day (>50% of profit) must still PASS MFFU
        when the default MC context is used — consistency only gates at sim-payout.
        """
        # 1 big day > 50% of total profit → would fail consistency check if enforced
        # day0 = 900 / (900+100+100+50+50+100+100+100+100+100) = 900/1700 ≈ 53% > 50%
        pnls = [900, 100, 100, 50, 50, 100, 100, 100, 100, 100]
        results = run_prop_compliance(pnls, self._good_stats())  # default: skip MFFU
        # MFFU must pass — consistency check skipped outside sim-payout
        mffu_failures = results["mffu_50k"]["failures"]
        consistency_fail = [f for f in mffu_failures if "consistency" in f.lower()]
        assert len(consistency_fail) == 0, (
            f"MFFU consistency must be skipped outside sim-payout stage. "
            f"Got failures: {consistency_fail}"
        )

    def test_mffu_payout_eligibility_is_separate_when_requested(self):
        """A recoverable sim-funded payout delay never fails the account."""
        # The sim-funded payout buffer must be met before consistency is evaluated.
        # day0 remains above 50% of the funded payout window after firm costs.
        pnls = [1800, 700, 700]
        results = run_prop_compliance(
            pnls,
            self._good_stats(),
            enforce_mffu_consistency=True,
            payout_contexts={
                "mffu_50k": {
                    "daily_pnls": pnls,
                    "traded_days": [True, True, True],
                    "account_state": {"account_balance": 3200.0, "cycle_elapsed_hours": 72.0},
                }
            },
        )
        mffu = results["mffu_50k"]
        assert mffu["passed"] is True
        assert mffu["payout_eligibility"]["eligible"] is False
        assert mffu["payout_eligibility"]["reason"] == "consistency_target_not_met"

    def test_topstep_dynamic_target_is_always_evaluated(self):
        """Topstep's two-day dynamic target does not depend on MFFU payout mode."""
        # The first day is more than half of total profit, so Topstep must keep
        # trading toward the raised effective target. This is recoverable.
        pnls = [900, 100, 100, 50, 50, 100, 100, 100, 100, 100]
        # Default (MFFU skip)
        results_default = run_prop_compliance(pnls, self._good_stats())
        # Explicit opt-in
        results_optin = run_prop_compliance(
            pnls, self._good_stats(), enforce_mffu_consistency=True
        )
        # Topstep must report a recoverable evaluation shortfall in BOTH cases.
        for label, results in [("default", results_default), ("opt-in", results_optin)]:
            ts_failures = results["topstep_50k"]["failures"]
            dynamic_target_failure = [f for f in ts_failures if "not yet eligible" in f.lower()]
            assert len(dynamic_target_failure) > 0, (
                f"Topstep dynamic target must be evaluated ({label}). "
                f"Failures were: {ts_failures}"
            )
