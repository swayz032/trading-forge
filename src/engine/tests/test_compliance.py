"""Tests for the compliance gate engine — deterministic rule enforcement."""

from datetime import datetime, timedelta, timezone

import pytest

from src.engine.compliance.compliance_gate import (
    RULESET_MAX_AGE_HOURS,
    check_freshness,
    check_strategy_compliance,
    compute_content_hash,
    detect_drift,
    pre_session_gate,
)


# ─── Helpers ─────────────────────────────────────────────────────


def _iso_now_minus(hours: float) -> str:
    """Return ISO timestamp for `hours` ago (UTC)."""
    dt = datetime.now(timezone.utc) - timedelta(hours=hours)
    return dt.isoformat()


def _make_ruleset(
    firm: str,
    age_hours: float = 1.0,
    drift_detected: bool = False,
    rules: dict | None = None,
) -> dict:
    return {
        "firm": firm,
        "retrieved_at": _iso_now_minus(age_hours),
        "drift_detected": drift_detected,
        "rules": rules or {},
    }


def _make_strategy(
    firm: str,
    strategy_id: str = "strat_1",
    strategy_name: str = "Test Strategy",
    **overrides,
) -> dict:
    base = {
        "strategy_id": strategy_id,
        "strategy_name": strategy_name,
        "firm": firm,
        "max_drawdown": 1500,
        "daily_loss": 500,
        "best_day_pnl": 400,
        "total_pnl": 5000,
        "overnight_holding": False,
        "automated": False,
        "contracts_per_symbol": {},
    }
    base.update(overrides)
    return base


# ─── Freshness Check ────────────────────────────────────────────


class TestCheckFreshness:
    def test_fresh_ruleset_passes(self):
        """Ruleset retrieved 1h ago should be fresh for active trading."""
        ruleset = _make_ruleset("topstep_50k", age_hours=1.0)
        result = check_freshness("topstep_50k", ruleset, "active_trading")

        assert result["fresh"] is True
        assert result["status"] == "verified"
        assert result["drift_detected"] is False
        assert result["age_hours"] < 24

    def test_stale_ruleset_blocks(self):
        """Ruleset retrieved 30h ago should be stale for active trading."""
        ruleset = _make_ruleset("topstep_50k", age_hours=30.0)
        result = check_freshness("topstep_50k", ruleset, "active_trading")

        assert result["fresh"] is False
        assert result["status"] == "stale"
        assert result["max_age_hours"] == 24

    def test_drift_detected_blocks_immediately(self):
        """Drift detected should block regardless of age."""
        ruleset = _make_ruleset("mffu_50k", age_hours=0.5, drift_detected=True)
        result = check_freshness("mffu_50k", ruleset, "active_trading")

        assert result["fresh"] is False
        assert result["status"] == "blocked_drift"
        assert result["drift_detected"] is True
        assert result["max_age_hours"] == 0

    def test_research_context_allows_older_rulesets(self):
        """research_only context allows up to 72h."""
        ruleset = _make_ruleset("tpt_50k", age_hours=48.0)
        result = check_freshness("tpt_50k", ruleset, "research_only")

        assert result["fresh"] is True
        assert result["max_age_hours"] == 72

    def test_research_context_blocks_very_old(self):
        """research_only still blocks at 80h."""
        ruleset = _make_ruleset("tpt_50k", age_hours=80.0)
        result = check_freshness("tpt_50k", ruleset, "research_only")

        assert result["fresh"] is False
        assert result["status"] == "stale"

    def test_edge_near_max_age(self):
        """At just under the max age boundary, should still be fresh."""
        # Use 23.99h to avoid timing drift during test execution
        ruleset = _make_ruleset("apex_50k", age_hours=23.99)
        result = check_freshness("apex_50k", ruleset, "active_trading")

        assert result["fresh"] is True

    def test_naive_datetime_treated_as_utc(self):
        """ISO string without timezone info should be treated as UTC."""
        naive_iso = (
            datetime.now(timezone.utc) - timedelta(hours=2)
        ).strftime("%Y-%m-%dT%H:%M:%S")
        ruleset = {"retrieved_at": naive_iso, "drift_detected": False}
        result = check_freshness("test_firm", ruleset, "active_trading")

        assert result["fresh"] is True
        assert 1.5 < result["age_hours"] < 2.5


