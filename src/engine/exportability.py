"""Exportability scoring — assesses how well a StrategyDSL translates to Pine Script v6.

Score bands:
  90-100: Clean Pine deployment candidate
  70-89:  Pine possible with reductions
  50-69:  Alert-only export recommended
  <50:    Do not export
"""
from __future__ import annotations
import json
import sys
from typing import Optional
from pydantic import BaseModel, Field

# Indicators that have direct Pine v6 equivalents
NATIVE_PINE_INDICATORS = {
    "sma", "ema", "rsi", "atr", "vwap", "bollinger", "macd", "adx",
}

# Indicators that need custom Pine implementations (approximations)
CUSTOM_PINE_INDICATORS = {
    "volume_profile", "order_block", "fvg", "breaker_block", "liquidity_sweep",
}

# Indicators that cannot be exported to Pine
UNEXPORTABLE_INDICATORS = {
    "ml_signal", "ml", "neural_net", "neural", "external_api", "external",
}


class ExportabilityResult(BaseModel):
    score: float = Field(..., ge=0, le=100)
    band: str  # "clean" | "reducible" | "alert_only" | "do_not_export"
    indicator_scores: dict[str, float] = Field(default_factory=dict)
    deductions: list[str] = Field(default_factory=list)
    recommendations: list[str] = Field(default_factory=list)
    exportable: bool = True


def score_exportability(strategy_config: dict) -> ExportabilityResult:
    """Score a strategy's exportability to Pine Script v6.

    Args:
        strategy_config: Strategy DSL dict (from StrategyDSL.model_dump())

    Returns:
        ExportabilityResult with score, band, and details
    """
    score = 100.0
    deductions = []
    recommendations = []
    indicator_scores = {}

    # 1. Check indicators
    indicators = strategy_config.get("indicators", [])
    if not indicators:
        # Entry condition might reference indicators inline
        entry_indicator = strategy_config.get("entry_indicator", "")
        if entry_indicator:
            indicators = [{"type": entry_indicator}]

    for ind in indicators:
        ind_type = ind.get("type", "") if isinstance(ind, dict) else str(ind)
        # Normalize: strip suffixes like "_crossover", "_breakout"
        base_type = ind_type.split("_")[0] if "_" in ind_type else ind_type

        if base_type in NATIVE_PINE_INDICATORS:
            indicator_scores[ind_type] = 100.0
        elif base_type in CUSTOM_PINE_INDICATORS:
            indicator_scores[ind_type] = 70.0
            score -= 10
            deductions.append(f"'{ind_type}' requires custom Pine implementation (approximation)")
        elif base_type in UNEXPORTABLE_INDICATORS:
            indicator_scores[ind_type] = 0.0
            score -= 40
            deductions.append(f"'{ind_type}' cannot be exported to Pine")
        else:
            # Unknown — assume custom implementation needed
            indicator_scores[ind_type] = 60.0
            score -= 15
            deductions.append(f"'{ind_type}' is not in standard Pine mapping — custom code needed")

    # 2. Check entry complexity
    entry_params = strategy_config.get("entry_params", {})
    if len(entry_params) > 5:
        score -= 10
        deductions.append(f"Too many entry params ({len(entry_params)}) — Pine inputs limited")

    # 3. Check exit type compatibility
    exit_type = strategy_config.get("exit_type", "")
    if exit_type in ("fixed_target", "trailing_stop", "atr_multiple", "time_exit"):
        pass  # All directly supported in Pine
    elif exit_type == "indicator_signal":
        score -= 5
        deductions.append("Indicator-based exit may need custom Pine logic")
    else:
        score -= 15
        deductions.append(f"Exit type '{exit_type}' may not translate cleanly to Pine")

    # 4. Check for features that don't exist in Pine
    if strategy_config.get("preferred_regime"):
        score -= 5
        recommendations.append("Regime filter uses ADX+ATR — can be approximated in Pine")

    # 5. Session filter
    session = strategy_config.get("session_filter", "")
    if session and session not in ("RTH_ONLY", "ALL_SESSIONS"):
        score -= 5
        recommendations.append(f"Session filter '{session}' needs Pine time() checks")

    # Clamp
    score = max(0.0, min(100.0, score))

    # Determine band
    if score >= 90:
        band = "clean"
    elif score >= 70:
        band = "reducible"
    elif score >= 50:
        band = "alert_only"
        recommendations.append("Consider alert-only export instead of full indicator")
    else:
        band = "do_not_export"

    return ExportabilityResult(
        score=score,
        band=band,
        indicator_scores=indicator_scores,
        deductions=deductions,
        recommendations=recommendations,
        exportable=score >= 50,
    )


if __name__ == "__main__":
    # CLI: python -m src.engine.exportability --input-json <file_or_json_string>
    import argparse
    import os
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-json", required=True)
    args = parser.parse_args()

    raw = args.input_json
    if os.path.isfile(raw):
        with open(raw) as f:
            raw = f.read()
    strategy = json.loads(raw)
    result = score_exportability(strategy)
    print(json.dumps(result.model_dump(), indent=2))
