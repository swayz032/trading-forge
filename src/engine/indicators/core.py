"""Indicator library — pure Polars, no vectorbt dependency.

Column naming convention:
  sma_20, ema_9, rsi_14, atr_14,
  bb_upper_20, bb_middle_20, bb_lower_20,
  macd_line, macd_signal, macd_hist, vwap,
  vwap_band_1s_upper, vwap_band_1s_lower,
  vwap_band_2s_upper, vwap_band_2s_lower,
  anchored_vwap_<anchor_iso>
"""

from __future__ import annotations

from datetime import datetime

import numpy as np
import polars as pl

from src.engine.config import IndicatorConfig


def compute_sma(series: pl.Series, period: int) -> pl.Series:
    """Simple Moving Average: rolling_mean(period)."""
    return series.rolling_mean(window_size=period)


def compute_ema(series: pl.Series, period: int) -> pl.Series:
    """Exponential Moving Average: ewm_mean(span=period)."""
    return series.ewm_mean(span=period)



def _wilder_rma(values, period):
    """Wilder RMA: seed=SMA(first period), recur=(rma*(p-1)+v)/p. F-1/F-2 2026-05-20."""
    n = len(values)
    out = np.full(n, np.nan, dtype=np.float64)
    seed_start = 0
    while seed_start < n and np.isnan(values[seed_start]):
        seed_start += 1
    seed_end = seed_start + period
    if seed_end > n:
        return out
    seed_slice = values[seed_start:seed_end]
    if np.any(np.isnan(seed_slice)):
        return out
    rma = float(np.mean(seed_slice))
    out[seed_end - 1] = rma
    for i in range(seed_end, n):
        v = values[i]
        if np.isnan(v):
            out[i] = np.nan
        else:
            rma = (rma * (period - 1) + v) / period
            out[i] = rma
    return out

def compute_rsi(series: pl.Series, period: int) -> pl.Series:
    """RSI via Wilder RMA. F-1+F-3 fix 2026-05-20.

    F-1: Wilder RMA instead of EWM (matches TradingView).
    F-3: warmup=NaN (no fill_nan(50)). NaN comparisons -> False in signals.
    np.where(NaN>0)=False => gains[0]=losses[0]=0.0, first RSI at period-1.
    """
    delta = series.diff()
    delta_np = delta.to_numpy().astype(np.float64)
    gains_np = np.where(delta_np > 0, delta_np, 0.0)
    losses_np = np.where(delta_np < 0, -delta_np, 0.0)
    avg_gain = _wilder_rma(gains_np, period)
    avg_loss = _wilder_rma(losses_np, period)
    with np.errstate(divide='ignore', invalid='ignore'):
        rs = avg_gain / avg_loss
    rsi = 100.0 - (100.0 / (1.0 + rs))
    return pl.Series(series.name or 'rsi', rsi, dtype=pl.Float64)


def compute_atr(df: pl.DataFrame, period: int) -> pl.Series:
    """ATR via Wilder RMA. F-2 fix 2026-05-20. Matches TradingView ta.atr()."""
    high = df["high"]
    low = df["low"]
    prev_close = df["close"].shift(1)

    tr1 = high - low
    tr2 = (high - prev_close).abs()
    tr3 = (low - prev_close).abs()

    # True range = max of the three components
    true_range = pl.DataFrame({"tr1": tr1, "tr2": tr2, "tr3": tr3}).max_horizontal()

    tr_np = true_range.to_numpy().astype(np.float64)
    atr_np = _wilder_rma(tr_np, period)
    return pl.Series("atr", atr_np, dtype=pl.Float64)


