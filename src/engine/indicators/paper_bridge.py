"""ICT Indicator Bridge for Paper Trading Engine.

Called by the TS paper engine via python-runner subprocess when a strategy
references ICT indicators that are not natively computed in TypeScript.

Protocol:
  Input  (via --config JSON):
    {
      "bars":      [ {symbol, timestamp, open, high, low, close, volume}, ... ],
      "requested": [ "indicator_name_1", "indicator_name_2", ... ],
      "symbol":    "MES"
    }

  Output (stdout JSON):
    {
      "indicator_name_1": <float | null>,
      "indicator_name_2": <float | null>,
      ...
    }

  Only the last bar's value is returned for each indicator (paper engine works
  bar-by-bar).  Structural indicators that return DataFrames are reduced to their
  last-row scalar.  Boolean columns are cast to float (1.0 / 0.0).

  Unknown indicator names produce null in the output (not an error).
  The TS side treats null/non-finite as NaN, which causes rule expressions that
  reference them to return false — fail-safe, not fail-open.

Design constraint: this module MUST be fast.  It is called per-bar for any live
paper session that uses ICT strategies.  The bar buffer is limited to the last
200 bars by the TS caller; Polars operations are used throughout.
"""

from __future__ import annotations

import json
import math
import sys
import os
from typing import Any

import polars as pl

# ─── Indicator imports ───────────────────────────────────────────────────────
# Each import is guarded so that a missing optional dependency does not crash
# the bridge for unrelated indicator requests.

try:
    from src.engine.indicators.core import (
        compute_sma,
        compute_ema,
        compute_rsi,
        compute_atr,
        compute_adx,
        compute_macd,
        compute_bbands,
    )
    _CORE_AVAILABLE = True
except ImportError:
    _CORE_AVAILABLE = False

try:
    from src.engine.indicators.market_structure import (
        detect_swings,
        detect_bos,
        detect_choch,
        detect_mss,
        compute_premium_discount,
    )
    _MS_AVAILABLE = True
except ImportError:
    _MS_AVAILABLE = False

try:
    from src.engine.indicators.order_flow import (
        detect_bullish_ob,
        detect_bearish_ob,
        detect_breaker,
        detect_mitigation,
        detect_rejection,
    )
    _OF_AVAILABLE = True
except ImportError:
    _OF_AVAILABLE = False

try:
    from src.engine.indicators.price_delivery import (
        detect_fvg,
        detect_ifvg,
        detect_displacement,
        detect_volume_imbalance,
        detect_liquidity_void,
    )
    _PD_AVAILABLE = True
except ImportError:
    _PD_AVAILABLE = False

try:
    from src.engine.indicators.liquidity import (
        detect_equal_highs,
        detect_equal_lows,
        detect_sweep,
        detect_inducement,
    )
    _LIQ_AVAILABLE = True
except ImportError:
    _LIQ_AVAILABLE = False

try:
    from src.engine.liquidity import compute_fill_probability_by_volume
    _FILL_PROB_AVAILABLE = True
except ImportError:
    _FILL_PROB_AVAILABLE = False

try:
    from src.engine.indicators.sessions import (
        is_asia_killzone,
        is_london_killzone,
        is_nyam_killzone,
        is_ny_lunch,
        is_nypm_killzone,
        is_silver_bullet_nyam,
        is_silver_bullet_nypm,
        is_silver_bullet_london,
        is_macro_time,
        midnight_open,
        true_day_open,
    )
    _SESS_AVAILABLE = True
except ImportError:
    _SESS_AVAILABLE = False


# ─── Bar Buffer → Polars DataFrame ──────────────────────────────────────────

