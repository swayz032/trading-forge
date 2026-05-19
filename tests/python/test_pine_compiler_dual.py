"""Tests for compile_dual_artifacts() — Wave D1 dual-artifact output.

Verifies:
- Both artifacts always emitted when strategy is exportable
- INDICATOR artifact: indicator() declaration, no strategy.entry()
- STRATEGY artifact: strategy() declaration, strategy.entry(), TradersPost JSON
- Both artifacts contain identical signal conditions (semantic parity)
- Prop overlay present in both
- Alert timing semantics documented
- Exportability score preserved
- Degradation notes surface correctly
- Firm routing lists correct
"""
import json
import pytest
from src.engine.pine_compiler import (
    compile_dual_artifacts,
    DualArtifactResult,
    PineArtifact,
    ATS_FIRMS,
    MANUAL_APPROVAL_FIRMS,
)


# ─── Fixtures ────────────────────────────────────────────────────────

def _make_strategy(**overrides):
    base = {
        "name": "BB Bollinger Mean Rev",
        "description": "Short when price tags upper band, long when it tags lower band",
        "symbol": "MES",
        "timeframe": "5m",
        "direction": "both",
        "entry_type": "mean_revert",
        "entry_indicator": "bollinger_breakout",
        "entry_params": {"period": 20, "std_dev": 2.0},
        "exit_type": "atr_multiple",
        "exit_params": {},
        "stop_loss_atr_multiple": 2.0,
        "take_profit_atr_multiple": 4.0,
        "indicators": [
            {"type": "bollinger", "period": 20, "mult": 2.0},
        ],
        "session_filter": "RTH_ONLY",
    }
    base.update(overrides)
    return base


# ─── Basic Shape Tests ────────────────────────────────────────────────

class TestDualArtifactShape:
    def test_returns_dual_artifact_result(self):
        result = compile_dual_artifacts(_make_strategy())
        assert isinstance(result, DualArtifactResult)

    def test_exportable_strategy_has_both_artifacts(self):
        result = compile_dual_artifacts(_make_strategy())
        if result.exportable:
            assert result.indicator_artifact is not None
            assert result.strategy_artifact is not None
            assert result.alerts_artifact is not None

    def test_indicator_artifact_type(self):
        result = compile_dual_artifacts(_make_strategy())
        if result.exportable:
            assert result.indicator_artifact.artifact_type == "dual_indicator"

    def test_strategy_artifact_type(self):
        result = compile_dual_artifacts(_make_strategy())
        if result.exportable:
            assert result.strategy_artifact.artifact_type == "dual_strategy"

    def test_indicator_filename_suffix(self):
        result = compile_dual_artifacts(_make_strategy())
        if result.exportable:
            assert result.indicator_artifact.file_name.endswith("_INDICATOR.pine")

    def test_strategy_filename_suffix(self):
        result = compile_dual_artifacts(_make_strategy())
        if result.exportable:
            assert result.strategy_artifact.file_name.endswith("_STRATEGY.pine")

    def test_content_hash_set(self):
        result = compile_dual_artifacts(_make_strategy())
        if result.exportable:
            assert len(result.content_hash) == 64  # SHA-256 hex

    def test_content_hash_deterministic(self):
        s = _make_strategy()
        r1 = compile_dual_artifacts(s)
        r2 = compile_dual_artifacts(s)
        assert r1.content_hash == r2.content_hash

    def test_firm_routing_lists_populated(self):
        result = compile_dual_artifacts(_make_strategy())
        if result.exportable:
            assert len(result.indicator_firms) > 0
            assert len(result.strategy_firms) > 0
            # Apex must be in manual-approval list
            assert "apex_50k" in result.indicator_firms
            # Topstep must be in ATS list
            assert "topstep_50k" in result.strategy_firms


# ─── INDICATOR Artifact Invariants ───────────────────────────────────

