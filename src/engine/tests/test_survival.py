"""Tests for prop firm survival optimizer (Phase 4.12).

Tests:
- Survival score calculation with known P&Ls
- Daily breach probability with and without daily limit
- MC drawdown breach returns reasonable probabilities
- Concentration analysis catches tight (15%) and loose (50%) thresholds
- Firm profiles all have required fields
- Firm profiles DERIVE from canonical firm_config.py (W3B 2026-07-17 —
  drift-impossible-by-construction; reverting to hand-typed literals goes RED)
- Grade assignment (A/B/C/D/F) boundaries
- Comparator ranks strategies correctly
"""

import pytest
import numpy as np

from src.engine.survival.firm_profiles import (
    FIRM_PROFILES,
    REQUIRED_FIELDS,
    get_firm_profile,
    list_firms,
)
from src.engine.survival.daily_breach_model import daily_breach_probability
from src.engine.survival.drawdown_simulator import mc_drawdown_breach
from src.engine.survival.concentration_analyzer import concentration_analysis
from src.engine.survival.survival_scorer import survival_score, _assign_grade
from src.engine.survival.survival_comparator import compare_strategies


# ─── Fixtures ────────────────────────────────────────────────────

@pytest.fixture
def good_daily_pnls():
    """A profitable, consistent strategy: ~$300/day avg, low variance."""
    rng = np.random.default_rng(42)
    # 60 trading days (~3 months), mean +300, std 200
    pnls = rng.normal(300, 200, 60).tolist()
    return pnls


@pytest.fixture
def bad_daily_pnls():
    """A terrible strategy: losing money, high variance."""
    rng = np.random.default_rng(99)
    pnls = rng.normal(-100, 500, 60).tolist()
    return pnls


@pytest.fixture
def spiky_daily_pnls():
    """A strategy where one huge day dominates total P&L."""
    # 59 days of ~$50, one day of $5000
    pnls = [50.0] * 59 + [5000.0]
    return pnls


# ─── Firm Profiles ───────────────────────────────────────────────

class TestFirmProfiles:
    def test_all_firms_present(self):
        # Topstep (PRIMARY) + MFFU only per CLAUDE.md §6. Legacy firms
        # (TPT, Apex, FFN, Alpha, Tradeify, Earn2Trade) removed 2026-05-19
        # (migration 0097). W3B 2026-07-17: test updated to the 2-firm reality —
        # it had expected the removed 8-firm set and was failing.
        firms = list_firms()
        assert sorted(firms) == ["MFFU", "Topstep"]

    def test_all_profiles_have_required_fields(self):
        for firm_key, firm_data in FIRM_PROFILES.items():
            assert "name" in firm_data, f"{firm_key} missing 'name'"
            assert "accounts" in firm_data, f"{firm_key} missing 'accounts'"
            for acct_key, acct_data in firm_data["accounts"].items():
                for field in REQUIRED_FIELDS:
                    assert field in acct_data, (
                        f"{firm_key}/{acct_key} missing required field: {field}"
                    )

    def test_get_firm_profile_valid(self):
        profile = get_firm_profile("MFFU", "50K")
        assert profile is not None
        assert profile["max_drawdown"] == 2000
        assert profile["drawdown_type"] == "EOD"

    def test_get_firm_profile_invalid(self):
        assert get_firm_profile("NonExistent") is None
        assert get_firm_profile("MFFU", "500K") is None

    def test_drawdown_types_valid(self):
        valid_types = {"trailing", "EOD", "intraday"}
        for firm_key, firm_data in FIRM_PROFILES.items():
            for acct_key, acct_data in firm_data["accounts"].items():
                assert acct_data["drawdown_type"] in valid_types, (
                    f"{firm_key}/{acct_key} has invalid drawdown_type: {acct_data['drawdown_type']}"
                )

    def test_payout_splits_in_range(self):
        for firm_key, firm_data in FIRM_PROFILES.items():
            for acct_key, acct_data in firm_data["accounts"].items():
                assert 0.0 < acct_data["payout_split"] <= 1.0, (
                    f"{firm_key}/{acct_key} payout_split out of range: {acct_data['payout_split']}"
                )


