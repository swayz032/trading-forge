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
    max_contracts: int | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    """Compute position sizes for each bar.

    Args:
        df: DataFrame with ATR column (atr_{period}) if dynamic sizing
        config: Position sizing configuration
        contract_spec: Contract specifications for the symbol
        atr_period: ATR period to look up column name
        max_contracts: Optional firm contract cap. When provided,
            sizes are clamped to this maximum.

    Returns:
        Tuple of (sizes, over_risk):
          - sizes: numpy array of integer contract counts per bar
          - over_risk: boolean numpy array flagging bars where ATR-implied
            risk exceeds target for even 1 contract (raw < 1.0). These bars
            still get size=1 but callers should log warnings.
    """
    n = len(df)

    if config.type == "fixed":
        return np.full(n, config.fixed_contracts, dtype=np.float64), np.zeros(n, dtype=bool)

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

    # Floor raw values. Bars where raw > 0 but < 1.0 mean ATR-implied risk
    # exceeds target for even 1 contract — flag as over_risk.
    sizes = np.where(np.isnan(raw), np.nan, np.floor(raw))
    over_risk = (raw > 0) & (raw < 1.0)  # ATR says <1 contract but we'd still trade

    # Set over_risk bars to 1 contract (minimum tradeable) but the mask
    # is returned so the backtester can log warnings about excess risk.
    sizes = np.where(over_risk, 1.0, sizes)

    # Bars with zero or negative raw get NaN (no trade)
    sizes = np.where((~np.isnan(raw)) & (raw <= 0), np.nan, sizes)

    # Apply firm contract cap (default max 15 micros — user's standard size)
    cap = max_contracts if max_contracts is not None else 15
    sizes = np.where(np.isnan(sizes), np.nan, np.minimum(sizes, cap))

    return sizes, over_risk
