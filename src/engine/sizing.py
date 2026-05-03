"""Position sizing — dynamic ATR-based, fixed, and Kelly Criterion.

Dynamic ATR: contracts = floor(target_risk / (ATR * tick_value)), clamped min=1.
Per CLAUDE.md: never use fixed position sizes in production.

Tier 5.4 — Profit-Based Position Scaling (Gemini Quantum Blueprint W5a):
  compute_profit_tier(account_pnl_total, base_contracts, increment, threshold, firm_max)
  Formula: tier_count = floor(pnl / threshold); extra = tier_count * increment
           final = min(base + extra, firm_max)
  Negative PnL -> tier_count=0 (no scaling). Single-account compounding only.
  Per CLAUDE.md: "ONE account must be profitable." No multi-account aggregation.

W13 B7 — Kelly Criterion Sizing:
  kelly_optimal_contracts(edge, odds, bankroll, kelly_fraction, firm_max) -> int
  Formula: f* = (b*p - q) / b  where b=odds, p=win_rate, q=1-p
  Quarter-Kelly (default): kelly_fraction=0.25 (industry safety standard)
  Position: contracts = floor((f* * kelly_fraction) * (bankroll / risk_per_trade))
  Cap: NEVER exceed firm_max.
  Kelly is ADDITIVE with profit_scaling_tier (Kelly = base, tier scales it up).
"""

from __future__ import annotations

import logging
import math

import numpy as np
import polars as pl

from src.engine.config import ContractSpec, PositionSizeConfig
from src.engine.firm_config import CONTRACT_CAP_MAX, CONTRACT_CAP_MIN

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


def kelly_optimal_contracts(
    edge: float,
    odds: float,
    bankroll: float,
    risk_per_trade: float,
    kelly_fraction: float = 0.25,
    firm_max: int | None = None,
) -> int:
    """Compute Kelly-optimal contract count for a single strategy.

    Kelly Criterion maximises log-growth of bankroll. Quarter-Kelly (kelly_fraction=0.25)
    is the industry safety standard — it reduces variance while capturing most of the
    log-growth benefit. NEVER exceeds firm_max.

    Formula:
        f* = (b*p - q) / b   where b=odds, p=edge (win rate), q=1-p
        contracts = floor((f* * kelly_fraction) * (bankroll / risk_per_trade))

    Args:
        edge: Win rate probability (0 < edge < 1). E.g., 0.60 for 60% win rate.
        odds: Avg winner / avg loser ratio (b). E.g., 1.5 for 1:1.5 R:R.
        bankroll: Current account equity in dollars.
        risk_per_trade: Dollar risk per contract per trade (e.g., ATR * point_value).
        kelly_fraction: Fraction of full Kelly to use (default 0.25 = quarter-Kelly).
        firm_max: Hard ceiling from firm contract cap. Default: CONTRACT_CAP_MAX (20).

    Returns:
        int: Contract count >= 0, always <= firm_max.

    Examples:
        kelly_optimal_contracts(0.60, 1.0, 50000, 250)  -> uses f*=0.20, quarter=0.05
        kelly_optimal_contracts(0.55, 1.5, 50000, 300)  -> uses f*=0.1833, quarter=0.0458

    Raises:
        ValueError: If edge, odds, bankroll, or risk_per_trade are invalid.
    """
    if not (0.0 < edge < 1.0):
        raise ValueError(f"edge must be in (0, 1), got {edge}")
    if odds <= 0.0:
        raise ValueError(f"odds must be > 0, got {odds}")
    if bankroll <= 0.0:
        raise ValueError(f"bankroll must be > 0, got {bankroll}")
    if risk_per_trade <= 0.0:
        raise ValueError(f"risk_per_trade must be > 0, got {risk_per_trade}")
    if not (0.0 < kelly_fraction <= 1.0):
        raise ValueError(f"kelly_fraction must be in (0, 1], got {kelly_fraction}")

    effective_max = firm_max if firm_max is not None else CONTRACT_CAP_MAX

    q = 1.0 - edge
    # Full Kelly fraction of bankroll to risk
    f_star = (odds * edge - q) / odds

    # Negative or zero Kelly = no edge, size 0
    if f_star <= 0.0:
        logger.debug(
            "sizing.kelly_no_edge edge=%.4f odds=%.4f f_star=%.4f -> 0 contracts",
            edge, odds, f_star,
        )
        return 0

    # Scale by kelly_fraction (quarter-Kelly by default)
    scaled_fraction = f_star * kelly_fraction

    # Dollar amount to risk = scaled_fraction * bankroll
    dollar_risk = scaled_fraction * bankroll

    # Convert to contracts: how many contracts fit within that dollar risk?
    raw_contracts = dollar_risk / risk_per_trade
    contracts = math.floor(raw_contracts)

    # Floor to 0 (never negative), cap to firm max
    contracts = max(0, min(contracts, effective_max))

    logger.debug(
        "sizing.kelly f_star=%.4f fraction=%.4f bankroll=%.2f risk_per_trade=%.2f "
        "raw=%.3f final=%d firm_max=%d",
        f_star, scaled_fraction, bankroll, risk_per_trade, raw_contracts, contracts, effective_max,
    )

    return contracts