def compute_donchian(df: pl.DataFrame, period: int):
    """Donchian channel upper/lower with shift(1) to prevent lookahead.
    F-7 fix 2026-05-20. Emits donchian_upper_{N}, donchian_lower_{N}.
    """
    upper = df["high"].rolling_max(window_size=period).shift(1)
    lower = df["low"].rolling_min(window_size=period).shift(1)
    return upper, lower

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
    plus_di = 100.0 * plus_dm.ewm_mean(alpha=1.0 / period, adjust=False) / safe_atr
    minus_di = 100.0 * minus_dm.ewm_mean(alpha=1.0 / period, adjust=False) / safe_atr

    # DX and ADX — guard against zero di_sum
    di_sum = plus_di + minus_di
    di_diff = (plus_di - minus_di).abs()
    safe_di_sum = pl.Series([max(v, 1e-10) if v is not None and v == v else 1e-10 for v in di_sum.to_list()])
    dx = 100.0 * di_diff / safe_di_sum
    adx = dx.fill_nan(0.0).ewm_mean(alpha=1.0 / period, adjust=False)

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

    # Extract date for daily reset (prefer ET timezone if available)
    ts_col = "ts_et" if "ts_et" in df.columns else "ts_event"
    dates = df[ts_col].dt.date()

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

    # Guard: zero-volume bars at day start → cum_vol=0 → NaN/inf; fill forward from last valid VWAP
    safe_cum_vol = result["cum_vol"].replace(0, None)
    vwap = (result["cum_tp_vol"] / safe_cum_vol).fill_null(strategy="forward").fill_null(0.0)
    return vwap


def _assign_globex_session_id(df: pl.DataFrame) -> pl.Series:
    """Assign an integer session_id that resets at 18:00 ET (Globex open).

    Globex session starts at 18:00 ET (after the 17:00-18:00 maintenance pause).
    Each new Globex trading day increments the session_id.

    Globex trading date convention:
        Bars from 18:00 ET onward belong to the NEXT calendar date's session.
        e.g. bars at 2026-01-02 18:00 ET through 2026-01-03 17:59 ET all belong
        to the "2026-01-03 Globex session" (session_date = calendar_date + 1 day
        if hour >= 18, else calendar_date).

    This correctly handles:
        - Multiple consecutive bars within the 18:xx hour (18:00, 18:05, 18:10...)
        - Sessions that skip directly from 18:45 to next-day 18:00 (no gap bars)
        - Intraday-only data (e.g. 09:30–16:00 only): all bars get the same session_id

    Args:
        df: DataFrame with ts_event (naive datetime, treated as ET wall-clock) or ts_et.

    Returns:
        Integer Series of session IDs, same length as df. Groups are not necessarily
        contiguous integers starting at 0 — use them only as group labels for over().
    """
    import polars as pl

    ts_col = "ts_et" if "ts_et" in df.columns else "ts_event"
    ts = df[ts_col]

    hour = ts.dt.hour().cast(pl.Int32)
    date = ts.dt.date()

    # Globex session date: add 1 day to calendar date for bars at hour >= 18.
    # This groups overnight bars with the next day's session correctly.
    # Use Polars duration arithmetic: pl.duration(days=1) for offset.
    # Assign session_id as a dense integer by converting globex_date to ordinal.
    # pl.Series.dt.epoch_days() gives days-since-epoch — unique per calendar date.
    # Work inside a DataFrame to use select() for the conditional.
    work = pl.DataFrame({
        "hour": hour,
        "date": date,
    }).select(
        pl.when(pl.col("hour") >= 18)
        .then(pl.col("date") + pl.duration(days=1))
        .otherwise(pl.col("date"))
        .alias("globex_date")
    )

    # epoch_days() returns Int32 — usable directly as a group label
    session_id = work["globex_date"].cast(pl.Datetime).dt.epoch(time_unit="d")
    return session_id


