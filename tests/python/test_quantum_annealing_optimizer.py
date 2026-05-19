"""Tests for SQA parameter optimizer."""
import numpy as np
import pytest
from src.engine.quantum_annealing_optimizer import (
    build_parameter_qubo, run_sqa_optimization,
    decode_solution, find_robust_plateau, compare_vs_optuna,
    ParamRange, SQAResult,
)


class TestSQAOptimizer:
    def _make_param_ranges(self):
        return [
            ParamRange(name="sma_period", min_val=10, max_val=50, n_bits=4),
            ParamRange(name="stop_loss_atr", min_val=1.0, max_val=4.0, n_bits=4),
            ParamRange(name="take_profit_atr", min_val=2.0, max_val=8.0, n_bits=4),
        ]

    def test_build_qubo(self):
        ranges = self._make_param_ranges()
        qubo, formulation = build_parameter_qubo(ranges)
        assert len(qubo) > 0
        assert formulation.total_bits == 12  # 3 params * 4 bits

    def test_run_sqa(self):
        ranges = self._make_param_ranges()
        qubo, _ = build_parameter_qubo(ranges)
        result = run_sqa_optimization(qubo, ranges, num_reads=10, num_sweeps=100)
        assert isinstance(result, SQAResult)
        assert len(result.best_params) == 3
        assert "sma_period" in result.best_params

    def test_params_in_range(self):
        ranges = self._make_param_ranges()
        qubo, _ = build_parameter_qubo(ranges)
        result = run_sqa_optimization(qubo, ranges, num_reads=20)
        for pr in ranges:
            assert pr.min_val <= result.best_params[pr.name] <= pr.max_val

    def test_decode_solution(self):
        ranges = self._make_param_ranges()
        binary = np.array([1, 0, 1, 0, 0, 1, 0, 1, 1, 1, 0, 0])
        params = decode_solution(binary, ranges)
        assert len(params) == 3
        for pr in ranges:
            assert pr.min_val <= params[pr.name] <= pr.max_val

    def test_robust_plateau(self):
        solutions = [
            {"params": {"a": 1.0, "b": 2.0}, "energy": -5},
            {"params": {"a": 1.1, "b": 2.1}, "energy": -4.9},
            {"params": {"a": 1.2, "b": 1.9}, "energy": -4.8},
        ]
        plateau = find_robust_plateau(solutions, top_k=3)
        assert "a" in plateau
        assert plateau["a"]["min"] <= plateau["a"]["max"]

    def test_compare_vs_optuna(self):
        ranges = self._make_param_ranges()
        qubo, _ = build_parameter_qubo(ranges)
        sqa_result = run_sqa_optimization(qubo, ranges, num_reads=10)
        comparison = compare_vs_optuna(
            sqa_result,
            optuna_best_params={"sma_period": 25, "stop_loss_atr": 2.5, "take_profit_atr": 5.0},
            optuna_best_value=1.5,
            optuna_time_ms=5000,
        )
        assert hasattr(comparison, "sqa_wins")
        assert comparison.speedup > 0
