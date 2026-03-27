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

    def test_indicator_artifact_has_pine_v6(self):
        result = compile_strategy(self._make_strategy())
        indicator = next(a for a in result.artifacts if a.artifact_type == "indicator")
        assert "//@version=6" in indicator.content
        assert 'indicator("Test SMA Cross"' in indicator.content

    def test_alerts_json_artifact(self):
        result = compile_strategy(self._make_strategy())
        alerts = next(a for a in result.artifacts if a.artifact_type == "alerts_json")
        parsed = json.loads(alerts.content)
        assert "alerts" in parsed
        assert len(parsed["alerts"]) > 0

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