class TestIndicatorArtifact:
    def _get_indicator(self, firm_key=None, **overrides) -> str:
        r = compile_dual_artifacts(_make_strategy(**overrides), firm_key=firm_key)
        assert r.exportable, f"strategy not exportable: {r.exportability.deductions}"
        return r.indicator_artifact.content

    def test_uses_indicator_declaration(self):
        code = self._get_indicator()
        assert 'indicator("' in code

    def test_no_strategy_entry_calls(self):
        """INDICATOR artifact must NEVER contain strategy.entry() — live-trading safety."""
        code = self._get_indicator()
        assert "strategy.entry(" not in code

    def test_no_strategy_exit_calls(self):
        code = self._get_indicator()
        assert "strategy.exit(" not in code

    def test_no_strategy_declaration(self):
        code = self._get_indicator()
        # strategy() as a declaration (not a function call on a different word)
        assert '\nstrategy("' not in code

    def test_has_alertcondition_long_entry(self):
        code = self._get_indicator()
        assert 'title="Long Entry"' in code

    def test_has_alertcondition_short_entry(self):
        code = self._get_indicator()
        assert 'title="Short Entry"' in code

    def test_alert_message_manual_approval_note(self):
        """INDICATOR alerts must flag MANUAL_APPROVAL_REQUIRED to prevent ATS confusion."""
        code = self._get_indicator()
        assert "MANUAL_APPROVAL_REQUIRED" in code

    def test_has_plotshape_for_signals(self):
        code = self._get_indicator()
        assert "plotshape(" in code

    def test_pine_v5_header(self):
        code = self._get_indicator()
        assert "//@version=5" in code

    def test_prop_overlay_present(self):
        """Prop overlay must appear in INDICATOR artifact regardless of firm."""
        code = self._get_indicator()
        assert "max_drawdown_limit" in code
        assert "risk_lockout" in code

    def test_prop_overlay_with_firm(self):
        code = self._get_indicator(firm_key="topstep_50k")  # passed to compile_dual_artifacts
        assert "topstep_50k" in code
        assert "max_drawdown_limit" in code

    def test_session_filter_rth_present(self):
        code = self._get_indicator()
        assert "0930-1600" in code

    def test_state_machine_in_indicator(self):
        code = self._get_indicator()
        assert "state == 0" in code

    def test_firm_deployment_notice_in_header(self):
        """Header must name the manual-approval firms so trader knows where to use it."""
        code = self._get_indicator()
        assert "Apex" in code or "apex" in code.lower()


# ─── STRATEGY Artifact Invariants ────────────────────────────────────

class TestStrategyArtifact:
    def _get_strategy(self, **overrides) -> str:
        r = compile_dual_artifacts(_make_strategy(**overrides))
        assert r.exportable, f"strategy not exportable: {r.exportability.deductions}"
        return r.strategy_artifact.content

    def test_uses_strategy_declaration(self):
        code = self._get_strategy()
        assert 'strategy("' in code

    def test_no_indicator_declaration(self):
        """STRATEGY artifact must use strategy(), not indicator()."""
        code = self._get_strategy()
        # The indicator() call would appear as indicator( without strategy prefix
        # Check that the word 'indicator(' is not the Pine script declaration
        lines = code.split("\n")
        decl_lines = [l for l in lines if l.strip().startswith("indicator(")]
        assert len(decl_lines) == 0, f"Found indicator() declaration in STRATEGY artifact: {decl_lines}"

    def test_has_strategy_entry_long(self):
        code = self._get_strategy()
        assert 'strategy.entry("Long"' in code

    def test_has_strategy_entry_short(self):
        code = self._get_strategy()
        assert 'strategy.entry("Short"' in code

    def test_has_strategy_exit(self):
        code = self._get_strategy()
        assert "strategy.exit(" in code

    def test_has_traderspost_webhook_alerts(self):
        """STRATEGY artifact must contain TradersPost JSON payload alerts."""
        code = self._get_strategy()
        assert '"action"' in code
        assert '"symbol"' in code
        assert '"quantity"' in code

    def test_traderspost_buy_action(self):
        code = self._get_strategy()
        assert '"action": "buy"' in code

    def test_traderspost_sell_action(self):
        code = self._get_strategy()
        assert '"action": "sell"' in code

    def test_traderspost_exit_action(self):
        code = self._get_strategy()
        assert '"action": "exit"' in code

    def test_traderspost_symbol_is_continuous(self):
        """Symbol in webhook payload must be TradingView continuous contract ticker."""
        code = self._get_strategy()
        assert "MES1!" in code

    def test_traderspost_strategy_id_in_payload(self):
        """strategyId must appear in webhook JSON for downstream automation."""
        code = self._get_strategy()
        assert "strategyId" in code

    def test_risk_lockout_closes_position(self):
        """STRATEGY artifact must close all positions when risk lockout fires."""
        code = self._get_strategy()
        assert "strategy.close_all" in code

    def test_risk_lockout_cancel_alert(self):
        """Risk lockout must emit cancel action for TradersPost."""
        code = self._get_strategy()
        assert '"action": "cancel"' in code

    def test_prop_overlay_present(self):
        code = self._get_strategy()
        assert "max_drawdown_limit" in code
        assert "risk_lockout" in code

    def test_pine_v5_header(self):
        code = self._get_strategy()
        assert "//@version=5" in code

    def test_commission_topstep(self):
        r = compile_dual_artifacts(_make_strategy(), firm_key="topstep_50k")
        code = r.strategy_artifact.content
        assert "commission_value=0.37" in code

    def test_commission_tradeify(self):
        r = compile_dual_artifacts(_make_strategy(), firm_key="tradeify_50k")
        code = r.strategy_artifact.content
        assert "commission_value=1.29" in code

    def test_commission_no_firm_fallback(self):
        r = compile_dual_artifacts(_make_strategy())
        code = r.strategy_artifact.content
        assert "commission_value=0.62" in code

    def test_once_per_bar_close_documented(self):
        """Alert setup instructions must require 'Once Per Bar Close' to prevent intrabar fills."""
        code = self._get_strategy()
        assert "Once Per Bar Close" in code

    def test_ats_deployment_notice_in_header(self):
        """Header must name the ATS firms."""
        code = self._get_strategy()
        assert "Topstep" in code or "topstep" in code.lower()


