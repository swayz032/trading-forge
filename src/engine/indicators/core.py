"""Indicator library — pure Polars, no vectorbt dependency.

Column naming convention:
  sma_20, ema_9, rsi_14, atr_14,
  bb_upper_20, bb_middle_20, bb_lower_20,
  macd_line, macd_signal, macd_hist, vwap
"""

from __future__ import annotations

import polars as pl

from src.engine.config import IndicatorConfig


def compute_sma(series: pl.Series, period: int) -> pl.Series:
    """Simple Moving Average: rolling_mean(period)."""
    return series.rolling_mean(window_size=period)


def compute_ema(series: pl.Series, period: int) -> pl.Series:
    """Exponential Moving Average: ewm_mean(span=period)."""
    return series.ewm_mean(span=period)


def compute_rsi(series: pl.Series, period: int) -> pl.Series:
    """Relative Strength Index using EWM gains/losses."""
    delta = series.diff()
    gains = delta.clip(lower_bound=0.0)
    losses = (-delta).clip(lower_bound=0.0)

    avg_gain = gains.ewm_mean(span=period)
    avg_loss = losses.ewm_mean(span=period)

    rs = avg_gain / avg_loss
    rsi = 100.0 - (100.0 / (1.0 + rs))
    return rsi


def compute_atr(df: pl.DataFrame, period: int) -> pl.Series:
    """Average True Range using EWM."""
    high = df["high"]
    low = df["low"]
    prev_close = df["close"].shift(1)

    tr1 = high - low
    tr2 = (high - prev_close).abs()
    tr3 = (low - prev_close).abs()

    # True range = max of the three components
    true_range = pl.DataFrame({"tr1": tr1, "tr2": tr2, "tr3": tr3}).max_horizontal()

    return true_range.ewm_mean(span=period)


def compute_adx(df: pl.DataFrame, period: int = 14) -> pl.Series:
    """Average Directional Index: measures trend strength (0-100).

    ADX > 25 = trending, ADX < 20 = ranging.
    Uses +DI and -DI from directional movement.
    """
    high = df["high"]
    low = df["low"]
    prev_high = high.shift(1)
    prev_low = low.shift(1)

    # Directional movement
    plus_dm_raw = (high - prev_high).clip(lower_bound=0.0)
    minus_dm_raw = (prev_low - low).clip(lower_bound=0.0)

    # Zero out when the other is larger — evaluate via select to get Series
    plus_mask = plus_dm_raw > minus_dm_raw
    minus_mask = minus_dm_raw > plus_dm_raw
    temp = df.select([
        pl.when(plus_mask).then(plus_dm_raw).otherwise(0.0).alias("plus_dm"),
        pl.when(minus_mask).then(minus_dm_raw).otherwise(0.0).alias("minus_dm"),
    ])
    plus_dm = temp["plus_dm"]
    minus_dm = temp["minus_dm"]

    # Smooth with EWM (same as ATR)
    atr = compute_atr(df, period)
    # Guard against zero ATR
    safe_atr = atr.fill_null(1.0)
    safe_atr = pl.Series([max(v, 1e-10) if v is not None else 1e-10 for v in safe_atr.to_list()])
    plus_di = 100.0 * plus_dm.ewm_mean(span=period) / safe_atr
    minus_di = 100.0 * minus_dm.ewm_mean(span=period) / safe_atr

    # DX and ADX — guard against zero di_sum
    di_sum = plus_di + minus_di
    di_diff = (plus_di - minus_di).abs()
    safe_di_sum = pl.Series([max(v, 1e-10) if v is not None and v == v else 1e-10 for v in di_sum.to_list()])
    dx = 100.0 * di_diff / safe_di_sum
    adx = dx.fill_nan(0.0).ewm_mean(span=period)

    return adx


def compute_adr(df: pl.DataFrame, period: int = 14) -> pl.Series:
    """Average Day Range: rolling average of (high - low).

    Used for session range expectations.
    """
    day_range = df["high"] - df["low"]
    return day_range.rolling_mean(window_size=period)


