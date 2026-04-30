"""
Decay gate — single pass/fail/warn decision combining half_life, quarantine, and sub_signals.

This is the top-level entry point for the decay subsystem. It runs all three
modules and returns a unified verdict that the paper engine or governor can act on.
"""

from __future__ import annotations

import logging
import os

from .half_life import fit_decay
from .quarantine import evaluate_quarantine, QuarantineLevel, SIZE_MULTIPLIERS
from .sub_signals import composite_decay_score

logger = logging.getLogger(__name__)

# ── TF_DECAY_FULL_SUBSIGNALS ───────────────────────────────────────────────
# Controls whether all 6 decay sub-signals individually influence the quarantine
# level, or whether only the composite score (which already incorporates all 6
# via weighted average) drives decisions.
#
# SHADOW mode (default, env var absent or "false"):
#   - composite_decay_score runs all 6 sub-signals (existing behavior)
#   - per-signal WARNING/CRITICAL verdicts are computed and logged as telemetry
#   - quarantine level decision uses ONLY the composite score (existing behavior)
#   - allows observing which individual signals would have fired before enforcing
#
# ENFORCE mode (env var = "true"):
#   - same composite score path runs as before
#   - ADDITIONALLY: if any individual sub-signal exceeds its CRITICAL threshold,
#     the composite score is floored to the "worst-signal minimum" to prevent
#     a low-weight critical signal from being diluted by healthy signals
#   - critical thresholds: sharpe_decay >= 70, mfe_decay >= 60, slippage_growth >= 50,
#     win_size_decay >= 60, regime_mismatch >= 60, fill_rate_decay >= 50
#   - this prevents, e.g., a 100-score regime_mismatch (weight=0.15) being masked
#     by four healthy signals keeping composite around 15
#
# Risk of metric drift when enforcing:
#   - Strategies with one critically bad sub-signal but otherwise healthy signals
#     will see composite_score floored higher → faster quarantine escalation
#   - Historical decay score comparisons are NOT valid across the mode boundary
_DECAY_FULL_SUBSIGNALS = os.environ.get("TF_DECAY_FULL_SUBSIGNALS", "false").lower() == "true"

# Per-signal CRITICAL thresholds (ENFORCE mode: floor composite to this if exceeded)
_SUBSIGNAL_CRITICAL_THRESHOLDS: dict[str, float] = {
    "sharpe_decay": 70.0,
    "mfe_decay": 60.0,
    "slippage_growth": 50.0,
    "win_size_decay": 60.0,
    "regime_mismatch": 60.0,
    "fill_rate_decay": 50.0,
}

# Per-signal WARNING thresholds (shadow logging)
_SUBSIGNAL_WARNING_THRESHOLDS: dict[str, float] = {
    "sharpe_decay": 40.0,
    "mfe_decay": 35.0,
    "slippage_growth": 25.0,
    "win_size_decay": 35.0,
    "regime_mismatch": 60.0,   # regime_mismatch starts at 60 on any mismatch
    "fill_rate_decay": 25.0,
}


