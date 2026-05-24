"""Structural Stop Placement — Replaces ATR-only stops with structure-based invalidation.

Priority: sweep_wick > order_block > FVG > swing_point

Buffer (W24-P2 Item 20 — sweep-aware, 2026-05-23):
  Per-symbol tick-based buffer places the stop 3 ticks beyond prior bar high/low.
  Empirical funded-trader consensus (r/FuturesTrading 2025-05, 2026 funds): 1pt on
  MES lands inside the sweep zone; 3 ticks (0.75pt) clears it while minimising
  stop distance inflation.
    MES: 3 ticks × 0.25/tick = 0.75pt
    MNQ: 5 ticks × 0.25/tick = 1.25pt
    MCL: 2 ticks × 0.01/tick = 0.02pt

  Env-var overrides (integer tick counts):
    STOP_BUFFER_TICKS_MES, STOP_BUFFER_TICKS_MNQ, STOP_BUFFER_TICKS_MCL

  Unknown symbols fall back to legacy max(tick_size, ATR×0.10) with a warning.
"""
from __future__ import annotations

import logging
import os
import warnings
from dataclasses import dataclass
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)


# ─── Sweep-aware buffer table (W24-P2 Item 20) ─────────────────────────────────
# Default tick counts are the canonical funded-trader values.
# Override via env vars — integer ticks only.
_DEFAULT_BUFFER_TICKS: dict[str, int] = {
    "MES": 3,
    "ES":  3,   # micro alias
    "MNQ": 5,
    "NQ":  5,   # micro alias
    "MCL": 2,
    "CL":  2,   # micro alias
}

# Populate from environment at module load time.
# Env format: STOP_BUFFER_TICKS_MES=3 (integer, ticks beyond the prior bar extreme)
def _load_env_buffer_ticks() -> dict[str, int]:
    overrides: dict[str, int] = {}
    for sym, default in _DEFAULT_BUFFER_TICKS.items():
        # Only read canonical names (not aliases; we'll mirror to aliases below)
        env_key = f"STOP_BUFFER_TICKS_{sym}"
        raw = os.environ.get(env_key)
        if raw is not None:
            try:
                val = int(raw)
                if val < 1:
                    raise ValueError("must be >= 1")
                overrides[sym] = val
            except (ValueError, TypeError) as exc:
                warnings.warn(
                    f"{env_key}={raw!r} is invalid ({exc}); using default {default}",
                    UserWarning,
                    stacklevel=2,
                )
    return overrides


_ENV_OVERRIDES = _load_env_buffer_ticks()
# Merge with aliases
_EFFECTIVE_BUFFER_TICKS: dict[str, int] = {
    sym: _ENV_OVERRIDES.get(sym, default)
    for sym, default in _DEFAULT_BUFFER_TICKS.items()
}
# Mirror alias resolution: if env overrode MES, also apply to ES
for _base, _alias in [("MES", "ES"), ("MNQ", "NQ"), ("MCL", "CL")]:
    if _base in _ENV_OVERRIDES:
        _EFFECTIVE_BUFFER_TICKS[_alias] = _EFFECTIVE_BUFFER_TICKS[_base]


def get_sweep_buffer_ticks(symbol: str) -> Optional[int]:
    """Return the sweep-aware buffer in ticks for the symbol, or None if unknown."""
    return _EFFECTIVE_BUFFER_TICKS.get(symbol.upper())


def get_sweep_buffer_points(symbol: str, tick_size: float) -> Optional[float]:
    """Return the sweep-aware buffer in price points for the symbol, or None if unknown."""
    ticks = get_sweep_buffer_ticks(symbol)
    if ticks is None:
        return None
    return ticks * tick_size


def _compute_buffer(symbol: str, tick_size: float, atr: float, session_adj: float) -> tuple[float, bool]:
    """Return (buffer_points, sweep_aware_applied).

    Sweep-aware path: tick-count × tick_size, scaled by session_adj.
    Legacy fallback: max(tick_size, atr × 0.10) × session_adj — with warning.
    """
    sweep_pts = get_sweep_buffer_points(symbol, tick_size)
    if sweep_pts is not None:
        return sweep_pts * session_adj, True
    # Unknown symbol — legacy fallback with warning
    warnings.warn(
        f"Symbol '{symbol}' not in STOP_BUFFER_TICKS table; "
        "falling back to legacy ATR-based buffer (max(tick_size, ATR×0.10)). "
        "Add the symbol to _DEFAULT_BUFFER_TICKS in structural_stops.py.",
        UserWarning,
        stacklevel=3,
    )
    return max(tick_size, atr * 0.10) * session_adj, False


