"""Style C Exit Handler — regime runner exit for Track 3.

Style C structure (2026 consensus: trend-continuation regime with VP confirmation):
  TP1: 33% off at +1.0R
  TP2: 33% off at +2.0R
  Runner: 33% trails developing session POC (Volume Profile Point of Control)
  Time-stop: hard flatten at 15:55 ET regardless of P&L

This is a PURE FUNCTION with no I/O. Same inputs → same output every time.
Fail-closed: any error returns HOLD with an audit_log row. Never raises.

Regime trigger (enforced by select_exit_style() in structural_targets.py):
  bias_state.playbook == "TREND_CONTINUATION"
  AND vp_shape in {D, b, P, Thin}
  AND macro_state != "crisis"

Callers that do not supply regime context receive Style D (the default).
Style C is only invoked after select_exit_style() returns "style_c".

Determinism:
  HANDLER_VERSION = "style_c_v1.0.0"
  All logic is arithmetic on float inputs. No randomness.
"""
from __future__ import annotations

import logging
import math
import warnings
from typing import Optional

from pydantic import BaseModel

from src.engine.config import TRACK3_CONFIG
from src.engine.exits.style_d_handler import ExitDecision, _is_time_stop

logger = logging.getLogger(__name__)


def validate_style_c_base_contracts(base_contracts: int) -> int:
    """H8 FIX: Enforce base_contracts % 3 == 0 for Style C 33/33/33 splits.

    Style C splits: TP1=33%, TP2=33%, runner=34% — this requires a contract
    count divisible by 3 so integer-lot exits are clean (e.g. 6 → 2+2+2, 9 → 3+3+3).
    Non-divisible counts create fractional lots that can't be executed (e.g. 7 → 2.31+2.31+2.38).

    Fix: ROUND DOWN to nearest multiple of 3 with a WARNING, emit audit field.

    Args:
        base_contracts: Proposed base contract count.

    Returns:
        Adjusted contract count (multiple of 3), always >= 3.

    Raises:
        ValueError: If base_contracts <= 0.
    """
    if base_contracts <= 0:
        raise ValueError(f"base_contracts must be > 0, got {base_contracts}")
    if base_contracts % 3 != 0:
        adjusted = max(3, (base_contracts // 3) * 3)
        warnings.warn(
            f"Style C requires base_contracts divisible by 3 for clean 33/33/34 splits. "
            f"Got {base_contracts}, rounding down to {adjusted}. "
            f"Audit field: style_c_size_rounded=True.",
            stacklevel=2,
        )
        logger.warning(
            "style_c: base_contracts=%d not divisible by 3 → rounded to %d "
            "[audit: style_c_size_rounded=True]",
            base_contracts, adjusted,
        )
        return adjusted
    return base_contracts

# ─── Determinism anchor ───────────────────────────────────────────────────────
HANDLER_VERSION = "style_c_v1.0.0"

# Scale fractions: tp1=33%, tp2=33%, runner=34% (rounds to ~1.0)
TP1_FRACTION_C = 0.33
TP2_FRACTION_C = 0.33
RUNNER_FRACTION_C = 0.34   # Remainder after TP1 + TP2

# R multiples for Style C
TP1_AT_R_C = 1.0
TP2_AT_R_C = 2.0


# ─── Input state ─────────────────────────────────────────────────────────────

class StyleCState(BaseModel):
    """Input state for Style C evaluate_exit()."""
    direction: str          # "long" | "short"
    entry_price: float
    stop_pts: float         # Initial stop distance in points (always positive)
    current_price: float
    current_time_et: str    # "HH:MM" in ET
    position_pct_open: float = 1.0    # 1.0 = full, 0.67 = after TP1, 0.34 = after TP2
    tick_size: float = 0.25

    # Scale-out state flags
    tp1_filled: bool = False
    tp2_filled: bool = False

    # Session POC trail (developing intraday POC, updated by volume profile module)
    developing_session_poc: Optional[float] = None

    # Regime validation inputs (for audit evidence only — routing already done)
    playbook: Optional[str] = None
    vp_shape: Optional[str] = None
    macro_state: Optional[str] = None

    # C2 fix: intrabar high/low for limit-touch TP detection.
    # When supplied by the paper engine (via StyleExitBarContext.currentBarHigh/Low),
    # price_reached() uses bar_high (long TP) / bar_low (short TP) to match the
    # backtester's intrabar limit-fill semantics (backtester.py:1248/1260):
    #   long:  bar_high >= tp_price  (touch from below)
    #   short: bar_low  <= tp_price  (touch from above)
    # Backward-compatible: when None, falls back to current_price (close-based).
    bar_high: Optional[float] = None  # intrabar high — for TP fill touch detection
    bar_low: Optional[float] = None   # intrabar low  — for TP fill touch detection


# ─── Main handler ─────────────────────────────────────────────────────────────

def evaluate_exit(state: StyleCState) -> ExitDecision:
    """Evaluate exit decisions for a Style C (regime runner) trade.

    Decision priority:
      1. TIME_STOP_FLATTEN  — current_time_et >= 15:55 ET
      2. FILL_TP1_50PCT     — price reached +1.0R and tp1 not yet filled
                              (label is reused; fills 33%, not 50%)
      3. FILL_TP2           — price reached +2.0R and tp2 not yet filled
      4. TIGHTEN_TRAIL_TO_X — runner trails developing session POC
      5. HOLD               — no action

    Note: FILL_TP1_50PCT decision name is reused for TP1 in Style C (fills 33%).
          Callers must use Style C fractions (TP1_FRACTION_C=0.33, TP2_FRACTION_C=0.33).
          FILL_TP2 is a Style-C-specific decision type.

    Fail-closed: any exception returns HOLD with error evidence.
    Idempotent: each fill only fires once via tp1_filled / tp2_filled flags.
    """
    evidence: dict = {
        "direction": state.direction,
        "entry_price": state.entry_price,
        "stop_pts": state.stop_pts,
        "current_price": state.current_price,
        "bar_high": state.bar_high,
        "bar_low": state.bar_low,
        "position_pct_open": state.position_pct_open,
        "tp1_filled": state.tp1_filled,
        "tp2_filled": state.tp2_filled,
        "current_time_et": state.current_time_et,
        "playbook": state.playbook,
        "vp_shape": state.vp_shape,
        "macro_state": state.macro_state,
        "handler_version": HANDLER_VERSION,
    }

    try:
        # Validate critical fields
        for field_name, val in [
            ("entry_price", state.entry_price),
            ("stop_pts", state.stop_pts),
            ("current_price", state.current_price),
        ]:
            if math.isnan(val) or math.isinf(val):
                logger.warning(
                    "style_c_handler: NaN/Inf in field=%s value=%s → HOLD",
                    field_name, val,
                )
                evidence["error"] = f"NaN_or_Inf_in_{field_name}"
                return ExitDecision(decision="HOLD", evidence=evidence, handler_version=HANDLER_VERSION)

        if state.stop_pts <= 0:
            logger.warning("style_c_handler: stop_pts <= 0 → HOLD")
            evidence["error"] = "stop_pts_not_positive"
            return ExitDecision(decision="HOLD", evidence=evidence, handler_version=HANDLER_VERSION)

        risk_pts = state.stop_pts
        sign = 1 if state.direction == "long" else -1
        tp1_price = state.entry_price + sign * risk_pts * TP1_AT_R_C
        tp2_price = state.entry_price + sign * risk_pts * TP2_AT_R_C

        def price_reached(target: float) -> bool:
            # C2 fix: use intrabar high/low for limit-order TP touch detection
            # when bar context is supplied by the paper engine, mirroring
            # backtester.py:1248/1260 semantics:
            #   long:  bar_high >= target  (price touched limit from below intrabar)
            #   short: bar_low  <= target  (price touched limit from above intrabar)
            # Falls back to current_price (close) when bar_high/bar_low absent,
            # preserving backward-compat for callers that don't supply OHLC context.
            if state.direction == "long":
                probe = state.bar_high if state.bar_high is not None else state.current_price
                return probe >= target
            probe = state.bar_low if state.bar_low is not None else state.current_price
            return probe <= target

        # ── Priority 1: Time-stop ──────────────────────────────────────────────
        if _is_time_stop(state.current_time_et):
            evidence["trigger"] = "time_stop"
            evidence["flatten_threshold"] = TRACK3_CONFIG.TIME_STOP_FLATTEN_ET
            logger.debug("style_c: TIME_STOP_FLATTEN at %s", state.current_time_et)
            return ExitDecision(
                decision="TIME_STOP_FLATTEN", evidence=evidence, handler_version=HANDLER_VERSION
            )

        # ── Priority 2: TP1 fill at 1.0R ──────────────────────────────────────
        if price_reached(tp1_price) and not state.tp1_filled:
            evidence["trigger"] = "tp1_fill"
            evidence["tp1_price"] = tp1_price
            evidence["tp1_fraction"] = TP1_FRACTION_C
            logger.debug("style_c: FILL_TP1 at price=%.4f", state.current_price)
            return ExitDecision(
                decision="FILL_TP1_50PCT", evidence=evidence, handler_version=HANDLER_VERSION
            )

        # ── Priority 3: TP2 fill at 2.0R ──────────────────────────────────────
        if price_reached(tp2_price) and state.tp1_filled and not state.tp2_filled:
            evidence["trigger"] = "tp2_fill"
            evidence["tp2_price"] = tp2_price
            evidence["tp2_fraction"] = TP2_FRACTION_C
            logger.debug("style_c: FILL_TP2 at price=%.4f", state.current_price)
            return ExitDecision(
                decision="FILL_TP2", evidence=evidence, handler_version=HANDLER_VERSION
            )

        # ── Priority 4: POC trail for runner ──────────────────────────────────
        if state.tp1_filled and state.tp2_filled and state.developing_session_poc is not None:
            poc = state.developing_session_poc
            # Check if POC trail has been breached (price moved through POC)
            poc_breached = (
                state.current_price <= poc if state.direction == "long"
                else state.current_price >= poc
            )
            if poc_breached:
                evidence["trigger"] = "poc_trail_breached"
                evidence["developing_session_poc"] = poc
                logger.debug("style_c: TIGHTEN_TRAIL_TO_X (POC breach) poc=%.4f", poc)
                return ExitDecision(
                    decision="TIGHTEN_TRAIL_TO_X",
                    new_stop=poc,
                    evidence=evidence,
                    handler_version=HANDLER_VERSION,
                )

            # POC not yet breached — emit updated trail level
            evidence["trigger"] = "poc_trail_update"
            evidence["developing_session_poc"] = poc
            logger.debug("style_c: TIGHTEN_TRAIL_TO_X (POC update) poc=%.4f", poc)
            return ExitDecision(
                decision="TIGHTEN_TRAIL_TO_X",
                new_stop=poc,
                evidence=evidence,
                handler_version=HANDLER_VERSION,
            )

        # ── Default: Hold ─────────────────────────────────────────────────────
        evidence["trigger"] = "hold"
        return ExitDecision(decision="HOLD", evidence=evidence, handler_version=HANDLER_VERSION)

    except Exception as exc:
        logger.error("style_c_handler: unexpected error=%r → HOLD", exc, exc_info=True)
        evidence["error"] = repr(exc)
        return ExitDecision(decision="HOLD", evidence=evidence, handler_version=HANDLER_VERSION)
