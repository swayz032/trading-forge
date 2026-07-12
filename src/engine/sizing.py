"""Position sizing — dynamic ATR-based, fixed, Kelly Criterion, and risk-derived pyramid.

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

Track 3 (2026-05-09) — MES Pyramid Cap and Graduation Signal:
  MES_PYRAMID_CAP = 30 micros (raised from CONTRACT_CAP_MAX=20 for MES specifically).
  Non-MES instruments still use CONTRACT_CAP_MAX=20.
  compute_profit_tier() gains an optional mes_pyramid=False flag. When True:
    - firm_max defaults to MES_PYRAMID_CAP (30) instead of CONTRACT_CAP_MAX (20)
    - Returns (contracts: int, graduation_signal: bool) instead of just int
  graduation_signal=True when: profit_tier_count would exceed 30 OR account_pnl_total
  >= PYRAMID_GRADUATION_PNL ($30K). Signal means "consider graduating to ES minis."
  Does NOT auto-graduate or block sizing — advisory only.

Wave 21 — Risk-Derived Pyramid (E.2):
  compute_risk_derived_contracts() — exact Python port of risk-sizing.ts.
  Formula: finalContracts = min(pyramidTier, riskDerivedCap, firmCap, liquidityCap)
  pyramidTier  = base_contracts + tier_increment × floor(max(0, cumulative_profit) / tier_threshold)
  riskDerivedCap = floor(accountBalance × max_risk_pct / (stop_multiplier × atr × point_value))
  Rejection conditions: ATR=0, balance<=0, stop_multiplier<=0 → finalContracts=0.
  Returns RiskSizingResult dataclass with all component values for audit logging.
  CRITICAL: Do NOT pass slippage/fees to vectorbt — this module computes contracts only.

Wave 22 — Firm-Aware Risk Cap:
  compute_risk_derived_contracts() now accepts firm: str = "topstep" (operator primary).
  Topstep branch: riskDollars = buffer * max_risk_pct
    where buffer = currentBalance - trailingFloor
    and trailingFloor = min(highWaterBalance - trailingDD, accountStartingFloor)
  MFFU branch (unchanged): riskDollars = accountBalance * max_risk_pct
  New rejection: zero_buffer — Topstep buffer <= 0 (account at or below trailing floor).
  New RiskSizingResult fields: firm, risk_cap_method ("topstep_trailing_dd" | "mffu_balance_pct"),
    firm_cap_applied (bool).

Wave 23 — Pyramid Floor Enforcement (B.1):
  base_contracts is the MINIMUM viable contract count (MES=6, MNQ=6, MCL=18).
  All bases are divisible by 3 — Style C 33/33/33 partials clean at every tier.
  Micro point values LOCKED (per operator directive 2026-05-19):
    MES = $5/point  (1/10 of ES at $50/pt)
    MNQ = $2/point  (1/10 of NQ at $20/pt)
    MCL = $1/tick   ($100/point, tick=0.01, tick_value=$1.00)
  Floor rule: on healthy accounts (balance >= 85% of starting_capital), if risk-cap
  returns fewer than base_contracts, use base_contracts instead. On drawdown accounts
  (< 85%), risk-cap fully binds to protect firm compliance.
  New RiskSizingResult fields: pyramid_floor_applied (bool), account_health_ratio (float).

Wave 25 Pass 2 — Inst-10 Drawdown-Room Cap (Topstep only):
  Adds a new term to the min() chain (Topstep trailing-DD only):
    drawdownRoomCap = floor(currentDrawdownRoom × DRAWDOWN_ROOM_RISK_PCT / stopDollarsPerContract)
  where currentDrawdownRoom = max(0, balance - trailingFloor).
  DRAWDOWN_ROOM_RISK_PCT default 0.08 (8%) per 2026 funded-trader consensus.
  Parity: identical to TypeScript risk-sizing.ts drawdownRoomCap computation.
  NOT applied for MFFU (static 2% rule is correct for that firm).
  New RiskSizingResult fields: drawdown_room_cap (Optional[int]), drawdown_room_cap_binding (bool).
"""

from __future__ import annotations

import logging
import math
import os
from dataclasses import dataclass, field
from typing import Optional

import numpy as np
import polars as pl

from src.engine.config import TRACK3_CONFIG, ContractSpec, PositionSizeConfig
from src.engine.firm_config import CONTRACT_CAP_MAX, CONTRACT_CAP_MIN

# Track 3: MES-specific pyramid cap (overrides CONTRACT_CAP_MAX for MES only).
MES_PYRAMID_CAP: int = TRACK3_CONFIG.MES_PYRAMID_CAP  # 30 micros
PYRAMID_GRADUATION_PNL: float = TRACK3_CONFIG.PYRAMID_GRADUATION_PNL  # $30K trigger

logger = logging.getLogger(__name__)

# ── Wave 24 Pass 2 — Vol-scale + liquidity-haircut (backtest parity) ──────────
# Mirror of risk-sizing.ts: computeVolScale() + computeLiquidityHaircut().
# Identical math, identical env-var thresholds, identical fail-open semantics.
# These run in the sizing pass of the backtester so backtest decisions match paper.

_RISK_VIX_TARGET = float(os.environ.get("RISK_VIX_TARGET", "18"))
_RISK_VOL_SCALE_MIN = float(os.environ.get("RISK_VOL_SCALE_MIN", "0.5"))
_RISK_VOL_SCALE_MAX = float(os.environ.get("RISK_VOL_SCALE_MAX", "1.5"))

# Wave 25 Pass 2 Inst-10: Drawdown-room risk fraction (Topstep only).
# Mirror of TypeScript DRAWDOWN_ROOM_RISK_PCT constant in risk-sizing.ts.
# Default 0.08 = 8% of remaining drawdown buffer per NexusFi 2026-05 thread:
#   "8-12% of remaining drawdown buffer per trade" is the institutional standard.
#   Prior default of 0.01 (1%) produced ~$20/trade on a fresh $2K Topstep buffer →
#   floor(20 / stop_dollars) = 0 contracts, strangling sizing completely.
#   8% of $2K = $160; at 1.5×4pt ATR stop on MES ($30/contract) → floor(160/30) = 5.
# Scaling-plan-baby-mode update (2026-06-23): aligned with risk-sizing.ts.
_DRAWDOWN_ROOM_RISK_PCT = float(os.environ.get("DRAWDOWN_ROOM_RISK_PCT", "0.08"))