def compute_vwap_with_bands(
    bars: pl.DataFrame,
    typical_price_col: str = "typical_price",
) -> pl.DataFrame:
    """Computes session VWAP + 1-sigma + 2-sigma bands using cumulative TPV math.

    Adds columns:
        vwap               — session VWAP (backward-compat: same values as compute_vwap)
        vwap_band_1s_upper — VWAP + 1*sigma
        vwap_band_1s_lower — VWAP - 1*sigma
        vwap_band_2s_upper — VWAP + 2*sigma
        vwap_band_2s_lower — VWAP - 2*sigma

    Session-resetting: resets at the 18:00 ET Globex session boundary.

    Institutional formula (running population variance):
        cum_pv  = cumsum(tp * vol)
        cum_v   = cumsum(vol)
        vwap    = cum_pv / cum_v
        cum_pv2 = cumsum((tp - vwap)^2 * vol)
        sigma   = sqrt(cum_pv2 / cum_v)
        upper1  = vwap + 1*sigma
        lower1  = vwap - 1*sigma
        upper2  = vwap + 2*sigma
        lower2  = vwap - 2*sigma

    Zero-volume safety: cum_vol=0 → bands collapse to the running VWAP (no NaN/inf
    propagation). Fill-forward applied to handle zero-volume bars at session open.

    Pure function over Polars. No I/O. Immutable input.

    Args:
        bars: DataFrame with high, low, close, volume, and a ts_event or ts_et column.
        typical_price_col: If already present in bars, used directly. Otherwise
            computed as (high + low + close) / 3.

    Returns:
        bars with 5 new columns added (vwap, vwap_band_1s_upper, vwap_band_1s_lower,
        vwap_band_2s_upper, vwap_band_2s_lower). All Float64.
    """
    result = bars.clone()

    # Typical price
    if typical_price_col in bars.columns:
        tp = bars[typical_price_col]
    else:
        tp = (bars["high"] + bars["low"] + bars["close"]) / 3.0

    vol = bars["volume"]
    tp_vol = tp * vol

    # Assign Globex session IDs for reset boundaries
    session_id = _assign_globex_session_id(bars)

    # Build working frame for vectorized grouped operations
    work = pl.DataFrame({
        "session_id": session_id,
        "tp": tp,
        "vol": vol,
        "tp_vol": tp_vol,
    })

    # Step 1: cum_pv and cum_v per session
    work = work.with_columns([
        pl.col("tp_vol").cum_sum().over("session_id").alias("cum_pv"),
        pl.col("vol").cum_sum().over("session_id").alias("cum_v"),
    ])

    # Guard against zero cumulative volume
    safe_cum_v = pl.when(pl.col("cum_v") == 0).then(None).otherwise(pl.col("cum_v"))
    work = work.with_columns(safe_cum_v.alias("safe_cum_v"))

    # Step 2: VWAP per bar
    work = work.with_columns(
        (pl.col("cum_pv") / pl.col("safe_cum_v"))
        .fill_null(strategy="forward")
        .fill_null(0.0)
        .alias("vwap")
    )

    # Step 3: Running variance component (tp - vwap)^2 * vol, cumsum per session
    work = work.with_columns(
        ((pl.col("tp") - pl.col("vwap")) ** 2 * pl.col("vol"))
        .cum_sum()
        .over("session_id")
        .alias("cum_pv2")
    )

    # Step 4: sigma = sqrt(cum_pv2 / cum_v); protect against zero-vol and near-zero sigma
    work = work.with_columns(
        (pl.col("cum_pv2") / pl.col("safe_cum_v"))
        .fill_null(0.0)
        .sqrt()
        .alias("sigma")
    )

    # Step 5: Emit bands
    result = result.with_columns([
        work["vwap"].alias("vwap"),
        (work["vwap"] + work["sigma"]).alias("vwap_band_1s_upper"),
        (work["vwap"] - work["sigma"]).alias("vwap_band_1s_lower"),
        (work["vwap"] + 2.0 * work["sigma"]).alias("vwap_band_2s_upper"),
        (work["vwap"] - 2.0 * work["sigma"]).alias("vwap_band_2s_lower"),
    ])

    return result


