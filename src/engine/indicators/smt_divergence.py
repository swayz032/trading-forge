"""SMT (Smart Money Tool) Divergence — continuous confidence scoring for ES vs NQ.

ICT canonical cross-asset signal: when ES makes a new swing low but NQ does NOT
(or mirror: ES new high, NQ doesn't), institutional desks are tipping their hand.

This module produces a CONTINUOUS [0,1] confidence score — not binary detection.
See GPT critique #7: binary SMT collapses information; magnitude, time-sync, and
structure quality all modulate signal strength.

Design rules:
    - Pure function: no I/O, no time.now(), no global state
    - Polars only: no Pandas anywhere in this file
    - Backward asof join for time alignment: NO look-ahead (mirrors mtf_join.py pattern)
    - Score is always in [0.0, 1.0] — clamped at both ends
    - Returns None when no divergence found within lookback
    - Deterministic: same inputs → identical SmtDivergence output every run

Score formula (per GPT critique #7):
    score = clamp(
        0.35 * magnitude_norm          # bigger normalized gap = stronger
      + 0.25 * time_synced             # legs close in bar-space = better timing
      + 0.20 * structure_quality       # cleaner swing structure = higher quality
      + 0.20 * displacement_confirmation,  # follow-through after divergence
      0.0, 1.0
    )

Downstream consumers:
    - confluence-score.ts evalSmtConfirmation() (Pass 5 paper-parity wires this)
    - smt_age_bars → confluence-decay.ts smt_confirmation 60-bar half-life
"""

from __future__ import annotations

from dataclasses import dataclass

import polars as pl


# ─── Named weights (match GPT critique #7 specification exactly) ─────────────
_WEIGHT_MAGNITUDE: float = 0.35
_WEIGHT_TIME_SYNCED: float = 0.25
_WEIGHT_STRUCTURE: float = 0.20
_WEIGHT_DISPLACEMENT: float = 0.20

# ATR period for magnitude normalization
_ATR_PERIOD: int = 14

# Minimum ATR floor to avoid division near zero on synthetic flat series
_ATR_FLOOR: float = 1e-6

# Magnitude normalization cap: raw_gap / ATR above this value scores 1.0
# Calibrated to ES/NQ: a 10-ATR gap is extreme; 2-ATR is strong confirmation
_MAGNITUDE_ATR_CAP: float = 2.0

# Time-sync tolerance: if the two swing legs formed within this many bars of
# each other they are considered well-aligned (score approaches 1.0)
_TIME_SYNC_MAX_BAR_GAP: int = 5

# Structure quality: swing depth in ATR units. Swings deeper than this cap
# saturate at 1.0 quality. Shallow swings (<0.5 ATR) are noise.
_STRUCTURE_DEPTH_CAP: float = 1.5


@dataclass
class SmtDivergence:
    """Continuous SMT divergence signal at a single bar.

    All float fields except age_bars and detected_at_bar_idx are in [0, 1].
    magnitude is the raw unnormalized NQ gap in points.
    """

    detected_at_bar_idx: int
    """Bar index where the divergence was confirmed."""

    direction: str
    """
    One of:
      'bullish_es_low_nq_higher'   — ES new low, NQ higher low  (bullish reversal)
      'bearish_es_high_nq_lower'   — ES new high, NQ lower high (bearish reversal)
    """

    magnitude: float
    """Raw point difference: |ES swing distance| - |NQ swing distance|."""

    time_synced: float
    """[0,1] — how temporally aligned the two swing legs are."""

    structure_quality: float
    """[0,1] — how deep and clean the ES swing structure is."""

    displacement_confirmation: float
    """[0,1] — did a displacement (large) candle follow the divergence bar?"""

    score: float
    """[0,1] aggregate confidence. Consumer applies age-decay externally."""

    age_bars: int
    """Bars elapsed since detection. Caller updates this; used by decay engine."""


def _compute_atr14(es_bars: pl.DataFrame) -> float:
    """Compute ATR(14) from ES bars using Wilder true-range average.

    Returns _ATR_FLOOR if insufficient data.
    """
    n = len(es_bars)
    if n < 2:
        return _ATR_FLOOR

    highs = es_bars["high"].to_list()
    lows = es_bars["low"].to_list()
    closes = es_bars["close"].to_list()

    # True range for each bar
    true_ranges: list[float] = []
    for i in range(1, n):
        tr = max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i - 1]),
            abs(lows[i] - closes[i - 1]),
        )
        true_ranges.append(tr)

    if len(true_ranges) < _ATR_PERIOD:
        raw = sum(true_ranges) / len(true_ranges)
    else:
        # Wilder smooth: seed on first 14-bar SMA, then Wilder recur
        seed_end = _ATR_PERIOD
        atr = sum(true_ranges[:seed_end]) / _ATR_PERIOD
        for tr in true_ranges[seed_end:]:
            atr = (atr * (_ATR_PERIOD - 1) + tr) / _ATR_PERIOD
        raw = atr

    return max(raw, _ATR_FLOOR)


