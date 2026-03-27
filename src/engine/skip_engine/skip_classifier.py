"""
Skip Engine — Pre-session classifier.
Evaluates 10 signals before market open. Decision: TRADE | REDUCE | SKIP.

The 10 Skip Signals:
1. FOMC/CPI/NFP proximity (±30 min = SIT_OUT)
2. VIX level (>30 = SKIP, 25-30 = REDUCE)
3. Overnight gap size (>1.5 ATR = SKIP)
4. Pre-market volume anomaly (< 30% normal = SKIP)
5. Day-of-week filter (historically bad days for strategy)
6. Consecutive loss streak (>3 days = REDUCE, >5 = SKIP)
7. Monthly P&L vs drawdown budget (>60% used = REDUCE, >80% = SKIP)
8. Correlation spike (portfolio strategies correlated >0.7 today = REDUCE)
9. Calendar filter (holiday, triple witching, roll week)
10. QUBO timing (experimental — penalize blocks optimizer says to skip)
"""

from __future__ import annotations

from typing import Any

# Signal weights for scoring
SIGNAL_WEIGHTS: dict[str, float] = {
    "event_proximity": 3.0,      # Highest weight — FOMC/CPI can blow up any edge
    "vix_level": 2.5,
    "overnight_gap": 2.0,
    "premarket_volume": 1.5,
    "day_of_week": 1.0,
    "loss_streak": 2.0,
    "monthly_budget": 2.5,
    "correlation_spike": 1.5,
    "calendar_filter": 2.0,
    "qubo_timing": 1.5,
}

# Thresholds
SKIP_SCORE_THRESHOLD = 6.0     # Total weighted score >= this → SKIP
REDUCE_SCORE_THRESHOLD = 3.0   # Total weighted score >= this → REDUCE


# ─── Individual Signal Scorers ────────────────────────────────────


def _score_event_proximity(signals: dict[str, Any]) -> float:
    """
    Event proximity scorer.
    Same-day high-impact → 3.0 (auto-SKIP). 1 day away → 1.5. 2+ days → 0.
    """
    event_info = signals.get("event_proximity")
    if not event_info:
        return 0.0

    days_until = event_info.get("days_until")
    impact = event_info.get("impact", "low")

    if days_until is None:
        return 0.0

    # Only high-impact events trigger the skip
    if impact != "high":
        return 0.0

    if days_until == 0:
        return 3.0  # Auto-SKIP — same day
    elif days_until == 1:
        return 1.5
    else:
        return 0.0


def _score_vix_level(signals: dict[str, Any]) -> float:
    """VIX level scorer. >30 → 2.5, 25-30 → 1.5, 20-25 → 0.5, <20 → 0."""
    vix = signals.get("vix")
    if vix is None:
        return 0.0

    if vix > 30:
        return 2.5
    elif vix > 25:
        return 1.5
    elif vix > 20:
        return 0.5
    else:
        return 0.0


def _score_overnight_gap(signals: dict[str, Any]) -> float:
    """Overnight gap scorer. >1.5 ATR → 2.0, 1.0-1.5 → 1.0, <1.0 → 0."""
    gap_atr = signals.get("overnight_gap_atr")
    if gap_atr is None:
        return 0.0

    if gap_atr > 1.5:
        return 2.0
    elif gap_atr > 1.0:
        return 1.0
    else:
        return 0.0


def _score_premarket_volume(signals: dict[str, Any]) -> float:
    """Pre-market volume scorer. <30% → 1.5, 30-50% → 0.75, >50% → 0."""
    vol_pct = signals.get("premarket_volume_pct")
    if vol_pct is None:
        return 0.0

    if vol_pct < 0.30:
        return 1.5
    elif vol_pct < 0.50:
        return 0.75
    else:
        return 0.0