def compute_anchored_vwap(
    bars: pl.DataFrame,
    anchor_ts: datetime,
    typical_price_col: str = "typical_price",
) -> pl.DataFrame:
    """Anchored VWAP: cumulative VWAP starting from anchor_ts.

    Adds column:
        anchored_vwap_<anchor_iso> — Float64; null before anchor_ts, running VWAP from anchor onward.

    The column name is derived from anchor_ts.isoformat() with colons replaced by
    underscores and fractional seconds stripped — safe for Polars column names.
    Example: anchor_ts=datetime(2026,1,3,9,30) → column='anchored_vwap_2026-01-03T09_30_00'

    Backward compat: existing single `vwap` column is UNCHANGED. This function
    does not touch any pre-existing columns.

    Pure function. No I/O. Immutable input.

    Args:
        bars: DataFrame with high, low, close, volume, and ts_event (datetime).
        anchor_ts: The timestamp from which cumulative VWAP accumulates.
            Bars with ts_event < anchor_ts receive null.
            The anchor bar itself (ts_event == anchor_ts) is the first bar included.
        typical_price_col: If already present in bars, used directly. Otherwise
            computed as (high + low + close) / 3.

    Returns:
        bars with one additional column named anchored_vwap_<anchor_iso>.
    """
    # Build a safe ISO column name: replace colons and dots
    iso_raw = anchor_ts.isoformat()
    iso_safe = iso_raw.replace(":", "_").split(".")[0]  # strip sub-second precision
    col_name = f"anchored_vwap_{iso_safe}"

    ts_col = "ts_event"  # anchored VWAP always keys from ts_event (UTC-stable)
    ts = bars[ts_col]

    # Typical price
    if typical_price_col in bars.columns:
        tp = bars[typical_price_col]
    else:
        tp = (bars["high"] + bars["low"] + bars["close"]) / 3.0

    vol = bars["volume"]

    # Mask: only bars at or after anchor_ts contribute.
    # `at_or_after` is a boolean Series used for vectorized masking.
    at_or_after = ts >= anchor_ts

    # Build a working DataFrame using Series (not Expr) — pl.when(Series) returns Expr
    # which cannot be passed to pl.DataFrame(). Evaluate via select() instead.
    tp_vol_series = tp * vol  # Series

    # Evaluate the pl.when expressions via a temporary DataFrame select
    work = pl.DataFrame({
        "at_or_after": at_or_after,
        "tp_vol": tp_vol_series,
        "vol": vol,
    }).select([
        pl.when(pl.col("at_or_after")).then(pl.col("tp_vol")).otherwise(0.0).alias("masked_tp_vol"),
        pl.when(pl.col("at_or_after")).then(pl.col("vol")).otherwise(0.0).alias("masked_vol"),
    ]).with_columns([
        pl.col("masked_tp_vol").cum_sum().alias("cum_pv"),
        pl.col("masked_vol").cum_sum().alias("cum_v"),
    ])

    # Guard zero cumulative volume (pre-anchor rows have cum_v=0)
    # avwap_raw: cumulative VWAP or null when cum_v==0
    avwap_raw_vals = work.select(
        pl.when(pl.col("cum_v") > 0)
        .then(pl.col("cum_pv") / pl.col("cum_v"))
        .otherwise(None)
        .alias("avwap_raw")
    )["avwap_raw"]

    # Apply null mask: pre-anchor rows must be null regardless of the zero-guard
    # Use the at_or_after boolean Series to mask the final result
    avwap_col = pl.DataFrame({
        "at_or_after": at_or_after,
        "avwap_raw": avwap_raw_vals,
    }).select(
        pl.when(pl.col("at_or_after")).then(pl.col("avwap_raw")).otherwise(None).alias(col_name)
    )[col_name]

    return bars.with_columns(avwap_col)


