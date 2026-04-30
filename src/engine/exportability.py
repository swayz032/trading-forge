"""Exportability scoring — assesses how well a StrategyDSL translates to Pine Script v5.

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

# Indicators that have direct Pine v5 equivalents
NATIVE_PINE_INDICATORS = {
    "sma", "ema", "rsi", "atr", "vwap", "bollinger", "macd", "adx",
}

# Indicators explicitly mapped to None in INDICATOR_MAP (pine_compiler.py) — the compiler
# has a placeholder path for these (returns a comment, not a real implementation).
# They are NOT fully unsupported (no crash), but they produce no real Pine logic.
# Deduction: -50 to match the "unknown type" path, ensuring exportable=False for any
# strategy whose primary indicator is None-mapped.  Scorer message uses "no Pine equivalent"
# so it aligns with the compiler's ValueError message and downstream test assertions.
# NOTE: keep this set in sync with INDICATOR_MAP keys that map to None in pine_compiler.py.
NONE_MAPPED_INDICATORS = {
    "volume_profile",  # INDICATOR_MAP["volume_profile"] = None — placeholder only
}

# ICT structural indicators: no Pine equivalent in INDICATOR_MAP.
# Deduction is -25 each so a strategy with 2 ICT indicators scores ≤50 → exportable=False.
# Path B (real Pine approximations) is a separate engineering project; do not conflate.
ICT_NO_PINE_INDICATORS = {
    "order_block", "fvg", "breaker_block", "liquidity_sweep",
}

# Indicators that need custom Pine implementations (approximations) but DO produce
# valid (approximate) Pine.  Distinct from NONE_MAPPED_INDICATORS (no Pine at all).
CUSTOM_PINE_INDICATORS: set[str] = set()  # Currently empty — volume_profile promoted to NONE_MAPPED

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
    """Score a strategy's exportability to Pine Script v5.

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
        elif ind_type in ICT_NO_PINE_INDICATORS:
            # Match on full ind_type, not base_type: ICT names are multi-word (order_block,
            # breaker_block, liquidity_sweep) so base_type stripping would truncate them to
            # "order", "breaker", "liquidity" — none of which are in the set. We intentionally
            # bypass the base_type normalisation here.
            # -30 per ICT indicator: one ICT indicator scores 70 (alert_only band, exportable=True
            # but strongly warned). Two ICT indicators score 40 (do_not_export, exportable=False).
            # This matches the compiler's actual behaviour: _build_pine_indicator_var raises
            # ValueError for these types, so compile_dual_artifacts produces zero artifacts.
            # Score must be strictly < 50 for exportable=False (threshold: score >= 50).
            # Using -25 would land exactly at 50 (True) with two indicators — that still lies.
            indicator_scores[ind_type] = 0.0
            score -= 30
            deductions.append(
                f"'{ind_type}' has no Pine equivalent — strategy will not produce a Pine artifact. "
                "Consider non-ICT entry conditions for export."
            )
        elif ind_type in NONE_MAPPED_INDICATORS or base_type in NONE_MAPPED_INDICATORS:
            # Explicitly mapped to None in INDICATOR_MAP: the compiler produces a placeholder
            # comment but no real Pine logic.  Deduct -50 (same as unknown type) so any
            # strategy with a None-mapped primary indicator scores exportable=False.
            # Message uses "no Pine equivalent" / "INDICATOR_MAP" to align with compiler output
            # and downstream test assertions.
            indicator_scores[ind_type] = 0.0
            score -= 50
            deductions.append(
                f"'{ind_type}' has no Pine equivalent in INDICATOR_MAP (mapped to None) — "
                "compiler emits a placeholder comment only. Manual Pine implementation required."
            )
        elif ind_type in CUSTOM_PINE_INDICATORS or base_type in CUSTOM_PINE_INDICATORS:
            # Approximate Pine implementation exists — partial parity.
            indicator_scores[ind_type] = 70.0
            score -= 10
            deductions.append(f"'{ind_type}' requires custom Pine implementation (approximation)")
        elif base_type in UNEXPORTABLE_INDICATORS:
            indicator_scores[ind_type] = 0.0
            score -= 40
            deductions.append(f"'{ind_type}' cannot be exported to Pine")
        else:
            # Unknown — not in INDICATOR_MAP; compiler will raise ValueError.
            # Penalize -50 so any strategy with 1+ unknown indicator scores <= 50
            # (exportable=False), aligning scorer with actual compiler behaviour.
            # Previously -15 was dishonest: it produced exportable=True (score ~85)
            # while the compiler crashed on the unknown type.
            indicator_scores[ind_type] = 0.0
            score -= 50
            deductions.append(
                f"'{ind_type}' is not in INDICATOR_MAP — compiler will raise ValueError. "
                "Add to INDICATOR_MAP or remove from strategy before exporting."
            )

    # 2. Check entry complexity
    entry_params = strategy_config.get("entry_params", {})
    if len(entry_params) > 5:
        score -= 10
        deductions.append(f"Too many entry params ({len(entry_params)}) — Pine inputs limited")

    # 3. Check exit type compatibility
    exit_type = strategy_config.get("exit_type", "")
    if exit_type in ("fixed_target", "atr_multiple"):
        pass  # Directly supported in Pine — no deduction
    elif exit_type == "trailing_stop":
        # Pine strategy.exit(trail_offset=...) is only available in strategy() context.
        # The INDICATOR artifact cannot faithfully implement trailing stop — it degrades to
        # a fixed ATR stop. This changes exit timing materially for intrabar moves.
        score -= 20
        deductions.append(
            "exit_type='trailing_stop': INDICATOR artifact degrades to fixed ATR stop "
            "(strategy.exit trail_offset not available in indicator() context). "
            "Use STRATEGY artifact for trailing stop export."
        )
    elif exit_type == "time_exit":
        # Bar-count exit semantics are silently lost in the indicator artifact path:
        # Pine bar_index arithmetic approximates but does not replicate exact session-bar
        # counting (e.g. partial bars at session boundaries behave differently).
        score -= 15
        deductions.append(
            "exit_type='time_exit': bar-count exit semantics are approximated in Pine "
            "(session-boundary partial bars behave differently). Verify exit timing in TradingView."
        )
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
