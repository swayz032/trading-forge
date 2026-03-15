"""
Regime Graph -- composite regime combining technical (ADX/ATR) + macro signals.
This is the unified regime view that strategies consume.
"""

from __future__ import annotations

from typing import Any

# Valid technical regimes (from src/engine/regime.py)
VALID_TECHNICAL_REGIMES = {
    "TRENDING_UP", "TRENDING_DOWN", "RANGE_BOUND",
    "HIGH_VOL", "LOW_VOL", "TRANSITIONAL",
}

# Valid macro regimes (from macro_tagger.py)
VALID_MACRO_REGIMES = {
    "RISK_ON", "RISK_OFF", "TIGHTENING", "EASING",
    "STAGFLATION", "GOLDILOCKS", "TRANSITION",
}

# Alignment rules: (technical, macro) -> alignment
_ALIGNED_PAIRS = {
    ("TRENDING_UP", "RISK_ON"),
    ("TRENDING_UP", "GOLDILOCKS"),
    ("TRENDING_UP", "EASING"),
    ("TRENDING_DOWN", "RISK_OFF"),
    ("TRENDING_DOWN", "TIGHTENING"),
    ("TRENDING_DOWN", "STAGFLATION"),
    ("RANGE_BOUND", "TRANSITION"),
    ("LOW_VOL", "GOLDILOCKS"),
    ("LOW_VOL", "RISK_ON"),
    ("HIGH_VOL", "RISK_OFF"),
    ("HIGH_VOL", "STAGFLATION"),
}

_CONFLICTING_PAIRS = {
    ("TRENDING_UP", "RISK_OFF"),
    ("TRENDING_UP", "STAGFLATION"),
    ("TRENDING_DOWN", "RISK_ON"),
    ("TRENDING_DOWN", "GOLDILOCKS"),
    ("LOW_VOL", "RISK_OFF"),
    ("LOW_VOL", "STAGFLATION"),
    ("HIGH_VOL", "RISK_ON"),
    ("HIGH_VOL", "GOLDILOCKS"),
}


def _determine_alignment(technical: str, macro: str) -> str:
    """
    Determine alignment between technical and macro regimes.
    Returns "aligned", "conflicting", or "neutral".
    """
    if (technical, macro) in _ALIGNED_PAIRS:
        return "aligned"
    if (technical, macro) in _CONFLICTING_PAIRS:
        return "conflicting"
    return "neutral"


def _alignment_confidence(
    alignment: str,
    vix: float | None = None,
) -> float:
    """Compute confidence score based on alignment and VIX."""
    base = {
        "aligned": 0.85,
        "neutral": 0.50,
        "conflicting": 0.25,
    }.get(alignment, 0.50)

    # VIX modifier: extreme VIX reduces confidence in neutral/aligned
    if vix is not None:
        if vix > 30:
            # High vol environment -- reduce confidence in bullish signals
            if alignment == "aligned":
                base *= 0.8
        elif vix < 12:
            # Very low vol -- boost aligned confidence slightly
            if alignment == "aligned":
                base = min(base * 1.1, 1.0)

    return round(min(max(base, 0.0), 1.0), 4)


def _recommend_sizing(alignment: str, vix: float | None = None) -> str:
    """
    Recommend position sizing based on regime alignment.

    Returns:
        "full_size" -- regimes agree, trade normally
        "reduce" -- regimes conflict or VIX elevated, reduce position
        "skip" -- strong conflict or extreme conditions
    """
    if alignment == "aligned":
        if vix is not None and vix > 35:
            return "reduce"
        return "full_size"
    elif alignment == "conflicting":
        if vix is not None and vix > 30:
            return "skip"
        return "reduce"
    else:  # neutral
        if vix is not None and vix > 30:
            return "reduce"
        return "full_size"


def composite_regime(
    technical_regime: str,
    macro_regime: str,
    vix: float | None = None,
) -> dict[str, Any]:
    """
    Combine technical and macro regimes into a composite view.

    Args:
        technical_regime: From src/engine/regime.py (e.g. "TRENDING_UP")
        macro_regime: From macro_tagger (e.g. "RISK_ON")
        vix: Current VIX value (optional, used for confidence adjustment)

    Returns:
        {
            "composite": str,       # e.g. "TRENDING_UP:RISK_ON"
            "technical": str,
            "macro": str,
            "alignment": "aligned" | "conflicting" | "neutral",
            "confidence": float,
            "recommendation": "full_size" | "reduce" | "skip",
        }
    """
    # Validate inputs
    tech = technical_regime if technical_regime in VALID_TECHNICAL_REGIMES else "TRANSITIONAL"
    macro = macro_regime if macro_regime in VALID_MACRO_REGIMES else "TRANSITION"

    alignment = _determine_alignment(tech, macro)
    confidence = _alignment_confidence(alignment, vix)
    recommendation = _recommend_sizing(alignment, vix)

    return {
        "composite": f"{tech}:{macro}",
        "technical": tech,
        "macro": macro,
        "alignment": alignment,
        "confidence": confidence,
        "recommendation": recommendation,
    }
