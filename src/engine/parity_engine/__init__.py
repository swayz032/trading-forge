"""Parity Engine — Cross-engine validation layer (A3, W10).

Event-driven backtrader vs vectorized vectorbt.  If they agree on trade
lists, PnL, and Sharpe within tolerance, both engines are likely correct.
If they disagree, the divergence is documented for root-cause analysis.

IMPORTANT: This package is TEST-ONLY.  backtrader must never be imported
from any production path (backtester.py, paper engine, prop sim, etc.).
Only test_cross_engine_parity.py and diff_harness.py import it.
"""
