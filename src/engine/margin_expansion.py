"""CME margin expansion model — VIX-driven contract cap reduction.

MED #4 (Wave 27.5 Pass D.1): CME doubles intraday margin when VIX > 30.
A backtest that permits the same pyramid cap year-round overstates live
tradeable contract counts in high-volatility environments.

Model:
    VIX ≤ MARGIN_VIX_THRESHOLD_30  → no change (base_max_contracts returned as-is)
    VIX > MARGIN_VIX_THRESHOLD_30  → max_contracts = int(floor(base × 0.5))
    VIX > MARGIN_VIX_THRESHOLD_50  → max_contracts = int(floor(base × 0.25))
                                      (CME emergency-margin tier per 2026 institutional standard)

Pure-functional: no DB, no I/O, no randomness, deterministic.

Env vars:
    MARGIN_VIX_THRESHOLD_30  (default 30.0) — VIX level that triggers 0.5× reduction
    MARGIN_VIX_MULTIPLIER_30 (default 0.5)  — multiplier applied above threshold_30
    MARGIN_VIX_THRESHOLD_50  (default 50.0) — VIX level that triggers 0.25× reduction
    MARGIN_VIX_MULTIPLIER_50 (default 0.25) — multiplier applied above threshold_50
"""

from __future__ import annotations

import math
import os

# ─── Env-configurable thresholds ─────────────────────────────────────────────

_VIX_THRESHOLD_30: float = float(os.environ.get("MARGIN_VIX_THRESHOLD_30", "30.0"))
_VIX_MULTIPLIER_30: float = float(os.environ.get("MARGIN_VIX_MULTIPLIER_30", "0.5"))
_VIX_THRESHOLD_50: float = float(os.environ.get("MARGIN_VIX_THRESHOLD_50", "50.0"))
_VIX_MULTIPLIER_50: float = float(os.environ.get("MARGIN_VIX_MULTIPLIER_50", "0.25"))


def apply_vix_margin_expansion(
    base_max_contracts: int,
    vix_level: float,
    *,
    env_threshold_30: float | None = None,
    env_multiplier_30: float | None = None,
    env_threshold_50: float | None = None,
    env_multiplier_50: float | None = None,
) -> int:
    """Apply CME VIX-driven margin expansion to the pyramidTier cap.

    Returns the maximum contract count that may be traded at the given
    VIX level.  Always returns at least 1.

    Args:
        base_max_contracts: The contract cap WITHOUT margin expansion applied.
            This is the result of the pyramid-tier + firm-cap + liquidity-cap
            min() chain in the caller — i.e. the number that would be used on
            a normal-vol day.
        vix_level: Current VIX reading.
        env_threshold_30: Override for MARGIN_VIX_THRESHOLD_30 (tests only).
        env_multiplier_30: Override for MARGIN_VIX_MULTIPLIER_30 (tests only).
        env_threshold_50: Override for MARGIN_VIX_THRESHOLD_50 (tests only).
        env_multiplier_50: Override for MARGIN_VIX_MULTIPLIER_50 (tests only).

    Returns:
        Adjusted contract count (int, ≥ 1).
    """
    threshold_30 = env_threshold_30 if env_threshold_30 is not None else _VIX_THRESHOLD_30
    multiplier_30 = env_multiplier_30 if env_multiplier_30 is not None else _VIX_MULTIPLIER_30
    threshold_50 = env_threshold_50 if env_threshold_50 is not None else _VIX_THRESHOLD_50
    multiplier_50 = env_multiplier_50 if env_multiplier_50 is not None else _VIX_MULTIPLIER_50

    if vix_level > threshold_50:
        expanded = int(math.floor(base_max_contracts * multiplier_50))
    elif vix_level > threshold_30:
        expanded = int(math.floor(base_max_contracts * multiplier_30))
    else:
        expanded = base_max_contracts

    return max(1, expanded)


def get_vix_expansion_audit(
    base_max_contracts: int,
    expanded_max_contracts: int,
    vix_level: float,
    *,
    env_threshold_30: float | None = None,
    env_multiplier_30: float | None = None,
    env_threshold_50: float | None = None,
    env_multiplier_50: float | None = None,
) -> dict:
    """Build audit payload for backtest.margin_expansion_applied audit row.

    Returns a dict ready for JSON serialization.  If no expansion was
    applied (expanded_max == base_max) the dict still serializes cleanly
    so callers can decide whether to emit the row.

    Args:
        base_max_contracts: Cap before expansion.
        expanded_max_contracts: Cap after expansion.
        vix_level: VIX reading used.
        env_threshold_30, env_multiplier_30, env_threshold_50, env_multiplier_50:
            Override values (same as apply_vix_margin_expansion — for test parity).
    """
    threshold_30 = env_threshold_30 if env_threshold_30 is not None else _VIX_THRESHOLD_30
    multiplier_30 = env_multiplier_30 if env_multiplier_30 is not None else _VIX_MULTIPLIER_30
    threshold_50 = env_threshold_50 if env_threshold_50 is not None else _VIX_THRESHOLD_50

    if vix_level > threshold_50:
        multiplier_used = env_multiplier_50 if env_multiplier_50 is not None else _VIX_MULTIPLIER_50
        tier_triggered = "emergency_50"
    elif vix_level > threshold_30:
        multiplier_used = multiplier_30
        tier_triggered = "elevated_30"
    else:
        multiplier_used = 1.0
        tier_triggered = "none"

    return {
        "vix_level": round(vix_level, 2),
        "base_max": base_max_contracts,
        "expanded_max": expanded_max_contracts,
        "multiplier": multiplier_used,
        "tier_triggered": tier_triggered,
        "expansion_applied": expanded_max_contracts != base_max_contracts,
    }