def compute_opening_range_breakout(
    df: pl.DataFrame,
    range_minutes: int = 15,
    session_start_et: str = "09:30",
) -> tuple[pl.Series, pl.Series, pl.Series]:
    """Compute opening-range high/low/range for each trading session.

    Returns a 3-tuple: (orh_series, orl_series, or_range_series)

    Column semantics (when joined back via compute_indicators dispatcher):
      orh_{range_minutes}m : float  — opening range high (locked once range completes)
      orl_{range_minutes}m : float  — opening range low
      or_range_{range_minutes}m : float — orh - orl

    Correctness invariants:
      - ET timezone (use ts_et if available; else treat ts_event as wall-clock ET)
      - Range LOCKS at session_start_et + range_minutes (e.g. 09:45 ET for 15-min OR)
      - Values BEFORE the lock time are None (no lookahead — not forward-fillable)
      - Resets each trading day
      - 09:30 ET start aligns with NYSE/CME RTH open
    """
    n = len(df)

    # Return empty series for empty input
    if n == 0:
        null_float = pl.Series([], dtype=pl.Float64)
        return null_float, null_float, null_float

    # ── Resolve timestamp column ──────────────────────────────────────
    # Prefer ts_et (already ET wall-clock); fall back to ts_event (treated as ET).
    ts_col = "ts_et" if "ts_et" in df.columns else "ts_event"
    ts = df[ts_col]

    # Extract date and time-of-day components
    # Cast to Int32 before arithmetic: dt.hour() / dt.minute() return i8 in Polars,
    # which overflows for values > 127 (e.g. 570 = 9*60+30 would wrap on i8).
    dates = ts.dt.date()
    hours = ts.dt.hour().cast(pl.Int32)
    minutes = ts.dt.minute().cast(pl.Int32)
    time_minutes = hours * 60 + minutes  # minutes since midnight (Int32)

    # ── Parse session_start_et ────────────────────────────────────────
    start_hh, start_mm = (int(x) for x in session_start_et.split(":"))
    start_total_minutes = start_hh * 60 + start_mm
    lock_total_minutes = start_total_minutes + range_minutes

    # ── Per-day: compute max(high) and min(low) for bars in [start, lock) ───
    # Build a working frame to use Polars grouped aggregations
    temp = pl.DataFrame({
        "date": dates,
        "time_min": time_minutes,
        "high": df["high"],
        "low": df["low"],
    })

    # Rows that fall inside the opening range window
    in_range_mask = (temp["time_min"] >= start_total_minutes) & (temp["time_min"] < lock_total_minutes)

    or_rows = temp.filter(in_range_mask)

    if len(or_rows) == 0:
        # No in-range bars at all → all null
        null_series = pl.Series([None] * n, dtype=pl.Float64)
        return null_series, null_series, null_series

    # Aggregate per day
    day_or = or_rows.group_by("date").agg([
        pl.col("high").max().alias("orh"),
        pl.col("low").min().alias("orl"),
    ])

    # ── Join day aggregates back to all rows ─────────────────────────
    full = temp.with_columns([
        pl.col("date"),
        pl.col("time_min"),
    ]).join(day_or, on="date", how="left")

    # ── Apply lock mask: pre-lock rows get None ───────────────────────
    # A bar at lock_total_minutes or later is post-lock; earlier bars are null.
    #
    # PERFORMANCE FIX (2026-05-20): The original implementation used three Python
    # list comprehensions iterating range(n) and accessing Polars Series via [i]
    # scalar indexing. Each series[i] access crosses the Python/Rust boundary,
    # making the total cost O(n) scalar extractions with high per-call overhead.
    # At n=46K bars (MES 5m, 1 year) × 5 walk-forward windows this caused
    # 23-minute runtimes on 3-month windows and 30-minute timeouts on full-year
    # windows for ORB-MES-15m and CL-MCL-5m strategies.
    #
    # Fix: use pl.when().then().otherwise() — vectorized conditional executed
    # entirely in the Polars Rust engine. Zero Python per-element overhead.
    # Output semantics are IDENTICAL: pre-lock rows are null, post-lock rows
    # carry the day's OR values. Column names, dtypes, and null patterns unchanged.
    full = full.with_columns([
        pl.when(pl.col("time_min") >= lock_total_minutes)
          .then(pl.col("orh"))
          .otherwise(None)
          .alias("orh_locked"),
        pl.when(pl.col("time_min") >= lock_total_minutes)
          .then(pl.col("orl"))
          .otherwise(None)
          .alias("orl_locked"),
    ]).with_columns([
        (pl.col("orh_locked") - pl.col("orl_locked")).alias("or_range_locked"),
    ])

    orh_series = full["orh_locked"].cast(pl.Float64)
    orl_series = full["orl_locked"].cast(pl.Float64)
    or_range_series = full["or_range_locked"].cast(pl.Float64)

    return orh_series, orl_series, or_range_series


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

        elif cfg.type == "vwap_with_bands":
            result = compute_vwap_with_bands(result)

        elif cfg.type == "anchored_vwap":
            anchor_ts = cfg.anchor_ts  # datetime; caller must set cfg.anchor_ts
            if anchor_ts is not None:
                result = compute_anchored_vwap(result, anchor_ts)

        elif cfg.type == "adx":
            col = compute_adx(df, cfg.period)
            result = result.with_columns(col.alias(f"adx_{cfg.period}"))

        elif cfg.type == "adr":
            col = compute_adr(df, cfg.period)
            result = result.with_columns(col.alias(f"adr_{cfg.period}"))

        elif cfg.type == "opening_range_breakout":
            range_min = cfg.range_minutes if cfg.range_minutes is not None else 15
            session_start = cfg.session_start_et if cfg.session_start_et is not None else "09:30"
            orh, orl, or_range = compute_opening_range_breakout(result, range_min, session_start)
            result = result.with_columns([
                orh.alias(f"orh_{range_min}m"),
                orl.alias(f"orl_{range_min}m"),
                or_range.alias(f"or_range_{range_min}m"),
            ])

        elif cfg.type == "donchian":
            # F-7 fix 2026-05-20: honest donchian (replaces SMA approximation)
            upper, lower = compute_donchian(df, cfg.period)
            result = result.with_columns([
                upper.alias(f"donchian_upper_{cfg.period}"),
                lower.alias(f"donchian_lower_{cfg.period}"),
            ])

    return result