# ── Scaling-plan-baby-mode (2026-06-23): Proven-trades ramp config ────────────
# Number of proven winning trades required per pyramid tier step.
# When proven_trades is provided to compute_risk_derived_contracts(), tier is computed
# as floor(proven_trades / _PROVEN_TRADES_PER_TIER) instead of the dollar formula.
# Mirror of TypeScript PROVEN_TRADES_PER_TIER constant in risk-sizing.ts.
_PROVEN_TRADES_PER_TIER = max(1, int(os.environ.get("PROVEN_TRADES_PER_TIER", "10")))


def compute_vol_scale(vix_now: Optional[float]) -> float:
    """VIX-driven vol scale on max_risk_pct_per_trade — Python port of computeVolScale().

    scale = clamp(vixTarget / vixNow, VOL_SCALE_MIN, VOL_SCALE_MAX).
    Returns 1.0 (no-op / fail-open) when vix_now is None, NaN, or <= 0.

    At VIX=18 (target): scale=1.0.  VIX=36: scale=0.5 (floor).  VIX=9: scale=1.5 (ceil).
    Env vars: RISK_VIX_TARGET (18), RISK_VOL_SCALE_MIN (0.5), RISK_VOL_SCALE_MAX (1.5).
    """
    if vix_now is None or math.isnan(float(vix_now)) or float(vix_now) <= 0:
        return 1.0
    raw = _RISK_VIX_TARGET / float(vix_now)
    return max(_RISK_VOL_SCALE_MIN, min(_RISK_VOL_SCALE_MAX, raw))


def compute_liquidity_haircut(
    current_top3_depth: Optional[float],
    baseline_20d_median_top3_depth: Optional[float],
) -> float:
    """Dynamic liquidity haircut on per-symbol caps — Python port of computeLiquidityHaircut().

    haircut = min(1.0, currentTop3Depth / baseline20dMedianTop3Depth).
    Returns 1.0 (no-op / fail-open) when either input is missing.

    CME Liberation Day 2025-04-02 reference: -27% top-3 depth collapse.
    Static caps flood thinned books during liquidity events — haircut prevents this.
    """
    if not current_top3_depth or not baseline_20d_median_top3_depth:
        return 1.0
    if float(baseline_20d_median_top3_depth) <= 0:
        return 1.0
    return min(1.0, float(current_top3_depth) / float(baseline_20d_median_top3_depth))


# ─── Wave 21: Risk-Derived Pyramid (E.2) ─────────────────────────────────────
# Exact Python port of src/server/lib/risk-sizing.ts:computeRiskDerivedContracts().
# Same math, same edge cases, identical numeric outputs.
# CRITICAL: This computes CONTRACT COUNT only. Never pass fees/slippage to vectorbt.


@dataclass
class RiskSizingResult:
    """Output of compute_risk_derived_contracts(). All component values for audit trail."""

    final_contracts: int
    pyramid_tier: int
    risk_derived_cap: int
    firm_cap: Optional[int]
    liquidity_cap: int
    rejection_reason: Optional[
        str
    ]  # None | "zero_atr" | "zero_balance" | "negative_cap" | "zero_buffer"
    # Wave 22 additions
    firm: str = "topstep"  # "topstep" | "mffu"
    risk_cap_method: str = "topstep_trailing_dd"  # how riskDollars was derived
    firm_cap_applied: bool = False  # True if firm cap was binding
    # Wave 23 additions
    pyramid_floor_applied: bool = (
        False  # True when base_contracts floor overrode risk-cap
    )
    account_health_ratio: float = (
        1.0  # currentBalance / startingCapital (floor binds at >= 0.85)
    )
    evidence: dict = field(default_factory=dict)
    # Wave 25 Pass 2 Inst-10 additions
    drawdown_room_cap: Optional[int] = (
        None  # Computed DD-room cap (Topstep only). None when not applied.
    )
    drawdown_room_cap_binding: bool = (
        False  # True when drawdownRoomCap was the binding constraint.
    )
    # Scaling-plan-baby-mode (2026-06-23): proven-trades ramp observability
    # "proven_trades" — provenTrades input present; tier = floor(proven_trades / proven_trades_per_tier).
    # "dollar_fallback" — proven_trades absent; tier = floor(cumulativeProfit / tier_threshold_dollars).
    scaling_mode: str = "dollar_fallback"  # "proven_trades" | "dollar_fallback"
    scaling_tier: int = 0  # tier count used in pyramidTier computation (audit)


def _compute_topstep_trailing_floor(
    high_water_balance: float,
    trailing_dd: float,
    account_starting_floor: float,
) -> float:
    """Compute Topstep EOD trailing-DD floor.

    Per docs/prop-firm-rules-2026-topstep.md §6:
      - Floor starts at (startingBalance - trailingDD).
      - Trails up as HWM rises.
      - LOCKS at startingBalance once HWM >= startingBalance.

    Formula: trailingFloor = min(highWaterBalance - trailingDD, accountStartingFloor)
    """
    raw_floor = high_water_balance - trailing_dd
    return min(raw_floor, account_starting_floor)


