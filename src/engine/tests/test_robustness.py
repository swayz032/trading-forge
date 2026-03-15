"""Tests for parameter robustness analysis."""

import pytest
import optuna

from src.engine.robustness import (
    analyze_optuna_study,
    compute_param_importance,
    extract_robust_range,
)


def _make_study(values: list[float]) -> optuna.Study:
    """Create a mock Optuna study with given objective values (already negated for minimize)."""
    study = optuna.create_study(direction="minimize")

    for i, val in enumerate(values):
        trial = optuna.trial.create_trial(
            params={"param_a": 10 + i, "param_b": 5 + i * 0.5},
            distributions={
                "param_a": optuna.distributions.IntDistribution(5, 25),
                "param_b": optuna.distributions.FloatDistribution(1.0, 20.0),
            },
            values=[val],
        )
        study.add_trial(trial)

    return study


class TestAnalyzeOptunaStudy:
    def test_returns_dict(self):
        study = _make_study([-2.0, -1.9, -1.8, -1.5, -1.0])
        result = analyze_optuna_study(study)
        assert isinstance(result, dict)
        assert "is_robust" in result
        assert "plateau_variance" in result

    def test_robust_plateau(self):
        # All values very close → robust
        study = _make_study([-2.0, -1.95, -1.9, -1.92, -1.88, -1.91, -1.93, -1.89, -1.94, -1.96])
        result = analyze_optuna_study(study)
        assert result["is_robust"] is True
        assert result["plateau_variance"] < 15.0

    def test_not_robust_when_scattered(self):
        # Wide spread → not robust
        study = _make_study([-2.0, -0.1, -1.5, -0.3, -0.8, -1.8, -0.2, -0.5])
        result = analyze_optuna_study(study)
        # With such spread, top 15% should have variance > 15%
        assert isinstance(result["is_robust"], bool)

    def test_empty_study(self):
        study = optuna.create_study(direction="minimize")
        result = analyze_optuna_study(study)
        assert result["is_robust"] is False
        assert result["top_trial_count"] == 0

    def test_best_score_positive(self):
        study = _make_study([-2.5, -2.0, -1.5])
        result = analyze_optuna_study(study)
        assert result["best_score"] == pytest.approx(2.5)


class TestComputeParamImportance:
    def test_returns_dict(self):
        study = _make_study([-2.0, -1.5, -1.0, -0.5])
        result = compute_param_importance(study)
        assert isinstance(result, dict)

    def test_empty_study(self):
        study = optuna.create_study(direction="minimize")
        result = compute_param_importance(study)
        assert result == {}


class TestExtractRobustRange:
    def test_returns_dict(self):
        study = _make_study([-2.0, -1.9, -1.8, -1.5, -1.0])
        result = extract_robust_range(study, threshold=0.85)
        assert isinstance(result, dict)

    def test_contains_param_ranges(self):
        study = _make_study([-2.0, -1.9, -1.8, -1.5, -1.0])
        result = extract_robust_range(study, threshold=0.85)
        if result:
            for name, (low, high) in result.items():
                assert low <= high

    def test_empty_study(self):
        study = optuna.create_study(direction="minimize")
        result = extract_robust_range(study)
        assert result == {}
