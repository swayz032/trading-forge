"""Tests for performance gates + Forge Score — TDD."""


from src.engine.performance_gate import (
    check_performance_gate,
    classify_tier,
    compute_forge_score,
)

# ─── Helpers ───────────────────────────────────────────────────────

def _tier1_stats():
    """Stats that should pass TIER_1."""
    return {
        "avg_daily_pnl": 600.0,
        "winning_days": 56,
        "total_trading_days": 75,
        "total_trades": 200,
        "worst_month_win_days": 13,
        "profit_factor": 3.0,
        "sharpe_ratio": 2.5,
        "avg_winner_to_loser_ratio": 2.0,
        "max_drawdown": 1200.0,
        "max_consecutive_losing_days": 2,
        "avg_loss_on_red_days": -200.0,
        "avg_win_on_green_days": 400.0,
        "expectancy_per_trade": 150.0,
    }


def _tier3_stats():
    """Stats that should pass TIER_3 but not TIER_2."""
    return {
        "avg_daily_pnl": 280.0,
        "winning_days": 48,
        "total_trading_days": 75,
        "total_trades": 150,
        "worst_month_win_days": 11,
        "profit_factor": 1.80,
        "sharpe_ratio": 1.6,
        "avg_winner_to_loser_ratio": 2.1,
        "max_drawdown": 1800.0,
        "max_consecutive_losing_days": 3,
        "avg_loss_on_red_days": -300.0,
        "avg_win_on_green_days": 400.0,
        "expectancy_per_trade": 85.0,
    }


def _failing_stats():
    """Stats that should be REJECTED."""
    return {
        "avg_daily_pnl": 150.0,
        "winning_days": 30,
        "total_trading_days": 75,
        "total_trades": 150,
        "worst_month_win_days": 8,
        "profit_factor": 1.3,
        "sharpe_ratio": 1.0,
        "avg_winner_to_loser_ratio": 1.2,
        "max_drawdown": 3000.0,
        "max_consecutive_losing_days": 6,
        "avg_loss_on_red_days": -500.0,
        "avg_win_on_green_days": 300.0,
    }


# ─── Performance Gate ─────────────────────────────────────────────

class TestPerformanceGate:
    def test_tier1_passes(self):
        passed, messages = check_performance_gate(_tier1_stats())
        assert passed is True
        # Messages may include warnings (e.g., sample size < 500) — that's OK, not rejections
        rejections = [m for m in messages if "statistically unreliable" not in m and "DECAYING" not in m]
        assert len(rejections) == 0

    def test_tier3_passes(self):
        passed, rejections = check_performance_gate(_tier3_stats())
        assert passed is True

    def test_failing_stats_rejected(self):
        passed, rejections = check_performance_gate(_failing_stats())
        assert passed is False
        assert len(rejections) > 0

    def test_low_daily_pnl_rejected(self):
        stats = _tier1_stats()
        stats["avg_daily_pnl"] = 200.0
        passed, rejections = check_performance_gate(stats)
        assert passed is False
        assert any("avg_daily_pnl" in r for r in rejections)

    def test_high_drawdown_rejected(self):
        stats = _tier1_stats()
        stats["max_drawdown"] = 2100.0
        passed, rejections = check_performance_gate(stats)
        assert passed is False
        assert any("drawdown" in r.lower() for r in rejections)

    def test_low_win_rate_rejected(self):
        stats = _tier1_stats()
        stats["winning_days"] = 40  # 40/75 = 53% < 60%
        passed, rejections = check_performance_gate(stats)
        assert passed is False

    def test_too_many_consecutive_losers_rejected(self):
        stats = _tier1_stats()
        stats["max_consecutive_losing_days"] = 5
        passed, rejections = check_performance_gate(stats)
        assert passed is False

    def test_low_profit_factor_rejected(self):
        stats = _tier1_stats()
        stats["profit_factor"] = 1.5
        passed, rejections = check_performance_gate(stats)
        assert passed is False

    def test_low_sharpe_rejected(self):
        stats = _tier1_stats()
        stats["sharpe_ratio"] = 1.2
        passed, rejections = check_performance_gate(stats)
        assert passed is False

    def test_losers_bigger_than_winners_rejected(self):
        stats = _tier1_stats()
        stats["avg_loss_on_red_days"] = -500.0
        stats["avg_win_on_green_days"] = 300.0
        passed, rejections = check_performance_gate(stats)
        assert passed is False

    def test_worst_month_too_few_wins(self):
        stats = _tier1_stats()
        stats["worst_month_win_days"] = 9
        passed, rejections = check_performance_gate(stats)
        assert passed is False