def compute_macd(
    series: pl.Series,
    fast: int = 12,
    slow: int = 26,
    signal: int = 9,
) -> tuple[pl.Series, pl.Series, pl.Series]:
    """MACD: EMA(fast) - EMA(slow), signal = EMA of MACD line."""
    ema_fast = compute_ema(series, fast)
    ema_slow = compute_ema(series, slow)
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm_mean(span=signal)
    histogram = macd_line - signal_line
    return macd_line, signal_line, histogram


def compute_bbands(
    series: pl.Series,
    period: int,
    std_dev: float = 2.0,
) -> tuple[pl.Series, pl.Series, pl.Series]:
    """Bollinger Bands: SMA ± std_dev × rolling_std."""
    middle = compute_sma(series, period)
    rolling_std = series.rolling_std(window_size=period)
    upper = middle + std_dev * rolling_std
    lower = middle - std_dev * rolling_std
    return upper, middle, lower


def compute_vwap(df: pl.DataFrame) -> pl.Series:
    """VWAP: cumulative(typical_price × volume) / cumulative(volume).

    Resets daily based on ts_event date.
    """
    typical_price = (df["high"] + df["low"] + df["close"]) / 3.0
    tp_vol = typical_price * df["volume"]

    # Extract date for daily reset
    dates = df["ts_event"].cast(pl.Date)

    # Build a temporary DataFrame for grouped cumsum
    temp = pl.DataFrame({
        "date": dates,
        "tp_vol": tp_vol,
        "volume": df["volume"],
    })

    result = temp.with_columns([
        pl.col("tp_vol").cum_sum().over("date").alias("cum_tp_vol"),
        pl.col("volume").cum_sum().over("date").alias("cum_vol"),
    ])

    vwap = result["cum_tp_vol"] / result["cum_vol"]
    return vwap


def compute_indicators(
    df: pl.DataFrame,
    indicator_configs: list[IndicatorConfig],
) -> pl.DataFrame:
    """Dispatcher: compute all indicators and add columns to DataFrame."""
    result = df.clone()

    for cfg in indicator_configs:
        if cfg.type == "sma":
            col = compute_sma(df["close"], cfg.period)
            result = result.with_columns(col.alias(f"sma_{cfg.period}"))

        elif cfg.type == "ema":
            col = compute_ema(df["close"], cfg.period)
            result = result.with_columns(col.alias(f"ema_{cfg.period}"))

        elif cfg.type == "rsi":
            col = compute_rsi(df["close"], cfg.period)
            result = result.with_columns(col.alias(f"rsi_{cfg.period}"))

        elif cfg.type == "atr":
            col = compute_atr(df, cfg.period)
            result = result.with_columns(col.alias(f"atr_{cfg.period}"))

        elif cfg.type == "macd":
            fast = cfg.fast or 12
            slow = cfg.slow or 26
            signal = cfg.signal or 9
            macd_line, signal_line, histogram = compute_macd(
                df["close"], fast, slow, signal
            )
            result = result.with_columns([
                macd_line.alias("macd_line"),
                signal_line.alias("macd_signal"),
                histogram.alias("macd_hist"),
            ])

        elif cfg.type == "bbands":
            upper, middle, lower = compute_bbands(
                df["close"], cfg.period, cfg.std_dev
            )
            result = result.with_columns([
                upper.alias(f"bb_upper_{cfg.period}"),
                middle.alias(f"bb_middle_{cfg.period}"),
                lower.alias(f"bb_lower_{cfg.period}"),
            ])

        elif cfg.type == "vwap":
            col = compute_vwap(df)
            result = result.with_columns(col.alias("vwap"))

        elif cfg.type == "adx":
            col = compute_adx(df, cfg.period)
            result = result.with_columns(col.alias(f"adx_{cfg.period}"))

        elif cfg.type == "adr":
            col = compute_adr(df, cfg.period)
            result = result.with_columns(col.alias(f"adr_{cfg.period}"))

    return result
