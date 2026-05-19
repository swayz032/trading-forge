"""DeepAR Regime Classifier — Converts raw quantile forecasts into regime classifications.

Post-processor that takes DeepARForecaster.predict() output and produces
deterministic regime labels with cross-instrument correlation stress detection.

Governance: experimental=true, authoritative=false, decision_role=challenger_only

Usage:
    python -m src.engine.deepar_regime_classifier --config <json>

Config keys:
    forecasts: dict[str, RegimeForecast dict] — output from deepar_forecaster predict
    historical_spreads: dict[str, float] — optional 60-day avg spread per symbol
    mode: "classify" (default)
"""
from __future__ import annotations

import json
import math
import os
import sys
import time
from typing import Literal, Optional

import numpy as np
from pydantic import BaseModel, Field


# ─── Governance Labels ──────────────────────────────────────────

GOVERNANCE = {
    "experimental": True,
    "authoritative": False,
    "decision_role": "challenger_only",
    "description": "DeepAR regime forecasts are experimental — weight starts at 0.0, auto-graduates through WF+MC validation",
}


# ─── Pydantic Models ───────────────────────────────────────────

class RegimeClassification(BaseModel):
    """Deterministic regime classification from quantile forecasts."""
    symbol: str
    # Volatility regime
    regime_label: Literal["low_vol", "normal", "high_vol", "extreme"]
    # Trend regime
    trend_label: Literal["trending", "ranging", "mean_reverting"]
    # Cross-instrument stress
    correlation_stress_label: Literal["normal", "elevated", "stressed"]
    # Raw probabilities (for downstream consumers)
    p_high_vol: float = Field(ge=0.0, le=1.0)
    p_trending: float = Field(ge=0.0, le=1.0)
    p_mean_revert: float = Field(ge=0.0, le=1.0)
    p_correlation_stress: float = Field(ge=0.0, le=1.0)
    # Confidence in classification
    confidence: float = Field(ge=0.0, le=1.0)
    # Quantiles passed through for downstream
    quantile_p10: float
    quantile_p50: float
    quantile_p90: float
    # Governance on every output
    governance_labels: dict = Field(default_factory=lambda: GOVERNANCE.copy())


class ClassificationResult(BaseModel):
    """Aggregated classification result for all symbols."""
    classifications: dict[str, dict]  # symbol -> RegimeClassification.model_dump()
    correlation_stress: float = Field(ge=0.0, le=1.0)
    correlation_stress_label: Literal["normal", "elevated", "stressed"]
    classification_date: str
    duration_ms: int
    governance_labels: dict = Field(default_factory=lambda: GOVERNANCE.copy())


# ─── Volatility Regime Thresholds ───────────────────────────────

# Spread ratio = (p90-p10) / historical_60d_avg_spread
# These thresholds map spread ratio to volatility regime labels.
VOL_THRESHOLDS = {
    "low_vol": 0.7,       # spread < 0.7x historical → low vol
    "normal": 1.3,        # 0.7x-1.3x → normal
    "high_vol": 2.0,      # 1.3x-2.0x → high vol
    # > 2.0x → extreme
}

# Trend thresholds (normalized slope relative to daily std)
TREND_THRESHOLDS = {
    "ranging": 0.3,       # |slope| < 0.3 std → ranging
    "trending": 0.8,      # |slope| > 0.8 std → trending
    # 0.3-0.8 → mean_reverting (low conviction direction)
}

# Correlation stress thresholds
STRESS_THRESHOLDS = {
    "elevated": 0.5,      # > 0.5 → elevated
    "stressed": 0.75,     # > 0.75 → stressed
}


# ─── Classification Logic ──────────────────────────────────────

