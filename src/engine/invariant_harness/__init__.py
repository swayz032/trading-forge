"""Trading Forge — Post-backtest Invariant Harness.

Public API:
    run_invariants(result: dict) -> InvariantReport

All 14 invariants run synchronously, purely on the result dict.
No I/O, no side effects, no new dependencies.
"""
from src.engine.invariant_harness.core import (
    InvariantCheck,
    InvariantHarness,
    InvariantReport,
    run_invariants,
)

__all__ = [
    "InvariantCheck",
    "InvariantHarness",
    "InvariantReport",
    "run_invariants",
]
