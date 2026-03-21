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
        # But locks_at_start means floor = max(50500, 50000-2000=48000) = 50500
        # So 50000 < 50500 → blown
        passed, _, _ = simulate_trailing_drawdown_eod(
            balances, max_dd=2000, locks_at_start=True
        )
        assert passed is False


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
    def test_returns_all_7_firms(self):
        daily_pnls = [250] * 20
        stats = {
            "avg_daily_pnl": 250,
            "max_drawdown": 1500,
            "trades_overnight": False,
            "consistency_ratio": 0.10,
        }
        results = run_prop_compliance(daily_pnls, stats)
        assert len(results) == 7
        assert "topstep_50k" in results
        assert "mffu_50k" in results
        assert "tpt_50k" in results
        assert "apex_50k" in results
        assert "tradeify_50k" in results
        assert "alpha_50k" in results
        assert "ffn_50k" in results

    def test_topstep_fails_high_dd(self):
        """$2,100 DD fails Topstep but passes TPT ($3K limit)."""
        # PnLs: up $1000, then drop $2,100 from peak, then recover
        daily_pnls = [500, 500, -700, -700, -700, 500, 500, 500, 500]
        stats = {
            "avg_daily_pnl": 300,
            "max_drawdown": 2100,
            "trades_overnight": False,
            "consistency_ratio": 0.10,
        }
        results = run_prop_compliance(daily_pnls, stats)
        assert results["topstep_50k"]["passed"] is False
        assert results["tpt_50k"]["passed"] is True  # $3K limit

    def test_alpha_no_overnight(self):
        """Alpha Futures flags overnight positions."""
        daily_pnls = [250] * 20
        stats = {
            "avg_daily_pnl": 250,
            "max_drawdown": 1500,
            "trades_overnight": True,
            "consistency_ratio": 0.10,
        }
        results = run_prop_compliance(daily_pnls, stats)
        assert results["alpha_50k"]["passed"] is False

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

    def test_high_dd_excludes_firms(self):
        stats = {
            "avg_daily_pnl": 300,
            "max_daily_pnl": 600,
            "max_drawdown": 2800,  # Exceeds most firms
            "avg_days_to_target": 15,
            "trades_overnight": False,
            "consistency_ratio": 0.10,
        }
        rankings = rank_firms_for_strategy(stats)
        # Should exclude firms with tighter limits
        firm_names = [r["firm"] for r in rankings]
        assert "topstep_50k" not in firm_names  # $2K limit
        assert "tpt_50k" in firm_names  # $3K limit