# ─── Strategy Compliance ─────────────────────────────────────────


class TestCheckStrategyCompliance:
    def test_strategy_passes_all_checks(self):
        """Strategy within all limits should pass."""
        strategy = _make_strategy("topstep_50k")
        firm_rules = {
            "max_drawdown_limit": 2000,
            "daily_loss_limit": 1000,
            "consistency_threshold": 0.50,
            "overnight_allowed": True,
            "contract_limits": {"MES": 5, "MNQ": 5},
            "automation_banned": False,
        }
        result = check_strategy_compliance(strategy, firm_rules)

        assert result["result"] == "pass"
        assert result["violations"] == []
        assert result["risk_score"] == 0

    def test_drawdown_violation(self):
        """Strategy exceeding drawdown limit should fail."""
        strategy = _make_strategy("topstep_50k", max_drawdown=2500)
        firm_rules = {"max_drawdown_limit": 2000}
        result = check_strategy_compliance(strategy, firm_rules)

        assert result["result"] == "fail"
        assert any("drawdown" in v.lower() for v in result["violations"])
        assert result["risk_score"] >= 40

    def test_drawdown_warning_near_limit(self):
        """Strategy at 85% of drawdown limit triggers warning."""
        strategy = _make_strategy("topstep_50k", max_drawdown=1700)
        firm_rules = {"max_drawdown_limit": 2000}
        result = check_strategy_compliance(strategy, firm_rules)

        assert result["result"] == "needs_review"
        assert len(result["warnings"]) >= 1
        assert result["violations"] == []

    def test_consistency_violation_tpt(self):
        """Best day > 50% of total P&L violates TPT consistency rule."""
        strategy = _make_strategy(
            "tpt_50k",
            best_day_pnl=3000,
            total_pnl=5000,  # 60% concentration
        )
        firm_rules = {"consistency_threshold": 0.50}
        result = check_strategy_compliance(strategy, firm_rules)

        assert result["result"] == "fail"
        assert any("consistency" in v.lower() or "best day" in v.lower()
                    for v in result["violations"])

    def test_consistency_violation_ffn_express(self):
        """Best day > 15% of total P&L violates FFN Express consistency."""
        strategy = _make_strategy(
            "ffn_50k",
            best_day_pnl=1000,
            total_pnl=5000,  # 20% concentration
        )
        firm_rules = {"consistency_threshold": 0.15}
        result = check_strategy_compliance(strategy, firm_rules)

        assert result["result"] == "fail"
        assert any("best day" in v.lower() for v in result["violations"])

    def test_consistency_passes_when_under_threshold(self):
        """Best day at 40% passes TPT's 50% threshold."""
        strategy = _make_strategy(
            "tpt_50k",
            best_day_pnl=2000,
            total_pnl=5000,  # 40%
        )
        firm_rules = {"consistency_threshold": 0.50}
        result = check_strategy_compliance(strategy, firm_rules)

        assert not any("consistency" in v.lower() or "best day" in v.lower()
                       for v in result["violations"])

    def test_daily_loss_violation(self):
        """Daily loss exceeding limit should fail."""
        strategy = _make_strategy("topstep_50k", daily_loss=1200)
        firm_rules = {"daily_loss_limit": 1000}
        result = check_strategy_compliance(strategy, firm_rules)

        assert result["result"] == "fail"
        assert any("daily loss" in v.lower() for v in result["violations"])

    def test_overnight_holding_violation(self):
        """Overnight holding when firm prohibits it should fail."""
        strategy = _make_strategy("test_firm", overnight_holding=True)
        firm_rules = {"overnight_allowed": False}
        result = check_strategy_compliance(strategy, firm_rules)

        assert result["result"] == "fail"
        assert any("overnight" in v.lower() for v in result["violations"])

    def test_contract_limit_violation(self):
        """Exceeding contract limit for a symbol should fail."""
        strategy = _make_strategy(
            "tpt_50k",
            contracts_per_symbol={"MES": 5, "MNQ": 2},
        )
        firm_rules = {"contract_limits": {"MES": 3, "MNQ": 3}}
        result = check_strategy_compliance(strategy, firm_rules)

        assert result["result"] == "fail"
        assert any("MES" in v for v in result["violations"])

    def test_automation_banned_violation(self):
        """Automated strategy on a firm that bans bots should fail."""
        strategy = _make_strategy("tpt_50k", automated=True)
        firm_rules = {"automation_banned": True}
        result = check_strategy_compliance(strategy, firm_rules)

        assert result["result"] == "fail"
        assert any("automat" in v.lower() for v in result["violations"])

    def test_multiple_violations_accumulate_risk(self):
        """Multiple violations should increase risk score."""
        strategy = _make_strategy(
            "test_firm",
            max_drawdown=3000,
            daily_loss=1500,
            overnight_holding=True,
            automated=True,
        )
        firm_rules = {
            "max_drawdown_limit": 2000,
            "daily_loss_limit": 1000,
            "overnight_allowed": False,
            "automation_banned": True,
        }
        result = check_strategy_compliance(strategy, firm_rules)

        assert result["result"] == "fail"
        assert len(result["violations"]) >= 4
        assert result["risk_score"] >= 80

    def test_risk_score_capped_at_100(self):
        """Risk score should never exceed 100."""
        strategy = _make_strategy(
            "test_firm",
            max_drawdown=5000,
            daily_loss=3000,
            best_day_pnl=4500,
            total_pnl=5000,
            overnight_holding=True,
            automated=True,
            contracts_per_symbol={"MES": 20},
        )
        firm_rules = {
            "max_drawdown_limit": 2000,
            "daily_loss_limit": 1000,
            "consistency_threshold": 0.15,
            "overnight_allowed": False,
            "automation_banned": True,
            "contract_limits": {"MES": 3},
        }
        result = check_strategy_compliance(strategy, firm_rules)

        assert result["risk_score"] <= 100

    def test_no_firm_rules_passes(self):
        """Missing firm rules should not cause violations."""
        strategy = _make_strategy("test_firm")
        result = check_strategy_compliance(strategy, {})

        assert result["result"] == "pass"
        assert result["violations"] == []