# ─── Signal Parity Between Artifacts ─────────────────────────────────

class TestSignalParity:
    """Both artifacts must use the same signal conditions — guarantees identical
    backtest results when loaded into TradingView Strategy Tester."""

    def _get_both(self, **overrides):
        r = compile_dual_artifacts(_make_strategy(**overrides))
        assert r.exportable
        return r.indicator_artifact.content, r.strategy_artifact.content

    def test_same_session_filter(self):
        ind, strat = self._get_both()
        assert "0930-1600" in ind
        assert "0930-1600" in strat

    def test_same_atr_period(self):
        ind, strat = self._get_both()
        assert "ta.atr(14)" in ind
        assert "ta.atr(14)" in strat

    def test_same_long_signal_var(self):
        ind, strat = self._get_both()
        assert "long_signal" in ind
        assert "long_signal" in strat

    def test_same_short_signal_var(self):
        ind, strat = self._get_both()
        assert "short_signal" in ind
        assert "short_signal" in strat

    def test_same_stop_distance_expression(self):
        ind, strat = self._get_both()
        # Both must reference stop_distance
        assert "stop_distance" in ind
        assert "stop_distance" in strat

    def test_same_use_target_value(self):
        # With take profit set
        ind, strat = self._get_both()
        # Both should have use_target = true
        assert "use_target = true" in ind
        assert "use_target" in strat

    def test_no_target_consistent(self):
        # Without take profit
        r = compile_dual_artifacts(_make_strategy(take_profit_atr_multiple=None))
        if r.exportable:
            assert "use_target = false" in r.indicator_artifact.content
            # Strategy artifact should also have na for target
            assert "na" in r.strategy_artifact.content


# ─── Alerts JSON Metadata ─────────────────────────────────────────────

