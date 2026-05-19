"""
Regime-aware anti-setup filter.

Checks if the current market regime matches known anti-setup patterns for a
strategy. Unlike the generic filter_gate (which checks individual trade context),
this module works at the regime level: if the current regime is one where the
strategy historically fails, it blocks all entries regardless of other conditions.

Uses mined anti-setup data from the miner module (condition="regime") and
enriches it with regime persistence and transition awareness.
"""

from __future__ import annotations

from typing import Any


# Known regime labels used by the bias engine (ADX + ATR percentile classification)
VALID_REGIMES = {"TREND_UP", "TREND_DOWN", "RANGE", "VOLATILE", "QUIET", "TRANSITION"}


def check_regime_anti_setup(
    strategy_id: str,
    current_regime: str,
    anti_setups: list[dict],
    regime_history: list[dict] | None = None,
    min_confidence: float = 0.75,
    min_persistence_periods: int = 3,
) -> dict:
    """
    Check if the current regime is a known anti-setup for this strategy.

    Args:
        strategy_id: Strategy identifier (for logging/audit).
        current_regime: Current market regime label.
        anti_setups: List of mined anti-setups (from miner.mine_anti_setups).
        regime_history: Recent regime observations, newest last.
            Each entry: {"regime": str, "timestamp": str, ...}
        min_confidence: Minimum confidence to act on a regime anti-setup.
        min_persistence_periods: How many consecutive periods the regime must
            persist before triggering the filter (avoids whipsawing on
            single-bar regime transitions).

    Returns:
        {
            "filter": bool,           # True = BLOCK entries in this regime
            "verdict": "pass" | "warn" | "block",
            "reason": str,
            "current_regime": str,
            "matched_anti_setup": dict | None,
            "regime_persistence": int, # consecutive periods in current regime
            "recommendation": str,
        }
    """
    current_upper = current_regime.upper().strip()

    # Extract regime-type anti-setups only
    regime_antis = [
        a for a in anti_setups
        if a.get("condition") == "regime"
        and a.get("confidence", 0) >= min_confidence
    ]

    if not regime_antis:
        return _result(
            filter_trade=False,
            verdict="pass",
            reason="No regime anti-setups found for this strategy",
            current_regime=current_upper,
            matched=None,
            persistence=0,
            recommendation="Normal operation. No regime-based restrictions.",
        )

    # Check if current regime matches any anti-setup
    matched: dict | None = None
    for anti in regime_antis:
        anti_regime = str(anti.get("filter", {}).get("regime", "")).upper().strip()
        if anti_regime == current_upper:
            # Pick the one with highest failure rate
            if matched is None or anti.get("failure_rate", 0) > matched.get("failure_rate", 0):
                matched = anti

    if matched is None:
        return _result(
            filter_trade=False,
            verdict="pass",
            reason=f"Current regime '{current_upper}' is not an anti-setup for this strategy",
            current_regime=current_upper,
            matched=None,
            persistence=0,
            recommendation="Normal operation.",
        )

    # Regime matches an anti-setup -- check persistence before blocking
    persistence = _count_regime_persistence(current_upper, regime_history)

    if persistence < min_persistence_periods:
        return _result(
            filter_trade=False,
            verdict="warn",
            reason=(
                f"Regime '{current_upper}' is a known anti-setup "
                f"(failure_rate={matched.get('failure_rate', 0):.1%}) but has only "
                f"persisted {persistence}/{min_persistence_periods} periods. Watching."
            ),
            current_regime=current_upper,
            matched=matched,
            persistence=persistence,
            recommendation=(
                f"Monitor closely. If regime persists {min_persistence_periods - persistence} "
                f"more period(s), entries will be blocked."
            ),
        )

    # Persistent anti-setup regime -- block
    failure_rate = matched.get("failure_rate", 0)
    sample_size = matched.get("sample_size", 0)

    return _result(
        filter_trade=True,
        verdict="block",
        reason=(
            f"BLOCKED: Regime '{current_upper}' is a confirmed anti-setup for strategy "
            f"'{strategy_id}'. Historical failure_rate={failure_rate:.1%} over "
            f"{sample_size} trades. Regime has persisted {persistence} periods."
        ),
        current_regime=current_upper,
        matched=matched,
        persistence=persistence,
        recommendation=(
            f"Do not enter trades. Wait for regime transition out of '{current_upper}'. "
            f"Resume when regime changes and persists for {min_persistence_periods} periods."
        ),
    )


def _count_regime_persistence(
    current_regime: str,
    regime_history: list[dict] | None,
) -> int:
    """Count consecutive periods at the end of history matching current_regime."""
    if not regime_history:
        return 1  # Current observation counts as 1

    count = 0
    for entry in reversed(regime_history):
        if str(entry.get("regime", "")).upper().strip() == current_regime:
            count += 1
        else:
            break

    return max(count, 1)  # At least 1 (the current observation)


def _result(
    filter_trade: bool,
    verdict: str,
    reason: str,
    current_regime: str,
    matched: dict | None,
    persistence: int,
    recommendation: str,
) -> dict:
    return {
        "filter": filter_trade,
        "verdict": verdict,
        "reason": reason,
        "current_regime": current_regime,
        "matched_anti_setup": matched,
        "regime_persistence": persistence,
        "recommendation": recommendation,
    }