# ─── Pre-Session Gate ────────────────────────────────────────────


class TestPreSessionGate:
    def test_mixed_results(self):
        """Gate with one passing, one failing, one restricted strategy."""
        rules = {
            "max_drawdown_limit": 2000,
            "daily_loss_limit": 1000,
            "consistency_threshold": 0.50,
            "overnight_allowed": True,
        }
        rulesets = [
            _make_ruleset("firm_a", age_hours=1.0, rules=rules),
            _make_ruleset("firm_b", age_hours=1.0, rules=rules),
            _make_ruleset("firm_c", age_hours=1.0, rules=rules),
        ]
        strategies = [
            # Should pass
            _make_strategy("firm_a", strategy_id="s1", max_drawdown=1000),
            # Should fail — drawdown violation
            _make_strategy("firm_b", strategy_id="s2", max_drawdown=2500),
            # Should be restricted — near drawdown limit (warning)
            _make_strategy("firm_c", strategy_id="s3", max_drawdown=1700),
        ]

        result = pre_session_gate(strategies, rulesets)

        assert result["summary"]["approved"] == 1
        assert result["summary"]["blocked"] == 1
        assert result["summary"]["restricted"] == 1
        assert len(result["decisions"]) == 3

        gates = {d["strategy_id"]: d["gate"] for d in result["decisions"]}
        assert gates["s1"] == "APPROVED"
        assert gates["s2"] == "BLOCKED"
        assert gates["s3"] == "RESTRICTED"

    def test_missing_ruleset_blocks(self):
        """Strategy with no matching ruleset should be blocked."""
        strategies = [_make_strategy("unknown_firm")]
        result = pre_session_gate(strategies, [])

        assert result["summary"]["blocked"] == 1
        assert result["decisions"][0]["gate"] == "BLOCKED"
        assert "No ruleset found" in result["decisions"][0]["reason"]

    def test_stale_ruleset_blocks(self):
        """Strategy with stale ruleset should be blocked."""
        rulesets = [_make_ruleset("firm_a", age_hours=30.0)]
        strategies = [_make_strategy("firm_a")]

        result = pre_session_gate(strategies, rulesets, "active_trading")

        assert result["summary"]["blocked"] == 1
        assert result["decisions"][0]["gate"] == "BLOCKED"
        assert result["decisions"][0]["freshness"]["status"] == "stale"

    def test_drift_blocks_even_with_good_compliance(self):
        """Drift-detected ruleset blocks even if strategy is compliant."""
        rulesets = [
            _make_ruleset(
                "firm_a",
                age_hours=0.5,
                drift_detected=True,
                rules={"max_drawdown_limit": 5000},
            ),
        ]
        strategies = [_make_strategy("firm_a", max_drawdown=500)]

        result = pre_session_gate(strategies, rulesets)

        assert result["summary"]["blocked"] == 1
        assert result["decisions"][0]["freshness"]["status"] == "blocked_drift"

    def test_all_approved(self):
        """All strategies passing should yield all APPROVED."""
        rules = {"max_drawdown_limit": 3000}
        rulesets = [
            _make_ruleset("firm_a", age_hours=1.0, rules=rules),
            _make_ruleset("firm_b", age_hours=2.0, rules=rules),
        ]
        strategies = [
            _make_strategy("firm_a", strategy_id="s1", max_drawdown=1000),
            _make_strategy("firm_b", strategy_id="s2", max_drawdown=1000),
        ]

        result = pre_session_gate(strategies, rulesets)

        assert result["summary"]["approved"] == 2
        assert result["summary"]["blocked"] == 0
        assert result["summary"]["restricted"] == 0

    def test_date_is_iso_format(self):
        """Gate output date should be ISO format."""
        result = pre_session_gate([], [])

        assert result["date"]  # Non-empty
        # Should be parseable as date
        datetime.fromisoformat(result["date"])