def _time_align_nq_to_es(
    es_bars: pl.DataFrame,
    nq_bars: pl.DataFrame,
) -> pl.DataFrame:
    """Align NQ bars to ES bar timestamps using backward asof join.

    For each ES bar at timestamp T, the joined NQ value is the most recent
    NQ bar whose ts_event <= T.  This is the NO-LOOK-AHEAD invariant.

    If nq_bars has no 'ts_event', falls back to positional alignment (assumes
    both series are already bar-for-bar synchronous).

    Returns a DataFrame with ES columns + NQ columns prefixed 'nq_'.
    """
    if "ts_event" not in es_bars.columns or "ts_event" not in nq_bars.columns:
        # Positional alignment path — both series are already synchronous
        if len(es_bars) != len(nq_bars):
            raise ValueError(
                f"Without ts_event, DataFrames must be same length: "
                f"{len(es_bars)} vs {len(nq_bars)}"
            )
        nq_renamed = nq_bars.rename({
            c: f"nq_{c}" for c in nq_bars.columns
        })
        return pl.concat([es_bars, nq_renamed], how="horizontal")

    # Rename NQ columns before join to avoid collisions
    nq_renamed = nq_bars.rename({
        c: f"nq_{c}" for c in nq_bars.columns if c != "ts_event"
    })

    es_sorted = es_bars.sort("ts_event")
    nq_sorted = nq_renamed.sort("ts_event")

    # Normalize datetime dtypes so join_asof key types match
    es_ts_dtype = es_sorted["ts_event"].dtype
    nq_ts_dtype = nq_sorted["ts_event"].dtype
    if es_ts_dtype != nq_ts_dtype:
        try:
            nq_sorted = nq_sorted.with_columns(
                pl.col("ts_event").cast(es_ts_dtype)
            )
        except Exception:
            # If cast fails, strip timezone from both and try naive
            es_sorted = es_sorted.with_columns(
                pl.col("ts_event").dt.replace_time_zone(None)
            )
            nq_sorted = nq_sorted.with_columns(
                pl.col("ts_event").dt.replace_time_zone(None)
            )

    joined = es_sorted.join_asof(
        nq_sorted,
        on="ts_event",
        strategy="backward",
    )
    return joined


def _find_lookback_swing_low(
    lows: list[float],
    end_idx: int,
    lookback: int,
) -> tuple[float, int]:
    """Return (min_low, bar_idx_of_min) within [end_idx - lookback, end_idx)."""
    start = max(0, end_idx - lookback)
    window = lows[start:end_idx]
    if not window:
        return (lows[end_idx] if end_idx < len(lows) else 0.0, end_idx)
    min_val = min(window)
    min_pos = window.index(min_val) + start
    return (min_val, min_pos)


def _find_lookback_swing_high(
    highs: list[float],
    end_idx: int,
    lookback: int,
) -> tuple[float, int]:
    """Return (max_high, bar_idx_of_max) within [end_idx - lookback, end_idx)."""
    start = max(0, end_idx - lookback)
    window = highs[start:end_idx]
    if not window:
        return (highs[end_idx] if end_idx < len(highs) else 0.0, end_idx)
    max_val = max(window)
    max_pos = window.index(max_val) + start
    return (max_val, max_pos)


def _clamp(value: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, value))


