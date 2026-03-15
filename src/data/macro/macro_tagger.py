"""
Macro Tagger -- overlay macro regime on price bars.
Each bar gets tagged with the prevailing macro environment.
"""

from __future__ import annotations

from typing import Any

# ─── Valid macro regime names ────────────────────────────────────
VALID_MACRO_REGIMES = {
    "RISK_ON", "RISK_OFF", "TIGHTENING", "EASING",
    "STAGFLATION", "GOLDILOCKS", "TRANSITION",
}

# ─── Macro regime definitions ───────────────────────────────────
MACRO_REGIMES = {
    "RISK_ON": {
        "description": "Low VIX, rising equities, tight spreads",
        "conditions": {
            "vix": "<= 18",
            "yield_spread_10y2y": "> 0",
            "trend": "up",
        },
    },
    "RISK_OFF": {
        "description": "High VIX, falling equities, wide spreads",
        "conditions": {
            "vix": "> 25",
            "trend": "down",
        },
    },
    "TIGHTENING": {
        "description": "Rising rates, hawkish Fed",
        "conditions": {
            "fed_funds_trend": "rising",
            "treasury_2y_trend": "rising",
        },
    },
    "EASING": {
        "description": "Falling rates, dovish Fed",
        "conditions": {
            "fed_funds_trend": "falling",
            "treasury_2y_trend": "falling",
        },
    },
    "STAGFLATION": {
        "description": "Rising CPI + rising unemployment",
        "conditions": {
            "cpi_trend": "rising",
            "unemployment_trend": "rising",
        },
    },
    "GOLDILOCKS": {
        "description": "Falling CPI + low unemployment + moderate growth",
        "conditions": {
            "cpi_trend": "falling",
            "unemployment": "< 5.0",
            "vix": "< 20",
        },
    },
    "TRANSITION": {
        "description": "Mixed signals, regime change in progress",
    },
}


def _check_threshold(value: float | None, condition: str) -> bool:
    """
    Evaluate a threshold condition like "<= 18", "> 25", "< 5.0".
    Returns False if value is None.
    """
    if value is None:
        return False

    condition = condition.strip()
    if condition.startswith("<="):
        return value <= float(condition[2:].strip())
    elif condition.startswith(">="):
        return value >= float(condition[2:].strip())
    elif condition.startswith("<"):
        return value < float(condition[1:].strip())
    elif condition.startswith(">"):
        return value > float(condition[1:].strip())
    elif condition.startswith("=="):
        return value == float(condition[2:].strip())
    return False


def _detect_trend(values: list[float], window: int = 3) -> str:
    """
    Detect trend from a list of recent values.
    Returns "rising", "falling", or "flat".
    """
    if len(values) < 2:
        return "flat"
    recent = values[-window:] if len(values) >= window else values
    if len(recent) < 2:
        return "flat"
    diff = recent[-1] - recent[0]
    threshold = abs(recent[0]) * 0.01 if recent[0] != 0 else 0.01
    if diff > threshold:
        return "rising"
    elif diff < -threshold:
        return "falling"
    return "flat"