class TestFirmProfilesDerivedFromCanonical:
    """W3B (2026-07-17): FIRM_PROFILES is a DERIVED VIEW over firm_config.py.

    Every firm-rule value must equal the canonical struct it derives from.
    RED-proof: reverting firm_profiles.py to any hand-typed literal (e.g. the
    pre-W3B drifted MFFU max_contracts=50) makes these tests fail, because the
    expectation side is read from firm_config.py at test time — not hand-typed
    here. These pins guard the C4 TESTING→PAPER survival gate's inputs.
    """

    def test_mffu_max_contracts_equals_canonical(self):
        from src.engine.firm_config import FIRM_CONTRACT_CAPS
        profile = get_firm_profile("MFFU", "50K")
        # Pre-W3B drift: hand-typed 50; canonical MFFU Builder = 40 micros.
        assert profile["max_contracts"] == FIRM_CONTRACT_CAPS["mffu_50k"]

    def test_topstep_max_contracts_equals_canonical(self):
        from src.engine.firm_config import FIRM_CONTRACT_CAPS
        profile = get_firm_profile("Topstep", "50K")
        assert profile["max_contracts"] == FIRM_CONTRACT_CAPS["topstep_50k"]

    def test_commission_per_side_equals_canonical(self):
        from src.engine.firm_config import get_commission_per_side
        # MES is the representative symbol (MES == MNQ at both firms).
        assert get_firm_profile("MFFU", "50K")["commission_per_side"] == (
            get_commission_per_side("mffu_50k", "MES")
        )
        assert get_firm_profile("Topstep", "50K")["commission_per_side"] == (
            get_commission_per_side("topstep_50k", "MES")
        )

    def test_consistency_threshold_equals_canonical_rule(self):
        from src.engine.firm_config import FIRM_RULES
        # Both canonical 2026 consistency rules map to 50% best-day.
        assert FIRM_RULES["topstep_50k"]["consistency_rule"] == "topstep_50pct"
        assert get_firm_profile("Topstep", "50K")["consistency_threshold"] == 0.50
        assert FIRM_RULES["mffu_50k"]["consistency_rule"] == "mffu_50pct_sim_payout"
        assert get_firm_profile("MFFU", "50K")["consistency_threshold"] == 0.50

    def test_core_rule_fields_equal_canonical(self):
        from src.engine.firm_config import FIRM_RULES
        for firm, key in (("MFFU", "mffu_50k"), ("Topstep", "topstep_50k")):
            profile = get_firm_profile(firm, "50K")
            rules = FIRM_RULES[key]
            assert profile["max_drawdown"] == rules["max_drawdown"]
            assert profile["drawdown_type"] == rules["trailing"].upper()
            assert profile["daily_loss_limit"] == rules["daily_loss_limit"]
            assert profile["payout_split"] == rules["payout_split"]
            assert profile["eval_cost_monthly"] == rules["monthly_fee"]

    def test_profile_shape_unchanged_for_consumers(self):
        # survival_scorer.py reads exactly these keys — shape contract.
        profile = get_firm_profile("MFFU", "50K")
        for field in REQUIRED_FIELDS:
            assert field in profile
        assert isinstance(profile["max_contracts"], dict)
        assert set(profile["max_contracts"].keys()) == {"MES", "MNQ", "MCL"}


# ─── Daily Breach Probability ────────────────────────────────────

