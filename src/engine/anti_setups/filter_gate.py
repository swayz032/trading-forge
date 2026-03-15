"""Real-time anti-setup filter — blocks trades that match known anti-conditions."""

from __future__ import annotations

from typing import Any


def should_filter(
    trade_context: dict,
    anti_setups: list[dict],
    confidence_threshold: float = 0.80,
) -> dict:
    """
    Check if current trade context matches any active anti-setup.

    Returns:
        {
            "filter": bool,       # True = BLOCK this trade
            "matched_conditions": [...],
            "strongest_match": dict | None,
            "confidence": float,
        }
    """
    matched: list[dict] = []

    for anti in anti_setups:
        if anti.get("confidence", 0) < confidence_threshold:
            continue

        condition = anti.get("condition", "")
        filt = anti.get("filter", {})

        if _matches_condition(trade_context, condition, filt):
            matched.append(anti)

    if not matched:
        return {
            "filter": False,
            "matched_conditions": [],
            "strongest_match": None,
            "confidence": 0.0,
        }

    strongest = max(matched, key=lambda x: x.get("failure_rate", 0))

    return {
        "filter": True,
        "matched_conditions": matched,
        "strongest_match": strongest,
        "confidence": strongest.get("confidence", 0.0),
    }


def _matches_condition(context: dict, condition: str, filt: dict) -> bool:
    """Check if trade context matches a single anti-setup condition."""
    if condition == "time_of_day":
        hour = context.get("hour")
        if hour is None:
            # Try to extract from time field
            time_val = context.get("time", "")
            if time_val and "T" in str(time_val):
                try:
                    hour = int(str(time_val).split("T")[1].split(":")[0])
                except (ValueError, IndexError):
                    return False
            else:
                return False
        return filt.get("hour_start", 0) <= hour < filt.get("hour_end", 24)

    elif condition == "volatility":
        atr = context.get("atr")
        if atr is None:
            return False
        atr_mean = filt.get("atr_mean", 0)
        if atr_mean == 0:
            return False
        lo_mult = filt.get("atr_min_multiplier")
        hi_mult = filt.get("atr_max_multiplier")
        if lo_mult is not None and atr < atr_mean * lo_mult:
            return False
        if hi_mult is not None and atr > atr_mean * hi_mult:
            return False
        return True

    elif condition == "volume":
        volume = context.get("volume")
        if volume is None:
            return False
        vol_condition = filt.get("volume_condition", "")
        if vol_condition == "below_average":
            return volume < filt.get("volume_mean", float("inf"))
        elif vol_condition == "very_low":
            return volume < filt.get("volume_threshold", float("inf"))
        return False

    elif condition == "day_of_week":
        dow = context.get("day_of_week")
        if dow is None:
            return False
        return dow == filt.get("day")

    elif condition == "regime":
        regime = context.get("regime")
        if regime is None:
            return False
        return str(regime) == filt.get("regime")

    elif condition == "archetype":
        archetype = context.get("archetype")
        if archetype is None:
            return False
        return str(archetype) == filt.get("archetype")

    elif condition == "event_proximity":
        days_to_event = context.get("days_to_event")
        if days_to_event is None:
            return False
        return days_to_event <= filt.get("max_days_to_event", 0)

    elif condition == "streak":
        streak = context.get("streak")
        if streak is None:
            return False
        label = filt.get("streak_label", "")
        # Match "after_N_wins" or "after_N_losses"
        if "wins" in label:
            try:
                n = int(label.split("_")[1])
                return streak >= n and context.get("streak_type") == "win"
            except (ValueError, IndexError):
                return False
        elif "losses" in label:
            try:
                n = int(label.split("_")[1])
                return streak >= n and context.get("streak_type") == "loss"
            except (ValueError, IndexError):
                return False

    return False
