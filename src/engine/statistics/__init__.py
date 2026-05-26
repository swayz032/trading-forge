"""Statistics sub-package for backtesting engine.

Exports:
  whites_reality_check  — White's Reality Check (WRC) test
  hansens_spa           — Hansen's Superior Predictive Ability (SPA) test

Both functions are pure: no DB access, no I/O, deterministic with fixed seed.
"""

from src.engine.statistics.whites_reality_check import whites_reality_check
from src.engine.statistics.hansens_spa import hansens_spa

__all__ = ["whites_reality_check", "hansens_spa"]
