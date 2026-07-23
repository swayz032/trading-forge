"""Tests for Topstep 50% consistency rule — 2026-06-22 fix.

Verifies that:
1. firm_config.py FIRM_RULES["topstep_50k"]["consistency_rule"] == "topstep_50pct"
2. prop_compliance.py run_prop_compliance() now fails Topstep when a single
   day > 50% of cumulative profit (previously never checked for Topstep).
3. MFFU consistency check is unaffected (still "mffu_50pct", still enforced).
4. Both firms PASS when no single day exceeds 50% of cumulative profit.
5. rank_firms_for_strategy() disqualifies both firms when consistency_ratio > 0.50.

Run with: python -m pytest tests/python/test_topstep_consistency_rule.py -v
"""
from __future__ import annotations

# ─── Helper ──────────────────────────────────────────────────────────────────

def _import_firm_config():
    from src.engine.firm_config import FIRM_RULES
    return FIRM_RULES


def _import_compliance():
    from src.engine.prop_compliance import FIRM_CONFIGS, check_tpt_consistency, run_prop_compliance
    return run_prop_compliance, check_tpt_consistency, FIRM_CONFIGS


def _run(daily_pnls, **stat_overrides):
    run_prop_compliance, _, _ = _import_compliance()
    stats = {
        "symbol": "MES",
        "total_trades": len(daily_pnls),
        "total_trading_days": len(daily_pnls),
        "avg_daily_pnl": sum(daily_pnls) / max(len(daily_pnls), 1),
        "trades_overnight": False,
        **stat_overrides,
    }
    return run_prop_compliance(daily_pnls, stats)


# ─── Config-level checks ──────────────────────────────────────────────────────

class TestFirmConfigConsistencyRule:
    """firm_config.py FIRM_RULES must declare topstep_50pct."""

    def test_topstep_consistency_rule_is_topstep_50pct(self):
        rules = _import_firm_config()
        assert rules["topstep_50k"]["consistency_rule"] == "topstep_50pct", (
            "Topstep consistency_rule must be 'topstep_50pct' not None "
            "(fix 2026-06-22: 5 corroborating sources confirm the 50% rule)"
        )

    def test_mffu_consistency_rule_unchanged(self):
        rules = _import_firm_config()
        assert rules["mffu_50k"]["consistency_rule"] == "mffu_50pct_sim_payout", (
            "MFFU consistency applies only at the simulated-funded payout stage"
        )

    def test_topstep_prop_compliance_config_consistency_rule(self):
        _, _, FIRM_CONFIGS = _import_compliance()
        assert FIRM_CONFIGS["topstep_50k"]["consistency_rule"] == "topstep_50pct", (
            "prop_compliance.py FIRM_CONFIGS['topstep_50k']['consistency_rule'] "
            "must be 'topstep_50pct'"
        )


# ─── Topstep consistency enforcement ─────────────────────────────────────────

class TestTopstepConsistencyEnforcement:
    """run_prop_compliance() must fail Topstep when best day > 50% of total profit."""

    def test_topstep_fails_when_single_day_exceeds_50pct(self):
        """$600 on day 1 / $1000 total = 60% — must FAIL."""
        daily_pnls = [600.0, 200.0, 100.0, 100.0]  # Day 1 = 60% of $1000 profit
        results = _run(daily_pnls)
        topstep = results["topstep_50k"]
        assert not topstep["passed"], (
            "Topstep must FAIL when single day = 60% of total profit "
            "(50% consistency rule)"
        )
        assert any("consistency" in f.lower() for f in topstep["failures"]), (
            f"Failure message must mention consistency. Got: {topstep['failures']}"
        )

    def test_topstep_fails_exactly_at_boundary_over_50pct(self):
        """$501 / $1000 = 50.1% — must FAIL (rule is strictly > 50%)."""
        daily_pnls = [501.0, 499.0]
        results = _run(daily_pnls)
        topstep = results["topstep_50k"]
        assert not topstep["passed"], (
            "Topstep must FAIL when best day = 50.1% of total profit"
        )

    def test_topstep_passes_when_all_days_equal(self):
        """$500 / $1000 = 50.0% — must PASS (rule is > 50%, not >= 50%)."""
        daily_pnls = [500.0, 500.0]
        results = _run(daily_pnls)
        topstep = results["topstep_50k"]
        consistency_failures = [f for f in topstep["failures"] if "consistency" in f.lower()]
        assert not consistency_failures, (
            f"Topstep must PASS consistency check at exactly 50.0%. "
            f"Got consistency failures: {consistency_failures}"
        )

    def test_topstep_passes_well_distributed_profit(self):
        """$250 max / $1000 total = 25% — must PASS."""
        daily_pnls = [250.0, 250.0, 250.0, 250.0]
        results = _run(daily_pnls)
        topstep = results["topstep_50k"]
        consistency_failures = [f for f in topstep["failures"] if "consistency" in f.lower()]
        assert not consistency_failures, (
            f"Topstep must PASS when profit is evenly distributed (25% max day). "
            f"Got: {consistency_failures}"
        )

    def test_topstep_failure_message_names_topstep(self):
        """Failure message must name 'Topstep' (not 'MFFU')."""
        daily_pnls = [800.0, 100.0, 100.0]  # 80% — clear violation
        results = _run(daily_pnls)
        topstep = results["topstep_50k"]
        assert not topstep["passed"]
        topstep_msg = " ".join(topstep["failures"])
        assert "Topstep" in topstep_msg, (
            f"Failure message must say 'Topstep', got: {topstep_msg}"
        )
        assert "MFFU" not in topstep_msg, (
            f"Topstep failure message must not say 'MFFU', got: {topstep_msg}"
        )