def compute_position_sizes(
    df: pl.DataFrame,
    config: PositionSizeConfig,
    contract_spec: ContractSpec,
    atr_period: int = 14,
    max_contracts: int | None = None,
    profit_scaling_tier: dict | None = None,
    kelly_params: dict | None = None,
    fomc_proximity: int | None = None,
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
        kelly_params: Optional dict for W13 B7 Kelly Criterion sizing.
            When None (default), falls through to existing ATR/fixed logic (backward-compatible).
            When provided, must contain:
        fomc_proximity: C11 FOMC day proximity in days. When abs(fomc_proximity) <= 1,
            all computed sizes are halved (floor, minimum 1). None = no reduction.
            Applied LAST, after all other sizing (Kelly, tier, cap).
            When provided, must contain:
                {
                    "edge": float,            # win rate probability (0 < p < 1)
                    "odds": float,            # avg_winner / avg_loser ratio
                    "bankroll": float,        # current account equity ($)
                    "risk_per_trade": float,  # dollar risk per contract per trade
                }
            Optional keys:
                {
                    "kelly_fraction": float,  # default 0.25 (quarter-Kelly)
                }
            Kelly sizing produces a CONSTANT base size for all bars (it is strategy-level,
            not bar-level like ATR). Profit tier is then applied on top of Kelly base.
            Result is always capped at max_contracts / firm cap.
            Strategies without kelly_params use existing ATR/fixed logic unchanged.

    Returns:
        Tuple of (sizes, over_risk):
          - sizes: numpy array of integer contract counts per bar
          - over_risk: boolean numpy array flagging bars where ATR-implied
            risk exceeds target for even 1 contract (raw < 1.0). These bars
            still get size=1 but callers should log warnings.
            For Kelly mode: over_risk is all-False (Kelly is bankroll-relative,
            not ATR-relative, so the concept does not apply).
    """
    n = len(df)

    # W13 B7: Kelly Criterion sizing dispatch.
    # When kelly_params is provided, compute a constant Kelly-optimal base for all bars.
    # Profit tier (if provided) is applied on top of the Kelly base.
    # Kelly mode skips the ATR pipeline entirely — over_risk is always all-False.
    if kelly_params is not None:
        kelly_edge = float(kelly_params["edge"])
        kelly_odds = float(kelly_params["odds"])
        kelly_bankroll = float(kelly_params["bankroll"])
        kelly_risk = float(kelly_params["risk_per_trade"])
        kelly_frac = float(kelly_params.get("kelly_fraction", 0.25))

        if max_contracts is not None:
            # Kelly: respect the firm's actual cap directly. CONTRACT_CAP_MIN (10) is
            # the ATR-sizing floor, not a Kelly constraint. Conservative firms with
            # max_contracts=5 must not be inflated. Still hard-capped at CONTRACT_CAP_MAX.
            kelly_firm_max = min(max_contracts, CONTRACT_CAP_MAX)
        else:
            kelly_firm_max = CONTRACT_CAP_MAX

        kelly_base = kelly_optimal_contracts(
            edge=kelly_edge,
            odds=kelly_odds,
            bankroll=kelly_bankroll,
            risk_per_trade=kelly_risk,
            kelly_fraction=kelly_frac,
            firm_max=kelly_firm_max,
        )

        # Apply profit tier on top of Kelly base (Kelly = base, tier scales it up)
        if profit_scaling_tier is not None:
            pnl_total_k = float(profit_scaling_tier.get("account_pnl_total", 0.0))
            tier_increment_k = int(profit_scaling_tier.get("increment", 2))
            tier_threshold_k = float(profit_scaling_tier.get("threshold", 3000.0))
            kelly_base = compute_profit_tier(
                account_pnl_total=pnl_total_k,
                base_contracts=kelly_base,
                increment=tier_increment_k,
                threshold=tier_threshold_k,
                firm_max=kelly_firm_max,
            )

        # Constant size for all bars; over_risk meaningless in Kelly mode
        sizes = np.full(n, float(kelly_base), dtype=np.float64)
        over_risk = np.zeros(n, dtype=bool)
        return sizes, over_risk

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

    # C11: FOMC proximity reduction (applied last, after all other sizing).
    # When within ±1 day of FOMC: halve all positions (floor, minimum 1).
    # Determinism: pure arithmetic on existing sizes array, no randomness.
    if fomc_proximity is not None and abs(fomc_proximity) <= 1:
        fomc_sizes = np.where(
            np.isnan(sizes),
            np.nan,
            np.maximum(1.0, np.floor(sizes / 2.0)),
        )
        sizes = fomc_sizes
        logger.debug(
            "C11 FOMC ±1 day: all position sizes halved (proximity=%d)", fomc_proximity
        )

    return sizes, over_risk
