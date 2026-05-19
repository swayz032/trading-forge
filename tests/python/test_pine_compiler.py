"""Tests for Pine Script v6 compiler."""
import json
import pytest
from src.engine.pine_compiler import compile_strategy, CompilerResult, PineArtifact


class TestPineCompiler:
    def _make_strategy(self, **overrides):
        base = {
            "name": "Test SMA Cross",
            "description": "Buy when fast SMA crosses above slow SMA",
            "symbol": "MES",
            "timeframe": "5m",
            "direction": "both",
            "entry_type": "trend_follow",
            "entry_indicator": "sma_crossover",
            "entry_params": {"fast": 20, "slow": 50},
            "exit_type": "atr_multiple",
            "exit_params": {},
            "stop_loss_atr_multiple": 2.0,
            "take_profit_atr_multiple": 4.0,
            "indicators": [
                {"type": "sma", "period": 20},
                {"type": "sma", "period": 50},
            ],
        }
        base.update(overrides)
        return base

    def test_compile_produces_artifacts(self):
        strategy = self._make_strategy()
        result = compile_strategy(strategy)
        assert isinstance(result, CompilerResult)
        assert len(result.artifacts) >= 2  # indicator + alerts_json at minimum
        assert result.exportability.exportable is True

    def test_indicator_artifact_has_pine_v5(self):
        result = compile_strategy(self._make_strategy())
        indicator = next(a for a in result.artifacts if a.artifact_type == "indicator")
        assert "//@version=5" in indicator.content
        assert 'indicator("Test SMA Cross"' in indicator.content

    def test_alerts_json_artifact(self):
        result = compile_strategy(self._make_strategy())
        alerts = next(a for a in result.artifacts if a.artifact_type == "alerts_json")
        parsed = json.loads(alerts.content)
        assert "alerts" in parsed
        assert len(parsed["alerts"]) > 0

    def test_alerts_json_names_match_pine_alertcondition_titles(self):
        """Fix 4.3: alerts_json names must match the Pine alertcondition() title= strings exactly.

        Webhook automation reads the JSON names to configure TradingView alert subscriptions.
        Any mismatch between JSON names and Pine titles causes silent webhook misconfiguration.
        """
        result = compile_strategy(self._make_strategy())
        alerts_artifact = next(a for a in result.artifacts if a.artifact_type == "alerts_json")
        parsed = json.loads(alerts_artifact.content)
        json_names = {entry["name"] for entry in parsed["alerts"]}

        # These are the exact title= strings used in the emitted alertcondition() calls
        expected_pine_titles = {"Long Entry", "Short Entry", "Invalidated", "Long Exit", "Short Exit", "Risk Lockout"}
        assert json_names == expected_pine_titles, (
            f"alerts_json names must match Pine alertcondition titles exactly. "
            f"Got: {json_names}. Expected: {expected_pine_titles}"
        )

    def test_alerts_json_no_stale_names(self):
        """Fix 4.3: stale alert names (long_armed, short_armed, entry_confirmed, no_trade, prop_risk_lockout)
        must not appear in alerts_json — they have no corresponding Pine alertcondition().
        """
        result = compile_strategy(self._make_strategy())
        alerts_artifact = next(a for a in result.artifacts if a.artifact_type == "alerts_json")
        parsed = json.loads(alerts_artifact.content)
        json_names = {entry["name"] for entry in parsed["alerts"]}

        stale_names = {"long_armed", "short_armed", "entry_confirmed", "no_trade", "prop_risk_lockout"}
        intersection = json_names & stale_names
        assert not intersection, f"Stale alert names found in alerts_json: {intersection}"

    def test_alerts_json_pine_version_is_v5(self):
        """Fix 4.4: alerts_json pine_version field must reflect v5, not v6."""
        result = compile_strategy(self._make_strategy())
        alerts_artifact = next(a for a in result.artifacts if a.artifact_type == "alerts_json")
        parsed = json.loads(alerts_artifact.content)
        assert parsed["pine_version"] == "v5", f"Expected v5, got {parsed['pine_version']}"

    def test_compiler_result_pine_version_is_v5(self):
        """Fix 4.4: CompilerResult.pine_version must be v5."""
        result = compile_strategy(self._make_strategy())
        assert result.pine_version == "v5", f"Expected v5, got {result.pine_version}"

    def test_strategy_shell_is_pine_v5(self):
        """Fix 4.4: strategy shell must emit //@version=5, not //@version=6."""
        result = compile_strategy(self._make_strategy())
        shells = [a for a in result.artifacts if a.artifact_type == "strategy_shell"]
        if shells:
            assert "//@version=5" in shells[0].content
            assert "//@version=6" not in shells[0].content

    def test_strategy_shell_for_high_score(self):
        result = compile_strategy(self._make_strategy())
        if result.exportability.score >= 70:
            shells = [a for a in result.artifacts if a.artifact_type == "strategy_shell"]
            assert len(shells) == 1
            assert "strategy(" in shells[0].content

    def test_prop_overlay_with_firm(self):
        result = compile_strategy(self._make_strategy(), firm_key="topstep_50k")
        indicator = next(a for a in result.artifacts if a.artifact_type == "indicator")
        assert "topstep_50k" in indicator.content
        assert "max_drawdown_limit" in indicator.content

    def test_prop_overlay_without_firm(self):
        result = compile_strategy(self._make_strategy())
        indicator = next(a for a in result.artifacts if a.artifact_type == "indicator")
        assert "max_drawdown_limit" in indicator.content

    def test_no_firm_declares_risk_lockout(self):
        """Fix 2.11: risk_lockout must be declared in no-firm path so state machine can reference it."""
        result = compile_strategy(self._make_strategy())
        indicator = next(a for a in result.artifacts if a.artifact_type == "indicator")
        # Must have a var declaration, not just a bare assignment — prevents undeclared-variable parse error
        assert "var bool risk_lockout = false" in indicator.content
        # State machine must reference risk_lockout — this is the consuming side
        assert "not risk_lockout" in indicator.content

    def test_firm_path_declares_risk_lockout(self):
        """Firm path already assigns risk_lockout; verify declaration is still present."""
        result = compile_strategy(self._make_strategy(), firm_key="topstep_50k")
        indicator = next(a for a in result.artifacts if a.artifact_type == "indicator")
        assert "risk_lockout" in indicator.content

    def test_risk_intelligence_overlay_emitted_when_provided(self):
        """Fix 2.12: risk_intelligence dict passed to compile_strategy must appear in output Pine."""
        risk_intel = {
            "breach_probability": 0.12,
            "ruin_probability": 0.03,
            "survival_rate": 0.97,
            "mc_sharpe_p50": 1.85,
            "quantum_estimate": 0.11,
        }
        result = compile_strategy(self._make_strategy(), risk_intelligence=risk_intel)
        indicator = next(a for a in result.artifacts if a.artifact_type == "indicator")
        assert "BREACH_PROB" in indicator.content
        assert "RUIN_PROB" in indicator.content
        assert "SURVIVAL_RATE" in indicator.content
        assert "MC_SHARPE_P50" in indicator.content
        assert "QUANTUM_ESTIMATE" in indicator.content
        assert "riskTable" in indicator.content

    def test_risk_intelligence_not_emitted_when_absent(self):
        """Risk intelligence table must not appear when no risk_intelligence is passed."""
        result = compile_strategy(self._make_strategy())
        indicator = next(a for a in result.artifacts if a.artifact_type == "indicator")
        assert "riskTable" not in indicator.content
        assert "BREACH_PROB" not in indicator.content

    def test_risk_intelligence_partial_fields(self):
        """Only fields with non-None values should appear in the risk table."""
        risk_intel = {
            "ruin_probability": 0.05,
            "survival_rate": 0.95,
            # breach_probability, mc_sharpe_p50, quantum_estimate intentionally absent
        }
        result = compile_strategy(self._make_strategy(), risk_intelligence=risk_intel)
        indicator = next(a for a in result.artifacts if a.artifact_type == "indicator")
        assert "RUIN_PROB" in indicator.content
        assert "SURVIVAL_RATE" in indicator.content
        assert "BREACH_PROB" not in indicator.content
        assert "MC_SHARPE_P50" not in indicator.content

    def test_state_machine_in_output(self):
        result = compile_strategy(self._make_strategy())
        indicator = next(a for a in result.artifacts if a.artifact_type == "indicator")
        assert "state == 0" in indicator.content
        assert "NEUTRAL" in indicator.content or "neutral" in indicator.content.lower()

    def test_session_filter_rth(self):
        result = compile_strategy(self._make_strategy(session_filter="RTH_ONLY"))
        indicator = next(a for a in result.artifacts if a.artifact_type == "indicator")
        assert "0930-1600" in indicator.content

    def test_unexportable_strategy_no_artifacts(self):
        strategy = self._make_strategy(
            entry_indicator="ml_signal",
            indicators=[{"type": "ml_signal"}],
        )
        result = compile_strategy(strategy)
        if not result.exportability.exportable:
            assert len(result.artifacts) == 0

    def test_content_hash_deterministic(self):
        s = self._make_strategy()
        r1 = compile_strategy(s)
        r2 = compile_strategy(s)
        assert r1.content_hash == r2.content_hash

    # ── 4.6: firm-specific commission in strategy shell ──────────────────

    def test_strategy_shell_commission_topstep(self):
        """topstep_50k charges $0.37/side — shell must reflect that, not the generic 0.62."""
        result = compile_strategy(self._make_strategy(), firm_key="topstep_50k")
        shells = [a for a in result.artifacts if a.artifact_type == "strategy_shell"]
        if shells:
            assert "commission_value=0.37" in shells[0].content
            assert "commission_value=0.62" not in shells[0].content

    def test_strategy_shell_commission_tradeify(self):
        """tradeify_50k charges $1.29/side."""
        result = compile_strategy(self._make_strategy(), firm_key="tradeify_50k")
        shells = [a for a in result.artifacts if a.artifact_type == "strategy_shell"]
        if shells:
            assert "commission_value=1.29" in shells[0].content

    def test_strategy_shell_commission_alpha(self):
        """alpha_50k charges $0.00/side."""
        result = compile_strategy(self._make_strategy(), firm_key="alpha_50k")
        shells = [a for a in result.artifacts if a.artifact_type == "strategy_shell"]
        if shells:
            assert "commission_value=0.0" in shells[0].content

    def test_strategy_shell_commission_no_firm_fallback(self):
        """No firm key — shell must fall back to 0.62 default."""
        result = compile_strategy(self._make_strategy())
        shells = [a for a in result.artifacts if a.artifact_type == "strategy_shell"]
        if shells:
            assert "commission_value=0.62" in shells[0].content

    # ── 4.8: export_type routing ─────────────────────────────────────────

    def test_export_type_alert_only_emits_only_alerts_json(self):
        """alert_only must produce exactly one artifact: alerts_json."""
        strategy = self._make_strategy(export_type="alert_only")
        result = compile_strategy(strategy)
        assert len(result.artifacts) == 1
        assert result.artifacts[0].artifact_type == "alerts_json"

    def test_export_type_alert_only_no_pine_scripts(self):
        """alert_only must not emit indicator or strategy_shell artifacts."""
        strategy = self._make_strategy(export_type="alert_only")
        result = compile_strategy(strategy)
        types = {a.artifact_type for a in result.artifacts}
        assert "indicator" not in types
        assert "strategy_shell" not in types

    def test_export_type_pine_strategy_no_indicator(self):
        """pine_strategy must emit strategy_shell + alerts_json, no indicator."""
        strategy = self._make_strategy(export_type="pine_strategy")
        result = compile_strategy(strategy)
        types = {a.artifact_type for a in result.artifacts}
        assert "indicator" not in types
        assert "strategy_shell" in types
        assert "alerts_json" in types

    def test_export_type_pine_indicator_default_behavior(self):
        """pine_indicator (explicit) produces indicator + alerts_json + optional shell."""
        strategy = self._make_strategy(export_type="pine_indicator")
        result = compile_strategy(strategy)
        types = {a.artifact_type for a in result.artifacts}
        assert "indicator" in types
        assert "alerts_json" in types

    def test_export_type_omitted_defaults_to_pine_indicator(self):
        """Omitting export_type must behave identically to pine_indicator."""
        s_default = self._make_strategy()
        s_explicit = self._make_strategy(export_type="pine_indicator")
        r_default = compile_strategy(s_default)
        r_explicit = compile_strategy(s_explicit)
        default_types = sorted(a.artifact_type for a in r_default.artifacts)
        explicit_types = sorted(a.artifact_type for a in r_explicit.artifacts)
        assert default_types == explicit_types

    def test_export_type_pine_strategy_uses_firm_commission(self):
        """pine_strategy export must also respect firm commission (not hardcode 0.62)."""
        strategy = self._make_strategy(export_type="pine_strategy")
        result = compile_strategy(strategy, firm_key="topstep_50k")
        shells = [a for a in result.artifacts if a.artifact_type == "strategy_shell"]
        assert len(shells) == 1
        assert "commission_value=0.37" in shells[0].content
