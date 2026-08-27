#!/usr/bin/env python3
"""Pandas 3 compatibility launcher for the frozen v2.2 runner.

Pandas 3 removed DataFrame.applymap in favor of DataFrame.map. The underlying
runner uses applymap only for the post-backtest tick-grid validation table. This
shim restores that API alias and changes no trading, data, or performance logic.
"""
import pandas as pd

if not hasattr(pd.DataFrame, "applymap"):
    pd.DataFrame.applymap = pd.DataFrame.map

from research.current_mnq_strategy_v2_2_runner import main

if __name__ == "__main__":
    main()
