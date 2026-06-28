"""
4-level auto-quarantine system for decaying strategies.
Escalates based on composite decay score and duration.
"""

from enum import Enum

from .half_life import _within_grace_period


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
    promoted_at=None,
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
    # F-2: freshly-promoted strategies are immune to quarantine escalation.
    # A strategy that was just promoted to DEPLOYED has not yet accumulated
    # enough live P&L for decay signals to be meaningful. Short-circuit here
    # to prevent premature quarantine escalation. DECAY_GRACE_DAYS is
    # configurable via env var (default 14). Recovery transitions are still
    # evaluated so a grace-period strategy can de-escalate if currently at Watch.
    if _within_grace_period(promoted_at):
        try:
            level = QuarantineLevel(current_level.lower())
        except ValueError:
            level = QuarantineLevel.HEALTHY
        multiplier = SIZE_MULTIPLIERS.get(level, 1.0)
        return {
            "current_level": level.value,
            "new_level": level.value,
            "changed": False,
            "reason": "Grace period active — decay escalation suppressed for freshly-promoted strategy",
            "size_multiplier": multiplier,
            "recommendation": "Strategy is within grace period. Normal operation.",
            "_grace_period_active": True,
        }

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


if __name__ == "__main__":
    import argparse
    import json
    import sys

    _parser = argparse.ArgumentParser(description="Quarantine evaluation CLI")
    _parser.add_argument("--config", required=True, help="Path to JSON config file")
    _args = _parser.parse_args()

    try:
        with open(_args.config) as _f:
            _cfg = json.load(_f)
    except Exception as _e:
        print(json.dumps({"error": f"Failed to read config: {_e}"}))
        sys.exit(1)

    _action = _cfg.get("action", "")

    if _action == "evaluate":
        # Route: POST /api/decay/quarantine/evaluate
        # Config keys: current_level, decay_score, days_at_current_level, improving_days,
        #              promoted_at (ISO string or null — B3 fix).
        # B3 fix: pass promoted_at so _within_grace_period() can protect newly
        # promoted strategies from immediate quarantine escalation.
        try:
            _result = evaluate_quarantine(
                current_level=str(_cfg.get("current_level", "healthy")),
                decay_score=float(_cfg.get("decay_score", 0)),
                days_at_current_level=int(_cfg.get("days_at_current_level", 0)),
                improving_days=int(_cfg.get("improving_days", 0)),
                promoted_at=_cfg.get("promoted_at"),
            )
            print(json.dumps(_result))
        except Exception as _e:
            print(json.dumps({"error": f"evaluate_quarantine failed: {_e}"}))
            sys.exit(1)

    else:
        # Fail-closed: unknown action → error JSON + non-zero exit; NEVER empty stdout.
        print(json.dumps({
            "error": f"Unknown quarantine action: {_action!r}",
            "valid_actions": ["evaluate"],
        }))
        sys.exit(1)