class TestAlertsJsonMetadata:
    def _get_alerts(self, **overrides) -> dict:
        r = compile_dual_artifacts(_make_strategy(**overrides))
        assert r.exportable
        return json.loads(r.alerts_artifact.content)

    def test_has_delivery_paths(self):
        data = self._get_alerts()
        assert "delivery_paths" in data
        assert "indicator" in data["delivery_paths"]
        assert "strategy" in data["delivery_paths"]

    def test_indicator_path_has_manual_approval(self):
        data = self._get_alerts()
        assert data["delivery_paths"]["indicator"]["approval"] == "manual"

    def test_strategy_path_has_automated(self):
        data = self._get_alerts()
        assert data["delivery_paths"]["strategy"]["approval"] == "automated"

    def test_strategy_path_webhook_is_traderspost(self):
        data = self._get_alerts()
        assert data["delivery_paths"]["strategy"]["webhook"] == "traderspost"

    def test_tv_symbol_is_continuous(self):
        data = self._get_alerts()
        assert data["tv_symbol"] == "MES1!"

    def test_sample_payload_has_required_keys(self):
        data = self._get_alerts()
        payload = data["delivery_paths"]["strategy"]["sample_payload"]
        assert "action" in payload
        assert "symbol" in payload
        assert "strategyId" in payload

    def test_strategy_id_in_alerts_json(self):
        data = self._get_alerts()
        assert data["strategy_id"] != ""

    def test_once_per_bar_close_timing(self):
        data = self._get_alerts()
        ind_timing = data["delivery_paths"]["indicator"]["alert_timing"]
        strat_timing = data["delivery_paths"]["strategy"]["alert_timing"]
        assert ind_timing == "once_per_bar_close"
        assert strat_timing == "once_per_bar_close"


# ─── Risk Intelligence Propagation ───────────────────────────────────

class TestRiskIntelligence:
    def test_risk_intel_in_indicator(self):
        risk_intel = {"breach_probability": 0.10, "survival_rate": 0.90}
        r = compile_dual_artifacts(_make_strategy(), risk_intelligence=risk_intel)
        if r.exportable:
            assert "BREACH_PROB" in r.indicator_artifact.content

    def test_risk_intel_in_strategy(self):
        risk_intel = {"ruin_probability": 0.05}
        r = compile_dual_artifacts(_make_strategy(), risk_intelligence=risk_intel)
        if r.exportable:
            assert "RUIN_PROB" in r.strategy_artifact.content


# ─── Degradation Notes ───────────────────────────────────────────────

class TestDegradationNotes:
    def test_manual_approval_firm_triggers_note(self):
        """When firm_key is a manual-approval firm, degradation note must warn against ATS use."""
        r = compile_dual_artifacts(_make_strategy(), firm_key="apex_50k")
        if r.exportable:
            notes = " ".join(r.degradation_notes)
            assert "apex_50k" in notes or "manual" in notes.lower() or "automated" in notes.lower()

    def test_no_target_triggers_degradation_note(self):
        """Missing take_profit_atr_multiple must surface a degradation note about na target."""
        r = compile_dual_artifacts(_make_strategy(take_profit_atr_multiple=None))
        if r.exportable:
            notes = " ".join(r.degradation_notes)
            assert "take_profit" in notes.lower() or "target" in notes.lower()

    def test_unexportable_strategy_no_artifacts(self):
        strategy = _make_strategy(
            entry_indicator="ml_signal",
            indicators=[{"type": "ml_signal"}],
        )
        r = compile_dual_artifacts(strategy)
        if not r.exportable:
            assert r.indicator_artifact is None
            assert r.strategy_artifact is None
            assert len(r.degradation_notes) > 0


# ─── Backward Compatibility — compile_strategy() unchanged ───────────

class TestBackwardCompatibility:
    """compile_strategy() must still pass all existing tests — dual path is additive."""

    def test_compile_strategy_still_works(self):
        from src.engine.pine_compiler import compile_strategy, CompilerResult
        s = _make_strategy()
        result = compile_strategy(s)
        assert isinstance(result, CompilerResult)
        assert result.exportability.exportable is True

    def test_compile_strategy_no_dual_artifact_types(self):
        """compile_strategy() must NOT emit dual_indicator or dual_strategy types."""
        from src.engine.pine_compiler import compile_strategy
        result = compile_strategy(_make_strategy())
        types = {a.artifact_type for a in result.artifacts}
        assert "dual_indicator" not in types
        assert "dual_strategy" not in types

    def test_dual_does_not_affect_original_compile_hash(self):
        """Running compile_dual_artifacts should not change compile_strategy output."""
        from src.engine.pine_compiler import compile_strategy
        s = _make_strategy()
        r1 = compile_strategy(s)
        compile_dual_artifacts(s)  # run dual — should not mutate anything
        r2 = compile_strategy(s)
        assert r1.content_hash == r2.content_hash