def _score_day_of_week(
    signals: dict[str, Any],
    strategy_id: str | None = None,
) -> float:
    """
    Day-of-week scorer. Configurable per strategy.
    Some strategies lose on Mondays/Fridays.
    Uses 'bad_days' list in signals if provided, otherwise returns 0.
    """
    day = signals.get("day_of_week")
    bad_days = signals.get("bad_days", [])

    if day is None or not bad_days:
        return 0.0

    if day in bad_days:
        return 1.0
    return 0.0


def _score_loss_streak(signals: dict[str, Any]) -> float:
    """Loss streak scorer. >5 → 2.0, 3-5 → 1.0, <3 → 0."""
    streak = signals.get("consecutive_losses")
    if streak is None:
        return 0.0

    if streak > 5:
        return 2.0
    elif streak >= 3:
        return 1.0
    else:
        return 0.0


def _score_monthly_budget(signals: dict[str, Any]) -> float:
    """Monthly DD budget scorer. >80% used → 2.5, 60-80% → 1.25, <60% → 0."""
    usage = signals.get("monthly_dd_usage_pct")
    if usage is None:
        return 0.0

    if usage > 0.80:
        return 2.5
    elif usage > 0.60:
        return 1.25
    else:
        return 0.0


def _score_correlation_spike(signals: dict[str, Any]) -> float:
    """Correlation spike scorer. >0.7 → 1.5, 0.5-0.7 → 0.75, <0.5 → 0."""
    corr = signals.get("portfolio_correlation")
    if corr is None:
        return 0.0

    if corr > 0.7:
        return 1.5
    elif corr > 0.5:
        return 0.75
    else:
        return 0.0


def _score_calendar_filter(signals: dict[str, Any]) -> float:
    """
    Calendar filter scorer. Additive:
    Holiday adjacent → 1.0, triple witching → 1.0, roll week → 0.5.
    """
    cal = signals.get("calendar")
    if not cal:
        return 0.0

    score = 0.0

    # Holiday proximity (0 = today is holiday or adjacent)
    holiday_prox = cal.get("holiday_proximity")
    if holiday_prox is not None and holiday_prox <= 1:
        score += 1.0

    if cal.get("triple_witching", False):
        score += 1.0

    if cal.get("roll_week", False):
        score += 0.5

    return score


def _score_qubo_timing(signals: dict[str, Any]) -> float:
    """
    QUBO timing signal — if a QUBO timing schedule exists for this session,
    penalize trading during blocks the optimizer says to skip.

    Expects signals["qubo_timing"] = {"current_block_trade": bool, "schedule_active": bool}
    """
    qubo = signals.get("qubo_timing")
    if not qubo or not qubo.get("schedule_active"):
        return 0.0

    if not qubo.get("current_block_trade", True):
        return 1.0  # Moderate penalty — QUBO says skip this time block

    return 0.0


# ─── Main Classifier ──────────────────────────────────────────────


