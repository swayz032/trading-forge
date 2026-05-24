"""Quantum replay-grading harness — challenger-only, advisory layer.

Sub-modules:
  - db_loader      (P1.A2 backtest-core): DB extraction + WF fold loading
  - quantum_replay (P1.A1 quantum-challenger): IAE compute leaf

Import sub-modules directly rather than relying on package-level re-exports
to avoid circular import issues during package initialisation.

Example:
    from src.engine.replay.db_loader import load_backtest_with_folds
    from src.engine.replay.quantum_replay import replay_quantum_on_backtest
"""
# Intentionally minimal — no top-level re-exports to prevent circular imports
# during package initialisation when sub-modules import from each other.

