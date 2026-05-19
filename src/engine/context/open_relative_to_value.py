"""Open Relative to Value — classify session open vs prior day's value area.

Classifications (in priority order):
  1. Open-Outside-Range:          open above prior high OR below prior low (gap)
  2. Open-Outside-Value-Up:       open above prior VAH but within prior range
  3. Open-Outside-Value-Down:     open below prior VAL but within prior range
  4. Open-In-Value:               open within prior VAL..VAH

These classifications drive bias-engine playbook selection and are consumed by
the paper-parity agent's VP integration layer. This module is pure/deterministic.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, Literal, Optional

from src.engine.indicators.volume_profile import VolumeProfileLevels


# ─── Classification enum ──────────────────────────────────────────────────────

OpenClassification = Literal[
    "Open-In-Value",
    "Open-Outside-Value-Up",
    "Open-Outside-Value-Down",
    "Open-Outside-Range",
]

# Tolerance: price within this many ticks of a level is treated as "at" the level.
# Default 0.0 means exact boundary membership. Callers may pass tick_size.
_DEFAULT_TOLERANCE = 0.0


# ─── Output dataclass ─────────────────────────────────────────────────────────

@dataclass
class OpenRelativeClassification:
    """Result of open-relative-to-value classification."""

    classification: OpenClassification
    evidence: Dict = field(default_factory=dict)


# ─── Core computation ─────────────────────────────────────────────────────────

def classify_open_relative_to_value(
    open_price: float,
    prior_levels: VolumeProfileLevels,
    prior_session_high: Optional[float] = None,
    prior_session_low: Optional[float] = None,
    tolerance: float = _DEFAULT_TOLERANCE,
) -> OpenRelativeClassification:
    """Classify today's open price relative to prior day's value area.

    Args:
        open_price: Today's opening price (first bar open or RTH open).
        prior_levels: VolumeProfileLevels from the prior session.
        prior_session_high: Prior session high. Falls back to prior_levels.session_high.
        prior_session_low: Prior session low. Falls back to prior_levels.session_low.
        tolerance: Price fuzziness in points. Prices within +/-tolerance of a
                   boundary are treated as "at" the boundary (inclusive on both sides).
                   Pass symbol tick_size for tick-precision classification.

    Returns:
        OpenRelativeClassification with classification and evidence dict.

    Edge cases:
        - open_price exactly at VAH or VAL: treated as Open-In-Value (inclusive bounds).
        - Prior day was a thin profile (no clear VA): VAH == VAL == POC. The
          open-in-value window collapses to a single price band. Classification
          still works — open at POC is In-Value, outside is Outside-Value.
        - prior_levels with zero poc/vah/val (degenerate): returns Open-In-Value
          with a "degenerate_prior" note in evidence.
    """
    val = prior_levels.val
    vah = prior_levels.vah
    poc = prior_levels.poc

    # Use session_high/low from levels if not explicitly provided
    p_high = prior_session_high if prior_session_high is not None else prior_levels.session_high
    p_low = prior_session_low if prior_session_low is not None else prior_levels.session_low

    # Fall back to vah/val if session_high/low not populated
    if p_high <= 0:
        p_high = vah
    if p_low <= 0:
        p_low = val

    evidence: Dict = {
        "open_price": open_price,
        "prior_val": val,
        "prior_vah": vah,
        "prior_poc": poc,
        "prior_session_high": p_high,
        "prior_session_low": p_low,
        "tolerance": tolerance,
    }

    # Degenerate prior
    if vah <= 0 and val <= 0 and poc <= 0:
        evidence["note"] = "degenerate_prior"
        return OpenRelativeClassification(
            classification="Open-In-Value", evidence=evidence
        )

    tol = abs(tolerance)

    # 1. Outside-Range (gap): open above prior high OR below prior low
    if open_price > p_high + tol:
        evidence["reason"] = "gap_above_prior_high"
        return OpenRelativeClassification(
            classification="Open-Outside-Range", evidence=evidence
        )
    if open_price < p_low - tol:
        evidence["reason"] = "gap_below_prior_low"
        return OpenRelativeClassification(
            classification="Open-Outside-Range", evidence=evidence
        )

    # 2. Open-In-Value: within VAL..VAH (inclusive, with tolerance)
    if val - tol <= open_price <= vah + tol:
        evidence["reason"] = "open_within_value_area"
        return OpenRelativeClassification(
            classification="Open-In-Value", evidence=evidence
        )

    # 3. Open-Outside-Value-Up: above VAH but within prior range
    if open_price > vah + tol:
        evidence["reason"] = "above_vah_within_range"
        return OpenRelativeClassification(
            classification="Open-Outside-Value-Up", evidence=evidence
        )

    # 4. Open-Outside-Value-Down: below VAL but within prior range
    if open_price < val - tol:
        evidence["reason"] = "below_val_within_range"
        return OpenRelativeClassification(
            classification="Open-Outside-Value-Down", evidence=evidence
        )

    # Fallback (should not be reached given the checks above)
    evidence["reason"] = "fallback_in_value"
    return OpenRelativeClassification(
        classification="Open-In-Value", evidence=evidence
    )
