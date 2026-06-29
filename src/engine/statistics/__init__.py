"""Statistics sub-package for backtesting engine.

Exports:
  whites_reality_check  — White's Reality Check (WRC) test
  hansens_spa           — Hansen's Superior Predictive Ability (SPA) test
  compute_bif           — Backtest Inflation Factor (BIF): IS/OOS Sharpe ratio
  compute_cscv_pbo      — CSCV Probability of Backtest Overfitting (parameter snooping)

All functions are pure: no DB access, no I/O, deterministic with fixed seed.
"""

from src.engine.statistics.backtest_inflation_factor import compute_bif
from src.engine.statistics.cscv_gate import compute_cscv_pbo
from src.engine.statistics.hansens_spa import hansens_spa
from src.engine.statistics.whites_reality_check import whites_reality_check

__all__ = ["whites_reality_check", "hansens_spa", "compute_bif", "compute_cscv_pbo"]