def classify_macro_regime(snapshot: dict[str, float | None]) -> dict[str, Any]:
    """
    Classify current macro regime from a snapshot of indicator values.

    Args:
        snapshot: Dict of indicator values, e.g.:
            {
                "vix": 16.5,
                "fed_funds_rate": 5.25,
                "treasury_10y": 4.3,
                "treasury_2y": 4.7,
                "yield_spread_10y2y": -0.4,
                "cpi_yoy": 3.2,
                "unemployment": 3.9,
                "fed_funds_trend": "rising",  # or provide recent values list
                "treasury_2y_trend": "rising",
                "cpi_trend": "falling",
                "unemployment_trend": "flat",
                "trend": "up",  # equity market trend
            }

    Returns:
        {
            "regime": str,
            "confidence": float (0-1),
            "signals": dict,
            "secondary_regime": str | None,
        }
    """
    scores: dict[str, dict[str, Any]] = {}

    # --- RISK_ON ---
    risk_on_signals: dict[str, bool] = {}
    risk_on_signals["low_vix"] = _check_threshold(snapshot.get("vix"), "<= 18")
    risk_on_signals["positive_spread"] = _check_threshold(
        snapshot.get("yield_spread_10y2y"), "> 0"
    )
    risk_on_signals["trend_up"] = snapshot.get("trend") == "up"
    matched = sum(risk_on_signals.values())
    scores["RISK_ON"] = {
        "score": matched / max(len(risk_on_signals), 1),
        "signals": risk_on_signals,
    }

    # --- RISK_OFF ---
    risk_off_signals: dict[str, bool] = {}
    risk_off_signals["high_vix"] = _check_threshold(snapshot.get("vix"), "> 25")
    risk_off_signals["trend_down"] = snapshot.get("trend") == "down"
    matched = sum(risk_off_signals.values())
    scores["RISK_OFF"] = {
        "score": matched / max(len(risk_off_signals), 1),
        "signals": risk_off_signals,
    }

    # --- TIGHTENING ---
    tight_signals: dict[str, bool] = {}
    tight_signals["fed_funds_rising"] = snapshot.get("fed_funds_trend") == "rising"
    tight_signals["treasury_2y_rising"] = snapshot.get("treasury_2y_trend") == "rising"
    matched = sum(tight_signals.values())
    scores["TIGHTENING"] = {
        "score": matched / max(len(tight_signals), 1),
        "signals": tight_signals,
    }

    # --- EASING ---
    ease_signals: dict[str, bool] = {}
    ease_signals["fed_funds_falling"] = snapshot.get("fed_funds_trend") == "falling"
    ease_signals["treasury_2y_falling"] = snapshot.get("treasury_2y_trend") == "falling"
    matched = sum(ease_signals.values())
    scores["EASING"] = {
        "score": matched / max(len(ease_signals), 1),
        "signals": ease_signals,
    }

    # --- STAGFLATION ---
    stag_signals: dict[str, bool] = {}
    stag_signals["cpi_rising"] = snapshot.get("cpi_trend") == "rising"
    stag_signals["unemployment_rising"] = snapshot.get("unemployment_trend") == "rising"
    matched = sum(stag_signals.values())
    scores["STAGFLATION"] = {
        "score": matched / max(len(stag_signals), 1),
        "signals": stag_signals,
    }

    # --- GOLDILOCKS ---
    goldi_signals: dict[str, bool] = {}
    goldi_signals["cpi_falling"] = snapshot.get("cpi_trend") == "falling"
    goldi_signals["low_unemployment"] = _check_threshold(
        snapshot.get("unemployment"), "< 5.0"
    )
    goldi_signals["moderate_vix"] = _check_threshold(snapshot.get("vix"), "< 20")
    matched = sum(goldi_signals.values())
    scores["GOLDILOCKS"] = {
        "score": matched / max(len(goldi_signals), 1),
        "signals": goldi_signals,
    }

    # Find top two regimes by score
    ranked = sorted(scores.items(), key=lambda x: x[1]["score"], reverse=True)
    best_regime = ranked[0][0]
    best_score = ranked[0][1]["score"]
    best_signals = ranked[0][1]["signals"]

    secondary = ranked[1][0] if len(ranked) > 1 else None
    secondary_score = ranked[1][1]["score"] if len(ranked) > 1 else 0.0

    # If best score is too low or too close to second, it's TRANSITION
    if best_score < 0.5:
        regime = "TRANSITION"
        confidence = best_score
    elif best_score - secondary_score < 0.15 and best_score < 0.8:
        regime = "TRANSITION"
        confidence = best_score * 0.5
    else:
        regime = best_regime
        confidence = best_score

    return {
        "regime": regime,
        "confidence": round(min(max(confidence, 0.0), 1.0), 4),
        "signals": best_signals,
        "secondary_regime": secondary if regime != "TRANSITION" else best_regime,
    }


def tag_bars(
    bars: list[dict],
    macro_snapshots: list[dict],
) -> list[dict]:
    """
    Tag each price bar with its corresponding macro regime.
    Joins on date -- each bar gets the most recent macro snapshot <= bar date.

    Args:
        bars: List of price bar dicts. Must have a "date" key (YYYY-MM-DD str or
              "timestamp" key).
        macro_snapshots: List of dicts with "date" (YYYY-MM-DD) and at least the
              fields needed by classify_macro_regime.

    Returns:
        Bars with added 'macro_regime' and 'macro_confidence' fields.
    """
    if not macro_snapshots:
        for bar in bars:
            bar["macro_regime"] = "TRANSITION"
            bar["macro_confidence"] = 0.0
        return bars

    # Sort snapshots by date
    sorted_snapshots = sorted(macro_snapshots, key=lambda x: x.get("date", ""))

    # Pre-classify all snapshots
    classified: list[tuple[str, dict[str, Any]]] = []
    for snap in sorted_snapshots:
        result = classify_macro_regime(snap)
        classified.append((snap.get("date", ""), result))

    # Tag each bar with the most recent snapshot
    for bar in bars:
        bar_date = bar.get("date", bar.get("timestamp", ""))
        if hasattr(bar_date, "strftime"):
            bar_date = bar_date.strftime("%Y-%m-%d")
        bar_date_str = str(bar_date)[:10]  # Take just YYYY-MM-DD

        # Find most recent snapshot <= bar_date
        best_result: dict[str, Any] | None = None
        for snap_date, result in classified:
            if snap_date <= bar_date_str:
                best_result = result
            else:
                break

        if best_result:
            bar["macro_regime"] = best_result["regime"]
            bar["macro_confidence"] = best_result["confidence"]
        else:
            bar["macro_regime"] = "TRANSITION"
            bar["macro_confidence"] = 0.0

    return bars