def compute_htf_indicators(
    htf_df: pl.DataFrame,
    configs: list[IndicatorConfig],
    suffix: str,
) -> pl.DataFrame:
    """Compute indicators on an HTF DataFrame and emit suffixed column names.

    This is a COMPANION to compute_indicators() — it does NOT modify
    compute_indicators() signature or behavior. Existing callers are unaffected.

    Column naming: same primitives as compute_indicators() but with `suffix`
    appended. E.g. suffix='_4h' → 'ema_50_4h', 'rsi_14_4h', 'atr_14_4h'.

    Multi-column indicators (macd, bbands, opening_range_breakout) also get the
    suffix on every sub-column (e.g. 'macd_line_4h', 'bb_upper_20_4h').

    Args:
        htf_df: Higher-timeframe OHLCV DataFrame (ts_event, open, high, low, close, volume).
        configs: List of IndicatorConfig — same primitives as compute_indicators
            supports (sma, ema, rsi, atr, macd, bbands, vwap, adx, adr,
            opening_range_breakout).
        suffix: String to append to every output column name.
            Convention: '_{timeframe}' e.g. '_4h', '_1d'.

    Returns:
        htf_df with suffixed indicator columns added.

    Raises:
        ValueError: if suffix is empty (would silently overwrite LTF columns).
    """
    if not suffix:
        raise ValueError(
            "compute_htf_indicators: suffix must be non-empty to prevent "
            "column name collisions with the exec-TF DataFrame."
        )

    result = htf_df.clone()

    for cfg in configs:
        if cfg.type == "sma":
            col = compute_sma(htf_df["close"], cfg.period)
            result = result.with_columns(col.alias(f"sma_{cfg.period}{suffix}"))

        elif cfg.type == "ema":
            col = compute_ema(htf_df["close"], cfg.period)
            result = result.with_columns(col.alias(f"ema_{cfg.period}{suffix}"))

        elif cfg.type == "rsi":
            col = compute_rsi(htf_df["close"], cfg.period)
            result = result.with_columns(col.alias(f"rsi_{cfg.period}{suffix}"))

        elif cfg.type == "atr":
            col = compute_atr(htf_df, cfg.period)
            result = result.with_columns(col.alias(f"atr_{cfg.period}{suffix}"))

        elif cfg.type == "macd":
            fast = cfg.fast or 12
            slow = cfg.slow or 26
            signal = cfg.signal or 9
            macd_line, signal_line, histogram = compute_macd(
                htf_df["close"], fast, slow, signal
            )
            result = result.with_columns([
                macd_line.alias(f"macd_line{suffix}"),
                signal_line.alias(f"macd_signal{suffix}"),
                histogram.alias(f"macd_hist{suffix}"),
            ])

        elif cfg.type == "bbands":
            upper, middle, lower = compute_bbands(
                htf_df["close"], cfg.period, cfg.std_dev
            )
            result = result.with_columns([
                upper.alias(f"bb_upper_{cfg.period}{suffix}"),
                middle.alias(f"bb_middle_{cfg.period}{suffix}"),
                lower.alias(f"bb_lower_{cfg.period}{suffix}"),
            ])

        elif cfg.type == "vwap":
            col = compute_vwap(htf_df)
            result = result.with_columns(col.alias(f"vwap{suffix}"))

        elif cfg.type == "adx":
            col = compute_adx(htf_df, cfg.period)
            result = result.with_columns(col.alias(f"adx_{cfg.period}{suffix}"))

        elif cfg.type == "adr":
            col = compute_adr(htf_df, cfg.period)
            result = result.with_columns(col.alias(f"adr_{cfg.period}{suffix}"))

        elif cfg.type == "opening_range_breakout":
            range_min = cfg.range_minutes if cfg.range_minutes is not None else 15
            session_start = cfg.session_start_et if cfg.session_start_et is not None else "09:30"
            orh, orl, or_range = compute_opening_range_breakout(result, range_min, session_start)
            result = result.with_columns([
                orh.alias(f"orh_{range_min}m{suffix}"),
                orl.alias(f"orl_{range_min}m{suffix}"),
                or_range.alias(f"or_range_{range_min}m{suffix}"),
            ])

        elif cfg.type == "donchian":
            upper, lower = compute_donchian(htf_df, cfg.period)
            result = result.with_columns([
                upper.alias(f"donchian_upper_{cfg.period}{suffix}"),
                lower.alias(f"donchian_lower_{cfg.period}{suffix}"),
            ])

    return result


