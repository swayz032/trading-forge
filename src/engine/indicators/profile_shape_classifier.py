"""Profile Shape Classifier — D/b/P/Thin classification from VP bin distribution.

Classification rules (all thresholds are named constants, not magic numbers):
  - Thin:    High-range trend day with thin value area (<40% of total range)
  - D-shaped: Balanced / normal — POC in middle 50%, VA >= 60% of range
  - b-shaped: Selling tail at top — POC in lower 33%, thin upper 33%
  - P-shaped: Buying tail at bottom — POC in upper 33%, thin lower 33%
  - Fallback: D-shaped with low confidence

Inputs: VolumeProfileLevels + underlying bin_map + session ATR-20d.
Outputs: ProfileShapeClassification dataclass.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, Literal, Optional

from src.engine.indicators.volume_profile import VolumeProfileLevels


# ─── Classification thresholds (named constants) ──────────────────────────────

# Thin profile: trend-day trigger
THIN_RANGE_MULTIPLIER: float = 1.5   # range > 1.5 × ATR_20d
THIN_VA_MAX_RANGE_PCT: float = 0.40  # VA spans < 40% of session range

# D-shaped: balanced session
D_SHAPE_POC_LOW_PCT: float = 0.25    # POC above this % of range
D_SHAPE_POC_HIGH_PCT: float = 0.75   # POC below this % of range
D_SHAPE_MIN_VA_RANGE_PCT: float = 0.60  # VA spans >= 60% of range

# b/P-shape: single distribution with tail
BP_POC_TAIL_PCT: float = 0.33        # POC in bottom/top 33%
BP_TAIL_THIN_PCT: float = 0.15       # Tail region has < 15% of total volume

# Confidence scale
HIGH_CONFIDENCE: float = 0.85
MED_CONFIDENCE: float = 0.65
LOW_CONFIDENCE: float = 0.40
FALLBACK_CONFIDENCE: float = 0.30


# ─── Output dataclass ─────────────────────────────────────────────────────────

ProfileShape = Literal["D", "b", "P", "Thin"]


@dataclass
class ProfileShapeClassification:
    """Result of profile shape classification."""

    shape: ProfileShape
    confidence: float
    evidence: Dict


# ─── Core classification ──────────────────────────────────────────────────────

def _vol_in_range(bin_map: Dict[float, float], lo: float, hi: float) -> float:
    """Sum volume for bins in [lo, hi]."""
    return sum(v for k, v in bin_map.items() if lo <= k <= hi)


def classify_profile_shape(
    levels: VolumeProfileLevels,
    atr_20d: Optional[float] = None,
) -> ProfileShapeClassification:
    """Classify daily profile shape.

    Args:
        levels: VolumeProfileLevels from compute_volume_profile(). Must have
                non-empty _bin_map for meaningful classification.
        atr_20d: 20-day ATR for Thin profile detection. If None, Thin check
                 is skipped (can still classify D/b/P).

    Returns:
        ProfileShapeClassification with shape, confidence, evidence dict.
    """
    bin_map = levels._bin_map
    total_vol = sum(bin_map.values()) if bin_map else 0.0

    session_high = levels.session_high
    session_low = levels.session_low
    session_range = session_high - session_low

    poc = levels.poc
    vah = levels.vah
    val = levels.val
    va_range = vah - val

    evidence: Dict = {
        "poc": poc,
        "vah": vah,
        "val": val,
        "session_high": session_high,
        "session_low": session_low,
        "session_range": session_range,
        "va_range": va_range,
        "total_volume": total_vol,
        "atr_20d": atr_20d,
    }

    # Degenerate: no range or no volume
    if session_range < 1e-9 or total_vol <= 0 or not bin_map:
        evidence["reason"] = "degenerate_no_range_or_volume"
        return ProfileShapeClassification(
            shape="D", confidence=FALLBACK_CONFIDENCE, evidence=evidence
        )

    # ── Relative positions ──────────────────────────────────────────────────
    poc_range_pct = (poc - session_low) / session_range   # 0.0=at low, 1.0=at high
    va_range_pct = va_range / session_range               # VA span as % of total range

    evidence["poc_range_pct"] = poc_range_pct
    evidence["va_range_pct"] = va_range_pct

    # ── 1. Thin profile (trend day) ─────────────────────────────────────────
    if atr_20d is not None and atr_20d > 0:
        range_vs_atr = session_range / atr_20d
        evidence["range_vs_atr"] = range_vs_atr
        if range_vs_atr > THIN_RANGE_MULTIPLIER and va_range_pct < THIN_VA_MAX_RANGE_PCT:
            confidence = _thin_confidence(range_vs_atr, va_range_pct)
            evidence["reason"] = "high_range_and_thin_va"
            return ProfileShapeClassification(
                shape="Thin", confidence=confidence, evidence=evidence
            )

    # ── 2. b-shaped: POC in lower 33%, thin upper tail ─────────────────────
    if poc_range_pct <= BP_POC_TAIL_PCT:
        upper_boundary = session_low + session_range * (1 - BP_POC_TAIL_PCT)
        vol_upper_tail = _vol_in_range(bin_map, upper_boundary, session_high)
        upper_tail_pct = vol_upper_tail / total_vol if total_vol > 0 else 1.0
        evidence["upper_tail_vol_pct"] = upper_tail_pct
        if upper_tail_pct < BP_TAIL_THIN_PCT:
            confidence = _bp_confidence(poc_range_pct, upper_tail_pct, shape="b")
            evidence["reason"] = "low_poc_thin_upper_tail"
            return ProfileShapeClassification(
                shape="b", confidence=confidence, evidence=evidence
            )

    # ── 3. P-shaped: POC in upper 33%, thin lower tail ─────────────────────
    if poc_range_pct >= (1 - BP_POC_TAIL_PCT):
        lower_boundary = session_low + session_range * BP_POC_TAIL_PCT
        vol_lower_tail = _vol_in_range(bin_map, session_low, lower_boundary)
        lower_tail_pct = vol_lower_tail / total_vol if total_vol > 0 else 1.0
        evidence["lower_tail_vol_pct"] = lower_tail_pct
        if lower_tail_pct < BP_TAIL_THIN_PCT:
            confidence = _bp_confidence(poc_range_pct, lower_tail_pct, shape="P")
            evidence["reason"] = "high_poc_thin_lower_tail"
            return ProfileShapeClassification(
                shape="P", confidence=confidence, evidence=evidence
            )

    # ── 4. D-shaped: balanced — POC in middle 50%, VA >= 60% of range ──────
    if D_SHAPE_POC_LOW_PCT <= poc_range_pct <= D_SHAPE_POC_HIGH_PCT:
        if va_range_pct >= D_SHAPE_MIN_VA_RANGE_PCT:
            confidence = _d_confidence(poc_range_pct, va_range_pct)
            evidence["reason"] = "centered_poc_wide_va"
            return ProfileShapeClassification(
                shape="D", confidence=confidence, evidence=evidence
            )
        else:
            # Centered POC but thin VA — ambiguous, still D with lower confidence
            evidence["reason"] = "centered_poc_thin_va_ambiguous"
            return ProfileShapeClassification(
                shape="D", confidence=MED_CONFIDENCE * 0.7, evidence=evidence
            )

    # ── 5. Fallback: D-shaped low confidence ───────────────────────────────
    evidence["reason"] = "fallback_no_clear_pattern"
    return ProfileShapeClassification(
        shape="D", confidence=FALLBACK_CONFIDENCE, evidence=evidence
    )


# ─── Confidence helpers ───────────────────────────────────────────────────────

def _thin_confidence(range_vs_atr: float, va_range_pct: float) -> float:
    """Higher range_vs_atr and lower va_range_pct = higher confidence."""
    r_score = min(1.0, (range_vs_atr - THIN_RANGE_MULTIPLIER) / THIN_RANGE_MULTIPLIER)
    va_score = max(0.0, (THIN_VA_MAX_RANGE_PCT - va_range_pct) / THIN_VA_MAX_RANGE_PCT)
    raw = 0.5 + 0.3 * r_score + 0.2 * va_score
    return min(HIGH_CONFIDENCE, max(MED_CONFIDENCE, raw))


def _bp_confidence(poc_range_pct: float, tail_pct: float, shape: str) -> float:
    """For b: lower poc_range_pct and lower tail_pct = higher confidence.
    For P: higher poc_range_pct (closer to 1.0) and lower tail_pct."""
    if shape == "b":
        poc_score = max(0.0, (BP_POC_TAIL_PCT - poc_range_pct) / BP_POC_TAIL_PCT)
    else:
        poc_score = max(0.0, (poc_range_pct - (1 - BP_POC_TAIL_PCT)) / BP_POC_TAIL_PCT)
    tail_score = max(0.0, (BP_TAIL_THIN_PCT - tail_pct) / BP_TAIL_THIN_PCT)
    raw = 0.55 + 0.25 * poc_score + 0.20 * tail_score
    return min(HIGH_CONFIDENCE, max(MED_CONFIDENCE, raw))


def _d_confidence(poc_range_pct: float, va_range_pct: float) -> float:
    """Centered POC and wide VA = high confidence D."""
    # Distance from center 0.5 (lower = more centered = higher confidence)
    center_dist = abs(poc_range_pct - 0.5) / 0.5  # 0=perfect center, 1=at edge
    center_score = 1.0 - center_dist
    va_score = min(1.0, (va_range_pct - D_SHAPE_MIN_VA_RANGE_PCT) / (1.0 - D_SHAPE_MIN_VA_RANGE_PCT))
    raw = 0.5 + 0.30 * center_score + 0.25 * va_score
    return min(HIGH_CONFIDENCE, max(MED_CONFIDENCE, raw))


# ─── ASCII visualization helper ───────────────────────────────────────────────

def ascii_profile(
    levels: VolumeProfileLevels,
    width: int = 40,
    height: int = 20,
) -> str:
    """Return ASCII visualization of the volume profile for debug output.

    Args:
        levels: Computed VolumeProfileLevels.
        width: Character width for volume bars.
        height: Number of price rows to display.

    Returns:
        Multi-line string with profile visualization.
    """
    bin_map = levels._bin_map
    if not bin_map:
        return "[empty profile]\n"

    sorted_prices = sorted(bin_map.keys(), reverse=True)
    max_vol = max(bin_map.values()) if bin_map else 1.0

    # Sample to height rows
    if len(sorted_prices) > height:
        step = max(1, len(sorted_prices) // height)
        sorted_prices = sorted_prices[::step][:height]

    lines = []
    lines.append(f"  Volume Profile   POC={levels.poc:.2f}  VAH={levels.vah:.2f}  VAL={levels.val:.2f}")
    lines.append("  " + "-" * (width + 12))

    for price in sorted_prices:
        vol = bin_map.get(price, 0.0)
        bar_len = int((vol / max_vol) * width) if max_vol > 0 else 0
        bar = "#" * bar_len

        tag = ""
        if abs(price - levels.poc) < 1e-9:
            tag = " <- POC"
        elif abs(price - levels.vah) < 1e-9:
            tag = " <- VAH"
        elif abs(price - levels.val) < 1e-9:
            tag = " <- VAL"
        elif price in levels.naked_pocs:
            tag = " <- nPOC"

        lines.append(f"  {price:8.2f} |{bar:<{width}}|{tag}")

    lines.append("  " + "-" * (width + 12))
    return "\n".join(lines) + "\n"