def classify_regime(
    forecasts: dict,
    historical_spreads: Optional[dict] = None,
) -> dict[str, RegimeClassification]:
    """Convert raw quantile forecasts into regime classifications.

    Args:
        forecasts: Dict of symbol -> RegimeForecast dict (from DeepARForecaster.predict())
                   Each value must have: quantile_p10, quantile_p50, quantile_p90,
                   p_high_vol, p_trending, p_mean_revert, forecast_confidence
        historical_spreads: Dict of symbol -> 60-day average spread width.
                           If not provided, uses forecast's own p_high_vol probability.

    Returns:
        Dict of symbol -> RegimeClassification
    """
    historical_spreads = historical_spreads or {}

    # First compute correlation stress across all instruments
    corr_stress = compute_correlation_stress(forecasts)
    corr_stress_label = _stress_label(corr_stress)

    results: dict[str, RegimeClassification] = {}

    for symbol, forecast in forecasts.items():
        # Handle both dict and Pydantic model inputs
        if hasattr(forecast, "model_dump"):
            fc = forecast.model_dump()
        elif isinstance(forecast, dict):
            fc = forecast
        else:
            continue

        q10 = fc.get("quantile_p10", 0.0)
        q50 = fc.get("quantile_p50", 0.0)
        q90 = fc.get("quantile_p90", 0.0)
        spread_width = q90 - q10

        # Determine volatility regime
        hist_spread = historical_spreads.get(symbol)
        if hist_spread and hist_spread > 1e-8:
            spread_ratio = spread_width / hist_spread
            regime_label = _vol_regime_label(spread_ratio)
            p_high_vol = min(1.0, max(0.0, (spread_ratio - 0.8) / 1.4))
        else:
            # Use pre-computed probability from forecaster
            p_high_vol = fc.get("p_high_vol", 0.5)
            regime_label = _vol_regime_from_prob(p_high_vol)

        # Determine trend regime
        p_trending = fc.get("p_trending", 0.5)
        p_mean_revert = fc.get("p_mean_revert", 0.5)
        trend_label = _trend_label(p_trending)

        # Confidence: combine forecast confidence with regime label certainty
        forecast_conf = fc.get("forecast_confidence", 0.5)
        # Boost confidence when regime label is clearly in one camp
        label_certainty = max(p_high_vol, 1.0 - p_high_vol) * max(p_trending, p_mean_revert)
        confidence = min(1.0, (forecast_conf + label_certainty) / 2.0)

        results[symbol] = RegimeClassification(
            symbol=symbol,
            regime_label=regime_label,
            trend_label=trend_label,
            correlation_stress_label=corr_stress_label,
            p_high_vol=round(p_high_vol, 4),
            p_trending=round(p_trending, 4),
            p_mean_revert=round(p_mean_revert, 4),
            p_correlation_stress=round(corr_stress, 4),
            confidence=round(confidence, 4),
            quantile_p10=round(q10, 6),
            quantile_p50=round(q50, 6),
            quantile_p90=round(q90, 6),
        )

    return results


def compute_correlation_stress(all_forecasts: dict) -> float:
    """Measure cross-instrument agreement in volatility forecasts.

    High agreement in wide spreads = correlation stress (systemic risk).
    Low agreement or narrow spreads = normal.

    Args:
        all_forecasts: Dict of symbol -> RegimeForecast dict

    Returns:
        Float 0.0-1.0 where higher = more stress
    """
    if len(all_forecasts) < 2:
        return 0.0

    spread_widths = []
    p_high_vols = []

    for symbol, forecast in all_forecasts.items():
        if hasattr(forecast, "model_dump"):
            fc = forecast.model_dump()
        elif isinstance(forecast, dict):
            fc = forecast
        else:
            continue

        q10 = fc.get("quantile_p10", 0.0)
        q90 = fc.get("quantile_p90", 0.0)
        spread_widths.append(q90 - q10)
        p_high_vols.append(fc.get("p_high_vol", 0.5))

    if not spread_widths:
        return 0.0

    arr_spreads = np.array(spread_widths)
    arr_pvols = np.array(p_high_vols)

    # Mean high-vol probability across instruments
    mean_high_vol = float(np.mean(arr_pvols))

    # Agreement: low coefficient of variation in spreads = high agreement
    spread_mean = float(np.mean(arr_spreads))
    spread_std = float(np.std(arr_spreads))

    if spread_mean > 1e-8:
        cv = spread_std / spread_mean  # Coefficient of variation
        agreement = max(0.0, 1.0 - cv)  # 0 = total disagreement, 1 = perfect agreement
    else:
        agreement = 0.5

    # Stress = agreement * mean_high_vol
    # High stress only when instruments AGREE that vol is high
    stress = agreement * mean_high_vol

    # Clamp to [0, 1]
    return min(1.0, max(0.0, stress))