def compute_risk_derived_contracts(
    base_contracts: int,
    tier_increment: int,
    tier_threshold_dollars: float,
    max_risk_pct_per_trade: float,
    liquidity_comfort_cap: int,
    account_balance: float,
    cumulative_profit: float,
    atr_points: float,
    stop_multiplier: float,
    point_dollar_value: float,
    firm_contract_cap: Optional[int] = None,
    topstep_account_cap_override: Optional[int] = None,
    # ── Wave 22: firm-aware parameters ──────────────────────────────────────
    firm: str = "topstep",
    trailing_dd: float = 2000.0,
    high_water_balance: Optional[float] = None,
    account_starting_floor: float = 50_000.0,
    # ── Wave 25 Pass 2 Inst-10: Drawdown-room cap (Topstep only) ────────────
    current_drawdown_room: Optional[float] = None,
    # ── Wave 26 Pass K Phase 3: PM session size factor ──────────────────────
    pm_size_factor: Optional[float] = None,
    # ── Scaling-plan-baby-mode (2026-06-23): Proven-trades ramp ─────────────
    # When provided: tier = floor(proven_trades / _PROVEN_TRADES_PER_TIER).
    # When None: falls back to dollar mode (backward-compat, byte-identical).
    # Cumulative count of closed WINNING trades (net realized P&L > 0), monotonic,
    # survives withdrawals. Produced by the live paper layer; this function only
    # CONSUMES the value, never computes it.
    proven_trades: Optional[int] = None,
) -> RiskSizingResult:
    """Compute risk-derived contract count at signal time.

    Firm-aware port of risk-sizing.ts:computeRiskDerivedContracts() (Wave 22).

    Topstep branch (firm="topstep", default):
        trailingFloor  = min(highWaterBalance - trailingDD, accountStartingFloor)
        buffer         = accountBalance - trailingFloor
        riskDollars    = buffer × max_risk_pct_per_trade

    MFFU branch (firm="mffu"):
        riskDollars = account_balance × max_risk_pct_per_trade  (unchanged from Wave 21)

    Common:
        pyramidTier    = base_contracts + tier_increment × floor(max(0, cumulative_profit) / tier_threshold)
        stopDollars    = stop_multiplier × atr_points × point_dollar_value
        riskDerivedCap = floor(riskDollars / stopDollars)
        firmCap        = topstep_account_cap_override if set, else firm_contract_cap, else None (∞)
        liquidityCap   = liquidity_comfort_cap
        finalContracts = max(0, min(pyramidTier, riskDerivedCap, firmCap, liquidityCap))

    Rejection conditions (return finalContracts=0 with reason):
        - atr_points <= 0 → "zero_atr"
        - account_balance <= 0 → "zero_balance"
        - riskDerivedCap <= 0 → "negative_cap" (extreme ATR or tiny account/buffer)
        - buffer <= 0 (Topstep only) → "zero_buffer" (account at/below trailing floor)

    Args:
        base_contracts: Starting contracts (4 for standard).
        tier_increment: Extra contracts per profit tier (2 per $3K is default).
        tier_threshold_dollars: Profit per tier in dollars (3000.0 default).
        max_risk_pct_per_trade: Fraction of risk base to risk per trade (0.02 = 2%).
        liquidity_comfort_cap: Book-depth ceiling (100 for MES default).
        account_balance: Live account equity in dollars.
        cumulative_profit: Sum of realized P&L since strategy inception.
        atr_points: Current ATR in price points (e.g. 4.0 for MES).
        stop_multiplier: ATR multiple for stop distance (1.5 per CLAUDE.md §4).
        point_dollar_value: Dollar value of one price point (MES=$5, MNQ=$2, MCL=$100).
        firm_contract_cap: Firm per-account contract ceiling (None = no firm cap).
        topstep_account_cap_override: DSL override that takes priority over firm_contract_cap.
        firm: Prop firm identifier ("topstep" default | "mffu"). Wave 22.
        trailing_dd: Topstep trailing drawdown amount ($2000 for 50K account). Wave 22.
        high_water_balance: Topstep HWM since inception (defaults to account_balance). Wave 22.
        account_starting_floor: Topstep starting account balance floor ($50K default). Wave 22.

    Returns:
        RiskSizingResult dataclass with all component values.
    """
    liquidity_cap = liquidity_comfort_cap

    # Resolve HWM default: first day or no drawdown → HWM = current balance
    _high_water = (
        high_water_balance if high_water_balance is not None else account_balance
    )

    # Pyramid tier (slow ramp-up)
    # Scaling-plan-baby-mode (2026-06-23): proven-trades mode takes priority when
    # proven_trades is provided. Parity with risk-sizing.ts: same formula, same edge cases.
    # Backward-compat: proven_trades=None → dollar mode, byte-identical to prior behavior.
    if proven_trades is not None and isinstance(proven_trades, (int, float)) and math.isfinite(float(proven_trades)):
        _pt_per_tier = _PROVEN_TRADES_PER_TIER if _PROVEN_TRADES_PER_TIER > 0 else 10
        tiers = math.floor(max(0, int(proven_trades)) / _pt_per_tier)
        scaling_mode = "proven_trades"
    else:
        profit_floor = max(0.0, cumulative_profit)
        tiers = (
            math.floor(profit_floor / tier_threshold_dollars)
            if tier_threshold_dollars > 0
            else 0
        )
        scaling_mode = "dollar_fallback"
    pyramid_tier_raw = base_contracts + tier_increment * tiers

    # ── Wave 26 Pass K Phase 3 (2026-05-26) — Apply PM session size factor ──
    # Mirrors src/server/lib/risk-sizing.ts. EOD-DD-aware multiplier per TTT
    # Markets 2026-04 + SurgeFunded 2026-02. None/missing → no scaling
    # (backward compat; pre-Pass-K backtests unchanged).
    if (
        pm_size_factor is None
        or not isinstance(pm_size_factor, (int, float))
        or not math.isfinite(pm_size_factor)
    ):
        _pm_factor = 1.0
    else:
        _pm_factor = max(0.0, min(1.0, float(pm_size_factor)))
    pyramid_tier = int(math.floor(pyramid_tier_raw * _pm_factor))

    # Determine risk cap method from firm
    risk_cap_method = "topstep_trailing_dd" if firm == "topstep" else "mffu_balance_pct"

    # Wave 23: Account health ratio for pyramid floor enforcement.
    # Floor binds when account is healthy (>= 85% of starting capital).
    # Starting capital: for Topstep = account_starting_floor; for MFFU = 50K default.
    _starting_capital_for_health = (
        account_starting_floor if account_starting_floor > 0 else 50_000.0
    )
    account_health_ratio = (
        account_balance / _starting_capital_for_health
        if _starting_capital_for_health > 0
        else 1.0
    )
    account_is_healthy = account_health_ratio >= 0.85

    # Edge case: balance <= 0
    if account_balance <= 0:
        return RiskSizingResult(
            final_contracts=0,
            pyramid_tier=pyramid_tier,
            risk_derived_cap=0,
            firm_cap=None,
            liquidity_cap=liquidity_cap,
            rejection_reason="zero_balance",
            firm=firm,
            risk_cap_method=risk_cap_method,
            firm_cap_applied=False,
            pyramid_floor_applied=False,
            account_health_ratio=account_health_ratio,
            scaling_mode=scaling_mode,
            scaling_tier=tiers,
            evidence={
                "account_balance": account_balance,
                "atr_points": atr_points,
                "pyramid_tier": pyramid_tier,
                "risk_derived_cap": 0,
                "firm_cap": None,
                "liquidity_cap": liquidity_cap,
                "final_contracts": 0,
                "rejection_reason": "zero_balance",
                "firm": firm,
                "account_health_ratio": account_health_ratio,
                "pyramid_floor_applied": False,
            },
        )

    # Edge case: ATR = 0
    if atr_points <= 0:
        return RiskSizingResult(
            final_contracts=0,
            pyramid_tier=pyramid_tier,
            risk_derived_cap=0,
            firm_cap=None,
            liquidity_cap=liquidity_cap,
            rejection_reason="zero_atr",
            firm=firm,
            risk_cap_method=risk_cap_method,
            firm_cap_applied=False,
            pyramid_floor_applied=False,
            account_health_ratio=account_health_ratio,
            scaling_mode=scaling_mode,
            scaling_tier=tiers,
            evidence={
                "account_balance": account_balance,
                "atr_points": atr_points,
                "pyramid_tier": pyramid_tier,
                "risk_derived_cap": 0,
                "firm_cap": None,
                "liquidity_cap": liquidity_cap,
                "final_contracts": 0,
                "rejection_reason": "zero_atr",
                "firm": firm,
                "account_health_ratio": account_health_ratio,
                "pyramid_floor_applied": False,
            },
        )

    # ── Wave 22: Firm-aware risk dollar computation ──────────────────────────
    trailing_floor: Optional[float] = None
    buffer: Optional[float] = None

    if firm == "topstep":
        trailing_floor = _compute_topstep_trailing_floor(
            high_water_balance=_high_water,
            trailing_dd=trailing_dd,
            account_starting_floor=account_starting_floor,
        )
        buffer = account_balance - trailing_floor

        # Edge case: no buffer left (account at or below trailing floor)
        if buffer <= 0:
            return RiskSizingResult(
                final_contracts=0,
                pyramid_tier=pyramid_tier,
                risk_derived_cap=0,
                firm_cap=None,
                liquidity_cap=liquidity_cap,
                rejection_reason="zero_buffer",
                firm=firm,
                risk_cap_method=risk_cap_method,
                firm_cap_applied=False,
                pyramid_floor_applied=False,
                account_health_ratio=account_health_ratio,
                scaling_mode=scaling_mode,
                scaling_tier=tiers,
                evidence={
                    "account_balance": account_balance,
                    "trailing_floor": trailing_floor,
                    "buffer": buffer,
                    "high_water_balance": _high_water,
                    "trailing_dd": trailing_dd,
                    "account_starting_floor": account_starting_floor,
                    "pyramid_tier": pyramid_tier,
                    "risk_derived_cap": 0,
                    "firm_cap": None,
                    "liquidity_cap": liquidity_cap,
                    "final_contracts": 0,
                    "rejection_reason": "zero_buffer",
                    "firm": firm,
                    "account_health_ratio": account_health_ratio,
                    "pyramid_floor_applied": False,
                },
            )

        risk_dollars = buffer * max_risk_pct_per_trade
    else:
        # MFFU: risk against current balance (unchanged from Wave 21)
        risk_dollars = account_balance * max_risk_pct_per_trade

    # Risk-derived ceiling (common to both firms)
    stop_dollars_per_contract = stop_multiplier * atr_points * point_dollar_value
    risk_derived_cap = math.floor(risk_dollars / stop_dollars_per_contract)

    # Wave 25 Pass 2 Inst-10: Drawdown-room cap (Topstep only when current_drawdown_room provided).
    # Parity: mirrors TypeScript drawdownRoomCap computation in risk-sizing.ts.
    # drawdown_room_cap = floor(current_drawdown_room * DRAWDOWN_ROOM_RISK_PCT / stop_dollars_per_contract)
    # NOT applied for MFFU (static 2% rule is correct for that firm).
    has_drawdown_room_input = (
        firm == "topstep"
        and current_drawdown_room is not None
        and float(current_drawdown_room) >= 0
    )
    drawdown_room_cap: Optional[int] = (
        math.floor(
            float(current_drawdown_room)
            * _DRAWDOWN_ROOM_RISK_PCT
            / stop_dollars_per_contract
        )
        if has_drawdown_room_input and stop_dollars_per_contract > 0
        else None
    )

    # Effective firm cap (computed early so it's available in all branch paths below).
    # DSL override takes priority over live firm cap (mirrors TS logic).
    if topstep_account_cap_override is not None:
        effective_firm_cap: Optional[int] = int(topstep_account_cap_override)
    elif firm_contract_cap is not None:
        effective_firm_cap = int(firm_contract_cap)
    else:
        effective_firm_cap = None  # No firm cap = infinity

    # Edge case: computed cap <= 0 (extreme ATR or tiny account/buffer).
    # Wave 23: On healthy accounts, pyramid floor still applies even here.
    # If account_is_healthy AND risk_cap <= 0, use base_contracts as the floor.
    # This handles the Topstep fresh-combine case: risk_cap=0 but account is healthy.
    # On drawdown accounts, this rejection holds (risk-cap protects the account).
    if risk_derived_cap <= 0:
        if account_is_healthy and base_contracts > 0:
            # F-7: Pyramid floor applies on healthy account, but clamp by firm cap + liquidity cap.
            # base_contracts alone is unbounded — firm compliance limits must still bind.
            # CAP-2 / F-4 fix (mirrors risk-sizing.ts:794-802): also include drawdown_room_cap
            # in this floor min(). The main path below already applies drawdown_room_cap in its
            # min(); this early-return path previously omitted it, allowing base_contracts to be
            # returned even when DD room is too tight to support that many contracts.
            # drawdown_room_cap OVERRIDES the pyramid floor when it is the binding constraint.
            floored_candidates = [base_contracts, liquidity_cap]
            if effective_firm_cap is not None:
                floored_candidates.append(effective_firm_cap)
            if drawdown_room_cap is not None and drawdown_room_cap >= 0:
                floored_candidates.append(drawdown_room_cap)
            floored_contracts = max(0, min(floored_candidates))
            floor_firm_cap_applied = (
                effective_firm_cap is not None
                and effective_firm_cap == floored_contracts
                and effective_firm_cap < base_contracts
            )
            # drawdown_room_cap binding when it was the actual constraining element
            early_return_drawdown_room_cap_binding = (
                drawdown_room_cap is not None
                and drawdown_room_cap >= 0
                and drawdown_room_cap == floored_contracts
            )
            ev_floor: dict = {
                "account_balance": account_balance,
                "atr_points": atr_points,
                "stop_multiplier": stop_multiplier,
                "point_dollar_value": point_dollar_value,
                "stop_dollars_per_contract": stop_dollars_per_contract,
                "risk_dollars": risk_dollars,
                "pyramid_tier": pyramid_tier,
                "risk_derived_cap": risk_derived_cap,
                "firm_cap": effective_firm_cap,  # F-7: expose the cap that was applied
                "liquidity_cap": liquidity_cap,
                "drawdown_room_cap": drawdown_room_cap,
                "final_contracts": floored_contracts,
                "rejection_reason": None,
                "firm": firm,
                "account_health_ratio": account_health_ratio,
                "pyramid_floor_applied": not early_return_drawdown_room_cap_binding,
                "firm_cap_applied": floor_firm_cap_applied,  # F-7: audit whether firm cap bound
                "binding_cap": (
                    "drawdown_room"
                    if early_return_drawdown_room_cap_binding
                    else "pyramid_floor_override"
                ),
                "base_contracts": base_contracts,
                "risk_cap_method": risk_cap_method,
            }
            if firm == "topstep":
                ev_floor.update(
                    {
                        "trailing_floor": trailing_floor,
                        "buffer": buffer,
                        "high_water_balance": _high_water,
                        "trailing_dd": trailing_dd,
                        "account_starting_floor": account_starting_floor,
                    }
                )
            return RiskSizingResult(
                final_contracts=floored_contracts,
                pyramid_tier=pyramid_tier,
                risk_derived_cap=risk_derived_cap,
                firm_cap=effective_firm_cap,  # F-7: expose effective firm cap
                liquidity_cap=liquidity_cap,
                rejection_reason=None,  # not a rejection — floor overrides (or DD room cap)
                firm=firm,
                risk_cap_method=risk_cap_method,
                firm_cap_applied=floor_firm_cap_applied,  # F-7: true if firm cap constrained floor
                pyramid_floor_applied=not early_return_drawdown_room_cap_binding,
                account_health_ratio=account_health_ratio,
                scaling_mode=scaling_mode,
                scaling_tier=tiers,
                drawdown_room_cap=drawdown_room_cap,
                drawdown_room_cap_binding=early_return_drawdown_room_cap_binding,
                evidence=ev_floor,
            )

        ev: dict = {
            "account_balance": account_balance,
            "atr_points": atr_points,
            "stop_multiplier": stop_multiplier,
            "point_dollar_value": point_dollar_value,
            "stop_dollars_per_contract": stop_dollars_per_contract,
            "risk_dollars": risk_dollars,
            "pyramid_tier": pyramid_tier,
            "risk_derived_cap": risk_derived_cap,
            "firm_cap": None,
            "liquidity_cap": liquidity_cap,
            "final_contracts": 0,
            "rejection_reason": "negative_cap",
            "firm": firm,
            "account_health_ratio": account_health_ratio,
            "pyramid_floor_applied": False,
        }
        if firm == "topstep":
            ev.update(
                {
                    "trailing_floor": trailing_floor,
                    "buffer": buffer,
                    "high_water_balance": _high_water,
                    "trailing_dd": trailing_dd,
                    "account_starting_floor": account_starting_floor,
                }
            )
        return RiskSizingResult(
            final_contracts=0,
            pyramid_tier=pyramid_tier,
            risk_derived_cap=risk_derived_cap,
            firm_cap=None,
            liquidity_cap=liquidity_cap,
            rejection_reason="negative_cap",
            firm=firm,
            risk_cap_method=risk_cap_method,
            firm_cap_applied=False,
            pyramid_floor_applied=False,
            account_health_ratio=account_health_ratio,
            scaling_mode=scaling_mode,
            scaling_tier=tiers,
            evidence=ev,
        )

    # (effective_firm_cap already computed above the risk_derived_cap <= 0 check)

    # Final: pyramid is FLOOR (slow ramp), risk/firm/liquidity are CEILING.
    # Step 1: min(pyramidTier, riskDerivedCap, firmCap, liquidityCap) — mirrors TS exactly.
    final_contracts = min(pyramid_tier, risk_derived_cap, liquidity_cap)
    _pre_firm_final = final_contracts
    if effective_firm_cap is not None:
        final_contracts = min(final_contracts, effective_firm_cap)
    firm_cap_applied = (
        effective_firm_cap is not None and effective_firm_cap < _pre_firm_final
    )

    # Wave 25 Pass 2 Inst-10: Apply drawdown_room_cap (Topstep only when input provided).
    # Parity: mirrors TypeScript drawdownRoomCapBinding detection in risk-sizing.ts.
    drawdown_room_cap_binding = False
    if drawdown_room_cap is not None:
        pre_ddr = final_contracts
        final_contracts = min(final_contracts, drawdown_room_cap)
        drawdown_room_cap_binding = drawdown_room_cap < pre_ddr

    final_contracts = max(0, final_contracts)

    # Step 2 (Wave 23): Pyramid floor enforcement.
    # On healthy accounts (>= 85% of starting capital), base_contracts is the minimum viable
    # contract count. Risk-cap can return fewer than base on fresh Topstep combines (narrow
    # buffer = low risk cap), which would break Style C 33/33/33 partials.
    # F-7: Floor is min(base_contracts, effective_firm_cap, liquidity_cap) — never unbounded.
    #      Firm cap and liquidity cap must still bind even when pyramid floor overrides risk-cap.
    # On drawdown accounts (< 85%), risk-cap fully binds — floor does not override.
    # Wave 25 Pass 2 Inst-10: drawdown_room_cap takes priority over pyramid floor —
    # when DD room is very small, forcing base_contracts would violate the 1%-of-room contract.
    # LOW#9 (fresh-scan 2026-07-12): this SCALAR floor lacked the `pyramid_tier >= base` trigger guard
    # and the pm-taper floor value that BOTH risk-sizing.ts and the Python per-bar path (compute_position_
    # sizes) apply — a latent TS/scalar parity divergence. Without them, a PM-tapered scalar call
    # (pm_size_factor<1) whose tapered pyramid_tier fell below base wrongly floored the size back UP to
    # full base, re-inflating a deliberate PM reduction. Mirror the per-bar path.
    pyramid_floor_applied = False
    if (
        not drawdown_room_cap_binding
        and account_is_healthy
        and final_contracts < base_contracts
        and pyramid_tier >= base_contracts
    ):
        floor_value = int(math.floor(base_contracts * _pm_factor))
        if effective_firm_cap is not None and effective_firm_cap < floor_value:
            floor_value = effective_firm_cap
        if liquidity_cap < floor_value:
            floor_value = liquidity_cap
        final_contracts = max(0, floor_value)
        pyramid_floor_applied = final_contracts > 0
        # F-7: firmCapApplied = true when effectiveFirmCap constrained the floor
        if effective_firm_cap is not None and effective_firm_cap < base_contracts:
            firm_cap_applied = True

    # Determine which cap is binding (for audit trail).
    # drawdown_room takes priority when it was binding.
    if drawdown_room_cap_binding:
        binding_cap = "drawdown_room"
    elif pyramid_floor_applied:
        binding_cap = "pyramid_floor_override"
    elif (
        risk_derived_cap <= pyramid_tier
        and (effective_firm_cap is None or risk_derived_cap <= effective_firm_cap)
        and risk_derived_cap <= liquidity_cap
    ):
        binding_cap = "risk_derived"
    elif (
        effective_firm_cap is not None
        and effective_firm_cap <= pyramid_tier
        and effective_firm_cap <= risk_derived_cap
        and effective_firm_cap <= liquidity_cap
    ):
        binding_cap = "firm_cap"
    elif (
        liquidity_cap <= pyramid_tier
        and liquidity_cap <= risk_derived_cap
        and (effective_firm_cap is None or liquidity_cap <= effective_firm_cap)
    ):
        binding_cap = "liquidity_cap"
    else:
        binding_cap = "pyramid"

    ev_full: dict = {
        "account_balance": account_balance,
        "cumulative_profit": cumulative_profit,
        "atr_points": atr_points,
        "stop_multiplier": stop_multiplier,
        "point_dollar_value": point_dollar_value,
        "stop_dollars_per_contract": stop_dollars_per_contract,
        "risk_dollars": risk_dollars,
        "pyramid_tier": pyramid_tier,
        "risk_derived_cap": risk_derived_cap,
        "firm_cap": effective_firm_cap,
        "liquidity_cap": liquidity_cap,
        "drawdown_room_cap": drawdown_room_cap,
        "drawdown_room_cap_binding": drawdown_room_cap_binding,
        "final_contracts": final_contracts,
        "binding_cap": binding_cap,
        "base_contracts": base_contracts,
        "tier_increment": tier_increment,
        "tier_threshold_dollars": tier_threshold_dollars,
        "max_risk_pct_per_trade": max_risk_pct_per_trade,
        "tiers_earned": tiers,
        "scaling_mode": scaling_mode,
        "scaling_tier": tiers,
        "firm": firm,
        "risk_cap_method": risk_cap_method,
        "account_health_ratio": account_health_ratio,
        "pyramid_floor_applied": pyramid_floor_applied,
    }
    if firm == "topstep":
        ev_full.update(
            {
                "trailing_floor": trailing_floor,
                "buffer": buffer,
                "high_water_balance": _high_water,
                "trailing_dd": trailing_dd,
                "account_starting_floor": account_starting_floor,
            }
        )

    return RiskSizingResult(
        final_contracts=final_contracts,
        pyramid_tier=pyramid_tier,
        risk_derived_cap=risk_derived_cap,
        firm_cap=effective_firm_cap,
        liquidity_cap=liquidity_cap,
        rejection_reason=None,
        firm=firm,
        risk_cap_method=risk_cap_method,
        firm_cap_applied=firm_cap_applied,
        pyramid_floor_applied=pyramid_floor_applied,
        account_health_ratio=account_health_ratio,
        evidence=ev_full,
        drawdown_room_cap=drawdown_room_cap,
        drawdown_room_cap_binding=drawdown_room_cap_binding,
        scaling_mode=scaling_mode,
        scaling_tier=tiers,
    )


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