class TestDailyBreachProbability:
    def test_no_daily_limit(self, good_daily_pnls):
        result = daily_breach_probability(good_daily_pnls, daily_loss_limit=None)
        assert result["breach_probability"] == 0.0
        assert result["has_daily_limit"] is False
        assert result["score"] == 100.0

    def test_with_daily_limit_good_strategy(self, good_daily_pnls):
        result = daily_breach_probability(good_daily_pnls, daily_loss_limit=1000)
        assert 0.0 <= result["breach_probability"] <= 1.0
        assert result["has_daily_limit"] is True
        # Good strategy should have low breach probability
        assert result["breach_probability"] < 0.2
        assert result["score"] > 50.0

    def test_with_daily_limit_bad_strategy(self, bad_daily_pnls):
        result = daily_breach_probability(bad_daily_pnls, daily_loss_limit=500)
        assert result["has_daily_limit"] is True
        # Bad strategy with tight limit should have higher breach probability
        assert result["breach_probability"] > 0.0

    def test_empty_pnls(self):
        result = daily_breach_probability([], daily_loss_limit=1000)
        assert result["total_days"] == 0
        assert result["score"] == 100.0

    def test_all_positive_days(self):
        result = daily_breach_probability([100, 200, 300, 150], daily_loss_limit=500)
        assert result["breach_probability"] < 0.5
        assert result["empirical_breach_count"] == 0


# ─── MC Drawdown Breach ─────────────────────────────────────────

class TestMCDrawdownBreach:
    def test_returns_valid_probabilities(self, good_daily_pnls):
        result = mc_drawdown_breach(good_daily_pnls, max_drawdown=2000, drawdown_type="trailing", num_sims=500)
        assert 0.0 <= result["breach_probability"] <= 1.0
        assert result["sims_run"] == 500
        assert result["median_max_dd"] >= 0
        assert result["p95_max_dd"] >= result["median_max_dd"]
        assert result["p99_max_dd"] >= result["p95_max_dd"]

    def test_good_strategy_low_breach(self, good_daily_pnls):
        result = mc_drawdown_breach(good_daily_pnls, max_drawdown=5000, drawdown_type="trailing", num_sims=500)
        # Very generous DD limit, good strategy — breach should be very low
        assert result["breach_probability"] < 0.3

    def test_bad_strategy_high_breach(self, bad_daily_pnls):
        result = mc_drawdown_breach(bad_daily_pnls, max_drawdown=1000, drawdown_type="trailing", num_sims=500)
        # Tight DD limit, bad strategy — should breach often
        assert result["breach_probability"] > 0.3

    def test_intraday_harsher_than_eod(self, good_daily_pnls):
        eod = mc_drawdown_breach(good_daily_pnls, max_drawdown=2000, drawdown_type="EOD", num_sims=1000)
        intraday = mc_drawdown_breach(good_daily_pnls, max_drawdown=2000, drawdown_type="intraday", num_sims=1000)
        # Intraday should have higher breach probability due to 1.2x multiplier
        assert intraday["breach_probability"] >= eod["breach_probability"]

    def test_empty_pnls(self):
        result = mc_drawdown_breach([], max_drawdown=2000, drawdown_type="trailing")
        assert result["breach_probability"] == 0.0
        assert result["sims_run"] == 0

    def test_score_in_range(self, good_daily_pnls):
        result = mc_drawdown_breach(good_daily_pnls, max_drawdown=2000, drawdown_type="trailing", num_sims=500)
        assert 0.0 <= result["score"] <= 100.0


# ─── Concentration Analysis ─────────────────────────────────────