def _bars_to_df(bars: list[dict]) -> pl.DataFrame:
    """Convert the bar-buffer list from the TS caller to a Polars DataFrame.

    Columns produced: timestamp (Utf8), open, high, low, close, volume (Float64).
    A ts_event column is added as Datetime for indicators that need it.
    """
    opens   = [float(b["open"])   for b in bars]
    highs   = [float(b["high"])   for b in bars]
    lows    = [float(b["low"])    for b in bars]
    closes  = [float(b["close"])  for b in bars]
    volumes = [float(b["volume"]) for b in bars]
    ts_strs = [str(b["timestamp"]) for b in bars]

    df = pl.DataFrame({
        "timestamp": pl.Series(ts_strs, dtype=pl.Utf8),
        "open":   pl.Series(opens,   dtype=pl.Float64),
        "high":   pl.Series(highs,   dtype=pl.Float64),
        "low":    pl.Series(lows,    dtype=pl.Float64),
        "close":  pl.Series(closes,  dtype=pl.Float64),
        "volume": pl.Series(volumes, dtype=pl.Float64),
    })

    # Parse timestamps — try ISO with timezone, fall back to naive UTC
    try:
        df = df.with_columns(
            pl.col("timestamp")
            .str.to_datetime(format=None, use_earliest=True, strict=False)
            .alias("ts_event")
        )
    except Exception:
        # If parsing fails, create a dummy integer index (sessions indicators won't work)
        df = df.with_columns(
            pl.lit(None).cast(pl.Datetime).alias("ts_event")
        )

    return df


# ─── Last-Row Scalar Extractor ───────────────────────────────────────────────

def _last_scalar(series: pl.Series | pl.DataFrame | Any, col: str | None = None) -> float | None:
    """Extract the last bar's float value from various result types."""
    try:
        if isinstance(series, pl.DataFrame):
            if col and col in series.columns:
                s = series[col]
            else:
                # Take first numeric column
                numeric_cols = [c for c in series.columns if series[c].dtype in (pl.Float64, pl.Int64, pl.Boolean)]
                if not numeric_cols:
                    return None
                s = series[numeric_cols[0]]
        else:
            s = series

        if isinstance(s, pl.Series):
            val = s[-1]
            if val is None:
                return None
            # Boolean → float
            if isinstance(val, bool):
                return 1.0 if val else 0.0
            v = float(val)
            return v if math.isfinite(v) else None
        return None
    except Exception:
        return None


# ─── Indicator Dispatcher ────────────────────────────────────────────────────