def compute_smt_divergence(
    es_bars: pl.DataFrame,
    nq_bars: pl.DataFrame,
    lookback: int = 20,
) -> SmtDivergence | None:
    """Compute SMT divergence confidence at the latest bar.

    SMT detection logic:
      Bullish: ES makes a new swing LOW within lookback, but NQ does NOT
               (NQ's equivalent low is higher than expected).
      Bearish: ES makes a new swing HIGH within lookback, but NQ does NOT
               (NQ's equivalent high is lower than expected).

    Returns None if no divergence found within lookback.
    Returns SmtDivergence with continuous score in [0, 1].

    Pure function over Polars — no I/O, no time.now(), deterministic.

    Args:
        es_bars: Polars DataFrame with columns: open, high, low, close, volume.
                 Optional 'ts_event' column for time alignment.
        nq_bars: Polars DataFrame for NQ. Same schema as es_bars.
                 May arrive at slightly offset timestamps — backward asof join
                 handles alignment without look-ahead.
        lookback: Number of bars to look back for swing detection (default 20).

    Returns:
        SmtDivergence if divergence found, else None.
    """
    required_cols = {"high", "low", "close"}
    if not required_cols.issubset(es_bars.columns):
        return None
    if not required_cols.issubset(nq_bars.columns):
        return None

    # Need at least lookback + a few bars for ATR and swing detection
    min_bars = lookback + _ATR_PERIOD + 1
    if len(es_bars) < min_bars or len(nq_bars) < min_bars:
        return None

    # Time-align NQ to ES (backward asof — no look-ahead)
    aligned = _time_align_nq_to_es(es_bars, nq_bars)

    # After alignment, NQ columns are prefixed with 'nq_'
    nq_high_col = "nq_high"
    nq_low_col = "nq_low"

    if nq_high_col not in aligned.columns or nq_low_col not in aligned.columns:
        return None

    # Drop rows where NQ data is null (no matching NQ bar before this ES bar)
    aligned = aligned.drop_nulls(subset=[nq_high_col, nq_low_col])

    if len(aligned) < min_bars:
        return None

    # Compute ATR(14) on ES for normalization
    atr = _compute_atr14(aligned)

    es_highs = aligned["high"].to_list()
    es_lows = aligned["low"].to_list()
    es_closes = aligned["close"].to_list()
    nq_highs = aligned[nq_high_col].to_list()
    nq_lows = aligned[nq_low_col].to_list()

    latest_idx = len(aligned) - 1

    # ── Check bullish SMT: ES new low within lookback, NQ does NOT ───────────
    es_swing_low, es_swing_low_idx = _find_lookback_swing_low(es_lows, latest_idx, lookback)
    nq_swing_low, nq_swing_low_idx = _find_lookback_swing_low(nq_lows, latest_idx, lookback)

    if es_lows[latest_idx] < es_swing_low:
        # ES has broken to a new low at the latest bar
        # NQ must NOT have also broken to a new low (higher low = divergence)
        if nq_lows[latest_idx] >= nq_swing_low:
            # Bullish SMT confirmed
            es_leg_depth = abs(es_lows[latest_idx] - es_swing_low)
            nq_expected_low = nq_swing_low  # NQ should have broken to same relative depth
            nq_actual_low = nq_lows[latest_idx]
            raw_magnitude = abs(nq_actual_low - nq_expected_low)  # NQ gap vs expected

            # ── Sub-scores ───────────────────────────────────────────────
            # 1. Magnitude: normalized by ATR
            magnitude_norm = _clamp(
                (raw_magnitude / atr) / _MAGNITUDE_ATR_CAP
            )

            # 2. Time sync: how many bars apart were the two swing legs formed?
            bar_gap = abs(es_swing_low_idx - nq_swing_low_idx)
            time_synced = _clamp(
                1.0 - (bar_gap / _TIME_SYNC_MAX_BAR_GAP)
            )

            # 3. Structure quality: depth of the ES swing relative to ATR
            structure_quality = _clamp(
                (es_leg_depth / atr) / _STRUCTURE_DEPTH_CAP
            )

            # 4. Displacement confirmation: is the latest ES bar a strong move?
            # A displacement bar closes significantly below its open (bearish body
            # going into the low); for bullish SMT the ES low confirms institutional
            # pressure — measure bar body relative to ATR
            bar_body = abs(es_closes[latest_idx] - aligned["open"].to_list()[latest_idx]) if "open" in aligned.columns else 0.0
            displacement_confirmation = _clamp(bar_body / atr)

            score = _clamp(
                _WEIGHT_MAGNITUDE * magnitude_norm
                + _WEIGHT_TIME_SYNCED * time_synced
                + _WEIGHT_STRUCTURE * structure_quality
                + _WEIGHT_DISPLACEMENT * displacement_confirmation
            )

            return SmtDivergence(
                detected_at_bar_idx=latest_idx,
                direction="bullish_es_low_nq_higher",
                magnitude=raw_magnitude,
                time_synced=time_synced,
                structure_quality=structure_quality,
                displacement_confirmation=displacement_confirmation,
                score=score,
                age_bars=0,
            )

    # ── Check bearish SMT: ES new high within lookback, NQ does NOT ──────────
    es_swing_high, es_swing_high_idx = _find_lookback_swing_high(es_highs, latest_idx, lookback)
    nq_swing_high, nq_swing_high_idx = _find_lookback_swing_high(nq_highs, latest_idx, lookback)

    if es_highs[latest_idx] > es_swing_high:
        # ES has broken to a new high at the latest bar
        # NQ must NOT have also broken to a new high (lower high = divergence)
        if nq_highs[latest_idx] <= nq_swing_high:
            # Bearish SMT confirmed
            es_leg_depth = abs(es_highs[latest_idx] - es_swing_high)
            nq_expected_high = nq_swing_high
            nq_actual_high = nq_highs[latest_idx]
            raw_magnitude = abs(nq_actual_high - nq_expected_high)

            # Sub-scores
            magnitude_norm = _clamp(
                (raw_magnitude / atr) / _MAGNITUDE_ATR_CAP
            )

            bar_gap = abs(es_swing_high_idx - nq_swing_high_idx)
            time_synced = _clamp(
                1.0 - (bar_gap / _TIME_SYNC_MAX_BAR_GAP)
            )

            structure_quality = _clamp(
                (es_leg_depth / atr) / _STRUCTURE_DEPTH_CAP
            )

            # Displacement: large candle body on ES at the high
            bar_body = abs(es_closes[latest_idx] - aligned["open"].to_list()[latest_idx]) if "open" in aligned.columns else 0.0
            displacement_confirmation = _clamp(bar_body / atr)

            score = _clamp(
                _WEIGHT_MAGNITUDE * magnitude_norm
                + _WEIGHT_TIME_SYNCED * time_synced
                + _WEIGHT_STRUCTURE * structure_quality
                + _WEIGHT_DISPLACEMENT * displacement_confirmation
            )

            return SmtDivergence(
                detected_at_bar_idx=latest_idx,
                direction="bearish_es_high_nq_lower",
                magnitude=raw_magnitude,
                time_synced=time_synced,
                structure_quality=structure_quality,
                displacement_confirmation=displacement_confirmation,
                score=score,
                age_bars=0,
            )

    return None


