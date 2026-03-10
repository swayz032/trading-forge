"""Position sizing — dynamic ATR-based and fixed.

Dynamic ATR: contracts = floor(target_risk / (ATR * tick_value)), clamped min=1.
Per CLAUDE.md: never use fixed position sizes in production.
"""

from __future__ import annotations

import math

import numpy as np
import polars as pl

from src.engine.config import ContractSpec, PositionSizeConfig


def compute_position_sizes(
    df: pl.DataFrame,
    config: PositionSizeConfig,
    contract_spec: ContractSpec,
    atr_period: int = 14,
) -> np.ndarray:
    """Compute position sizes for each bar.

    Args:
        df: DataFrame with ATR column (atr_{period}) if dynamic sizing
        config: Position sizing configuration
        contract_spec: Contract specifications for the symbol
        atr_period: ATR period to look up column name

    Returns:
        numpy array of integer contract counts per bar
    """
    n = len(df)

    if config.type == "fixed":
        return np.full(n, config.fixed_contracts, dtype=np.float64)

    # dynamic_atr: contracts = floor(target_risk / (ATR * tick_value))
    atr_col = f"atr_{atr_period}"
    if atr_col not in df.columns:
        # Fallback: compute ATR
        from src.engine.indicators.core import compute_atr
        atr_series = compute_atr(df, atr_period)
    else:
        atr_series = df[atr_col]

    atr_values = atr_series.to_numpy().astype(np.float64)
    tick_value = contract_spec.tick_value

    with np.errstate(divide="ignore", invalid="ignore"):
        raw = config.target_risk_dollars / (atr_values * tick_value)

    # Floor and clamp min=1
    sizes = np.where(np.isnan(raw), np.nan, np.maximum(1, np.floor(raw)))
    return sizes