# ─── Tier Classification ──────────────────────────────────────────

class TestClassifyTier:
    def test_tier1(self):
        assert classify_tier(_tier1_stats()) == "TIER_1"

    def test_tier3(self):
        assert classify_tier(_tier3_stats()) == "TIER_3"

    def test_rejected(self):
        assert classify_tier(_failing_stats()) == "REJECTED"

    def test_tier2(self):
        stats = _tier1_stats()
        stats["avg_daily_pnl"] = 400.0
        stats["winning_days"] = 49  # 49/75 * 20 = 13.07 win days per 20
        stats["max_drawdown"] = 1600.0
        stats["profit_factor"] = 2.2
        stats["sharpe_ratio"] = 1.8
        assert classify_tier(stats) == "TIER_2"

    def test_boundary_tier1_pnl(self):
        stats = _tier1_stats()
        stats["avg_daily_pnl"] = 500.0  # Exactly at boundary
        assert classify_tier(stats) == "TIER_1"

    def test_boundary_tier3_pnl(self):
        stats = _tier3_stats()
        stats["avg_daily_pnl"] = 250.0  # Exactly at boundary
        assert classify_tier(stats) == "TIER_3"


# ─── Forge Score ───────────────────────────────────────────────────

class TestForgeScore:
    """Tests for compute_forge_score().

    compute_forge_score() returns a dict with keys: score, passed, crisis_veto,
    crisis_veto_reason, components, tier. Tests extract result["score"] to get
    the numeric value. The dict schema is the contract with backtest-service.ts.
    """

    def test_score_range(self):
        score = compute_forge_score(_tier1_stats())["score"]
        assert 0 <= score <= 100

    def test_tier1_scores_high(self):
        # TIER_1 without MC/crisis inputs: 5-component formula gives ~63 pts on core stats.
        # 70 was based on the old bonus-point design (crisis added +5). Crisis is now a hard
        # veto (no bonus points), so core stats alone score ~63. Threshold reflects reality.
        score = compute_forge_score(_tier1_stats())["score"]
        assert score >= 55  # TIER_1 passes gate; forge_score on core stats only

    def test_failing_scores_low(self):
        score = compute_forge_score(_failing_stats())["score"]
        assert score < 50

    def test_score_components_sum(self):
        """Score is a float inside result["score"]. Result is a dict."""
        result = compute_forge_score(_tier1_stats())
        assert isinstance(result, dict)
        assert "score" in result
        assert isinstance(result["score"], float)

    def test_higher_pnl_higher_score(self):
        stats_low = _tier3_stats()
        stats_high = _tier1_stats()
        score_low = compute_forge_score(stats_low)["score"]
        score_high = compute_forge_score(stats_high)["score"]
        assert score_high > score_low

    # ─── MC-Enhanced Forge Score Tests ────────────────────────────

    def test_mc_results_increase_score(self):
        """MC data should add to the score vs no MC data."""
        stats = _tier1_stats()
        score_no_mc = compute_forge_score(stats)["score"]
        mc_results = {
            "probability_of_ruin": 0.005,  # 99.5% survival
            "sharpe_distribution": {"p5": 1.8, "p95": 2.5},
        }
        score_with_mc = compute_forge_score(stats, mc_results=mc_results)["score"]
        assert score_with_mc > score_no_mc

    def test_backward_compat_no_mc(self):
        """None MC still works — same as before."""
        stats = _tier1_stats()
        score = compute_forge_score(stats, mc_results=None, crisis_results=None)["score"]
        assert 0 <= score <= 100

    def test_mc_survival_scoring(self):
        """99%+ survival = 10 pts, 90% = 0 pts."""
        stats = _tier1_stats()
        mc_good = {"probability_of_ruin": 0.005, "sharpe_distribution": {"p5": 2.0, "p95": 2.5}}
        mc_bad = {"probability_of_ruin": 0.10, "sharpe_distribution": {"p5": 2.0, "p95": 2.5}}
        score_good = compute_forge_score(stats, mc_results=mc_good)["score"]
        score_bad = compute_forge_score(stats, mc_results=mc_bad)["score"]
        assert score_good > score_bad

    def test_sharpe_stability_scoring(self):
        """Narrow Sharpe spread = more points."""
        stats = _tier1_stats()
        mc_narrow = {"probability_of_ruin": 0.01, "sharpe_distribution": {"p5": 2.0, "p95": 2.3}}
        mc_wide = {"probability_of_ruin": 0.01, "sharpe_distribution": {"p5": 0.5, "p95": 3.0}}
        score_narrow = compute_forge_score(stats, mc_results=mc_narrow)["score"]
        score_wide = compute_forge_score(stats, mc_results=mc_wide)["score"]
        assert score_narrow > score_wide

    def test_crisis_veto_all_pass_no_score_change(self):
        """Crisis scenarios that all pass (no DD breach) do NOT change score.

        Crisis is now a hard veto, not a bonus. When all scenarios pass, the score
        is identical to no-crisis. The benefit of passing crisis is gate integrity
        (the strategy is not vetoed), not additional points.
        """
        stats = _tier1_stats()
        mc = {"probability_of_ruin": 0.005, "sharpe_distribution": {"p5": 2.0, "p95": 2.3}}
        # R-644 §3: every scenario carries an EXPLICIT under-limit max_drawdown.
        # These fixtures used to omit the key entirely, which F-G4 now routes to
        # crisis-stress-unevaluated — absence is an unknown, not a passing value,
        # and stress_test.py's two producers always emit the key anyway.
        crisis_all_pass = {
            "passed": True,
            "scenarios": [{"passed": True, "max_drawdown": 400.0}] * 8,
        }
        result_with_crisis = compute_forge_score(stats, mc_results=mc, crisis_results=crisis_all_pass)
        result_no_crisis = compute_forge_score(stats, mc_results=mc, crisis_results=None)
        assert result_with_crisis["score"] == result_no_crisis["score"]
        assert result_with_crisis["crisis_veto"] is False
        assert result_no_crisis["crisis_veto"] is False
        # R-644 §4 positive witness: two vetoed runs would ALSO be equal at 0.0.
        # Equality is only evidence of "crisis changes nothing" if the score is
        # non-degenerate.
        assert result_with_crisis["score"] > 0

    def test_crisis_veto_triggers_on_dd_breach(self):
        """Crisis scenario that breaches firm_max_dd sets crisis_veto=True and score=0."""
        stats = _tier1_stats()
        mc = {"probability_of_ruin": 0.005, "sharpe_distribution": {"p5": 2.0, "p95": 2.3}}
        # Scenario with max_drawdown > 2000 (firm_max_dd) — must trigger veto
        crisis_breach = {
            "passed": False,
            "scenarios": [{"passed": False, "max_drawdown": 3500.0, "name": "covid_crash"}],
        }
        result = compute_forge_score(stats, mc_results=mc, crisis_results=crisis_breach)
        assert result["crisis_veto"] is True
        assert result["score"] == 0.0
        assert result["passed"] is False

    def test_crisis_veto_triggers_on_unevaluated_scenario(self):
        """R-639 §6.1 (F-1 / F-G1): a crisis scenario that CRASHED must veto.

        stress_test.py:132-138 emits a failed scenario as
        {"passed": False, "max_drawdown": 0, "error": "..."}. A DD-only veto
        reads 0 > firm_max_dd as False, so a crisis test that BLEW UP scored as
        a clean pass — the strategy looked like it survived 2008 because the
        2008 check never ran.

        This is the committed red-proof the F-1 repair shipped without: deleting
        the `"error" in s` arm in performance_gate.py must turn THIS test red
        and leave test_crisis_veto_triggers_on_dd_breach green.
        """
        stats = _tier1_stats()
        mc = {"probability_of_ruin": 0.005, "sharpe_distribution": {"p5": 2.0, "p95": 2.3}}
        # The CRASHED shape, verbatim from stress_test.py:132-138. Note
        # max_drawdown=0: a DD compare alone CANNOT distinguish this from a
        # scenario that survived with zero drawdown.
        crisis_crashed = {
            "passed": False,
            "scenarios": [
                {"passed": True, "max_drawdown": 100.0, "name": "covid_crash"},
                {"passed": False, "max_drawdown": 0, "name": "gfc_2008",
                 "error": "ZeroDivisionError('stress run failed')"},
            ],
        }
        result = compute_forge_score(stats, mc_results=mc, crisis_results=crisis_crashed)
        assert result["crisis_veto"] is True, (
            "a crisis scenario carrying an 'error' key did not veto — an "
            "unevaluated stress test is being scored as a clean pass"
        )
        assert result["score"] == 0.0
        assert result["passed"] is False
        # The reason must name WHY, so a reader cannot mistake it for a breach.
        assert "unevaluated" in result["crisis_veto_reason"], (
            f"veto reason should identify the scenario as unevaluated, got: "
            f"{result['crisis_veto_reason']!r}"
        )

    def test_crisis_veto_triggers_on_missing_max_drawdown(self):
        """R-639 §6.2.3 (F-G4): an ABSENT drawdown is unknown, not zero.

        `s.get("max_drawdown", 0.0)` defaulted a missing key to 0.0 and
        `0.0 > firm_max_dd` is False, so a scenario whose drawdown was never
        recorded scored as a clean pass. Deleting the usable-value check in
        performance_gate.py must turn THIS test red.
        """
        stats = _tier1_stats()
        mc = {"probability_of_ruin": 0.005, "sharpe_distribution": {"p5": 2.0, "p95": 2.3}}
        crisis_missing = {
            "passed": True,
            "scenarios": [
                {"passed": True, "max_drawdown": 400.0, "name": "covid_crash"},
                {"passed": True, "name": "gfc_2008"},  # key absent entirely
            ],
        }
        result = compute_forge_score(stats, mc_results=mc, crisis_results=crisis_missing)
        assert result["crisis_veto"] is True, (
            "a scenario with no max_drawdown key did not veto — an unmeasured "
            "drawdown is being scored as a passing one"
        )
        assert result["score"] == 0.0
        assert result["passed"] is False
        assert "unevaluated" in result["crisis_veto_reason"]
        assert "gfc_2008" in result["crisis_veto_reason"], (
            "the reason must name the scenario that was not evaluated"
        )

    def test_crisis_veto_triggers_on_non_finite_max_drawdown(self):
        """R-639 §6.2.3 (F-G4): NaN is the same hole in a different shape.

        `float('nan') > 2000.0` is False, so a NaN drawdown passed the DD
        compare silently. Infinity is checked too — it is not a measurement
        either.
        """
        stats = _tier1_stats()
        mc = {"probability_of_ruin": 0.005, "sharpe_distribution": {"p5": 2.0, "p95": 2.3}}
        for bad in (float("nan"), float("inf"), None, "9999"):
            crisis_bad = {
                "passed": True,
                "scenarios": [{"passed": True, "max_drawdown": bad, "name": "gfc_2008"}],
            }
            result = compute_forge_score(stats, mc_results=mc, crisis_results=crisis_bad)
            assert result["crisis_veto"] is True, f"{bad!r} did not veto"
            assert result["score"] == 0.0, f"{bad!r} did not zero the score"
            assert "unevaluated" in result["crisis_veto_reason"]

    def test_crisis_veto_triggers_on_empty_scenarios(self):
        """R-639 §6.2.3 (F-G4): attempted-but-produced-nothing is unevaluated.

        `crisis_results={}` yielded `scenarios=[]`, the veto loop ran zero
        times, and the strategy scored as if all eight crisis scenarios had
        passed. `crisis_results is not None` means the evaluation was
        ATTEMPTED — an attempt that produced no measurement must fail closed.
        """
        stats = _tier1_stats()
        mc = {"probability_of_ruin": 0.005, "sharpe_distribution": {"p5": 2.0, "p95": 2.3}}
        for empty in ({}, {"passed": True, "scenarios": []}):
            result = compute_forge_score(stats, mc_results=mc, crisis_results=empty)
            assert result["crisis_veto"] is True, f"{empty!r} did not veto"
            assert result["score"] == 0.0
            assert "unevaluated" in result["crisis_veto_reason"]
        # DISCRIMINATOR: crisis_results=None means "no crisis stage ran at all",
        # which is a different state and must NOT veto — otherwise this guard
        # would veto every backtest that never reached the stress test.
        result_none = compute_forge_score(stats, mc_results=mc, crisis_results=None)
        assert result_none["crisis_veto"] is False
        assert result_none["score"] > 0

    def test_crisis_partial_fail_without_dd_breach_no_veto(self):
        """Partial failure with a REAL drawdown UNDER the firm limit does not veto.

        R-644 §2/§3 — this fixture used to give the failing scenario NO
        max_drawdown key at all, and its comment named that absence as the
        tested condition. That was not a test of the product decision; it was
        the fail-open written down as an expectation. The product decision is
        narrower and survives intact: a scenario that FAILED but whose drawdown
        was measured and came in UNDER firm_max_dd must not veto.

        The value is deliberately 500.0 and NOT 0 — 0 is what the old
        `s.get("max_drawdown", 0.0)` default returned for a missing key, so a 0
        here would re-create the same shorthand in a new costume and the test
        would still not distinguish "evaluated and safe" from "never evaluated".
        """
        stats = _tier1_stats()
        mc = {"probability_of_ruin": 0.005, "sharpe_distribution": {"p5": 2.0, "p95": 2.3}}
        crisis_partial = {
            "passed": False,
            "scenarios": (
                [{"passed": True, "max_drawdown": 400.0}] * 7
                + [{"passed": False, "max_drawdown": 500.0, "name": "flash_crash"}]
            ),
        }
        result = compute_forge_score(stats, mc_results=mc, crisis_results=crisis_partial)
        assert result["crisis_veto"] is False, (
            f"a failed scenario whose measured drawdown ($500) is UNDER the firm "
            f"limit must not veto, got: {result['crisis_veto_reason']!r}"
        )
        assert result["score"] > 0

    def test_score_capped_at_100(self):
        """Score should never exceed 100 even with crisis bonus."""
        stats = _tier1_stats()
        stats["avg_daily_pnl"] = 1000.0  # Max earnings
        stats["winning_days"] = 19
        stats["max_drawdown"] = 200.0
        stats["sharpe_ratio"] = 4.0
        stats["profit_factor"] = 5.0
        mc = {"probability_of_ruin": 0.001, "sharpe_distribution": {"p5": 3.0, "p95": 3.2}}
        crisis = {
            "passed": True,
            "scenarios": [{"passed": True, "max_drawdown": 300.0}] * 8,
        }
        result = compute_forge_score(stats, mc_results=mc, crisis_results=crisis)
        # R-644 §4 — POSITIVE WITNESS THAT THE CAP PATH ACTUALLY RAN.
        # `assert score <= 100` alone is satisfied by 0.0, so any change that
        # vetoes this fixture would leave this test GREEN while it stopped
        # testing the cap entirely. A failure-set diff cannot see that; these
        # two assertions can.
        assert result["crisis_veto"] is False, (
            f"fixture vetoed — the cap is no longer being exercised: "
            f"{result['crisis_veto_reason']!r}"
        )
        assert result["score"] > 0, "score collapsed to 0; the cap path did not run"
        assert result["score"] <= 100
