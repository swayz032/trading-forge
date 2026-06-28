"""Tests for Wave 4 Track 4C governance gates in parameter_evolver.py.

R2: trial_n_total injected into prompt when > 1.
R3: Lookahead guard instruction appears in every prompt;
    _validate_lookahead_guard detects forbidden patterns.
R5: INSUFFICIENT_SAMPLE tag when total_trades < MIN_SAMPLE_TRADING_DAYS.
R8: 5-field pre-commit validation in validate_mutations;
    precommit_status reflects completeness.

NUMBA_DISABLE_JIT=1 is NOT required by this file (no backtester import).
"""
from __future__ import annotations

import importlib
import os
import sys

# ---------------------------------------------------------------------------
# Import the module under test
# ---------------------------------------------------------------------------
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))

from src.engine.parameter_evolver import (  # noqa: E402
    _LOOKAHEAD_GUARD,
    _PRECOMMIT_FIELDS,
    MIN_SAMPLE_TRADING_DAYS,
    _validate_lookahead_guard,
    build_mutation_prompt,
    validate_mutations,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

PARAMS = {"ema_fast": 10, "ema_slow": 30, "atr_multiplier": 1.5}
RANGES = {"ema_fast": (5, 20), "ema_slow": (20, 60), "atr_multiplier": (1.0, 3.0)}

VALID_PRECOMMIT = {
    "economic_rationale": "Sharpe dropped 0.2 in window 3 per provided metrics.",
    "declared_param_space_size": 1,
    "min_sample_size": 63,
    "target_regime": "TRENDING",
    "declared_failure_mode": "Underperforms in ranging markets due to signal noise.",
}

MINIMAL_MUTATION = {
    "ema_fast": 12,  # 20% change from 10 → meaningful diff passes
    "reason": "Shorter period improves lag based on the provided walk-forward data.",
    **VALID_PRECOMMIT,
}


# ---------------------------------------------------------------------------
# R3 — Lookahead guard present in every prompt
# ---------------------------------------------------------------------------

class TestLookaheadGuardInPrompt:
    def test_lookahead_guard_prepended_to_prompt(self):
        prompt = build_mutation_prompt(
            name="Test", symbol="NQ", timeframe="5m",
            params=PARAMS, robust_ranges=RANGES,
            current_sharpe=0.8, baseline_sharpe=1.2, window_sharpes=[1.1, 0.9, 0.7],
        )
        assert prompt.startswith(_LOOKAHEAD_GUARD), (
            "Prompt must start with the LOOKAHEAD_GUARD constant"
        )

    def test_lookahead_guard_contains_key_instruction(self):
        prompt = build_mutation_prompt(
            name="Test", symbol="NQ", timeframe="5m",
            params=PARAMS, robust_ranges=RANGES,
            current_sharpe=0.5, baseline_sharpe=1.0, window_sharpes=[],
        )
        assert "GOVERNANCE INSTRUCTION" in prompt
        assert "EVALUATE ONLY PROVIDED DATA" in prompt
        assert "Do NOT use any knowledge from your training" in prompt

    def test_lookahead_guard_present_with_history(self):
        prompt = build_mutation_prompt(
            name="Strat", symbol="ES", timeframe="15m",
            params=PARAMS, robust_ranges=RANGES,
            current_sharpe=0.3, baseline_sharpe=0.9, window_sharpes=[0.8, 0.5, 0.3],
            mutation_history=[
                {"param_name": "ema_fast", "direction": "increase", "magnitude": "2",
                 "improvement": "0.1", "success": True, "regime": "trending"},
            ],
        )
        assert _LOOKAHEAD_GUARD in prompt


# ---------------------------------------------------------------------------
# R2 — trial_n_total context in prompt
# ---------------------------------------------------------------------------

class TestTrialNTotalInPrompt:
    def test_n_total_section_absent_when_one(self):
        prompt = build_mutation_prompt(
            name="Test", symbol="NQ", timeframe="5m",
            params=PARAMS, robust_ranges=RANGES,
            current_sharpe=1.0, baseline_sharpe=1.5, window_sharpes=[],
            trial_n_total=1,
        )
        assert "Cumulative trials" not in prompt, (
            "Should not inject N_total section when trial_n_total=1"
        )

    def test_n_total_section_present_when_greater_than_one(self):
        prompt = build_mutation_prompt(
            name="Test", symbol="NQ", timeframe="5m",
            params=PARAMS, robust_ranges=RANGES,
            current_sharpe=1.0, baseline_sharpe=1.5, window_sharpes=[],
            trial_n_total=7,
        )
        assert "Cumulative trials" in prompt
        assert "7" in prompt

    def test_n_total_default_is_one(self):
        """Default trial_n_total=1 should not inject N_total section."""
        prompt = build_mutation_prompt(
            name="Test", symbol="NQ", timeframe="5m",
            params=PARAMS, robust_ranges=RANGES,
            current_sharpe=1.0, baseline_sharpe=1.5, window_sharpes=[],
        )
        assert "Cumulative trials" not in prompt


# ---------------------------------------------------------------------------
# R3 — _validate_lookahead_guard detection
# ---------------------------------------------------------------------------

class TestValidateLookaheadGuard:
    def test_clean_reason_returns_empty(self):
        reason = "Sharpe dropped 0.3 in walk-forward window 3 per provided metrics."
        violations = _validate_lookahead_guard(reason)
        assert violations == []

    def test_detects_year_reference(self):
        reason = "In 2024 this strategy performed well on trending NQ sessions."
        violations = _validate_lookahead_guard(reason)
        assert len(violations) >= 1
        assert any("2024" in v for v in violations)

    def test_detects_last_year(self):
        reason = "Last year's data showed a clear pattern."
        violations = _validate_lookahead_guard(reason)
        assert len(violations) >= 1

    def test_detects_training_knowledge(self):
        reason = "From my training I know that EMA crossovers work better in trending markets."
        violations = _validate_lookahead_guard(reason)
        assert len(violations) >= 1

    def test_detects_based_on_my_knowledge(self):
        reason = "Based on my knowledge this period should be profitable."
        violations = _validate_lookahead_guard(reason)
        assert len(violations) >= 1

    def test_case_insensitive(self):
        reason = "IN 2025 there was a strong bull run."
        violations = _validate_lookahead_guard(reason)
        assert len(violations) >= 1

    def test_detects_research_shows(self):
        reason = "Research shows that shorter EMA periods reduce lag."
        violations = _validate_lookahead_guard(reason)
        assert len(violations) >= 1

    def test_does_not_flag_according_to_provided(self):
        reason = "According to the provided walk-forward metrics, Sharpe declined."
        violations = _validate_lookahead_guard(reason)
        assert violations == [], (
            "'according to the provided' must NOT trigger the lookahead violation"
        )


# ---------------------------------------------------------------------------
# R8 — Pre-commit field validation in validate_mutations
# ---------------------------------------------------------------------------

class TestValidateMutationsPrecommit:
    def test_complete_mutation_passes_with_all_fields(self):
        mutations = [dict(MINIMAL_MUTATION)]  # copy to avoid mutation
        result = validate_mutations(mutations, RANGES, PARAMS)
        assert len(result) == 1
        meta = result[0]["governance_meta"]
        assert meta["precommit_status"] == "complete"
        assert meta["missing_fields"] == []

    def test_missing_economic_rationale_marks_incomplete(self):
        mut = dict(MINIMAL_MUTATION)
        del mut["economic_rationale"]
        result = validate_mutations([mut], RANGES, PARAMS)
        assert len(result) == 1
        meta = result[0]["governance_meta"]
        assert meta["precommit_status"] == "incomplete"
        assert "economic_rationale" in meta["missing_fields"]

    def test_missing_target_regime_marks_incomplete(self):
        mut = dict(MINIMAL_MUTATION)
        del mut["target_regime"]
        result = validate_mutations([mut], RANGES, PARAMS)
        assert len(result) == 1
        meta = result[0]["governance_meta"]
        assert meta["precommit_status"] == "incomplete"
        assert "target_regime" in meta["missing_fields"]

    def test_missing_declared_failure_mode_marks_incomplete(self):
        mut = dict(MINIMAL_MUTATION)
        del mut["declared_failure_mode"]
        result = validate_mutations([mut], RANGES, PARAMS)
        assert len(result) == 1
        meta = result[0]["governance_meta"]
        assert meta["precommit_status"] == "incomplete"
        assert "declared_failure_mode" in meta["missing_fields"]

    def test_missing_declared_param_space_size_marks_incomplete(self):
        mut = dict(MINIMAL_MUTATION)
        del mut["declared_param_space_size"]
        result = validate_mutations([mut], RANGES, PARAMS)
        assert len(result) == 1
        meta = result[0]["governance_meta"]
        assert meta["precommit_status"] == "incomplete"
        assert "declared_param_space_size" in meta["missing_fields"]

    def test_missing_min_sample_size_marks_incomplete(self):
        mut = dict(MINIMAL_MUTATION)
        del mut["min_sample_size"]
        result = validate_mutations([mut], RANGES, PARAMS)
        assert len(result) == 1
        meta = result[0]["governance_meta"]
        assert meta["precommit_status"] == "incomplete"
        assert "min_sample_size" in meta["missing_fields"]

    def test_all_precommit_fields_preserved_in_governance_meta(self):
        mutations = [dict(MINIMAL_MUTATION)]
        result = validate_mutations(mutations, RANGES, PARAMS)
        meta = result[0]["governance_meta"]
        assert meta["economic_rationale"] == VALID_PRECOMMIT["economic_rationale"]
        assert meta["declared_param_space_size"] == 1
        assert meta["min_sample_size"] == 63
        assert meta["target_regime"] == "TRENDING"
        assert meta["declared_failure_mode"] == VALID_PRECOMMIT["declared_failure_mode"]

    def test_governance_meta_included_in_each_result(self):
        mutations = [dict(MINIMAL_MUTATION)]
        result = validate_mutations(mutations, RANGES, PARAMS)
        assert "governance_meta" in result[0]
        assert "params" in result[0]
        assert "reason" in result[0]

    def test_lookahead_violation_recorded_in_governance_meta(self):
        mut = dict(MINIMAL_MUTATION)
        mut["reason"] = "In 2025 this worked well according to external research."
        result = validate_mutations([mut], RANGES, PARAMS)
        assert len(result) == 1
        meta = result[0]["governance_meta"]
        assert meta["lookahead_violation"] is True
        assert len(meta["lookahead_violation_reasons"]) >= 1

    def test_no_lookahead_violation_when_reason_clean(self):
        mutations = [dict(MINIMAL_MUTATION)]
        result = validate_mutations(mutations, RANGES, PARAMS)
        meta = result[0]["governance_meta"]
        assert meta["lookahead_violation"] is False
        assert meta["lookahead_violation_reasons"] == []


# ---------------------------------------------------------------------------
# R5 — INSUFFICIENT_SAMPLE tag
# ---------------------------------------------------------------------------

class TestInsufficientSampleTag:
    def test_no_tag_when_trades_at_minimum(self):
        mutations = [dict(MINIMAL_MUTATION)]
        result = validate_mutations(mutations, RANGES, PARAMS, total_trades=MIN_SAMPLE_TRADING_DAYS)
        meta = result[0]["governance_meta"]
        assert "sample_tag" not in meta

    def test_no_tag_when_trades_above_minimum(self):
        mutations = [dict(MINIMAL_MUTATION)]
        result = validate_mutations(mutations, RANGES, PARAMS, total_trades=100)
        meta = result[0]["governance_meta"]
        assert "sample_tag" not in meta

    def test_insufficient_sample_tag_below_minimum(self):
        mutations = [dict(MINIMAL_MUTATION)]
        result = validate_mutations(mutations, RANGES, PARAMS, total_trades=30)
        meta = result[0]["governance_meta"]
        assert meta.get("sample_tag") == "INSUFFICIENT_SAMPLE"

    def test_insufficient_sample_tag_at_zero_trades(self):
        mutations = [dict(MINIMAL_MUTATION)]
        result = validate_mutations(mutations, RANGES, PARAMS, total_trades=0)
        meta = result[0]["governance_meta"]
        assert meta.get("sample_tag") == "INSUFFICIENT_SAMPLE"

    def test_insufficient_sample_one_below_minimum(self):
        mutations = [dict(MINIMAL_MUTATION)]
        result = validate_mutations(mutations, RANGES, PARAMS, total_trades=MIN_SAMPLE_TRADING_DAYS - 1)
        meta = result[0]["governance_meta"]
        assert meta.get("sample_tag") == "INSUFFICIENT_SAMPLE"

    def test_default_total_trades_zero_triggers_tag(self):
        """Calling without total_trades should default to 0 → INSUFFICIENT_SAMPLE."""
        mutations = [dict(MINIMAL_MUTATION)]
        result = validate_mutations(mutations, RANGES, PARAMS)
        meta = result[0]["governance_meta"]
        assert meta.get("sample_tag") == "INSUFFICIENT_SAMPLE"


# ---------------------------------------------------------------------------
# R8 — Pre-commit fields defined as tuple constant
# ---------------------------------------------------------------------------

class TestPrecommitFieldsConstant:
    def test_all_five_fields_present(self):
        expected = {
            "economic_rationale",
            "declared_param_space_size",
            "min_sample_size",
            "target_regime",
            "declared_failure_mode",
        }
        assert set(_PRECOMMIT_FIELDS) == expected

    def test_five_fields_in_prompt_example(self):
        prompt = build_mutation_prompt(
            name="Test", symbol="NQ", timeframe="5m",
            params=PARAMS, robust_ranges=RANGES,
            current_sharpe=0.8, baseline_sharpe=1.2, window_sharpes=[],
        )
        for field in _PRECOMMIT_FIELDS:
            assert field in prompt, f"Prompt must reference pre-commit field '{field}'"


# ---------------------------------------------------------------------------
# R2 — MIN_SAMPLE_TRADING_DAYS constant
# ---------------------------------------------------------------------------

class TestMinSampleTradingDaysConstant:
    def test_default_value_is_63(self):
        # env override may change it — check only when env is not set
        if "GOVERNANCE_MIN_SAMPLE_DAYS" not in os.environ:
            assert MIN_SAMPLE_TRADING_DAYS == 63
        else:
            assert MIN_SAMPLE_TRADING_DAYS == int(os.environ["GOVERNANCE_MIN_SAMPLE_DAYS"])

    def test_env_override_respected(self, monkeypatch):
        monkeypatch.setenv("GOVERNANCE_MIN_SAMPLE_DAYS", "90")
        # Reimport to pick up env
        import src.engine.parameter_evolver as pe
        importlib.reload(pe)
        assert pe.MIN_SAMPLE_TRADING_DAYS == 90
        # Restore
        importlib.reload(pe)