# ─── Label Helpers ──────────────────────────────────────────────

def _vol_regime_label(spread_ratio: float) -> Literal["low_vol", "normal", "high_vol", "extreme"]:
    """Map spread ratio to volatility regime label."""
    if spread_ratio < VOL_THRESHOLDS["low_vol"]:
        return "low_vol"
    elif spread_ratio < VOL_THRESHOLDS["normal"]:
        return "normal"
    elif spread_ratio < VOL_THRESHOLDS["high_vol"]:
        return "high_vol"
    else:
        return "extreme"


def _vol_regime_from_prob(p_high_vol: float) -> Literal["low_vol", "normal", "high_vol", "extreme"]:
    """Map p_high_vol probability to regime label when no historical spread available."""
    if p_high_vol < 0.2:
        return "low_vol"
    elif p_high_vol < 0.5:
        return "normal"
    elif p_high_vol < 0.8:
        return "high_vol"
    else:
        return "extreme"


def _trend_label(p_trending: float) -> Literal["trending", "ranging", "mean_reverting"]:
    """Map p_trending to trend label."""
    if p_trending > 0.65:
        return "trending"
    elif p_trending < 0.35:
        return "mean_reverting"
    else:
        return "ranging"


def _stress_label(stress: float) -> Literal["normal", "elevated", "stressed"]:
    """Map stress score to label."""
    if stress >= STRESS_THRESHOLDS["stressed"]:
        return "stressed"
    elif stress >= STRESS_THRESHOLDS["elevated"]:
        return "elevated"
    else:
        return "normal"


# ─── CLI Entry Point ────────────────────────────────────────────

def main():
    """CLI: python -m src.engine.deepar_regime_classifier --config <json>"""
    import argparse

    parser = argparse.ArgumentParser(description="DeepAR Regime Classifier")
    parser.add_argument("--config", required=True, help="JSON config string or file path")
    args = parser.parse_args()

    # Load config (file path or inline JSON — matches python-runner.ts pattern)
    config_input = args.config
    if os.path.isfile(config_input):
        with open(config_input) as f:
            raw_config = json.load(f)
    else:
        raw_config = json.loads(config_input)

    start_ms = int(time.time() * 1000)

    # Extract metadata
    _metadata = raw_config.pop("_metadata", {})

    forecasts = raw_config.get("forecasts", {})
    historical_spreads = raw_config.get("historical_spreads", {})

    if not forecasts:
        print(json.dumps({"error": "No forecasts provided in config"}), file=sys.stderr)
        sys.exit(1)

    classifications = classify_regime(forecasts, historical_spreads)

    # Compute overall correlation stress
    corr_stress = compute_correlation_stress(forecasts)

    duration_ms = int(time.time() * 1000) - start_ms

    result = ClassificationResult(
        classifications={k: v.model_dump() for k, v in classifications.items()},
        correlation_stress=round(corr_stress, 4),
        correlation_stress_label=_stress_label(corr_stress),
        classification_date=time.strftime("%Y-%m-%d"),
        duration_ms=duration_ms,
    )

    print(json.dumps(result.model_dump(), indent=2))


if __name__ == "__main__":
    main()
