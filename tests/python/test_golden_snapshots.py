"""Golden snapshot tests -- regression tests against known-good outputs."""
import json
import math
from pathlib import Path

import numpy as np
import pytest

GOLDEN_DIR = Path(__file__).parent / "golden"


def _compare_json(actual, expected, path="", tolerance=1e-6):
    """Deep compare two JSON structures with numeric tolerance."""
    ignored_keys = {"execution_time_ms", "execution_time_s"}

    if isinstance(expected, dict):
        assert isinstance(actual, dict), f"Type mismatch at {path}: expected dict, got {type(actual)}"
        for key in expected:
            if key in ignored_keys:
                continue
            assert key in actual, f"Missing key at {path}.{key}"
            _compare_json(actual[key], expected[key], f"{path}.{key}", tolerance)
    elif isinstance(expected, list):
        assert isinstance(actual, list), f"Type mismatch at {path}: expected list, got {type(actual)}"
        assert len(actual) == len(expected), (
            f"Length mismatch at {path}: {len(actual)} vs {len(expected)}"
        )
        for i, (a, e) in enumerate(zip(actual, expected)):
            _compare_json(a, e, f"{path}[{i}]", tolerance)
    elif isinstance(expected, float):
        assert isinstance(actual, (int, float)), (
            f"Type mismatch at {path}: expected number, got {type(actual)}"
        )
        if math.isnan(expected):
            assert math.isnan(actual), f"Expected NaN at {path}"
        else:
            assert abs(actual - expected) < tolerance, (
                f"Value mismatch at {path}: {actual} vs {expected} "
                f"(delta={abs(actual - expected)})"
            )
    else:
        assert actual == expected, f"Value mismatch at {path}: {actual!r} vs {expected!r}"


def _load_golden(name: str) -> dict:
    """Load a golden snapshot JSON file."""
    path = GOLDEN_DIR / name
    assert path.exists(), f"Golden snapshot not found: {path}"
    with open(path) as f:
        return json.load(f)


class TestGoldenSnapshots:
    def test_pine_compiler(self):
        from src.engine.pine_compiler import compile_strategy

        strategy = {
            "name": "golden_test_sma_cross",
            "symbol": "MES",
            "timeframe": "5m",
            "indicators": [
                {"type": "sma", "params": {"period": 20}},
                {"type": "sma", "params": {"period": 50}},
                {"type": "atr", "params": {"period": 14}},
            ],
            "entry_rules": [
                {"condition": "sma_20 > sma_50", "direction": "long"},
                {"condition": "sma_20 < sma_50", "direction": "short"},
            ],
            "exit_rules": [
                {"type": "atr_stop", "params": {"multiplier": 2.0}},
                {"type": "atr_target", "params": {"multiplier": 3.0}},
            ],
            "parameters": {
                "sma_fast": 20,
                "sma_slow": 50,
                "atr_period": 14,
                "stop_atr_mult": 2.0,
                "target_atr_mult": 3.0,
            },
        }

        result = compile_strategy(strategy, firm_key="topstep_50k")
        actual = result.model_dump()
        expected = _load_golden("pine_compiler_sma_cross.json")
        _compare_json(actual, expected, path="pine_compiler")

    def test_quantum_mc(self):
        from src.engine.quantum_mc import _run_estimation
        from src.engine.quantum_models import build_empirical_binned_distribution

        rng = np.random.default_rng(42)
        daily_pnls = rng.normal(100, 200, 100)
        model = build_empirical_binned_distribution(daily_pnls, n_bins=32)
        result = _run_estimation(
            model,
            threshold=2000.0,
            event_type="breach",
            backend=None,
            epsilon=0.01,
            alpha=0.05,
            seed=42,
        )
        actual = result.model_dump()
        expected = _load_golden("quantum_mc_breach.json")
        _compare_json(actual, expected, path="quantum_mc")

    def test_sqa_optimizer(self):
        from src.engine.quantum_annealing_optimizer import (
            ParamRange,
            build_parameter_qubo,
            run_sqa_optimization,
        )

        param_ranges = [
            ParamRange(name="sma_period", min_val=10, max_val=50, n_bits=4),
            ParamRange(name="stop_loss_atr", min_val=1.0, max_val=4.0, n_bits=4),
            ParamRange(name="take_profit_atr", min_val=2.0, max_val=8.0, n_bits=4),
        ]
        qubo, formulation = build_parameter_qubo(param_ranges)
        result = run_sqa_optimization(
            qubo, param_ranges, num_reads=50, num_sweeps=500, seed=42
        )
        actual = result.model_dump()
        expected = _load_golden("sqa_optimizer_params.json")
        _compare_json(actual, expected, path="sqa_optimizer")