def compute_multi_htf_indicators(
    tf_data: dict[str, pl.DataFrame],
    configs: "list[IndicatorConfig] | None" = None,
    suffix_map: "dict[str, str] | None" = None,
) -> dict[str, pl.DataFrame]:
    """Compute indicators per TF; returns dict of TF → DataFrame with suffixed cols.

    W25.4 — Generalised version of compute_htf_indicators() for N timeframes.
    Existing compute_htf_indicators() remains unchanged as a thin wrapper.

    Each TF in tf_data gets compute_htf_indicators() called with a suffix derived from:
        1. suffix_map[tf] if provided, else
        2. The canonical suffix: "_{tf}" with non-alphanum chars replaced by "_"
           e.g. "4h" → "_4h", "1d" → "_1d", "15m" → "_15m"

    Args:
        tf_data: Dict mapping TF string → raw OHLCV Polars DataFrame.
        configs: Indicator configs to compute on every TF. If None, no indicators
            are computed but the OHLCV DataFrames are returned unchanged (useful when
            the caller only needs the raw bars for backward-asof joins).
        suffix_map: Optional override for per-TF suffix. Dict of {tf_string: suffix}.
            Any TF not in the map gets the canonical suffix.

    Returns:
        Dict with the same keys as tf_data, values being the OHLCV DataFrame with
        suffixed indicator columns added (or unchanged if configs is None/empty).

    Raises:
        ValueError: if tf_data is empty.
    """
    if not tf_data:
        raise ValueError("compute_multi_htf_indicators: tf_data must not be empty")

    _suffix_map = suffix_map or {}
    result: dict[str, pl.DataFrame] = {}

    for tf, df in tf_data.items():
        # Derive suffix: use provided map, else canonical "_{tf}" with safe chars
        if tf in _suffix_map:
            suffix = _suffix_map[tf]
        else:
            # Replace non-alphanumeric with underscore, prepend underscore
            import re as _re
            safe = _re.sub(r"[^a-zA-Z0-9]", "_", tf)
            suffix = f"_{safe}"

        if configs:
            result[tf] = compute_htf_indicators(df, configs, suffix)
        else:
            result[tf] = df

    return result


# test_append