class TestConcentrationAnalysis:
    def test_no_threshold(self, good_daily_pnls):
        result = concentration_analysis(good_daily_pnls, consistency_threshold=None)
        assert result["passes_threshold"] is None
        assert result["best_day_pct"] >= 0.0
        assert result["total_pnl"] > 0

    def test_tight_15_percent_threshold_spiky(self, spiky_daily_pnls):
        # 15% is a tight synthetic threshold (formerly labeled "FFN Express" —
        # FFN removed 2026-05-19; the math being tested is firm-agnostic).
        result = concentration_analysis(spiky_daily_pnls, consistency_threshold=0.15)
        # The $5000 day is ~63% of total P&L — should fail 15% threshold
        assert result["passes_threshold"] is False
        assert result["best_day_pct"] > 0.15

    def test_canonical_50_percent_threshold_spiky(self, spiky_daily_pnls):
        # 50% is the canonical 2026 Topstep/MFFU consistency threshold
        # (formerly labeled "TPT" — TPT removed 2026-05-19).
        result = concentration_analysis(spiky_daily_pnls, consistency_threshold=0.50)
        # The $5000 day is ~63% of total P&L — should fail 50% threshold too
        assert result["passes_threshold"] is False

    def test_even_distribution_passes(self):
        # All days roughly equal — should pass any threshold
        pnls = [100.0] * 20
        result = concentration_analysis(pnls, consistency_threshold=0.15)
        assert result["passes_threshold"] is True
        assert result["best_day_pct"] <= 0.15
        assert result["distribution_evenness"] > 0.9

    def test_empty_pnls(self):
        result = concentration_analysis([], consistency_threshold=0.15)
        assert result["total_pnl"] == 0.0

    def test_top_3_days_pct(self, good_daily_pnls):
        result = concentration_analysis(good_daily_pnls, consistency_threshold=None)
        assert 0.0 <= result["top_3_days_pct"] <= 1.0


# ─── Survival Score ──────────────────────────────────────────────

class TestSurvivalScore:
    def test_basic_score_calculation(self, good_daily_pnls):
        result = survival_score(good_daily_pnls, firm="MFFU", num_mc_sims=500)
        assert "survival_score" in result
        assert 0.0 <= result["survival_score"] <= 100.0
        assert result["firm"] == "MFFU"
        assert result["account_type"] == "50K"
        assert result["grade"] in ("A", "B", "C", "D", "F")

    def test_all_seven_metrics_present(self, good_daily_pnls):
        result = survival_score(good_daily_pnls, firm="MFFU", num_mc_sims=500)
        expected_metrics = [
            "daily_breach_prob", "dd_breach_prob", "consistency",
            "recovery_speed", "worst_month", "commission_drag", "eval_speed",
        ]
        for m in expected_metrics:
            assert m in result["metrics"], f"Missing metric: {m}"
            assert 0.0 <= result["metrics"][m] <= 100.0

    def test_raw_values_present(self, good_daily_pnls):
        result = survival_score(good_daily_pnls, firm="MFFU", num_mc_sims=500)
        expected_raw = [
            "daily_breach_probability", "mc_dd_breach_probability", "best_day_pct",
            "avg_recovery_days", "worst_month_win_days", "net_gross_ratio",
            "expected_eval_days",
        ]
        for r in expected_raw:
            assert r in result["raw"], f"Missing raw value: {r}"

    def test_good_beats_bad(self, good_daily_pnls, bad_daily_pnls):
        good = survival_score(good_daily_pnls, firm="MFFU", num_mc_sims=500)
        bad = survival_score(bad_daily_pnls, firm="MFFU", num_mc_sims=500)
        assert good["survival_score"] > bad["survival_score"]

    def test_unknown_firm(self, good_daily_pnls):
        result = survival_score(good_daily_pnls, firm="FakeFirm")
        assert result["grade"] == "F"
        assert "error" in result

    def test_topstep_daily_limit_affects_score(self, good_daily_pnls):
        # W3B 2026-07-17: both firms now derive daily_loss_limit=$1000 from
        # canonical FIRM_RULES (the old hand-typed profile wrongly gave MFFU
        # None — MFFU Builder has a $1,000 DLL, canonically a SOFT pause;
        # scoring it as breach-able is the conservative direction). Same
        # limit + same P&Ls ⇒ identical daily_breach_prob scores.
        mffu = survival_score(good_daily_pnls, firm="MFFU", num_mc_sims=500)
        topstep = survival_score(good_daily_pnls, firm="Topstep", num_mc_sims=500)
        assert mffu["metrics"]["daily_breach_prob"] == topstep["metrics"]["daily_breach_prob"]

    def test_custom_weights(self, good_daily_pnls):
        # All weight on DD breach
        custom_weights = {
            "daily_breach_prob": 0.0,
            "dd_breach_prob": 1.0,
            "consistency": 0.0,
            "recovery_speed": 0.0,
            "worst_month": 0.0,
            "commission_drag": 0.0,
            "eval_speed": 0.0,
        }
        result = survival_score(good_daily_pnls, firm="MFFU", num_mc_sims=500, weights=custom_weights)
        # Score should equal the DD breach metric
        assert abs(result["survival_score"] - result["metrics"]["dd_breach_prob"]) < 0.1


