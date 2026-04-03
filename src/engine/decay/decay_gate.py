"""
Decay gate — single pass/fail/warn decision combining half_life, quarantine, and sub_signals.

This is the top-level entry point for the decay subsystem. It runs all three
modules and returns a unified verdict that the paper engine or governor can act on.
"""

from __future__ import annotations

from .half_life import fit_decay
from .quarantine import evaluate_quarantine, QuarantineLevel, SIZE_MULTIPLIERS
from .sub_signals import composite_decay_score


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

    # 3. Evaluate quarantine level transition
    quarantine = evaluate_quarantine(
        current_level=current_quarantine_level,
        decay_score=composite,
        days_at_current_level=days_at_current_level,
        improving_days=improving_days,
    )

    new_level = quarantine["new_level"]
    size_multiplier = quarantine["size_multiplier"]

    # 4. Produce unified verdict
    if new_level in (QuarantineLevel.QUARANTINE.value, QuarantineLevel.RETIRE.value):
        verdict = "fail"
        reason = (
            f"Decay gate FAIL: quarantine level={new_level}, "
            f"composite_score={composite:.1f}, "
            f"size_multiplier={size_multiplier}"
        )
    elif new_level == QuarantineLevel.REDUCE.value or composite >= 40:
        verdict = "warn"
        reason = (
            f"Decay gate WARN: quarantine level={new_level}, "
            f"composite_score={composite:.1f}, "
            f"size_multiplier={size_multiplier}"
        )
    elif half_life.get("decay_detected", False) and half_life.get("trend") == "accelerating_decline":
        verdict = "warn"
        reason = (
            f"Decay gate WARN: accelerating decline detected, "
            f"half_life={half_life.get('half_life_days')} days, "
            f"composite_score={composite:.1f}"
        )
    else:
        verdict = "pass"
        reason = (
            f"Decay gate PASS: quarantine level={new_level}, "
            f"composite_score={composite:.1f}"
        )

    return {
        "verdict": verdict,
        "reason": reason,
        "size_multiplier": size_multiplier,
        "composite_score": composite,
        "half_life": half_life,
        "quarantine": quarantine,
        "sub_signals": sub_signals,
    }
