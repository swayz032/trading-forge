"""Position sizing — dynamic ATR-based and fixed.

Dynamic ATR: contracts = floor(target_risk / (ATR * tick_value)), clamped min=1.
Per CLAUDE.md: never use fixed position sizes in production.

Tier 5.4 — Profit-Based Position Scaling (Gemini Quantum Blueprint W5a):
  compute_profit_tier(account_pnl_total, base_contracts, increment, threshold, firm_max)
  Formula: tier_count = floor(pnl / threshold); extra = tier_count * increment
           final = min(base + extra, firm_max)
  Negative PnL -> tier_count=0 (no scaling). Single-account compounding only.
  Per CLAUDE.md: "ONE account must be profitable." No multi-account aggregation.
"""

from __future__ import annotations

import logging
import math

import numpy as np
import polars as pl

from src.engine.config import ContractSpec, PositionSizeConfig
from src.engine.firm_config import CONTRACT_CAP_MIN, CONTRACT_CAP_MAX

logger = logging.getLogger(__name__)


def compute_profit_tier(
    account_pnl_total: float,
    base_contracts: int,
    increment: int = 2,
    threshold: float = 3000.0,
    firm_max: int | None = None,
) -> int:
    """Compute contract count after applying profit-based scaling tier.

    Gemini "Forge-Tested" 2026 Edition: every $3,000 of profit = +2 micros.
    Single-account compounding only. CLAUDE.md: ONE account must be profitable.

    Args:
        account_pnl_total: Cumulative realized PnL on the single account ($).
        base_contracts:    Starting contract count (from ATR sizing or fixed).
        increment:         Extra contracts added per tier (default 2).
        threshold:         Profit required per tier (default $3,000).
        firm_max:          Hard ceiling. Defaults to CONTRACT_CAP_MAX (20).

    Returns:
        int: Final contract count, always >= base_contracts, <= firm_max.

    Examples:
        compute_profit_tier(0,    10) -> 10  (no profit, no scaling)
        compute_profit_tier(3000, 10) -> 12  (1 tier x 2)
        compute_profit_tier(9000, 10) -> 16  (3 tiers x 2)
        compute_profit_tier(-500, 10) -> 10  (negative pnl, no scaling)
    """
    effective_max = firm_max if firm_max is not None else CONTRACT_CAP_MAX

    # Negative or zero PnL -> no scaling
    if account_pnl_total <= 0.0:
        return max(base_contracts, min(base_contracts, effective_max))

    tier_count: int = math.floor(account_pnl_total / threshold)
    extra_contracts: int = tier_count * increment
    final: int = min(base_contracts + extra_contracts, effective_max)
    # Never return fewer than base_contracts (scaling is additive only)
    final = max(final, base_contracts)

    if extra_contracts > 0:
        logger.debug(
            "sizing.profit_tier_applied base=%d extra=%d final=%d firm_cap=%d pnl=%.2f",
            base_contracts,
            extra_contracts,
            final,
            effective_max,
            account_pnl_total,
        )

    return final


def compute_position_sizes(
    df: pl.DataFrame,
    config: PositionSizeConfig,
    contract_spec: ContractSpec,
    atr_period: int = 14,
    max_contracts: int | None = None,
    profit_scaling_tier: dict | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    """Compute position sizes for each bar.

    Args:
        df: DataFrame with ATR column (atr_{period}) if dynamic sizing
        config: Position sizing configuration
        contract_spec: Contract specifications for the symbol
        atr_period: ATR period to look up column name
        max_contracts: Optional firm contract cap. When provided,
            sizes are clamped to this maximum.
        profit_scaling_tier: Optional dict for Tier 5.4 profit-based scaling.
            When None (default), behavior is identical to pre-Tier-5.4 (no change).
            When provided, must contain:
                {
                    "account_pnl_total": float,   # cumulative realized PnL ($)
                    "increment": int,              # contracts per tier (default 2)
                    "threshold": float,            # profit per tier (default $3000)
                }
            The ATR-derived base size per bar is scaled up via compute_profit_tier().
            Result is still capped at the firm's max_contracts limit.
            Negative account_pnl_total -> no scaling (base unchanged).
            Only applies to dynamic_atr mode; fixed mode ignores this parameter.

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
    # ATR is in points, so multiply by point_value to get dollar risk per contract
    point_value = contract_spec.point_value

    # Floor ATR at 1 tick to prevent inf sizes on zero-range bars (holidays, data gaps)
    min_atr = contract_spec.tick_size
    atr_values = np.maximum(atr_values, min_atr)

    with np.errstate(divide="ignore", invalid="ignore"):
        raw = config.target_risk_dollars / (atr_values * point_value)

    # Floor raw values. Bars where raw > 0 but < 1.0 mean ATR-implied risk
    # exceeds target for even 1 contract — flag as over_risk.
    sizes = np.where(np.isnan(raw), np.nan, np.floor(raw))
    over_risk = (raw > 0) & (raw < 1.0)  # ATR says <1 contract but we'd still trade

    # Set over_risk bars to 1 contract (minimum tradeable) but the mask
    # is returned so the backtester can log warnings about excess risk.
    sizes = np.where(over_risk, 1.0, sizes)

    # Bars with zero or negative raw get NaN (no trade)
    sizes = np.where((~np.isnan(raw)) & (raw <= 0), np.nan, sizes)

    # Apply firm contract cap, clamped to [10, 20] range (default 15 micros)
    if max_contracts is not None:
        cap = max(CONTRACT_CAP_MIN, min(max_contracts, CONTRACT_CAP_MAX))
    else:
        cap = 15
    sizes = np.where(np.isnan(sizes), np.nan, np.minimum(sizes, cap))

    # Tier 5.4: Profit-based position scaling (Gemini Quantum Blueprint W5a).
    # Only active when profit_scaling_tier dict is explicitly provided.
    # Backwards-compatible: None (default) -> no behavior change whatsoever.
    # Only applies in dynamic_atr mode (fixed mode already returned above).
    if profit_scaling_tier is not None:
        pnl_total: float = float(profit_scaling_tier.get("account_pnl_total", 0.0))
        tier_increment: int = int(profit_scaling_tier.get("increment", 2))
        tier_threshold: float = float(profit_scaling_tier.get("threshold", 3000.0))

        def _scale_size(base_val: float) -> float:
            """Apply profit tier scaling to a single bar's base size."""
            if np.isnan(base_val):
                return base_val
            scaled = compute_profit_tier(
                account_pnl_total=pnl_total,
                base_contracts=int(base_val),
                increment=tier_increment,
                threshold=tier_threshold,
                firm_max=cap,
            )
            return float(scaled)

        sizes = np.array([_scale_size(s) for s in sizes], dtype=np.float64)

    return sizes, over_risk
