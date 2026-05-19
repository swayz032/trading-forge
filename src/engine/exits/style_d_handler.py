"""Style D Exit Handler — default exit management for Track 3.

Style D structure (2026 consensus: Raschke, Grimes, Bellafiore, SMB):
  TP1: 50% off at +1.0R from entry
  On TP1 fill: move stop to BE + 1 tick
  Trail remainder: Chandelier(14, 2.0) OR last 2-bar 15m swing low (tighter wins)
  Time-stop: hard flatten at 15:55 ET regardless of P&L

This is a PURE FUNCTION with no I/O. Same inputs → same output every time.
Fail-closed: any error returns HOLD with an audit_log row. Never raises.

Determinism:
  HANDLER_VERSION = "style_d_v1.0.0"
  All logic is arithmetic on float inputs. No randomness.

Callers must supply an ExitState with all fields populated. Missing/NaN fields
are treated defensively (see field docs) and return HOLD with audit evidence.
"""
from __future__ import annotations

import hashlib
import logging
from datetime import time
from typing import Optional

from pydantic import BaseModel, Field

from src.engine.config import TRACK3_CONFIG

logger = logging.getLogger(__name__)

# ─── Determinism anchor ───────────────────────────────────────────────────────
HANDLER_VERSION = "style_d_v1.0.0"

# sha256 of this file's canonical content is committed separately in
# src/engine/exits/HANDLER_HASHES.txt and verified by test_style_d_handler.py.
# See determinism check in that test file.


# ─── Decision types ───────────────────────────────────────────────────────────

class ExitDecision(BaseModel):
    """Returned by both Style D and Style C handlers."""
    decision: str       # "HOLD" | "FILL_TP1_50PCT" | "MOVE_STOP_TO_BE" |
                        #  "TIGHTEN_TRAIL_TO_X" | "TIME_STOP_FLATTEN"
    new_stop: Optional[float] = None    # Populated for MOVE_STOP_TO_BE and TIGHTEN_TRAIL_TO_X
    evidence: dict = Field(default_factory=dict)   # Snapshot of inputs for audit_log
    handler_version: str = HANDLER_VERSION


class ExitState(BaseModel):
    """Input state for Style D evaluate_exit(). All floats default to 0.0 on missing."""
    direction: str          # "long" | "short"
    entry_price: float
    stop_pts: float         # Initial stop distance in points (always positive)
    current_price: float
    current_high_since_entry: float   # For longs: running max; for shorts: supply as low
    current_low_since_entry: float    # For longs: running min; for shorts: supply as high
    atr_14: float           # Current 14-bar ATR in points
    last_2bar_swing_low: Optional[float] = None   # For longs: lowest low of prior 2 bars on 15m
    last_2bar_swing_high: Optional[float] = None  # For shorts
    current_time_et: str    # "HH:MM" format, e.g. "15:54"
    position_pct_open: float = 1.0    # 1.0 = full size, 0.5 = half already exited
    tick_size: float = 0.25           # Instrument tick size for BE+1 tick calculation
    tp1_filled: bool = False          # True once TP1 50% has been executed
    be_stop_applied: bool = False     # True once BE stop has been applied

    # Chandelier trailing values (pre-computed by caller from OHLCV)
    chandelier_stop_long: Optional[float] = None   # Chandelier stop level for long
    chandelier_stop_short: Optional[float] = None  # Chandelier stop level for short


# ─── Internal helpers ─────────────────────────────────────────────────────────

def _is_time_stop(current_time_str: str) -> bool:
    """Return True if current time >= TIME_STOP_FLATTEN_ET (15:55 ET)."""
    try:
        h, m = current_time_str.split(":")
        current = time(int(h), int(m))
        flatten_h, flatten_m = TRACK3_CONFIG.TIME_STOP_FLATTEN_ET.split(":")
        flatten = time(int(flatten_h), int(flatten_m))
        return current >= flatten
    except Exception:
        return False


def _compute_chandelier_stop(
    direction: str,
    current_high_since_entry: float,
    current_low_since_entry: float,
    atr_14: float,
    period: int,
    mult: float,
) -> Optional[float]:
    """Compute Chandelier stop from running high/low and ATR.

    For longs:  chandelier = highest_high - mult * ATR(period)
    For shorts: chandelier = lowest_low  + mult * ATR(period)
    """
    if atr_14 <= 0:
        return None
    if direction == "long":
        return current_high_since_entry - mult * atr_14
    else:
        return current_low_since_entry + mult * atr_14


def _compute_swing_trail(
    direction: str,
    last_2bar_swing_low: Optional[float],
    last_2bar_swing_high: Optional[float],
) -> Optional[float]:
    """Return 2-bar 15m swing trail level, or None if unavailable."""
    if direction == "long":
        return last_2bar_swing_low
    else:
        return last_2bar_swing_high


def _tighter_trail(
    direction: str,
    chandelier: Optional[float],
    swing: Optional[float],
    entry_price: float,
) -> Optional[float]:
    """Return the tighter (closer to current price) of chandelier and swing trail.

    For longs: tighter = higher value (closer to price from below).
    For shorts: tighter = lower value (closer to price from above).
    Returns None if both inputs are None.
    """
    candidates = [v for v in (chandelier, swing) if v is not None]
    if not candidates:
        return None
    if direction == "long":
        # Want the highest (tightest) stop below entry/current price
        return max(candidates)
    else:
        # Want the lowest (tightest) stop above entry/current price
        return min(candidates)


# ─── Main handler ─────────────────────────────────────────────────────────────

