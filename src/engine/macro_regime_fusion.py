"""C11 — Macro regime fusion: HMM macro probabilities + DeepAR microstructure.

Combines:
  - HMM macro classifier (4-state: Growth/Inflation/Crisis/Easing)
  - DeepAR microstructure classifier (3-state: Trending/Range-bound/Chop/VolExpansion)

Weight cap: macro_weight MUST NOT exceed 0.30 (30%) of the final signal.
Dec 2025 lesson: strategies weighting macro >40% got whipsawed because
macro lags intraday by 5-7 days. Use macro as a FILTER, not a predictor.

Output: fused regime signal consumed by regime-state-service.ts.
"""

from __future__ import annotations

from typing import Literal

# Hard cap: macro contributes at most this fraction of the fused signal
MACRO_WEIGHT_CAP = 0.30
PRICE_WEIGHT_MIN = 1.0 - MACRO_WEIGHT_CAP  # 0.70

# DeepAR microstructure state names (matching regime-state-service.ts)
DEEPAR_STATES = Literal["trending", "range_bound", "chop", "vol_expansion"]

# HMM macro state names
MACRO_STATES = Literal["Growth", "Inflation", "Crisis", "Easing"]


def fuse_macro_deepar(
    macro_probs: dict[str, float],
    deepar_weights: dict[str, float],
    macro_weight: float = 0.25,
) -> dict:
    """Fuse HMM macro probabilities with DeepAR microstructure weights.

    The fused signal preserves the DeepAR microstructure regime as the
    primary driver (70-75%) and uses macro as a modifier/filter (25-30%).

    Macro probs shape:
      {"prob_growth": 0.x, "prob_inflation": 0.x, "prob_crisis": 0.x, "prob_easing": 0.x}

    DeepAR weights shape (from regime-state-service.ts RegimeWeights):
      {"high_vol": 0.x, "trending": 0.x, "mean_revert": 0.x}

    Args:
        macro_probs: HMM state probabilities (sum ~1.0).
        deepar_weights: DeepAR regime weights (sum ~1.0).
        macro_weight: Macro contribution fraction. Capped at MACRO_WEIGHT_CAP (0.30).

    Returns:
        {
          "fused_trending": float,
          "fused_range_bound": float,
          "fused_vol_expansion": float,
          "macro_crisis_prob": float,      # passthrough for hard gate
          "macro_inflation_prob": float,
          "macro_weight_used": float,      # actual weight applied
          "dominant_macro_state": str,
          "dominant_deepar_state": str,
          "crisis_gate_eligible": bool,    # prob_crisis > 0.60
        }
    """
    # Clamp macro_weight to cap
    effective_macro_weight = min(float(macro_weight), MACRO_WEIGHT_CAP)
    effective_price_weight = 1.0 - effective_macro_weight

    # Extract macro probs
    p_growth = float(macro_probs.get("prob_growth", 0.25))
    p_inflation = float(macro_probs.get("prob_inflation", 0.25))
    p_crisis = float(macro_probs.get("prob_crisis", 0.25))
    p_easing = float(macro_probs.get("prob_easing", 0.25))

    # Determine dominant macro state
    macro_arr = {"Growth": p_growth, "Inflation": p_inflation, "Crisis": p_crisis, "Easing": p_easing}
    dominant_macro = max(macro_arr, key=lambda k: macro_arr[k])

    # Extract DeepAR weights
    deepar_trending = float(deepar_weights.get("trending", 0.33))
    deepar_high_vol = float(deepar_weights.get("high_vol", 0.33))
    deepar_mean_revert = float(deepar_weights.get("mean_revert", 0.33))

    # Determine dominant DeepAR state
    deepar_arr = {
        "trending": deepar_trending,
        "high_vol": deepar_high_vol,
        "mean_revert": deepar_mean_revert,
    }
    dominant_deepar = max(deepar_arr, key=lambda k: deepar_arr[k])

    # ─── Fusion ──────────────────────────────────────────────────────
    # Map macro states to microstructure regime space:
    #   Growth    → trending bias (positive economic momentum)
    #   Inflation → vol_expansion bias (uncertainty, rate vol)
    #   Crisis    → high_vol / mean_revert bias (risk-off, defensive)
    #   Easing    → trending + mean_revert (gradual recovery)
    macro_trending_contrib = p_growth * 0.7 + p_easing * 0.4
    macro_vol_contrib = p_inflation * 0.5 + p_crisis * 0.6
    macro_mean_revert_contrib = p_crisis * 0.4 + p_easing * 0.6 + p_inflation * 0.3

    # Normalize macro contributions to sum to 1
    macro_total = macro_trending_contrib + macro_vol_contrib + macro_mean_revert_contrib
    if macro_total < 1e-6:
        macro_trending_contrib = 0.33
        macro_vol_contrib = 0.33
        macro_mean_revert_contrib = 0.33
        macro_total = 1.0
    macro_trending_contrib /= macro_total
    macro_vol_contrib /= macro_total
    macro_mean_revert_contrib /= macro_total

    # Weighted blend: price (DeepAR) dominates, macro modifies
    fused_trending = (
        deepar_trending * effective_price_weight
        + macro_trending_contrib * effective_macro_weight
    )
    fused_vol = (
        deepar_high_vol * effective_price_weight
        + macro_vol_contrib * effective_macro_weight
    )
    fused_range = (
        deepar_mean_revert * effective_price_weight
        + macro_mean_revert_contrib * effective_macro_weight
    )

    # Renormalize (floating point)
    fused_total = fused_trending + fused_vol + fused_range
    if fused_total > 0:
        fused_trending /= fused_total
        fused_vol /= fused_total
        fused_range /= fused_total

    return {
        "fused_trending": round(fused_trending, 6),
        "fused_vol_expansion": round(fused_vol, 6),
        "fused_range_bound": round(fused_range, 6),
        "macro_crisis_prob": round(p_crisis, 6),
        "macro_inflation_prob": round(p_inflation, 6),
        "macro_weight_used": round(effective_macro_weight, 4),
        "dominant_macro_state": dominant_macro,
        "dominant_deepar_state": dominant_deepar,
        "crisis_gate_eligible": p_crisis > 0.60,
    }