def compute_profit_tier_mes(
    account_pnl_total: float,
    base_contracts: int,
    increment: int = 2,
    threshold: float = 3000.0,
) -> tuple[int, bool]:
    """Compute MES micro contract count with Track 3 pyramid cap (30) and graduation signal.

    Track 3 change: MES uses a 30-contract cap (raised from CONTRACT_CAP_MAX=20).
    Returns (contracts, graduation_signal) where graduation_signal=True means the
    operator should consider graduating to full-size ES minis.

    graduation_signal fires when EITHER:
      - Scaled contract count would exceed MES_PYRAMID_CAP (30); OR
      - account_pnl_total >= PYRAMID_GRADUATION_PNL ($30K cumulative profit).

    Does NOT auto-graduate or block sizing. Advisory only — human decision.

    Args:
        account_pnl_total: Cumulative realized PnL on the single account ($).
        base_contracts:    Starting contract count.
        increment:         Extra contracts per tier (default 2).
        threshold:         Profit required per tier (default $3,000).

    Returns:
        Tuple of (final_contracts: int, graduation_signal: bool).

    Examples:
        compute_profit_tier_mes(0,     4)  -> (4,  False)
        compute_profit_tier_mes(3000,  4)  -> (6,  False)
        compute_profit_tier_mes(30000, 4)  -> (24, True)   # $30K graduation trigger
        compute_profit_tier_mes(50000, 4)  -> (30, True)   # capped at 30, graduation
    """
    if account_pnl_total <= 0.0:
        return (max(base_contracts, min(base_contracts, MES_PYRAMID_CAP)), False)

    tier_count: int = math.floor(account_pnl_total / threshold)
    extra_contracts: int = tier_count * increment
    # MES uses 30-contract cap, not CONTRACT_CAP_MAX=20
    final: int = min(base_contracts + extra_contracts, MES_PYRAMID_CAP)
    final = max(final, base_contracts)

    # Graduation signal: would-have-exceeded cap OR PnL threshold met
    would_exceed_cap = (base_contracts + extra_contracts) > MES_PYRAMID_CAP
    pnl_graduation = account_pnl_total >= PYRAMID_GRADUATION_PNL
    graduation_signal = would_exceed_cap or pnl_graduation

    if extra_contracts > 0:
        logger.debug(
            "sizing.mes_profit_tier_applied base=%d extra=%d final=%d cap=%d pnl=%.2f grad=%s",
            base_contracts,
            extra_contracts,
            final,
            MES_PYRAMID_CAP,
            account_pnl_total,
            graduation_signal,
        )

    return (final, graduation_signal)


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
            edge,
            odds,
            f_star,
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
        f_star,
        scaled_fraction,
        bankroll,
        risk_per_trade,
        raw_contracts,
        contracts,
        effective_max,
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
        return np.full(n, config.fixed_contracts, dtype=np.float64), np.zeros(
            n, dtype=bool
        )

    # ── risk_derived_pyramid (Wave 21 E.2, F-6 per-bar fix) ─────────────────
    # F-6: Compute PER-BAR risk-derived caps using bar-level ATR, not mean ATR.
    # Using mean ATR underestimates sizing during low-vol regimes and overestimates
    # during high-vol regimes — the backtest assumption is that the stop_mult × ATR
    # stop is sized at the bar's own ATR, not the session average.
    # Each bar gets: risk_derived_cap[i] = floor(buffer * max_risk_pct / (stop_mult * atr[i] * pv))
    # Then pyramid floor is applied element-wise (matches Wave 23 behavior).
    # Return: per-bar size array (not a scalar flat array).
    if config.type == "risk_derived_pyramid":
        atr_col = f"atr_{atr_period}"
        if atr_col in df.columns:
            _atr_arr = df[atr_col].to_numpy().astype(np.float64)
        else:
            _atr_arr = np.full(n, 1.0, dtype=np.float64)
        # Replace NaN/zero ATR with the column mean (fallback to 1.0 if all NaN)
        _valid_atr = _atr_arr[~np.isnan(_atr_arr) & (_atr_arr > 0)]
        _atr_fallback = float(np.mean(_valid_atr)) if len(_valid_atr) > 0 else 1.0
        atr_arr = np.where(
            np.isnan(_atr_arr) | (_atr_arr <= 0), _atr_fallback, _atr_arr
        )
        # atr_for_sizing is kept for the scalar compute_risk_derived_contracts() call below
        atr_for_sizing = _atr_fallback

        # profit_scaling_tier dict carries cumulative_profit if provided (optional)
        cumulative_profit = 0.0
        if profit_scaling_tier is not None:
            cumulative_profit = float(profit_scaling_tier.get("account_pnl_total", 0.0))

        # account_balance: use max_contracts parameter as a proxy when provided,
        # otherwise default to 50_000 (MFFU 50K eval funded account).
        # Callers that know live balance should pass it via profit_scaling_tier.
        account_balance = (
            float(profit_scaling_tier.get("account_balance", 50_000.0))
            if profit_scaling_tier is not None
            else 50_000.0
        )

        # Wave 22: read firm from profit_scaling_tier dict if caller provided it.
        # Callers that know the destination account's firm should pass:
        #   profit_scaling_tier={"firm": "topstep", ...other fields...}
        # Falls back to "topstep" (operator primary per directive 2026-05-18).
        _firm = "topstep"
        _trailing_dd = 2000.0
        _high_water: Optional[float] = None
        _account_starting_floor = 50_000.0
        if profit_scaling_tier is not None:
            _firm = str(profit_scaling_tier.get("firm", "topstep"))
            _trailing_dd = float(profit_scaling_tier.get("trailing_dd", 2000.0))
            _hwm = profit_scaling_tier.get("high_water_balance")
            _high_water = float(_hwm) if _hwm is not None else None
            _account_starting_floor = float(
                profit_scaling_tier.get("account_starting_floor", 50_000.0)
            )

        sizing_result = compute_risk_derived_contracts(
            base_contracts=config.base_contracts,
            tier_increment=config.tier_increment,
            tier_threshold_dollars=config.tier_threshold_dollars,
            max_risk_pct_per_trade=config.max_risk_pct_per_trade,
            liquidity_comfort_cap=config.liquidity_comfort_cap,
            account_balance=account_balance,
            cumulative_profit=cumulative_profit,
            atr_points=atr_for_sizing,
            stop_multiplier=1.5,  # CLAUDE.md §4 default stop multiplier
            point_dollar_value=contract_spec.point_value,
            firm_contract_cap=config.firm_contract_cap
            if config.firm_contract_cap
            else max_contracts,
            topstep_account_cap_override=config.topstep_account_cap_override,
            firm=_firm,
            trailing_dd=_trailing_dd,
            high_water_balance=_high_water,
            account_starting_floor=_account_starting_floor,
        )

        if sizing_result.rejection_reason is not None:
            logger.warning(
                "sizing.risk_derived_rejected reason=%s atr=%.4f balance=%.2f → 1 contract fallback",
                sizing_result.rejection_reason,
                atr_for_sizing,
                account_balance,
            )
            # Fall back to 1 contract on rejection (minimum tradeable)
            contracts = 1
        else:
            contracts = sizing_result.final_contracts

        logger.debug(
            "sizing.risk_derived pyramid=%d risk_cap=%d firm_cap=%s liquidity=%d → %d contracts "
            "binding=%s atr=%.4f balance=%.2f pnl=%.2f firm=%s method=%s",
            sizing_result.pyramid_tier,
            sizing_result.risk_derived_cap,
            sizing_result.firm_cap,
            sizing_result.liquidity_cap,
            contracts,
            sizing_result.evidence.get("binding_cap", "?"),
            atr_for_sizing,
            account_balance,
            cumulative_profit,
            sizing_result.firm,
            sizing_result.risk_cap_method,
        )

        # F-6: Per-bar risk-derived cap using bar-level ATR (not mean).
        # Uses the firm-aware buffer computed by compute_risk_derived_contracts() above.
        # risk_dollars is the per-trade risk budget (Topstep: buffer × pct; MFFU: balance × pct).
        stop_mult = 1.5  # CLAUDE.md §4 default
        pv = contract_spec.point_value
        # risk_dollars extracted from evidence (set by compute_risk_derived_contracts)
        risk_dollars_scalar = float(
            sizing_result.evidence.get(
                "risk_dollars", account_balance * config.max_risk_pct_per_trade
            )
        )
        # F-7 fix (2026-05-20): when firm_cap AND max_contracts are both None
        # (legacy strategies, no firm metadata) int(None) raised TypeError. Use a
        # sentinel "no cap" value (1e9 contracts — well above any liquidity cap
        # so this branch never binds) so the min() below still computes correctly.
        if sizing_result.firm_cap is not None:
            effective_firm_cap_bar = int(sizing_result.firm_cap)
        elif max_contracts is not None:
            effective_firm_cap_bar = int(max_contracts)
        else:
            effective_firm_cap_bar = 10**9
        liquidity_cap_bar = int(config.liquidity_comfort_cap)
        pyramid_tier_bar = int(sizing_result.pyramid_tier)
        base_contr = int(config.base_contracts)
        account_is_healthy_bar = sizing_result.account_health_ratio >= 0.85

        if sizing_result.rejection_reason is not None:
            # Global rejection (zero buffer, zero balance) — 1 contract fallback for all bars
            sizes = np.full(n, 1.0, dtype=np.float64)
        else:
            # Per-bar risk-derived cap: floor(risk_dollars / (stop_mult * atr[i] * pv))
            with np.errstate(divide="ignore", invalid="ignore"):
                risk_derived_caps = np.floor(
                    risk_dollars_scalar / (stop_mult * atr_arr * pv)
                )
            # Clamp negative / NaN → 0
            risk_derived_caps = np.where(
                np.isnan(risk_derived_caps) | (risk_derived_caps < 0),
                0.0,
                risk_derived_caps,
            )

            # ── Wave 26 Pass K Phase 3 (2026-05-26) — Per-bar PM size factor ──
            # Apply EOD-DD-aware multiplier to pyramid_tier_bar per-bar (NOT to
            # risk_derived_caps — those already reflect per-bar ATR risk). Mirrors
            # TS src/server/lib/risk-sizing.ts + paper-signal-service.ts wiring.
            # Fail-soft: if ts_event column absent or vectorizer raises, factor=1.0
            # (no scaling) so backward-compat preserved for legacy DataFrames.
            # CRIT (fresh-scan 2026-07-12): keep pm_factors defined in ALL branches (defaults to 1.0 =
            # no taper) so the pyramid FLOOR value below can apply the SAME PM taper the TS mirror does
            # (risk-sizing.ts flooredBase = floor(base × pmFactor)). Without this the Python floor
            # re-inflated a PM-tapered bar back to full base_contracts while paper floored to
            # base×pmFactor — a sizing PARITY break (backtest over-sized PM-session trades vs live).
            pm_factors = np.ones(n)
            try:
                from src.engine.pm_size_factor import compute_pm_size_factor_vec
                if "ts_event" in df.columns:
                    # Convert UTC ts_event → ET minute-of-day vector (DST-correct via Polars)
                    # CRITICAL (fresh-scan 2026-07-12): Polars `.dt.hour()`/`.dt.minute()` return Int8;
                    # `hour * 60` OVERFLOWS Int8 (max 127) for every ET hour >= 3 → SILENT garbage (no
                    # exception, so the fail-soft `except` never engages). That defeated the ENTIRE
                    # per-bar PM taper — every 13:30-15:30 ET (pm_factor should be ~0.5) minute silently
                    # re-inflated to pm_factor=1.0, so backtests over-sized PM trades vs live paper. This
                    # is the documented Polars-i8 hazard (AGENT-LOGS.md:5227/5241/9349/9378, fixed the same
                    # way in economic_calendar.py/liquidity.py): CAST to Int32 BEFORE the arithmetic.
                    et_minutes = (
                        df.select(
                            (
                                pl.col("ts_event")
                                .dt.convert_time_zone("America/New_York")
                                .dt.hour().cast(pl.Int32) * 60
                                + pl.col("ts_event")
                                .dt.convert_time_zone("America/New_York")
                                .dt.minute().cast(pl.Int32)
                            ).alias("et_min")
                        )["et_min"].to_numpy()
                    )
                    pm_factors = compute_pm_size_factor_vec(et_minutes)
                    pyramid_tier_per_bar = np.floor(pyramid_tier_bar * pm_factors)
                else:
                    pyramid_tier_per_bar = np.full(n, float(pyramid_tier_bar))
            except Exception as _pm_err:  # noqa: BLE001
                logger.warning("pm_size_factor: per-bar vectorization failed (%s) — falling back to no PM scaling", _pm_err)
                pyramid_tier_per_bar = np.full(n, float(pyramid_tier_bar))

            # Step 1: min(pyramid_tier_per_bar, risk_derived_cap, firm_cap, liquidity_cap)
            bar_sizes = np.minimum(pyramid_tier_per_bar, risk_derived_caps)
            bar_sizes = np.minimum(bar_sizes, effective_firm_cap_bar)
            bar_sizes = np.minimum(bar_sizes, liquidity_cap_bar)
            bar_sizes = np.maximum(bar_sizes, 0.0)
            # Step 2 (Wave 23): Pyramid floor on healthy accounts — element-wise
            # NOTE: Wave 26 Pass K — floor binds ONLY when pyramid_tier_per_bar >= base_contr
            # so PM-tapered bars don't get re-inflated above the EOD-DD safe size.
            if account_is_healthy_bar and base_contr > 0:
                # deep-scan 2026-07-11 MED fix: the floor value must be CLAMPED to the firm + liquidity
                # caps, not the raw base_contracts. When base_contracts >= a cap (e.g. a per-strategy
                # liquidity_comfort_cap=10 with base=18), the un-clamped floor re-inflated bar size ABOVE
                # the cap → over-sizing / inflated backtest P&L vs live-achievable (the TS floor already
                # clamps via flooredCandidates=[base, liquidityCap, firmCap?]). Mirror that here.
                # CRIT (fresh-scan 2026-07-12): apply the per-bar PM taper to the floor value, mirroring
                # the TS flooredBase = Math.floor(base_contracts × pmFactor). pm_factors is 1.0 on
                # non-PM bars (floor = base, unchanged) and ~0.5 in the PM session (floor = base×0.5),
                # so a deliberate PM-session reduction is never silently re-inflated to full base — and
                # Python now equals paper on the same afternoon bar.
                floored_val = np.minimum(np.floor(float(base_contr) * pm_factors), effective_firm_cap_bar)
                floored_val = np.minimum(floored_val, liquidity_cap_bar)
                bar_sizes = np.where(
                    (bar_sizes < base_contr) & (pyramid_tier_per_bar >= base_contr),
                    floored_val,
                    bar_sizes,
                )
            # Bars where risk_derived_caps == 0 and account unhealthy → 1 fallback (minimum tradeable)
            # Wave 26 Pass K: PM-closed bars (pyramid_tier_per_bar == 0) stay at 0 (no entry).
            bar_sizes = np.where(
                (bar_sizes <= 0) & (pyramid_tier_per_bar > 0),
                1.0,
                bar_sizes,
            )
            sizes = bar_sizes

        over_risk = np.zeros(n, dtype=bool)
        return sizes, over_risk

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
