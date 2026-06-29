"""Variable slippage model — ATR-scaled.

Per CLAUDE.md: slippage is a function of volatility, not a constant.
slippage_ticks = base_ticks * (ATR / median_ATR)
slippage_dollars = slippage_ticks * tick_value

C1 fix (2026-05-19): slippage_ticks is now rounded CONSERVATIVELY (ceiling on
absolute value) so fractional ticks are never silently gifted to the trader.
This prevents cumulative P&L inflation across thousands of trades.

Rounding mode is configurable via env var SLIPPAGE_TICK_ROUNDING_MODE:
  ceil  (default) — ceiling on absolute value; conservative, penalizes trader
  round — nearest integer; neutral estimate
  floor — floor on absolute value; optimistic; NOT recommended for production
"""

from __future__ import annotations

import json
import os
import sys
from functools import lru_cache

import numpy as np
import polars as pl

from src.engine.config import ContractSpec

# ─── Rounding mode (configurable via env, default 'ceil') ────────────────────
# 'ceil'  — always round up in absolute terms → worst-case slippage (conservative)
# 'round' — round to nearest integer → neutral estimate
# 'floor' — always round down in absolute terms → best-case (optimistic, not recommended)
_VALID_ROUNDING_MODES = {"ceil", "round", "floor"}


# Deep-scan #5 MED (2026-06-29): was a module-level constant frozen at import time, so
# tests that set SLIPPAGE_TICK_ROUNDING_MODE after import never saw the change (unlike
# fill_model.py which already used lru_cache getters). Mirror that pattern so tests can:
#   os.environ["SLIPPAGE_TICK_ROUNDING_MODE"] = "round"
#   slippage._get_rounding_mode.cache_clear()
# Production behavior is unchanged — default resolves to 'ceil' (conservative) once.
@lru_cache(maxsize=1)
def _get_rounding_mode() -> str:
    mode = os.environ.get("SLIPPAGE_TICK_ROUNDING_MODE", "ceil").lower()
    if mode not in _VALID_ROUNDING_MODES:
        print(
            json.dumps({
                "event": "slippage.invalid_rounding_mode",
                "mode": mode,
                "fallback": "ceil",
                "valid": sorted(_VALID_ROUNDING_MODES),
            }),
            file=sys.stderr,
        )
        return "ceil"
    return mode


def _ceil_ticks(ticks: np.ndarray) -> np.ndarray:
    """Round ticks conservatively: ceiling on the absolute value, preserving sign.

    Examples:
        1.2 → 2.0   (long-side slippage: worse fill)
        -1.2 → -2.0  (short-side slippage: worse fill)
        1.0 → 1.0   (already integer — no change)
    """
    return np.sign(ticks) * np.ceil(np.abs(ticks))


def _round_ticks_by_mode(ticks: np.ndarray, mode: str) -> np.ndarray:
    """Apply the configured rounding mode to an array of tick values.

    Args:
        ticks: Raw (possibly fractional) tick values.
        mode: 'ceil' | 'round' | 'floor'

    Returns:
        Integer-valued tick array with the correct rounding applied.
    """
    if mode == "ceil":
        return _ceil_ticks(ticks)
    elif mode == "round":
        return np.round(ticks)
    else:
        # floor — round down on absolute value (optimistic)
        return np.sign(ticks) * np.floor(np.abs(ticks))


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
        order_type: 'market' | 'stop' | 'stop_market' | 'limit' | 'stop_limit'

    Returns:
        numpy array of slippage in dollars per bar

    C1: slippage_ticks is rounded conservatively (ceiling on abs value by default)
    so fractional ticks are never gifted back to the trader.
    Rounding mode controlled by SLIPPAGE_TICK_ROUNDING_MODE env var (default: ceil).
    """
    # L-1 fix (2026-06-29): hard guard — stop/stop_market orders are prohibited by
    # CLAUDE.md §13.  If any caller passes these, the error surfaces immediately
    # instead of silently computing a 2× slippage value that hides the contract violation.
    # Use stop_limit instead (base slippage × 1.0, no modifier).
    if order_type in ("stop", "stop_market"):
        raise ValueError(
            f"stop/stop_market orders are prohibited per CLAUDE.md §13; "
            f"received order_type={order_type!r}. Use stop_limit instead."
        )

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
        # Fallback: constant slippage — 1 full tick, already integer
        return np.full(len(df), base_ticks * contract_spec.tick_value)

    # Variable slippage: scale with ATR relative to median.
    # C1 FIX: round per configured mode (default: ceiling on abs value).
    # Fractional ticks must never be silently gifted back to the trader.
    raw_ticks = base_ticks * (atr_values / median_atr)
    slippage_ticks = _round_ticks_by_mode(raw_ticks, _get_rounding_mode())
    slippage_dollars = slippage_ticks * contract_spec.tick_value

    # Order-type slippage modifier.
    # NOTE (2026-06-29 reconcile): "stop" and "stop_market" are already rejected by
    # the L-1 guard at the top of this function — matching fill_model.py:217's
    # ban-BOTH contract (use stop_limit). The earlier FIX-3 here that re-raised only
    # stop_market and kept "stop" at 2x was wrong (fill_model bans both) and dead
    # (the L-1 guard raised first); removed to keep slippage<->fill_model in lockstep.
    if order_type == "limit":
        # Limit orders: slippage = half-spread only (better fill)
        slippage_dollars = slippage_dollars * 0.5
    elif order_type == "stop_limit":
        pass  # Base slippage * 1.0 (no modifier)

    # Apply session-based liquidity multipliers
    if session_multipliers is not None:
        slippage_dollars = slippage_dollars * session_multipliers

    return slippage_dollars