def compute_fomc_size_reduction(
    fomc_day_proximity: int | None,
    base_contracts: int,
) -> int:
    """Compute FOMC-day position sizing reduction.

    C11 rule: FOMC day ±1 → reduce size 50%.

    Args:
        fomc_day_proximity: Days until (positive) or since (negative) FOMC.
            0 = FOMC day itself. None = unknown.
        base_contracts: Original contract count from Kelly/ATR sizing.

    Returns:
        Reduced contract count (minimum 1). Returns base unchanged when
        fomc_day_proximity is None or outside ±1 window.
    """
    if fomc_day_proximity is None:
        return base_contracts

    within_fomc_window = abs(fomc_day_proximity) <= 1

    if within_fomc_window:
        reduced = max(1, base_contracts // 2)
        return reduced

    return base_contracts


def check_hard_gates(
    macro_state: dict,
    instrument: str = "ES",
) -> dict:
    """Apply C11 hard gate logic to a macro regime state.

    Hard gates (C11 spec):
      1. prob_crisis > 0.60 → no longs >2hr horizon (ES/NQ/MES/MNQ)
      2. ISM < 49 AND RRP < $20B → no ES/NQ longs
      3. FOMC day ±1 → 50% size, tighter stops (handled in fusion layer)
      4. Macro release day → no new entries 1hr before to 3hr after

    Args:
        macro_state: Latest macro_regime_states row dict.
        instrument: Futures instrument ("ES", "NQ", "MES", "MNQ", "MCL").

    Returns:
        {
          "block_new_longs": bool,      # Crisis or ISM gate triggered
          "block_new_entries": bool,    # Release day gate
          "fomc_size_reduction": bool,  # True when ±1 day of FOMC
          "gate_reason": str,           # Human-readable reason
          "severity": str,              # "critical" | "warning" | "advisory"
        }
    """
    block_new_longs = False
    block_new_entries = False
    fomc_reduction = False
    reasons: list[str] = []
    severity = "advisory"

    prob_crisis = float(macro_state.get("prob_crisis", 0.0))
    crisis_gate_triggered = bool(macro_state.get("crisis_gate_triggered", False))
    fomc_proximity = macro_state.get("fomc_day_proximity")
    is_macro_release = bool(macro_state.get("macro_release_day", False))

    # Gate 1: Crisis probability
    if crisis_gate_triggered or prob_crisis > 0.60:
        if instrument in {"ES", "NQ", "MES", "MNQ"}:
            block_new_longs = True
            reasons.append(f"Crisis gate: prob_crisis={prob_crisis:.2f} > 0.60")
            severity = "critical"

    # Gate 2: Release day blackout
    if is_macro_release:
        block_new_entries = True
        reasons.append("Macro release day: no new entries ±1hr of release")
        if severity != "critical":
            severity = "warning"

    # Gate 3: FOMC proximity (size only, not block)
    if fomc_proximity is not None and abs(fomc_proximity) <= 1:
        fomc_reduction = True
        reasons.append(f"FOMC ±1 day proximity={fomc_proximity}: 50% size reduction")
        if severity == "advisory":
            severity = "warning"

    return {
        "block_new_longs": block_new_longs,
        "block_new_entries": block_new_entries,
        "fomc_size_reduction": fomc_reduction,
        "gate_reason": "; ".join(reasons) if reasons else "no gate triggered",
        "severity": severity,
    }
