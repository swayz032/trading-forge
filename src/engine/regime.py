"""Regime detection — classify market conditions for strategy filtering.

Regime labels: TRENDING_UP, TRENDING_DOWN, RANGE_BOUND, HIGH_VOL, LOW_VOL, TRANSITIONAL

Classification logic:
- ADX > 25 + MA slope positive → TRENDING_UP
- ADX > 25 + MA slope negative → TRENDING_DOWN
- ADX < 20 + ATR percentile < 30 → LOW_VOL
- ADX < 20 + ATR percentile > 70 → HIGH_VOL
- ADX < 20 + ATR percentile 30-70 → RANGE_BOUND
- Everything else → TRANSITIONAL
"""

from __future__ import annotations

import json
import math
import os
import sys
from typing import Optional

import click
import polars as pl

from src.engine.indicators.core import compute_adx, compute_atr, compute_ema


VALID_REGIMES = {
    "TRENDING_UP", "TRENDING_DOWN", "RANGE_BOUND",
    "HIGH_VOL", "LOW_VOL", "TRANSITIONAL",
}


def classify_regime(
    df: pl.DataFrame,
    adx_period: int = 14,
    atr_lookback: int = 252,
    ma_period: int = 50,
) -> dict:
    """Classify current market regime from OHLCV data.

    Args:
        df: OHLCV DataFrame (must have high, low, close columns)
        adx_period: Period for ADX calculation
        atr_lookback: Lookback for ATR percentile calculation
        ma_period: Period for trend direction MA

    Returns:
        dict with keys: regime, adx, atr_percentile, ma_slope, confidence
    """
    if len(df) < max(adx_period * 3, ma_period, 20):
        return {
            "regime": "TRANSITIONAL",
            "adx": 0.0,
            "atr_percentile": 50.0,
            "ma_slope": 0.0,
            "confidence": 0.0,
        }

    # ADX for trend strength
    adx_series = compute_adx(df, adx_period)
    current_adx = float(adx_series[-1]) if adx_series[-1] is not None else 0.0

    # ATR percentile for volatility context
    atr_series = compute_atr(df, adx_period)
    lookback = min(atr_lookback, len(df))
    recent_atrs = atr_series.tail(lookback).drop_nulls().drop_nans()
    current_atr = float(atr_series[-1]) if atr_series[-1] is not None else 0.0

    if len(recent_atrs) > 0:
        atr_rank = (recent_atrs < current_atr).sum()
        atr_percentile = float(atr_rank) / len(recent_atrs) * 100.0
    else:
        atr_percentile = 50.0

    # MA slope for trend direction
    ma = compute_ema(df["close"], ma_period)
    if len(ma) >= 5:
        slope_window = 5
        ma_recent = [float(ma[-i]) for i in range(1, slope_window + 1) if ma[-i] is not None]
        if len(ma_recent) >= 2:
            ma_slope = (ma_recent[0] - ma_recent[-1]) / len(ma_recent)
        else:
            ma_slope = 0.0
    else:
        ma_slope = 0.0

    # Sanitize NaN BEFORE classification to prevent NaN propagation
    if math.isnan(current_adx):
        current_adx = 0.0
    if math.isnan(atr_percentile):
        atr_percentile = 50.0
    if math.isnan(ma_slope):
        ma_slope = 0.0

    # Classification logic
    if current_adx > 25:
        if ma_slope > 0:
            regime = "TRENDING_UP"
            confidence = min(current_adx / 50.0, 1.0)
        else:
            regime = "TRENDING_DOWN"
            confidence = min(current_adx / 50.0, 1.0)
    elif current_adx < 20:
        if atr_percentile < 30:
            regime = "LOW_VOL"
            confidence = (30.0 - atr_percentile) / 30.0
        elif atr_percentile > 70:
            regime = "HIGH_VOL"
            confidence = (atr_percentile - 70.0) / 30.0
        else:
            regime = "RANGE_BOUND"
            confidence = (20.0 - current_adx) / 20.0
    else:
        regime = "TRANSITIONAL"
        confidence = 0.3

    return {
        "regime": regime,
        "adx": round(current_adx, 2),
        "atr_percentile": round(atr_percentile, 2),
        "ma_slope": round(ma_slope, 4),
        "confidence": round(min(max(confidence, 0.0), 1.0), 4),
    }


def should_strategy_trade(regime: str, preferred_regime: Optional[str]) -> bool:
    """Check if a strategy should trade in the current regime.

    Args:
        regime: Current regime label
        preferred_regime: Strategy's preferred regime (None = trade in all regimes)

    Returns:
        True if the strategy should trade.
    """
    if preferred_regime is None:
        return True

    # Direct match
    if regime == preferred_regime:
        return True

    # Compatible regimes
    compatible = {
        "TRENDING_UP": {"TRENDING_UP", "TRANSITIONAL"},
        "TRENDING_DOWN": {"TRENDING_DOWN", "TRANSITIONAL"},
        "RANGE_BOUND": {"RANGE_BOUND", "LOW_VOL"},
        "HIGH_VOL": {"HIGH_VOL", "TRANSITIONAL"},
        "LOW_VOL": {"LOW_VOL", "RANGE_BOUND"},
        "TRANSITIONAL": VALID_REGIMES,  # trade in any regime
    }

    allowed = compatible.get(preferred_regime, {preferred_regime})
    return regime in allowed


# ─── CLI Entry Point ──────────────────────────────────────────────

@click.command()
@click.option("--config", "config_input", required=True, help="JSON config string or file path")
def main(config_input: str):
    """Run regime detection. Outputs JSON to stdout."""
    try:
        if os.path.isfile(config_input):
            with open(config_input, 'r') as f:
                config = json.load(f)
        else:
            config = json.loads(config_input)
    except Exception as e:
        print(json.dumps({"error": f"Invalid JSON config: {e}"}))
        sys.exit(1)

    symbol = config.get("symbol", "MES")
    timeframe = config.get("timeframe", "1h")

    try:
        from src.engine.data_loader import load_ohlcv
        df = load_ohlcv(symbol, timeframe)
    except Exception as e:
        print(json.dumps({"error": f"Data load failed: {e}"}))
        sys.exit(1)

    result = classify_regime(
        df,
        adx_period=config.get("adx_period", 14),
        atr_lookback=config.get("atr_lookback", 252),
        ma_period=config.get("ma_period", 50),
    )

    result["symbol"] = symbol
    result["timeframe"] = timeframe

    print(json.dumps(result))


if __name__ == "__main__":
    main()