# ─── CLI entry-point (python -m src.engine.indicators.smt_divergence) ─────────
# Called by smt-live-service.ts via runPythonModule.
#
# Contract (matches runPythonModule --config pattern):
#   Input:  --config <path> to JSON with:
#     {
#       "es_bars":  [ {"open":N, "high":N, "low":N, "close":N, "volume":N, "ts_event":"ISO"}, ... ],
#       "nq_bars":  [ {...}, ... ],
#       "lookback": 20  // optional
#     }
#
#   Output (stdout, single JSON line):
#     {"score": 0.65, "direction": "bullish_es_low_nq_higher", "age_bars": 0}
#     or
#     {"score": null, "direction": null, "age_bars": null}  // when no divergence
#
# Graceful degradation:
#   - Any error → {"score": null, "direction": null, "age_bars": null, "error": "..."}
#   - Never exits non-zero (caller treats null snapshot as smt_unavailable)

if __name__ == "__main__":
    import argparse
    import json
    import sys

    parser = argparse.ArgumentParser(description="SMT divergence CLI")
    parser.add_argument("--config", required=True, help="Path to JSON config file")
    args = parser.parse_args()

    _NULL_RESULT: dict = {"score": None, "direction": None, "age_bars": None}

    try:
        with open(args.config, encoding="utf-8") as _f:
            _cfg = json.load(_f)

        _es_raw = _cfg.get("es_bars", [])
        _nq_raw = _cfg.get("nq_bars", [])
        _lookback = int(_cfg.get("lookback", 20))

        if not _es_raw or not _nq_raw:
            print(json.dumps(_NULL_RESULT))
            sys.exit(0)

        # Build Polars DataFrames from the bar arrays.
        # Required columns: high, low, close  (open + volume used when present).
        def _build_df(bars: list[dict]) -> pl.DataFrame:
            opens   = [float(b.get("open", 0))   for b in bars]
            highs   = [float(b["high"])           for b in bars]
            lows    = [float(b["low"])            for b in bars]
            closes  = [float(b["close"])          for b in bars]
            volumes = [float(b.get("volume", 0)) for b in bars]
            df = pl.DataFrame({
                "open":   pl.Series("open",   opens,   dtype=pl.Float64),
                "high":   pl.Series("high",   highs,   dtype=pl.Float64),
                "low":    pl.Series("low",    lows,    dtype=pl.Float64),
                "close":  pl.Series("close",  closes,  dtype=pl.Float64),
                "volume": pl.Series("volume", volumes, dtype=pl.Float64),
            })
            ts_list = [b.get("ts_event") for b in bars]
            if all(t is not None for t in ts_list):
                try:
                    df = df.with_columns(
                        pl.Series("ts_event", ts_list, dtype=pl.Utf8)
                          .str.to_datetime(strict=False)
                    )
                except Exception:
                    pass  # ts_event is optional — alignment falls back to positional
            return df

        _es_df = _build_df(_es_raw)
        _nq_df = _build_df(_nq_raw)

        _result = compute_smt_divergence(_es_df, _nq_df, lookback=_lookback)

        if _result is None:
            print(json.dumps(_NULL_RESULT))
        else:
            print(json.dumps({
                "score":     _result.score,
                "direction": _result.direction,
                "age_bars":  _result.age_bars,
            }))

    except Exception as _e:
        print(json.dumps({**_NULL_RESULT, "error": str(_e)}))

    sys.exit(0)