@dataclass
class StopPlan:
    stop_price: float
    stop_reason: str       # "sweep_wick" | "order_block" | "fvg" | "swing_point" | "atr_fallback"
    buffer: float
    risk_dollars: float    # (entry - stop) × contracts × point_value
    session_adjustment: float  # 1.0 normal, 1.5× during session transitions
    # W24-P2 Item 20 additions
    buffer_ticks: int         # ticks used for buffer (0 = legacy fallback)
    sweep_aware_buffer: bool  # True when sweep-aware path was used


def compute_structural_stop(
    direction: str,         # "long" | "short"
    entry_price: float,
    point_value: float,
    atr: float,
    tick_size: float,
    symbol: str = "MES",    # W24-P2 Item 20: required for per-symbol tick buffer
    # Structural levels (pre-computed from indicator modules)
    nearest_ob_below: Optional[float] = None,  # For longs: OB bottom below entry
    nearest_ob_above: Optional[float] = None,  # For shorts: OB top above entry
    nearest_fvg_below: Optional[float] = None,
    nearest_fvg_above: Optional[float] = None,
    nearest_swing_low: Optional[float] = None,
    nearest_swing_high: Optional[float] = None,
    sweep_wick_low: Optional[float] = None,    # Wick of a recent sweep candle
    sweep_wick_high: Optional[float] = None,
    session_transition: bool = False,
    max_stop_points: float = 6.0,
) -> StopPlan:
    """Compute structural stop placement with sweep-aware buffer (W24-P2 Item 20).

    For LONGS: stop goes BELOW structure (sweep wick > OB bottom > FVG bottom > swing low)
    For SHORTS: stop goes ABOVE structure (sweep wick > OB top > FVG top > swing high)

    Buffer is 3 ticks (MES) / 5 ticks (MNQ) / 2 ticks (MCL) beyond the structural
    level instead of the old flat 1pt or ATR-fraction approach.
    """
    # Guard: atr=0 would produce stop_price=entry_price (zero risk).
    # Fallback to tick_size × 20 as minimum ATR proxy.
    if atr <= 0:
        atr = tick_size * 20

    session_adj = 1.5 if session_transition else 1.0
    buffer, sweep_aware = _compute_buffer(symbol, tick_size, atr, session_adj)
    buffer_ticks = get_sweep_buffer_ticks(symbol) or 0

    stop_price = None
    stop_reason = "atr_fallback"

    if direction == "long":
        # Priority: sweep_wick > OB > FVG > swing_low > ATR fallback
        candidates = []
        if sweep_wick_low is not None and sweep_wick_low < entry_price:
            candidates.append((sweep_wick_low - buffer, "sweep_wick"))
        if nearest_ob_below is not None and nearest_ob_below < entry_price:
            candidates.append((nearest_ob_below - buffer, "order_block"))
        if nearest_fvg_below is not None and nearest_fvg_below < entry_price:
            candidates.append((nearest_fvg_below - buffer, "fvg"))
        if nearest_swing_low is not None and nearest_swing_low < entry_price:
            candidates.append((nearest_swing_low - buffer, "swing_point"))

        if candidates:
            # Pick the CLOSEST structural stop below entry (highest price)
            candidates.sort(key=lambda x: -x[0])
            stop_price, stop_reason = candidates[0]
        else:
            # ATR fallback: 1.5× ATR below entry
            stop_price = entry_price - (atr * 1.5 * session_adj)
            stop_reason = "atr_fallback"

    else:  # short
        candidates = []
        if sweep_wick_high is not None and sweep_wick_high > entry_price:
            candidates.append((sweep_wick_high + buffer, "sweep_wick"))
        if nearest_ob_above is not None and nearest_ob_above > entry_price:
            candidates.append((nearest_ob_above + buffer, "order_block"))
        if nearest_fvg_above is not None and nearest_fvg_above > entry_price:
            candidates.append((nearest_fvg_above + buffer, "fvg"))
        if nearest_swing_high is not None and nearest_swing_high > entry_price:
            candidates.append((nearest_swing_high + buffer, "swing_point"))

        if candidates:
            # Pick the CLOSEST structural stop above entry (lowest price)
            candidates.sort(key=lambda x: x[0])
            stop_price, stop_reason = candidates[0]
        else:
            stop_price = entry_price + (atr * 1.5 * session_adj)
            stop_reason = "atr_fallback"

    # Enforce max risk cap (default 6 points on MES)
    distance = abs(entry_price - stop_price)
    if max_stop_points > 0 and distance > max_stop_points:
        if direction == "long":
            stop_price = entry_price - max_stop_points
        else:
            stop_price = entry_price + max_stop_points
        stop_reason = f"{stop_reason}_capped_{max_stop_points:.0f}pt"

    risk_per_contract = abs(entry_price - stop_price) * point_value

    return StopPlan(
        stop_price=stop_price,
        stop_reason=stop_reason,
        buffer=buffer,
        risk_dollars=risk_per_contract,
        session_adjustment=session_adj,
        buffer_ticks=buffer_ticks,
        sweep_aware_buffer=sweep_aware,
    )