def evaluate_exit(state: ExitState) -> ExitDecision:
    """Evaluate exit decisions for a Style D trade.

    Decision priority:
      1. TIME_STOP_FLATTEN  — if current_time_et >= 15:55 ET
      2. FILL_TP1_50PCT     — if not tp1_filled and price reached +1.0R
      3. MOVE_STOP_TO_BE    — if tp1_filled and not be_stop_applied
      4. TIGHTEN_TRAIL_TO_X — if tp1_filled and be_stop_applied and trail tightened
      5. HOLD               — no action needed

    Fail-closed: any exception returns HOLD with error evidence.
    Idempotent: FILL_TP1 only returns once (tp1_filled guards it).
    """
    evidence: dict = {
        "direction": state.direction,
        "entry_price": state.entry_price,
        "stop_pts": state.stop_pts,
        "current_price": state.current_price,
        "position_pct_open": state.position_pct_open,
        "tp1_filled": state.tp1_filled,
        "be_stop_applied": state.be_stop_applied,
        "current_time_et": state.current_time_et,
        "handler_version": HANDLER_VERSION,
    }

    try:
        # Validate non-NaN critical fields
        import math
        for field_name, val in [
            ("entry_price", state.entry_price),
            ("stop_pts", state.stop_pts),
            ("current_price", state.current_price),
            ("atr_14", state.atr_14),
        ]:
            if math.isnan(val) or math.isinf(val):
                logger.warning(
                    "style_d_handler: NaN/Inf in field=%s value=%s → HOLD",
                    field_name, val,
                )
                evidence["error"] = f"NaN_or_Inf_in_{field_name}"
                return ExitDecision(decision="HOLD", evidence=evidence)

        if state.stop_pts <= 0:
            logger.warning("style_d_handler: stop_pts <= 0 → HOLD")
            evidence["error"] = "stop_pts_not_positive"
            return ExitDecision(decision="HOLD", evidence=evidence)

        risk_pts = state.stop_pts  # Always positive (points from entry to stop)
        tp1_price = (
            state.entry_price + risk_pts * TRACK3_CONFIG.TP1_AT_R
            if state.direction == "long"
            else state.entry_price - risk_pts * TRACK3_CONFIG.TP1_AT_R
        )
        be_stop_price = (
            state.entry_price + state.tick_size
            if state.direction == "long"
            else state.entry_price - state.tick_size
        )

        # ── Priority 1: Time-stop ──────────────────────────────────────────────
        if _is_time_stop(state.current_time_et):
            evidence["trigger"] = "time_stop"
            evidence["flatten_threshold"] = TRACK3_CONFIG.TIME_STOP_FLATTEN_ET
            logger.debug("style_d: TIME_STOP_FLATTEN at %s", state.current_time_et)
            return ExitDecision(decision="TIME_STOP_FLATTEN", evidence=evidence)

        # ── Priority 2: TP1 fill ──────────────────────────────────────────────
        tp1_hit = (
            state.current_price >= tp1_price
            if state.direction == "long"
            else state.current_price <= tp1_price
        )
        if tp1_hit and not state.tp1_filled and state.position_pct_open >= TRACK3_CONFIG.TP1_FRACTION:
            evidence["trigger"] = "tp1_fill"
            evidence["tp1_price"] = tp1_price
            evidence["tp1_fraction"] = TRACK3_CONFIG.TP1_FRACTION
            logger.debug("style_d: FILL_TP1_50PCT at price=%.4f tp1=%.4f", state.current_price, tp1_price)
            return ExitDecision(decision="FILL_TP1_50PCT", evidence=evidence)

        # ── Priority 3: Move stop to BE after TP1 ─────────────────────────────
        if state.tp1_filled and not state.be_stop_applied:
            evidence["trigger"] = "be_stop"
            evidence["be_stop_price"] = be_stop_price
            logger.debug("style_d: MOVE_STOP_TO_BE to %.4f", be_stop_price)
            return ExitDecision(decision="MOVE_STOP_TO_BE", new_stop=be_stop_price, evidence=evidence)

        # ── Priority 4: Trail tightening ──────────────────────────────────────
        if state.tp1_filled and state.be_stop_applied:
            chandelier = _compute_chandelier_stop(
                direction=state.direction,
                current_high_since_entry=state.current_high_since_entry,
                current_low_since_entry=state.current_low_since_entry,
                atr_14=state.atr_14,
                period=TRACK3_CONFIG.CHANDELIER_PERIOD,
                mult=TRACK3_CONFIG.CHANDELIER_MULT,
            )
            swing = _compute_swing_trail(
                direction=state.direction,
                last_2bar_swing_low=state.last_2bar_swing_low,
                last_2bar_swing_high=state.last_2bar_swing_high,
            )
            trail_method = TRACK3_CONFIG.TRAIL_METHOD
            if trail_method == "chandelier":
                new_trail = chandelier
            elif trail_method == "swing_low_2bar":
                new_trail = swing
            else:  # tighter_of_both (default)
                new_trail = _tighter_trail(state.direction, chandelier, swing, state.entry_price)

            if new_trail is not None:
                evidence["trigger"] = "trail_tighten"
                evidence["chandelier"] = chandelier
                evidence["swing"] = swing
                evidence["new_trail"] = new_trail
                evidence["trail_method"] = trail_method
                logger.debug("style_d: TIGHTEN_TRAIL_TO_X new_stop=%.4f", new_trail)
                return ExitDecision(decision="TIGHTEN_TRAIL_TO_X", new_stop=new_trail, evidence=evidence)

        # ── Default: Hold ─────────────────────────────────────────────────────
        evidence["trigger"] = "hold"
        return ExitDecision(decision="HOLD", evidence=evidence)

    except Exception as exc:
        logger.error("style_d_handler: unexpected error=%r → HOLD", exc, exc_info=True)
        evidence["error"] = repr(exc)
        return ExitDecision(decision="HOLD", evidence=evidence)