def evaluate_decay_gate(
    daily_pnls: list[float],
    trades: list[dict],
    current_quarantine_level: str = "healthy",
    days_at_current_level: int = 0,
    improving_days: int = 0,
    strategy_regime: str = "",
    current_regime: str = "",
    regime_history: list[dict] | None = None,
    half_life_window: int = 60,
) -> dict:
    """
    Combined decay gate: runs half-life fitting, composite sub-signals, and
    quarantine evaluation to produce a single verdict.

    Returns:
        {
            "verdict": "pass" | "warn" | "fail",
            "reason": str,
            "size_multiplier": float,  # 0.0 = no trading, 0.5 = reduced, 1.0 = full
            "composite_score": float,  # 0-100
            "half_life": dict,         # from fit_decay
            "quarantine": dict,        # from evaluate_quarantine
            "sub_signals": dict,       # from composite_decay_score
        }
    """
    # 1. Fit exponential decay to rolling Sharpe
    half_life = fit_decay(daily_pnls, window=half_life_window)

    # 2. Compute composite decay score from 6 sub-signals
    sub_signals = composite_decay_score(
        daily_pnls=daily_pnls,
        trades=trades,
        strategy_regime=strategy_regime,
        current_regime=current_regime,
        regime_history=regime_history,
    )
    composite = sub_signals["composite_score"]

    # ── TF_DECAY_FULL_SUBSIGNALS: per-signal shadow/enforce logic ─────────
    # In both modes, classify each sub-signal as OK / WARNING / CRITICAL and log.
    # In ENFORCE mode, floor the composite to prevent critical signals being diluted.
    signals_detail = sub_signals.get("signals", {})
    warning_signals: list[str] = []
    critical_signals: list[str] = []

    for sig_name, warn_thresh in _SUBSIGNAL_WARNING_THRESHOLDS.items():
        sig_score = float(signals_detail.get(sig_name, {}).get("score", 0.0))
        crit_thresh = _SUBSIGNAL_CRITICAL_THRESHOLDS.get(sig_name, 999.0)
        if sig_score >= crit_thresh:
            critical_signals.append(sig_name)
        elif sig_score >= warn_thresh:
            warning_signals.append(sig_name)

    if critical_signals or warning_signals:
        logger.info(
            "decay sub-signal breakdown "
            "(TF_DECAY_FULL_SUBSIGNALS=%s): "
            "critical=%s warning=%s composite=%.1f",
            "ENFORCE" if _DECAY_FULL_SUBSIGNALS else "SHADOW",
            critical_signals,
            warning_signals,
            composite,
        )

    effective_composite = composite
    if _DECAY_FULL_SUBSIGNALS and critical_signals:
        # ENFORCE: floor composite to the minimum score that would trigger WATCH
        # (decay_score >= 30 for healthy→watch) when any sub-signal is CRITICAL.
        # We use 40.0 (WARN threshold in quarantine) so a single critical signal
        # can't hide in an otherwise healthy composite.
        floor_score = 40.0
        if effective_composite < floor_score:
            logger.info(
                "decay gate ENFORCE: composite %.1f floored to %.1f "
                "due to critical sub-signal(s): %s",
                effective_composite,
                floor_score,
                critical_signals,
            )
            effective_composite = floor_score

    # 3. Evaluate quarantine level transition
    # SHADOW: uses composite (existing behavior).
    # ENFORCE: uses effective_composite (may be floored by critical signals).
    quarantine = evaluate_quarantine(
        current_level=current_quarantine_level,
        decay_score=effective_composite,
        days_at_current_level=days_at_current_level,
        improving_days=improving_days,
    )

    new_level = quarantine["new_level"]
    size_multiplier = quarantine["size_multiplier"]

    # 4. Produce unified verdict
    # Use effective_composite for warn-threshold check so ENFORCE mode can
    # promote a verdict when a critical sub-signal was floored up.
    if new_level in (QuarantineLevel.QUARANTINE.value, QuarantineLevel.RETIRE.value):
        verdict = "fail"
        reason = (
            f"Decay gate FAIL: quarantine level={new_level}, "
            f"composite_score={effective_composite:.1f}, "
            f"size_multiplier={size_multiplier}"
        )
    elif new_level == QuarantineLevel.REDUCE.value or effective_composite >= 40:
        verdict = "warn"
        reason = (
            f"Decay gate WARN: quarantine level={new_level}, "
            f"composite_score={effective_composite:.1f}, "
            f"size_multiplier={size_multiplier}"
        )
    elif half_life.get("decay_detected", False) and half_life.get("trend") == "accelerating_decline":
        verdict = "warn"
        reason = (
            f"Decay gate WARN: accelerating decline detected, "
            f"half_life={half_life.get('half_life_days')} days, "
            f"composite_score={effective_composite:.1f}"
        )
    else:
        verdict = "pass"
        reason = (
            f"Decay gate PASS: quarantine level={new_level}, "
            f"composite_score={effective_composite:.1f}"
        )

    return {
        "verdict": verdict,
        "reason": reason,
        "size_multiplier": size_multiplier,
        # composite_score: the raw weighted composite (same as before in both modes).
        # Downstream consumers reading this field see IDENTICAL values in shadow mode.
        # In enforce mode, effective_composite may be higher if a critical signal fired.
        "composite_score": composite,
        # effective_composite_score: what was actually used for quarantine decisions.
        # In shadow mode, equals composite_score. In enforce mode, may be floored higher.
        "effective_composite_score": effective_composite,
        "full_subsignals_enforced": _DECAY_FULL_SUBSIGNALS,
        "critical_signals": critical_signals,
        "warning_signals": warning_signals,
        "half_life": half_life,
        "quarantine": quarantine,
        "sub_signals": sub_signals,
    }
