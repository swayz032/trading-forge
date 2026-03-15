"""
4-level auto-quarantine system for decaying strategies.
Escalates based on composite decay score and duration.
"""

from enum import Enum


class QuarantineLevel(str, Enum):
    HEALTHY = "healthy"
    WATCH = "watch"
    REDUCE = "reduce"
    QUARANTINE = "quarantine"
    RETIRE = "retire"


# Transition thresholds
TRANSITIONS = {
    "healthy_to_watch": {"decay_score": 30, "min_days": 5},
    "watch_to_reduce": {"decay_score": 50, "min_days": 10},
    "reduce_to_quarantine": {"decay_score": 70, "min_days": 15},
    "quarantine_to_retire": {"decay_score": 80, "min_days": 30},
    # Recovery transitions
    "watch_to_healthy": {"decay_score": 20, "min_improving_days": 10},
    "reduce_to_watch": {"decay_score": 35, "min_improving_days": 15},
    "quarantine_to_reduce": {"decay_score": 50, "min_improving_days": 20},
}

# Size multipliers per level
SIZE_MULTIPLIERS = {
    QuarantineLevel.HEALTHY: 1.0,
    QuarantineLevel.WATCH: 1.0,
    QuarantineLevel.REDUCE: 0.5,
    QuarantineLevel.QUARANTINE: 0.0,
    QuarantineLevel.RETIRE: 0.0,
}

# Ordered levels for escalation/recovery logic
_LEVEL_ORDER = [
    QuarantineLevel.HEALTHY,
    QuarantineLevel.WATCH,
    QuarantineLevel.REDUCE,
    QuarantineLevel.QUARANTINE,
    QuarantineLevel.RETIRE,
]


def evaluate_quarantine(
    current_level: str,
    decay_score: float,
    days_at_current_level: int,
    improving_days: int = 0,
) -> dict:
    """
    Evaluate whether quarantine level should change.

    Returns:
        {
            "current_level": str,
            "new_level": str,
            "changed": bool,
            "reason": str,
            "size_multiplier": float,
            "recommendation": str,
        }
    """
    try:
        level = QuarantineLevel(current_level.lower())
    except ValueError:
        level = QuarantineLevel.HEALTHY

    new_level = level
    reason = "No change warranted"

    # --- Check escalation ---
    escalation_key = _escalation_key(level)
    if escalation_key and escalation_key in TRANSITIONS:
        rule = TRANSITIONS[escalation_key]
        if (
            decay_score >= rule["decay_score"]
            and days_at_current_level >= rule["min_days"]
        ):
            new_level = _next_level(level)
            reason = (
                f"Decay score {decay_score:.1f} >= {rule['decay_score']} "
                f"for {days_at_current_level} days (min {rule['min_days']})"
            )

    # --- Check recovery (only if no escalation happened) ---
    if new_level == level:
        recovery_key = _recovery_key(level)
        if recovery_key and recovery_key in TRANSITIONS:
            rule = TRANSITIONS[recovery_key]
            min_improving = rule.get("min_improving_days", 0)
            if (
                decay_score <= rule["decay_score"]
                and improving_days >= min_improving
            ):
                new_level = _prev_level(level)
                reason = (
                    f"Decay score {decay_score:.1f} <= {rule['decay_score']} "
                    f"with {improving_days} improving days (min {min_improving})"
                )

    changed = new_level != level
    multiplier = SIZE_MULTIPLIERS.get(new_level, 1.0)

    # Build recommendation
    if new_level == QuarantineLevel.RETIRE:
        recommendation = "Strategy should be permanently retired and added to graveyard"
    elif new_level == QuarantineLevel.QUARANTINE:
        recommendation = "Stop all trading. Monitor for recovery signals."
    elif new_level == QuarantineLevel.REDUCE:
        recommendation = "Reduce position size to 50%. Close monitoring required."
    elif new_level == QuarantineLevel.WATCH:
        recommendation = "Continue trading at full size. Monitor decay signals daily."
    else:
        recommendation = "Strategy is healthy. Normal operation."

    return {
        "current_level": level.value,
        "new_level": new_level.value,
        "changed": changed,
        "reason": reason,
        "size_multiplier": multiplier,
        "recommendation": recommendation,
    }


def _escalation_key(level: QuarantineLevel) -> str | None:
    mapping = {
        QuarantineLevel.HEALTHY: "healthy_to_watch",
        QuarantineLevel.WATCH: "watch_to_reduce",
        QuarantineLevel.REDUCE: "reduce_to_quarantine",
        QuarantineLevel.QUARANTINE: "quarantine_to_retire",
    }
    return mapping.get(level)


def _recovery_key(level: QuarantineLevel) -> str | None:
    mapping = {
        QuarantineLevel.WATCH: "watch_to_healthy",
        QuarantineLevel.REDUCE: "reduce_to_watch",
        QuarantineLevel.QUARANTINE: "quarantine_to_reduce",
    }
    return mapping.get(level)


def _next_level(level: QuarantineLevel) -> QuarantineLevel:
    idx = _LEVEL_ORDER.index(level)
    if idx < len(_LEVEL_ORDER) - 1:
        return _LEVEL_ORDER[idx + 1]
    return level


def _prev_level(level: QuarantineLevel) -> QuarantineLevel:
    idx = _LEVEL_ORDER.index(level)
    if idx > 0:
        return _LEVEL_ORDER[idx - 1]
    return level
