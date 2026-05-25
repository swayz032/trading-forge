"""Walk-Forward Regime Context — parameter stability regime classification.

HIGH #2 fix: classifies whether parameter drift across walk-forward windows
is driven by legitimate regime adaptation or random overfitting noise.

Pure functional — no I/O, no DB access, no time.now().
Replay-deterministic: same inputs always produce same classification.

Classification taxonomy (4-class):
  stable         — CV <= 30%, drift is minor regardless of regime
  regime_driven  — CV > 30% AND drift correlates with regime shifts
                   (Spearman rho >= 0.3)
  overfit_drift  — CV > 30% AND regime is stable but params jitter
  indeterminate  — CV > 30% AND regime is volatile but params jitter randomly
                   (cannot distinguish adaptation from noise)

When no regime data is available, classification defaults to "indeterminate"
with confidence=0 so downstream callers treat it as unknown.

Backward compat: the legacy `fragile` boolean flag is preserved.
  fragile = True  when classification is "overfit_drift" OR "indeterminate"
  fragile = False when classification is "stable" OR "regime_driven"
"""

from __future__ import annotations

import sys
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class ParameterDriftClassification:
    """Result of regime-context parameter drift analysis.

    Fields
    ------
    classification : str
        One of: "stable" | "regime_driven" | "overfit_drift" | "indeterminate"
    confidence : float
        In [0, 1]. 0 = no regime data / degenerate input. 1 = high-confidence.
    fragile : bool
        Backward-compat flag. True when classification is "overfit_drift" or
        "indeterminate" (i.e. the old binary FRAGILE==True cases).
    warning : str | None
        Human-readable warning message, or None when no concern.
    evidence : dict
        Diagnostic evidence (regime_sequence, spearman_rho, n_windows, etc.).
    """
    classification: str
    confidence: float
    fragile: bool
    warning: Optional[str]
    evidence: dict = field(default_factory=dict)


# ── Regime indicator conversion ───────────────────────────────────────────────

_REGIME_ORDINAL: dict[str, int] = {
    # Classical playbook labels
    "bullish":          2,
    "neutral":          0,
    "bearish":          -2,
    # 5-regime institutional labels (Wave 25 Pass 6)
    "TRENDING":         2,
    "EXPANSION":        1,
    "RANGE_BOUND":      0,
    "COMPRESSION":      -1,
    "HIGH_VOL_MACRO":   -1,
    "LOW_LIQ_CHOP":     -2,
    "NO_TRADE":         -2,
    "BREAKOUT_PREP":    1,
    "DISPLACEMENT_CONTINUATION": 2,
    "REDUCED_SIZING":   -1,
}


def _regime_to_ordinal(regime: str | None) -> Optional[float]:
    """Convert a regime string to a numeric ordinal for Spearman correlation.

    Returns None when the regime is unknown (caller must handle).
    """
    if regime is None:
        return None
    r = regime.strip().upper()
    # Try exact match on normalised key
    if r in _REGIME_ORDINAL:
        return float(_REGIME_ORDINAL[r])
    # Try lowercase match (for "bullish"/"bearish" etc.)
    rl = regime.strip().lower()
    if rl in _REGIME_ORDINAL:
        return float(_REGIME_ORDINAL[rl])
    return None


def _spearman_rho(x: list[float], y: list[float]) -> Optional[float]:
    """Spearman rank correlation between two equal-length lists.

    Returns None when inputs are degenerate (constant, too short, or unequal).
    Pure Python + basic rank computation — no scipy dependency.
    """
    if len(x) != len(y) or len(x) < 3:
        return None

    def _rank(seq: list[float]) -> list[float]:
        """Assign ranks with ties broken by average."""
        indexed = sorted(enumerate(seq), key=lambda t: t[1])
        ranks: list[float] = [0.0] * len(seq)
        i = 0
        n = len(indexed)
        while i < n:
            j = i
            while j < n - 1 and indexed[j + 1][1] == indexed[i][1]:
                j += 1
            avg_rank = float(i + j) / 2.0 + 1.0
            for k in range(i, j + 1):
                ranks[indexed[k][0]] = avg_rank
            i = j + 1
        return ranks

    rx = _rank(x)
    ry = _rank(y)
    n = len(rx)
    mean_rx = sum(rx) / n
    mean_ry = sum(ry) / n

    num = sum((rx[i] - mean_rx) * (ry[i] - mean_ry) for i in range(n))
    den_x = sum((rx[i] - mean_rx) ** 2 for i in range(n))
    den_y = sum((ry[i] - mean_ry) ** 2 for i in range(n))
    denom = (den_x * den_y) ** 0.5

    if denom < 1e-12:
        return None  # Constant rank sequence — degenerate

    return round(num / denom, 4)