# ─── Grade Assignment ────────────────────────────────────────────

class TestGradeAssignment:
    def test_grade_a(self):
        assert _assign_grade(80.0) == "A"
        assert _assign_grade(95.0) == "A"
        assert _assign_grade(100.0) == "A"

    def test_grade_b(self):
        assert _assign_grade(65.0) == "B"
        assert _assign_grade(79.9) == "B"

    def test_grade_c(self):
        assert _assign_grade(50.0) == "C"
        assert _assign_grade(64.9) == "C"

    def test_grade_d(self):
        assert _assign_grade(35.0) == "D"
        assert _assign_grade(49.9) == "D"

    def test_grade_f(self):
        assert _assign_grade(34.9) == "F"
        assert _assign_grade(0.0) == "F"
        assert _assign_grade(10.0) == "F"


# ─── Comparator ──────────────────────────────────────────────────

class TestSurvivalComparator:
    def test_compare_two_strategies(self, good_daily_pnls, bad_daily_pnls):
        strategies = [
            {"name": "GoodStrategy", "daily_pnls": good_daily_pnls},
            {"name": "BadStrategy", "daily_pnls": bad_daily_pnls},
        ]
        result = compare_strategies(strategies, firms=["MFFU"], num_mc_sims=500)
        assert result["strategies_tested"] == 2
        assert result["firms_tested"] == 1
        assert len(result["leaderboard"]) == 2
        # Good strategy should rank #1
        assert result["leaderboard"][0]["strategy"] == "GoodStrategy"
        assert result["leaderboard"][0]["rank"] == 1
        assert result["leaderboard"][1]["strategy"] == "BadStrategy"
        assert result["leaderboard"][1]["rank"] == 2

    def test_compare_across_multiple_firms(self, good_daily_pnls):
        strategies = [{"name": "TestStrat", "daily_pnls": good_daily_pnls}]
        result = compare_strategies(strategies, firms=["MFFU", "Topstep"], num_mc_sims=500)
        assert result["firms_tested"] == 2
        leaderboard_entry = result["leaderboard"][0]
        assert "MFFU" in leaderboard_entry["scores_by_firm"]
        assert "Topstep" in leaderboard_entry["scores_by_firm"]
        assert "MFFU" in result["firm_rankings"]
        assert "Topstep" in result["firm_rankings"]

    def test_compare_returns_grades(self, good_daily_pnls):
        strategies = [{"name": "TestStrat", "daily_pnls": good_daily_pnls}]
        result = compare_strategies(strategies, firms=["MFFU"], num_mc_sims=500)
        entry = result["leaderboard"][0]
        assert "MFFU" in entry["grades_by_firm"]
        assert entry["grades_by_firm"]["MFFU"] in ("A", "B", "C", "D", "F")

    def test_compare_default_all_firms(self, good_daily_pnls):
        strategies = [{"name": "TestStrat", "daily_pnls": good_daily_pnls}]
        result = compare_strategies(strategies, firms=None, num_mc_sims=200)
        # Should test against all configured firms — Topstep + MFFU only
        # per CLAUDE.md §6 (W3B 2026-07-17: was a stale 8-firm expectation).
        assert result["firms_tested"] == len(FIRM_PROFILES) == 2