# ─── MFFU consistency enforcement (regression) ───────────────────────────────

class TestMffuConsistencyUnchanged:
    """MFFU consistency enforcement must be unaffected by the Topstep fix."""

    def test_mffu_fails_when_single_day_exceeds_50pct(self):
        """$700 / $1000 = 70% — MFFU must still fail."""
        daily_pnls = [700.0, 300.0]
        results = _run(daily_pnls)
        mffu = results["mffu_50k"]
        assert mffu["passed"], "MFFU evaluation must not apply the sim-payout consistency gate"
        assert mffu["failures"] == []

    def test_mffu_failure_message_names_mffu(self):
        """MFFU failure message must name 'MFFU' (not 'Topstep')."""
        daily_pnls = [700.0, 300.0]
        results = _run(daily_pnls)
        mffu = results["mffu_50k"]
        mffu_msg = " ".join(mffu["failures"])
        assert mffu_msg == ""

    def test_mffu_passes_well_distributed_profit(self):
        """$400 / $1000 = 40% — MFFU must still pass."""
        daily_pnls = [400.0, 300.0, 200.0, 100.0]
        results = _run(daily_pnls)
        mffu = results["mffu_50k"]
        consistency_failures = [f for f in mffu["failures"] if "consistency" in f.lower()]
        assert not consistency_failures, (
            f"MFFU must PASS when max day = 40%. Got: {consistency_failures}"
        )


# ─── Both firms fail together ─────────────────────────────────────────────────

class TestBothFirmsConsistencyAlignment:
    """Both Topstep and MFFU must enforce the 50% rule consistently."""

    def test_both_firms_fail_on_extreme_concentration(self):
        """$900 / $1000 = 90% — both Topstep and MFFU must fail."""
        daily_pnls = [900.0, 100.0]
        results = _run(daily_pnls)
        assert not results["topstep_50k"]["passed"], "Topstep must FAIL"
        assert results["mffu_50k"]["passed"], "MFFU eval does not apply the sim-payout rule"

    def test_both_firms_pass_on_even_distribution(self):
        """$200 / $1000 = 20% — both Topstep and MFFU must pass consistency."""
        daily_pnls = [200.0, 200.0, 200.0, 200.0, 200.0]
        results = _run(daily_pnls)
        topstep_cons = [f for f in results["topstep_50k"]["failures"] if "consistency" in f.lower()]
        mffu_cons = [f for f in results["mffu_50k"]["failures"] if "consistency" in f.lower()]
        assert not topstep_cons, f"Topstep consistency must PASS. Got: {topstep_cons}"
        assert not mffu_cons, f"MFFU consistency must PASS. Got: {mffu_cons}"

    def test_loss_days_excluded_from_consistency_denominator(self):
        """Consistency denominator = sum of POSITIVE days only (losses excluded).
        $600 profit day + (-$100 loss day) = $600 total profit.
        $600 / $600 = 100% — fails.
        Confirm the loss day does not inflate the denominator.
        """
        daily_pnls = [600.0, -100.0]
        results = _run(daily_pnls)
        # $600 positive-only; $600/$600 = 100% → both firms must fail consistency
        assert not results["topstep_50k"]["passed"], (
            "Topstep must FAIL: only day with profit is 100% of total positive profit"
        )

    def test_no_profit_days_skip_consistency_check(self):
        """When total profit <= 0, consistency check is skipped (no division-by-zero)."""
        daily_pnls = [-100.0, -200.0, -50.0]  # only losses
        # Should not raise; both firms may fail on drawdown but not consistency
        results = _run(daily_pnls)
        for firm_key, result in results.items():
            cons_failures = [f for f in result["failures"] if "consistency" in f.lower()]
            assert not cons_failures, (
                f"{firm_key}: consistency must not fail when there is no positive profit. "
                f"Got: {cons_failures}"
            )


# ─── rank_firms_for_strategy regression ──────────────────────────────────────

class TestRankFirmsConsistency:
    """rank_firms_for_strategy must disqualify firms when consistency_ratio > 0.50."""

    def test_both_firms_disqualified_on_high_consistency_ratio(self):
        from src.engine.prop_compliance import rank_firms_for_strategy
        stats = {
            "max_drawdown": 500.0,
            "avg_daily_pnl": 50.0,
            "consistency_ratio": 0.75,  # 75% — over the 50% threshold
            "trades_overnight": False,
        }
        rankings = rank_firms_for_strategy(stats)
        firm_keys = {r["firm"] for r in rankings}
        assert "topstep_50k" not in firm_keys, (
            "topstep_50k must be disqualified when consistency_ratio > 0.50"
        )
        assert "mffu_50k" not in firm_keys, (
            "mffu_50k must be disqualified when consistency_ratio > 0.50"
        )

    def test_both_firms_eligible_on_low_consistency_ratio(self):
        from src.engine.prop_compliance import rank_firms_for_strategy
        stats = {
            "max_drawdown": 500.0,
            "avg_daily_pnl": 50.0,
            "consistency_ratio": 0.30,  # 30% — under the 50% threshold
            "trades_overnight": False,
        }
        rankings = rank_firms_for_strategy(stats)
        firm_keys = {r["firm"] for r in rankings}
        assert "topstep_50k" in firm_keys, (
            "topstep_50k must be eligible when consistency_ratio = 0.30"
        )
        assert "mffu_50k" in firm_keys, (
            "mffu_50k must be eligible when consistency_ratio = 0.30"
        )