def classify_session(
    signals: dict[str, Any],
    strategy_id: str | None = None,
) -> dict[str, Any]:
    """
    Main classification function. Takes pre-collected signals, returns decision.

    Args:
        signals: {
            "event_proximity": {"event": "FOMC", "days_until": 0, "impact": "high"},
            "vix": 28.5,
            "overnight_gap_atr": 1.8,
            "premarket_volume_pct": 0.45,  # 45% of normal
            "day_of_week": "Friday",
            "consecutive_losses": 4,
            "monthly_dd_usage_pct": 0.65,  # 65% of drawdown budget used
            "portfolio_correlation": 0.5,
            "calendar": {"holiday_proximity": 0, "triple_witching": False, "roll_week": False},
        }
        strategy_id: Optional strategy identifier for strategy-specific rules.

    Returns:
        {
            "decision": "TRADE" | "REDUCE" | "SKIP",
            "score": float,
            "signal_scores": {signal_name: individual_score},
            "triggered_signals": [list of signals that contributed],
            "reason": str,  # Human-readable explanation
            "confidence": float,  # 0-1
            "override_allowed": bool,  # True for REDUCE, False for SKIP on FOMC day
        }
    """
    # Score each signal
    signal_scores: dict[str, float] = {
        "event_proximity": _score_event_proximity(signals),
        "vix_level": _score_vix_level(signals),
        "overnight_gap": _score_overnight_gap(signals),
        "premarket_volume": _score_premarket_volume(signals),
        "day_of_week": _score_day_of_week(signals, strategy_id),
        "loss_streak": _score_loss_streak(signals),
        "monthly_budget": _score_monthly_budget(signals),
        "correlation_spike": _score_correlation_spike(signals),
        "calendar_filter": _score_calendar_filter(signals),
        "qubo_timing": _score_qubo_timing(signals),
    }

    # Total weighted score
    total_score = sum(signal_scores.values())

    # Determine which signals triggered (non-zero)
    triggered = [name for name, score in signal_scores.items() if score > 0]

    # Decision logic
    # Special case: FOMC/CPI/NFP same-day = hard SKIP, no override
    event_info = signals.get("event_proximity")
    is_same_day_high_impact = (
        event_info
        and event_info.get("days_until") == 0
        and event_info.get("impact") == "high"
    )

    if is_same_day_high_impact:
        decision = "SKIP"
        override_allowed = False
    elif total_score >= SKIP_SCORE_THRESHOLD:
        decision = "SKIP"
        override_allowed = True
    elif total_score >= REDUCE_SCORE_THRESHOLD:
        decision = "REDUCE"
        override_allowed = True
    else:
        decision = "TRADE"
        override_allowed = True

    # Confidence: how far above or below thresholds
    if decision == "SKIP":
        confidence = min(1.0, total_score / (SKIP_SCORE_THRESHOLD * 1.5))
    elif decision == "REDUCE":
        confidence = min(
            1.0,
            (total_score - REDUCE_SCORE_THRESHOLD)
            / (SKIP_SCORE_THRESHOLD - REDUCE_SCORE_THRESHOLD),
        )
    else:
        # TRADE confidence inversely related to score
        confidence = max(0.0, 1.0 - total_score / REDUCE_SCORE_THRESHOLD)

    # Build human-readable reason
    reason_parts: list[str] = []
    if signal_scores["event_proximity"] > 0:
        event_name = event_info.get("event", "event") if event_info else "event"
        reason_parts.append(f"{event_name} proximity")
    if signal_scores["vix_level"] > 0:
        reason_parts.append(f"VIX elevated ({signals.get('vix', '?')})")
    if signal_scores["overnight_gap"] > 0:
        reason_parts.append(
            f"overnight gap {signals.get('overnight_gap_atr', '?')} ATR"
        )
    if signal_scores["premarket_volume"] > 0:
        reason_parts.append("low pre-market volume")
    if signal_scores["day_of_week"] > 0:
        reason_parts.append(f"historically bad day ({signals.get('day_of_week')})")
    if signal_scores["loss_streak"] > 0:
        reason_parts.append(
            f"{signals.get('consecutive_losses', '?')} consecutive losses"
        )
    if signal_scores["monthly_budget"] > 0:
        usage_pct = signals.get("monthly_dd_usage_pct", 0)
        reason_parts.append(f"DD budget {usage_pct:.0%} used")
    if signal_scores["correlation_spike"] > 0:
        reason_parts.append("portfolio correlation spike")
    if signal_scores["calendar_filter"] > 0:
        reason_parts.append("calendar filter (holiday/witching/roll)")
    if signal_scores["qubo_timing"] > 0:
        reason_parts.append("QUBO timing (skip block)")

    reason = (
        f"{decision}: " + ", ".join(reason_parts)
        if reason_parts
        else f"{decision}: all signals clear"
    )

    return {
        "decision": decision,
        "score": round(total_score, 2),
        "signal_scores": {k: round(v, 2) for k, v in signal_scores.items()},
        "triggered_signals": triggered,
        "reason": reason,
        "confidence": round(confidence, 3),
        "override_allowed": override_allowed,
    }