# ── Main entry point ──────────────────────────────────────────────────────────

def classify_parameter_drift(
    per_window_params: list[dict],
    per_window_regimes: list[Optional[str]],
    spearman_threshold: float = 0.3,
    cv_fragile_threshold: float = 0.30,
) -> ParameterDriftClassification:
    """Classify whether parameter drift is regime-driven or overfit noise.

    Args
    ----
    per_window_params : list[dict]
        One dict per walk-forward window. Each dict maps param_name → numeric value.
        Must have len >= 2 to classify (returns indeterminate for degenerate input).
        Example: [{"fast_ma": 9}, {"fast_ma": 11}, {"fast_ma": 8}]

    per_window_regimes : list[str | None]
        Regime label per window (same length as per_window_params).
        Accepts None entries — windows with no regime data are excluded from the
        Spearman calculation.
        Example: ["TRENDING", "RANGE_BOUND", "TRENDING"]

    spearman_threshold : float
        Minimum absolute Spearman rho required to classify as REGIME_DRIVEN.
        Institutional default 0.3 per Bailey et al. 2025.

    cv_fragile_threshold : float
        Coefficient of variation above which a param is considered "jittery".
        Default 0.30 (30%) matches the existing binary FRAGILE definition.

    Returns
    -------
    ParameterDriftClassification
        See class docstring for field definitions.
    """
    n_windows = len(per_window_params)

    # ── Degenerate input ──────────────────────────────────────────────────────
    if n_windows < 2:
        return ParameterDriftClassification(
            classification="indeterminate",
            confidence=0.0,
            fragile=True,
            warning="Insufficient windows for regime-context analysis (need >= 2).",
            evidence={"n_windows": n_windows, "reason": "insufficient_windows"},
        )

    if len(per_window_regimes) != n_windows:
        # Length mismatch — skip regime context, fall back to indeterminate
        print(
            f"walk_forward_regime_context: per_window_regimes length mismatch "
            f"({len(per_window_regimes)} vs {n_windows} windows). Defaulting to indeterminate.",
            file=sys.stderr,
        )
        return ParameterDriftClassification(
            classification="indeterminate",
            confidence=0.0,
            fragile=True,
            warning="Regime sequence length mismatch — cannot classify drift.",
            evidence={
                "n_windows": n_windows,
                "regime_len": len(per_window_regimes),
                "reason": "length_mismatch",
            },
        )

    # ── Collect all param names across windows ────────────────────────────────
    all_param_names: set[str] = set()
    for w in per_window_params:
        all_param_names.update(w.keys())

    if not all_param_names:
        return ParameterDriftClassification(
            classification="indeterminate",
            confidence=0.0,
            fragile=True,
            warning="No parameter names found in per_window_params.",
            evidence={"n_windows": n_windows, "reason": "empty_params"},
        )

    # ── Compute per-param CV ──────────────────────────────────────────────────
    import math

    fragile_params: list[str] = []
    stable_params: list[str] = []
    per_param_cv: dict[str, float] = {}

    for pname in all_param_names:
        vals = [
            float(w[pname]) for w in per_window_params
            if pname in w and w[pname] is not None
        ]
        if len(vals) < 2:
            continue
        mean_val = sum(vals) / len(vals)
        variance = sum((v - mean_val) ** 2 for v in vals) / (len(vals) - 1)
        std_val = math.sqrt(variance)
        cv = std_val / abs(mean_val) if abs(mean_val) > 1e-10 else 0.0
        per_param_cv[pname] = round(cv, 4)
        if cv > cv_fragile_threshold:
            fragile_params.append(pname)
        else:
            stable_params.append(pname)

    # ── If no fragile params: STABLE ──────────────────────────────────────────
    if not fragile_params:
        return ParameterDriftClassification(
            classification="stable",
            confidence=1.0,
            fragile=False,
            warning=None,
            evidence={
                "n_windows": n_windows,
                "stable_params": stable_params,
                "fragile_params": [],
                "per_param_cv": per_param_cv,
                "spearman_rho": None,
                "reason": "all_params_stable",
            },
        )

    # ── Convert regimes to ordinals ───────────────────────────────────────────
    regime_ordinals: list[Optional[float]] = [
        _regime_to_ordinal(r) for r in per_window_regimes
    ]

    # ── Check regime volatility: is regime stable or shifting? ────────────────
    known_regimes = [r for r in regime_ordinals if r is not None]
    n_known = len(known_regimes)
    regime_data_available = n_known >= 3

    if not regime_data_available:
        # No usable regime data — default to indeterminate with confidence=0
        return ParameterDriftClassification(
            classification="indeterminate",
            confidence=0.0,
            fragile=True,
            warning=(
                f"Fragile params {fragile_params} (CV > {cv_fragile_threshold:.0%}) detected "
                f"but no regime data available — cannot distinguish adaptation from noise."
            ),
            evidence={
                "n_windows": n_windows,
                "fragile_params": fragile_params,
                "stable_params": stable_params,
                "per_param_cv": per_param_cv,
                "n_known_regimes": n_known,
                "regime_sequence": per_window_regimes,
                "spearman_rho": None,
                "reason": "no_regime_data",
            },
        )

    # ── Check if regime itself is stable ─────────────────────────────────────
    unique_regimes = set(r for r in per_window_regimes if r is not None)
    regime_is_stable = len(unique_regimes) <= 1

    if regime_is_stable:
        # Stable regime but params jitter → OVERFIT_DRIFT
        return ParameterDriftClassification(
            classification="overfit_drift",
            confidence=0.85,
            fragile=True,
            warning=(
                f"Fragile params {fragile_params} (CV > {cv_fragile_threshold:.0%}) but regime "
                f"is stable across all windows ({next(iter(unique_regimes), 'N/A')}) — "
                f"likely curve-fit to specific period."
            ),
            evidence={
                "n_windows": n_windows,
                "fragile_params": fragile_params,
                "stable_params": stable_params,
                "per_param_cv": per_param_cv,
                "regime_sequence": per_window_regimes,
                "unique_regimes": sorted(unique_regimes),
                "spearman_rho": None,
                "reason": "stable_regime_unstable_params",
            },
        )

    # ── Compute Spearman correlation for each fragile param against regime ────
    # Use windows where BOTH regime ordinal AND param value are known
    spearman_results: dict[str, Optional[float]] = {}

    for pname in fragile_params:
        paired_regime: list[float] = []
        paired_param: list[float] = []
        for i, w in enumerate(per_window_params):
            if pname in w and w[pname] is not None and regime_ordinals[i] is not None:
                paired_regime.append(float(regime_ordinals[i]))  # type: ignore[arg-type]
                paired_param.append(float(w[pname]))
        if len(paired_regime) >= 3:
            spearman_results[pname] = _spearman_rho(paired_regime, paired_param)
        else:
            spearman_results[pname] = None

    # ── Decision: regime_driven vs indeterminate ──────────────────────────────
    # A param is regime-driven when |rho| >= spearman_threshold
    regime_driven_params = [
        p for p, rho in spearman_results.items()
        if rho is not None and abs(rho) >= spearman_threshold
    ]
    indeterminate_params = [
        p for p in fragile_params if p not in regime_driven_params
    ]

    # Representative rho = max absolute rho across fragile params
    valid_rhos = [abs(rho) for rho in spearman_results.values() if rho is not None]
    max_abs_rho = round(max(valid_rhos), 4) if valid_rhos else None

    # Average raw rho for logging
    raw_rhos = {p: rho for p, rho in spearman_results.items() if rho is not None}

    if regime_driven_params:
        # Majority (or all) fragile params are regime-correlated → REGIME_DRIVEN
        driven_fraction = len(regime_driven_params) / max(len(fragile_params), 1)
        confidence = round(min(0.5 + driven_fraction * 0.5, 0.95), 4)
        return ParameterDriftClassification(
            classification="regime_driven",
            confidence=confidence,
            fragile=False,
            warning=None,
            evidence={
                "n_windows": n_windows,
                "fragile_params": fragile_params,
                "stable_params": stable_params,
                "regime_driven_params": regime_driven_params,
                "indeterminate_params": indeterminate_params,
                "per_param_cv": per_param_cv,
                "spearman_rho": max_abs_rho,
                "spearman_per_param": raw_rhos,
                "regime_sequence": per_window_regimes,
                "unique_regimes": sorted(unique_regimes),
                "reason": "regime_correlated",
            },
        )

    # All fragile params uncorrelated with regime → INDETERMINATE
    return ParameterDriftClassification(
        classification="indeterminate",
        confidence=0.5,
        fragile=True,
        warning=(
            f"Fragile params {fragile_params} (CV > {cv_fragile_threshold:.0%}) "
            f"but drift does not correlate with regime shifts "
            f"(max |rho| = {max_abs_rho}, threshold = {spearman_threshold}). "
            f"Cannot distinguish adaptation from noise."
        ),
        evidence={
            "n_windows": n_windows,
            "fragile_params": fragile_params,
            "stable_params": stable_params,
            "per_param_cv": per_param_cv,
            "spearman_rho": max_abs_rho,
            "spearman_per_param": raw_rhos,
            "regime_sequence": per_window_regimes,
            "unique_regimes": sorted(unique_regimes),
            "reason": "uncorrelated_with_regime",
        },
    )