def _compute_indicator(name: str, df: pl.DataFrame) -> float | None:
    """Compute a single indicator by name and return the last bar's scalar value."""

    closes = df["close"]

    # ── Core indicators (extended periods / MACD variants) ─────────────────
    if _CORE_AVAILABLE:
        # ADX variants
        if name.startswith("adx_"):
            try:
                period = int(name.split("_")[1])
                return _last_scalar(compute_adx(df, period))
            except Exception:
                return None

        # MACD components
        if name in ("macd_line", "macd_signal", "macd_hist"):
            try:
                macd_line, signal_line, hist = compute_macd(closes)
                target = {"macd_line": macd_line, "macd_signal": signal_line, "macd_hist": hist}
                return _last_scalar(target[name])
            except Exception:
                return None

        # Bollinger Band variants beyond bb_20
        if name.startswith("bb_") or name.startswith("bbands_"):
            # Handle both "bb_upper_20" and "bbands_20_upper" naming
            parts = name.split("_")
            try:
                if name.startswith("bb_"):
                    # bb_upper_20 / bb_middle_20 / bb_lower_20
                    band = parts[1]   # upper/middle/lower
                    period = int(parts[2])
                else:
                    # bbands_20_upper
                    period = int(parts[1])
                    band = parts[2]
                upper, middle, lower = compute_bbands(closes, period)
                target = {"upper": upper, "middle": middle, "lower": lower}
                return _last_scalar(target.get(band))
            except Exception:
                return None

        # Extended SMA/EMA/RSI/ATR periods
        for prefix, fn in [
            ("sma_", lambda p: compute_sma(closes, p)),
            ("ema_", lambda p: compute_ema(closes, p)),
            ("rsi_", lambda p: compute_rsi(closes, p)),
            ("atr_", lambda p: compute_atr(df, p)),
        ]:
            if name.startswith(prefix):
                try:
                    period = int(name[len(prefix):])
                    return _last_scalar(fn(period))
                except Exception:
                    return None

    # ── Market Structure ────────────────────────────────────────────────────
    if _MS_AVAILABLE:
        swings_cache: pl.DataFrame | None = None

        def _swings() -> pl.DataFrame:
            nonlocal swings_cache
            if swings_cache is None:
                swings_cache = detect_swings(df)
            return swings_cache

        if name in ("bos", "bos_bullish", "bos_bearish"):
            try:
                bos = detect_bos(df, _swings())
                col_map = {"bos": "bos", "bos_bullish": "bos_bullish", "bos_bearish": "bos_bearish"}
                col = col_map.get(name, "bos")
                return _last_scalar(bos, col if col in bos.columns else bos.columns[0])
            except Exception:
                return None

        if name in ("choch", "choch_bullish", "choch_bearish"):
            try:
                choch = detect_choch(df, _swings())
                col_map = {"choch": "choch", "choch_bullish": "choch_bullish", "choch_bearish": "choch_bearish"}
                col = col_map.get(name, "choch")
                return _last_scalar(choch, col if col in choch.columns else choch.columns[0])
            except Exception:
                return None

        if name == "mss":
            try:
                mss = detect_mss(df, _swings())
                return _last_scalar(mss, mss.columns[0])
            except Exception:
                return None

        if name == "premium_discount":
            try:
                pd_series = compute_premium_discount(df, _swings())
                # premium_discount is a string enum — convert to numeric
                val = pd_series[-1]
                if val == "premium":
                    return 1.0
                elif val == "discount":
                    return -1.0
                elif val == "equilibrium":
                    return 0.0
                return None
            except Exception:
                return None

    # ── Order Flow ──────────────────────────────────────────────────────────
    if _OF_AVAILABLE and _MS_AVAILABLE:
        def _swings_of() -> pl.DataFrame:
            return detect_swings(df)

        if name in ("bullish_ob", "ob_bullish"):
            try:
                obs = detect_bullish_ob(df, _swings_of())
                return _last_scalar(obs, obs.columns[0])
            except Exception:
                return None

        if name in ("bearish_ob", "ob_bearish"):
            try:
                obs = detect_bearish_ob(df, _swings_of())
                return _last_scalar(obs, obs.columns[0])
            except Exception:
                return None

        if name == "breaker":
            try:
                obs = detect_bullish_ob(df, _swings_of())
                brs = detect_breaker(df, obs)
                return _last_scalar(brs, brs.columns[0])
            except Exception:
                return None

        if name in ("mitigation", "ob_mitigated"):
            try:
                obs = detect_bullish_ob(df, _swings_of())
                mit = detect_mitigation(df, obs)
                return _last_scalar(mit, mit.columns[0])
            except Exception:
                return None

        if name == "rejection":
            try:
                rej = detect_rejection(df)
                return _last_scalar(rej, rej.columns[0])
            except Exception:
                return None

    # ── Price Delivery ──────────────────────────────────────────────────────
    if _PD_AVAILABLE:
        if name in ("fvg", "fvg_bullish", "fvg_bearish"):
            try:
                fvg = detect_fvg(df)
                col = name if name in fvg.columns else fvg.columns[0]
                return _last_scalar(fvg, col)
            except Exception:
                return None

        if name in ("ifvg", "ifvg_bullish", "ifvg_bearish"):
            try:
                fvg = detect_fvg(df)
                ifvg = detect_ifvg(df, fvg)
                col = name if name in ifvg.columns else ifvg.columns[0]
                return _last_scalar(ifvg, col)
            except Exception:
                return None

        if name in ("displacement", "displacement_bullish", "displacement_bearish"):
            try:
                disp = detect_displacement(df)
                col = name if name in disp.columns else disp.columns[0]
                return _last_scalar(disp, col)
            except Exception:
                return None

        if name in ("volume_imbalance", "vi"):
            try:
                vi = detect_volume_imbalance(df)
                return _last_scalar(vi, vi.columns[0])
            except Exception:
                return None

        if name == "liquidity_void":
            try:
                lv = detect_liquidity_void(df)
                return _last_scalar(lv, lv.columns[0])
            except Exception:
                return None

    # ── Liquidity ────────────────────────────────────────────────────────────
    if _LIQ_AVAILABLE and _MS_AVAILABLE:
        def _swings_liq() -> pl.DataFrame:
            return detect_swings(df)

        if name in ("equal_highs", "eqh"):
            try:
                eh = detect_equal_highs(df)
                return _last_scalar(eh, eh.columns[0])
            except Exception:
                return None

        if name in ("equal_lows", "eql"):
            try:
                el = detect_equal_lows(df)
                return _last_scalar(el, el.columns[0])
            except Exception:
                return None

        if name == "inducement":
            try:
                ind = detect_inducement(df, _swings_liq())
                return _last_scalar(ind, ind.columns[0])
            except Exception:
                return None

        if name in ("sweep", "liquidity_sweep"):
            try:
                lev = detect_equal_highs(df)  # sweep against buyside levels
                sw = detect_sweep(df, lev)
                return _last_scalar(sw)
            except Exception:
                return None

    # ── Session / Kill-Zone Indicators ──────────────────────────────────────
    if _SESS_AVAILABLE:
        ts = df["ts_event"]
        session_map = {
            "asia_killzone":       lambda: is_asia_killzone(ts),
            "london_killzone":     lambda: is_london_killzone(ts),
            "nyam_killzone":       lambda: is_nyam_killzone(ts),
            "ny_lunch":            lambda: is_ny_lunch(ts),
            "nypm_killzone":       lambda: is_nypm_killzone(ts),
            "silver_bullet_nyam":  lambda: is_silver_bullet_nyam(ts),
            "silver_bullet_nypm":  lambda: is_silver_bullet_nypm(ts),
            "silver_bullet_london": lambda: is_silver_bullet_london(ts),
            "macro_time":          lambda: is_macro_time(ts),
        }
        if name in session_map:
            try:
                return _last_scalar(session_map[name]())
            except Exception:
                return None

        if name == "midnight_open":
            try:
                return _last_scalar(midnight_open(df))
            except Exception:
                return None

        if name == "true_day_open":
            try:
                return _last_scalar(true_day_open(df))
            except Exception:
                return None

    # ── Volume-based fill probability ────────────────────────────────────────
    # fill_prob_volume: uses rolling median of bar buffer volumes.
    # Returns a fill probability scalar [0.30, 1.0] for the last bar.
    if name == "fill_prob_volume" and _FILL_PROB_AVAILABLE:
        try:
            volumes = df["volume"].to_list()
            if len(volumes) == 0:
                return None
            import statistics
            median_vol = statistics.median(volumes)
            last_vol = volumes[-1]
            return compute_fill_probability_by_volume(last_vol, median_vol)
        except Exception:
            return None

    # Unknown indicator
    return None


# ─── Main ────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    config_path = None
    for i, arg in enumerate(sys.argv[1:], 1):
        if arg == "--config" and i < len(sys.argv):
            config_path = sys.argv[i + 1]
            break
        elif os.path.isfile(arg):
            config_path = arg
            break

    if config_path:
        with open(config_path) as f:
            config = json.load(f)
    else:
        config = json.load(sys.stdin)

    bars: list[dict] = config.get("bars", [])
    requested: list[str] = config.get("requested", [])

    if not bars or not requested:
        print(json.dumps({}))
        sys.exit(0)

    df = _bars_to_df(bars)

    # Compute each requested indicator — errors are caught per-indicator
    # so one failure doesn't blank out the entire result.
    result: dict[str, float | None] = {}
    for ind_name in requested:
        result[ind_name] = _compute_indicator(ind_name, df)

    print(json.dumps(result))
