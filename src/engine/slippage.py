"""Variable slippage model — ATR-scaled.

Per CLAUDE.md: slippage is a function of volatility, not a constant.
slippage_ticks = base_ticks * (ATR / median_ATR)
slippage_dollars = slippage_ticks * tick_value
"""

from __future__ import annotations

import numpy as np
import polars as pl

from src.engine.config import ContractSpec


def compute_slippage(
    df: pl.DataFrame,
    contract_spec: ContractSpec,
    base_ticks: float = 1.0,
    atr_period: int = 14,
    session_multipliers: np.ndarray | None = None,
    order_type: str = "market",
) -> np.ndarray:
    """Compute variable slippage per bar in dollar terms.

    Args:
        df: DataFrame with ATR column
        contract_spec: Contract spec for tick_value
        base_ticks: Base slippage in ticks (default 1)
        atr_period: ATR period for column lookup
        session_multipliers: Optional per-bar multipliers from liquidity
            profiles (e.g., 2.0x overnight, 1.0x RTH core)

    Returns:
        numpy array of slippage in dollars per bar
    """
    atr_col = f"atr_{atr_period}"
    if atr_col not in df.columns:
        from src.engine.indicators.core import compute_atr
        atr_series = compute_atr(df, atr_period)
    else:
        atr_series = df[atr_col]

    atr_values = atr_series.to_numpy().astype(np.float64)

    # Median ATR for normalization
    median_atr = np.nanmedian(atr_values)

    if median_atr == 0 or np.isnan(median_atr):
        # Fallback: constant slippage
        return np.full(len(df), base_ticks * contract_spec.tick_value)

    # Variable slippage: scale with ATR relative to median
    slippage_ticks = base_ticks * (atr_values / median_atr)
    slippage_dollars = slippage_ticks * contract_spec.tick_value

    # Order-type slippage modifier
    if order_type == "stop" or order_type == "stop_market":
        slippage_dollars = slippage_dollars * 2.0  # Stop-market: 2x slippage
    elif order_type == "limit":
        # Limit orders: slippage = half-spread only (better fill)
        slippage_dollars = slippage_dollars * 0.5
    elif order_type == "stop_limit":
        pass  # Base slippage * 1.0 (no modifier)

    # Apply session-based liquidity multipliers
    if session_multipliers is not None:
        slippage_dollars = slippage_dollars * session_multipliers

    return slippage_dollars