# ─── Drift Detection ────────────────────────────────────────────


class TestDriftDetection:
    def test_no_drift_same_content(self):
        """Same content should produce no drift."""
        content = "Max drawdown: $2,000. Trailing EOD."
        stored_hash = compute_content_hash(content)
        result = detect_drift(stored_hash, content)

        assert result["drift_detected"] is False
        assert result["old_hash"] == result["new_hash"]

    def test_drift_detected_on_change(self):
        """Changed content should produce drift."""
        old_content = "Max drawdown: $2,000. Trailing EOD."
        new_content = "Max drawdown: $2,500. Trailing EOD."
        stored_hash = compute_content_hash(old_content)
        result = detect_drift(stored_hash, new_content)

        assert result["drift_detected"] is True
        assert result["old_hash"] != result["new_hash"]

    def test_hash_is_sha256(self):
        """Content hash should be a valid SHA-256 hex string."""
        h = compute_content_hash("test content")
        assert len(h) == 64
        assert all(c in "0123456789abcdef" for c in h)

    def test_hash_deterministic(self):
        """Same content should always produce the same hash."""
        content = "Consistency rule: 50% best day cap."
        h1 = compute_content_hash(content)
        h2 = compute_content_hash(content)
        assert h1 == h2

    def test_drift_on_whitespace_change(self):
        """Even whitespace changes should trigger drift."""
        old = "Max drawdown: $2,000."
        new = "Max drawdown:  $2,000."  # Extra space
        stored_hash = compute_content_hash(old)
        result = detect_drift(stored_hash, new)

        assert result["drift_detected"] is True
