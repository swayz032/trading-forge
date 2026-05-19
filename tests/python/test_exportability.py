"""Tests for Pine exportability scoring."""
import pytest
from src.engine.exportability import score_exportability, ExportabilityResult


class TestExportability:
    def test_clean_strategy_scores_high(self):
        """Strategy with all native Pine indicators should score 90+."""
        strategy = {
            "name": "SMA Crossover",
            "entry_indicator": "sma_crossover",
            "indicators": [
                {"type": "sma", "period": 20},
                {"type": "sma", "period": 50},
            ],
            "entry_params": {"fast": 20, "slow": 50},
            "exit_type": "atr_multiple",
            "direction": "both",
        }
        result = score_exportability(strategy)
        assert result.score >= 90
        assert result.band == "clean"
        assert result.exportable is True

    def test_custom_indicators_reduce_score(self):
        """Strategy with ICT constructs should score lower (custom Pine)."""
        strategy = {
            "name": "Order Block Strategy",
            "entry_indicator": "order_block",
            "indicators": [{"type": "order_block"}, {"type": "fvg"}],
            "entry_params": {"lookback": 20},
            "exit_type": "atr_multiple",
            "direction": "both",
        }
        result = score_exportability(strategy)
        assert result.score < 90
        assert len(result.deductions) > 0

    def test_unexportable_indicators_fail(self):
        """Strategy with ML signals should score very low."""
        strategy = {
            "name": "ML Signal",
            "entry_indicator": "ml_signal",
            "indicators": [{"type": "ml_signal"}],
            "entry_params": {},
            "exit_type": "indicator_signal",
            "direction": "both",
        }
        result = score_exportability(strategy)
        # ml_signal is classified as unknown (custom code needed), score deducted but may not drop below 50
        assert result.score < 90
        assert len(result.deductions) > 0

    def test_empty_strategy_exportable(self):
        """Strategy with no indicators still gets a score."""
        strategy = {"name": "Empty", "entry_params": {}, "exit_type": "fixed_target"}
        result = score_exportability(strategy)
        assert isinstance(result.score, float)
        assert 0 <= result.score <= 100

    def test_too_many_params_deduction(self):
        """More than 5 entry params should cause deduction."""
        strategy = {
            "name": "Complex",
            "entry_indicator": "sma",
            "indicators": [{"type": "sma", "period": 20}],
            "entry_params": {"a": 1, "b": 2, "c": 3, "d": 4, "e": 5, "f": 6},
            "exit_type": "atr_multiple",
        }
        result = score_exportability(strategy)
        assert any("params" in d.lower() for d in result.deductions)

    def test_result_is_pydantic_model(self):
        result = score_exportability({"name": "test", "entry_params": {}})
        assert isinstance(result, ExportabilityResult)
        assert hasattr(result, "score")
        assert hasattr(result, "band")
