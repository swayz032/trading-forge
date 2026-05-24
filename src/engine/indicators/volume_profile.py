"""Volume Profile Indicator — per-session POC, VAH, VAL, and naked POC detection.

Algorithm: TPO-style price binning at tick precision.
  1. Build price bins at symbol tick_size granularity.
  2. Assign volume to each bin whose price range overlaps the bar's high-low range.
  3. Max-volume bin = POC.
  4. Expand around POC alternating up/down until cumulative volume >= value_area_pct.
  5. Naked POCs = prior-N-day POCs where price has not traded through since.

Performance contract: <500ms for one symbol-day on 5m bars (Polars vectorized).

Hard rule: DO NOT pass slippage/fees to vectorbt — this module is pure indicator
computation only. No P&L math here.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Literal, Optional, Tuple

import polars as pl


# ─── Symbol tick sizes ────────────────────────────────────────────────────────

SYMBOL_TICK_SIZES: Dict[str, float] = {
    "MES": 0.25,
    "ES": 0.25,
    "MNQ": 0.25,
    "NQ": 0.25,
    "MCL": 0.01,
    "CL": 0.01,
    "MGC": 0.10,
    "GC": 0.10,
}

DEFAULT_TICK_SIZE = 0.25
NAKED_POC_LOOKBACK_DAYS = 30


# ─── Output dataclass ─────────────────────────────────────────────────────────

@dataclass
class VolumeProfileLevels:
    """Per-session Volume Profile output."""

    poc: float
    vah: float
    val: float
    naked_pocs: List[float] = field(default_factory=list)
    value_area_pct: float = 0.70

    # Session metadata (optional, for downstream use)
    session_high: float = 0.0
    session_low: float = 0.0
    total_volume: float = 0.0

    # Internal: raw bin map for shape classifier
    _bin_map: Dict[float, float] = field(default_factory=dict, repr=False)


# ─── Core computation ─────────────────────────────────────────────────────────

def _get_tick_size(symbol: Optional[str]) -> float:
    """Return tick size for symbol, default 0.25."""
    if symbol is None:
        return DEFAULT_TICK_SIZE
    return SYMBOL_TICK_SIZES.get(symbol.upper(), DEFAULT_TICK_SIZE)


def _build_bin_map(
    bars: pl.DataFrame,
    tick_size: float,
) -> Dict[float, float]:
    """Build price-bin → cumulative-volume map.

    Each bar [low, high] contributes its volume proportionally to all bins it
    spans.  Bins are aligned to tick_size grid.

    Returns dict mapping bin_price -> volume.
    """
    if len(bars) == 0:
        return {}

    tick = tick_size
    # Align global low/high to tick grid
    global_low = float(bars["low"].min())
    global_high = float(bars["high"].max())

    # Snap to tick grid (floor/ceil)
    bin_low = (global_low // tick) * tick
    bin_high = (global_high // tick) * tick + tick

    # Build bin array
    n_bins = round((bin_high - bin_low) / tick) + 1
    if n_bins <= 0:
        return {}

    bins: Dict[float, float] = {}

    # Vectorized via Polars
    low_s = bars["low"]
    high_s = bars["high"]
    vol_s = bars["volume"]

    for i in range(len(bars)):
        bar_low = float(low_s[i])
        bar_high = float(high_s[i])
        bar_vol = float(vol_s[i])

        if bar_vol <= 0:
            continue

        # Snap bar bounds to grid
        b_lo = (bar_low // tick) * tick
        b_hi = (bar_high // tick) * tick

        # Number of bins this bar spans
        span = max(1, round((b_hi - b_lo) / tick) + 1)
        vol_per_bin = bar_vol / span

        current = b_lo
        while current <= b_hi + 1e-9:
            key = round(current / tick) * tick  # canonical rounding
            bins[key] = bins.get(key, 0.0) + vol_per_bin
            current += tick

    return bins


def _find_poc(bin_map: Dict[float, float]) -> float:
    """Return price bin with maximum volume."""
    if not bin_map:
        return 0.0
    return max(bin_map, key=lambda k: bin_map[k])


def _compute_value_area(
    bin_map: Dict[float, float],
    poc: float,
    value_area_pct: float,
    tick_size: float,
) -> Tuple[float, float]:
    """Expand around POC alternating up/down to capture value_area_pct of volume.

    Returns (val, vah).
    """
    total_vol = sum(bin_map.values())
    if total_vol <= 0:
        return poc, poc

    target_vol = total_vol * value_area_pct

    sorted_bins = sorted(bin_map.keys())
    if poc not in bin_map:
        return poc, poc

    poc_idx = sorted_bins.index(poc)
    accumulated = bin_map[poc]

    upper_idx = poc_idx
    lower_idx = poc_idx

    # Alternate: compare one up vs one down, take whichever adds more volume
    max_iter = len(sorted_bins) + 2
    iterations = 0
    while accumulated < target_vol and iterations < max_iter:
        iterations += 1
        can_up = upper_idx + 1 < len(sorted_bins)
        can_down = lower_idx - 1 >= 0

        if not can_up and not can_down:
            break

        vol_up = bin_map.get(sorted_bins[upper_idx + 1], 0.0) if can_up else -1
        vol_down = bin_map.get(sorted_bins[lower_idx - 1], 0.0) if can_down else -1

        if vol_up >= vol_down:
            upper_idx += 1
            accumulated += bin_map.get(sorted_bins[upper_idx], 0.0)
        else:
            lower_idx -= 1
            accumulated += bin_map.get(sorted_bins[lower_idx], 0.0)

    vah = sorted_bins[upper_idx]
    val = sorted_bins[lower_idx]
    return val, vah


def compute_volume_profile(
    bars: pl.DataFrame,
    symbol: Optional[str] = None,
    tick_size: Optional[float] = None,
    value_area_pct: float = 0.70,
) -> VolumeProfileLevels:
    """Compute per-session Volume Profile levels.

    Args:
        bars: Polars DataFrame with columns: ts_event, open, high, low, close, volume.
        symbol: Symbol string for tick_size lookup (e.g. "MES"). Overridden by tick_size.
        tick_size: Explicit tick size. Takes precedence over symbol lookup.
        value_area_pct: Fraction of volume to include in the value area (default 0.70).

    Returns:
        VolumeProfileLevels with poc, vah, val, and empty naked_pocs list.
        Caller must supply prior-day POCs via compute_naked_pocs() separately.
    """
    if len(bars) == 0:
        return VolumeProfileLevels(poc=0.0, vah=0.0, val=0.0, value_area_pct=value_area_pct)

    # Validate required columns
    required = {"high", "low", "volume"}
    missing = required - set(bars.columns)
    if missing:
        raise ValueError(f"bars DataFrame missing columns: {missing}")

    tick = tick_size if tick_size is not None else _get_tick_size(symbol)

    # Zero-volume bars: keep for structural integrity but they contribute 0
    bin_map = _build_bin_map(bars, tick)

    if not bin_map:
        fallback = float(bars["high"].mean() or 0.0)
        return VolumeProfileLevels(
            poc=fallback, vah=fallback, val=fallback, value_area_pct=value_area_pct
        )

    poc = _find_poc(bin_map)
    val, vah = _compute_value_area(bin_map, poc, value_area_pct, tick)

    session_high = float(bars["high"].max())
    session_low = float(bars["low"].min())
    total_volume = float(bars["volume"].sum())

    levels = VolumeProfileLevels(
        poc=poc,
        vah=vah,
        val=val,
        naked_pocs=[],
        value_area_pct=value_area_pct,
        session_high=session_high,
        session_low=session_low,
        total_volume=total_volume,
    )
    levels._bin_map = bin_map
    return levels


# ─── Naked POC detection ──────────────────────────────────────────────────────

def compute_naked_pocs(
    daily_bars: pl.DataFrame,
    current_date_str: str,
    symbol: Optional[str] = None,
    tick_size: Optional[float] = None,
    value_area_pct: float = 0.70,
    lookback_days: int = NAKED_POC_LOOKBACK_DAYS,
) -> List[Tuple[object, float]]:
    """Compute naked POCs from prior sessions.

    A POC is "naked" (not yet retested) if price has not traded through that
    level since the session when it was formed.

    Args:
        daily_bars: DataFrame with ts_event, high, low, close, volume.
            Must cover at least lookback_days + current day.
        current_date_str: ISO date string "YYYY-MM-DD" for the current session.
        symbol: Used for tick_size lookup.
        tick_size: Explicit tick size override.
        value_area_pct: Value area pct (passed through to per-day computation).
        lookback_days: Number of prior days to check.

    Returns:
        List of (source_date, poc_price) tuples not yet retested, ordered by
        absolute distance of the POC price from the last session's close.
        source_date is a `datetime.date` corresponding to the prior session
        the POC was formed on.
    """
    if len(daily_bars) == 0:
        return []

    tick = tick_size if tick_size is not None else _get_tick_size(symbol)

    # Determine date column
    ts_col = "ts_event"
    if ts_col not in daily_bars.columns:
        return []

    # Add date column
    df = daily_bars.with_columns(
        pl.col(ts_col).dt.date().alias("_date")
    ).sort(ts_col)

    dates_series = df["_date"].unique().sort()
    all_dates = dates_series.to_list()

    try:
        from datetime import date as dt_date
        current_date = dt_date.fromisoformat(current_date_str)
    except Exception:
        return []

    # Find prior dates within lookback
    prior_dates = [d for d in all_dates if d < current_date]
    prior_dates = prior_dates[-lookback_days:]  # Most recent lookback_days

    if not prior_dates:
        return []

    # Compute POC for each prior date
    prior_pocs: List[Tuple[object, float]] = []  # (date, poc)
    for d in prior_dates:
        day_bars = df.filter(pl.col("_date") == d)
        if len(day_bars) == 0:
            continue
        lvl = compute_volume_profile(day_bars, tick_size=tick, value_area_pct=value_area_pct)
        if lvl.poc > 0:
            prior_pocs.append((d, lvl.poc))

    if not prior_pocs:
        return []

    # For each prior POC, check if price has traded through it in subsequent sessions
    naked: List[Tuple[object, float]] = []
    for poc_date, poc_price in prior_pocs:
        # All bars AFTER poc_date and BEFORE current_date
        subsequent = df.filter(
            (pl.col("_date") > poc_date) & (pl.col("_date") < current_date)
        )
        if len(subsequent) == 0:
            # No subsequent bars means it's naked
            naked.append((poc_date, poc_price))
            continue

        # Price "traded through" if any bar's high >= poc AND low <= poc
        # (i.e., the bar touched the POC price from either side)
        touched = subsequent.filter(
            (pl.col("high") >= poc_price) & (pl.col("low") <= poc_price)
        )
        if len(touched) == 0:
            naked.append((poc_date, poc_price))

    # Sort by absolute distance from most recent close
    if len(df) > 0:
        last_close = float(df.filter(pl.col("_date") < current_date)["close"].last())
        naked.sort(key=lambda item: abs(item[1] - last_close))
    else:
        naked.sort(key=lambda item: item[1])

    return naked


# ─── Wave 25 Pass 3 W25.6: Naked POC export helper ───────────────────────────
#
# Pure function — no I/O, no side effects. Returns a list of NakedPocRecord
# ready for persistence via the TS HTTP endpoint.
# Does NOT replace compute_naked_pocs(); that function returns (date, price) tuples
# used by the existing VP CLI contract. This export helper adds the richer shape
# needed for the liquidity_levels table (age_days, high/low at establishment,
# establishing_volume) so downstream systems can weight levels by freshness and size.

@dataclass
class NakedPocRecord:
    """Naked POC entry ready for DB persistence via TS liquidity-map endpoint."""

    symbol: str
    session_date: str              # ISO YYYY-MM-DD of the session that ESTABLISHED the POC
    price: float
    age_days: int                  # sessions since established (count of prior dates)
    high_low_at_establishment: Tuple[float, float]  # (session_high, session_low) when POC formed
    establishing_volume: float     # total session volume when POC formed


def extract_naked_pocs_for_persistence(
    daily_history: "pl.DataFrame",
    intraday_history: "pl.DataFrame",
    symbol: str,
    as_of_date: str,
    lookback_days: int = NAKED_POC_LOOKBACK_DAYS,
) -> "List[NakedPocRecord]":
    """Returns list of currently-naked POCs ready for DB persistence.

    Pure function — no I/O, no side effects. Safe to call in hot paths.

    A POC is "naked" if price has NOT traded through it since the session in
    which it formed (same definition as compute_naked_pocs()).

    The function merges daily_history and intraday_history so callers can pass
    either 5-min bars (from the VP CLI data pipeline) or daily OHLCV — the
    ts_event date column is used for session grouping regardless of bar frequency.
    If intraday_history is empty (or the caller passes the same DataFrame twice)
    the function gracefully falls back to daily_history for all computations.

    Args:
        daily_history: Polars DataFrame with ts_event, high, low, close, volume.
            Used to establish per-session POC via compute_volume_profile().
            Must cover at least lookback_days + 1 sessions of history.
        intraday_history: Same schema. Merged with daily_history before computation
            so intraday bars improve POC precision. Pass an empty DataFrame or the
            same DataFrame as daily_history if you only have one granularity.
        symbol: Futures symbol for tick_size lookup (e.g. "MES").
        as_of_date: ISO YYYY-MM-DD — the date for which we want naked POCs.
            Sessions on or after this date are excluded from the lookback window.
        lookback_days: Maximum number of prior sessions to inspect (default 30).

    Returns:
        List of NakedPocRecord sorted by ascending age (most recently established
        first), matching the ordering convention used by nearby_naked_pocs in
        pre_market_sessions.
    """
    from datetime import date as _date

    if len(daily_history) == 0:
        return []

    tick = _get_tick_size(symbol)

    # Merge intraday into daily if intraday has rows and is a different object
    if len(intraday_history) > 0 and intraday_history is not daily_history:
        # Guard: both must share the required columns
        required = {"ts_event", "high", "low", "close", "volume"}
        if required.issubset(set(intraday_history.columns)) and required.issubset(set(daily_history.columns)):
            merged = pl.concat([daily_history, intraday_history]).sort("ts_event").unique(subset=["ts_event"], keep="first")
        else:
            merged = daily_history
    else:
        merged = daily_history

    # Ensure date column
    if "ts_event" not in merged.columns:
        return []

    df = merged.with_columns(
        pl.col("ts_event").dt.date().alias("_date")
    ).sort("ts_event")

    try:
        current_date = _date.fromisoformat(as_of_date)
    except Exception:
        return []

    all_dates = df["_date"].unique().sort().to_list()
    prior_dates = [d for d in all_dates if d < current_date]
    prior_dates = prior_dates[-lookback_days:]

    if not prior_dates:
        return []

    # ── Step 1: compute POC + session metadata for each prior date ────────────
    # We store (date, poc_price, session_high, session_low, total_volume) in one pass.
    session_records: List[Tuple[object, float, float, float, float]] = []
    for d in prior_dates:
        day_bars = df.filter(pl.col("_date") == d)
        if len(day_bars) == 0:
            continue
        lvl = compute_volume_profile(day_bars, tick_size=tick)
        if lvl.poc <= 0:
            continue
        session_records.append((
            d,
            lvl.poc,
            lvl.session_high,
            lvl.session_low,
            lvl.total_volume,
        ))

    if not session_records:
        return []

    # ── Step 2: filter to naked (untouched since establishment) ──────────────
    naked_records: List[NakedPocRecord] = []

    for poc_date, poc_price, sess_high, sess_low, sess_vol in session_records:
        subsequent = df.filter(
            (pl.col("_date") > poc_date) & (pl.col("_date") < current_date)
        )
        if len(subsequent) > 0:
            touched = subsequent.filter(
                (pl.col("high") >= poc_price) & (pl.col("low") <= poc_price)
            )
            if len(touched) > 0:
                continue  # POC was retested — not naked

        # Age = number of sessions from poc_date up to (but not including) as_of_date
        # Use position in prior_dates list rather than calendar days to avoid
        # skewing by weekends / holidays.
        age_sessions = len([d for d in prior_dates if d > poc_date])

        iso_date = (
            poc_date.isoformat()  # type: ignore[union-attr]
            if hasattr(poc_date, "isoformat")
            else str(poc_date)
        )

        naked_records.append(NakedPocRecord(
            symbol=symbol,
            session_date=iso_date,
            price=round(poc_price, 6),
            age_days=age_sessions,
            high_low_at_establishment=(sess_high, sess_low),
            establishing_volume=sess_vol,
        ))

    # Sort by ascending age (most recent first — mirrors pre_market_sessions convention)
    naked_records.sort(key=lambda r: r.age_days)
    return naked_records


# ─── A+ Gate: VP Shape Score (Wave 23 Gap-Fix-A) ─────────────────────────────
#
# Python port of getSessionShapeScore() from volume-profile-service.ts.
# Identical formula; used by the backtest A+ confluence gate so backtest and paper
# evaluate vp_shape using the same math.
#
# Formula (mirrors TS VP_SHAPE_SCORE_THRESHOLD constants):
#   shape_base_abs = { D: 0, b: 5, P: 5, Thin: 10 }[shape]
#   score = round(confidence * (shape_base_abs / 10) * 100)
#
# Threshold used by A+ gate: score >= 50
#   → b/P at 100% confidence = 50 (just passes)
#   → Thin at 50% confidence = 50 (just passes)
#   → D at any confidence = 0 (never passes — neutral profile blocks)
#
# This is a PURE FUNCTION — takes already-computed shape + confidence, no DB/IO.
# The backtester calls classify_profile_shape() first, then passes the result here.

_SHAPE_BASE_ABS: Dict[str, int] = {
    "D": 0,     # neutral — no directional profile score
    "b": 5,     # bullish profile
    "P": 5,     # bearish profile (absolute; direction not needed)
    "Thin": 10, # trend day
}

VP_SHAPE_SCORE_THRESHOLD: int = 50
"""A+ gate threshold. Matches paper-signal-service.ts VP_SHAPE_SCORE_THRESHOLD."""


def compute_session_shape_score(shape: str, confidence: float) -> int:
    """Compute 0-100 VP shape score from shape label and confidence.

    Mirrors the TS getSessionShapeScore() formula exactly:
        score = round(confidence × (|shape_base| / 10) × 100)

    Args:
        shape: Profile shape string: 'D', 'b', 'P', or 'Thin'.
        confidence: Shape classifier confidence, 0.0-1.0.

    Returns:
        Integer score 0-100. Same value TS would return for the same inputs.
    """
    base_abs = _SHAPE_BASE_ABS.get(shape, 0)
    return round(confidence * (base_abs / 10) * 100)


def compute_session_shape_score_from_bars(
    session_bars: "pl.DataFrame",
    symbol: Optional[str] = None,
    tick_size: Optional[float] = None,
) -> Tuple[int, str, float, bool]:
    """Compute VP shape score from raw intraday OHLCV bars for one session.

    Runs compute_volume_profile() + classify_profile_shape() on the provided bars,
    then computes the 0-100 score using compute_session_shape_score().

    Used by the backtest A+ gate to evaluate vp_shape factor per-bar without DB.

    Args:
        session_bars: Polars DataFrame with high, low, volume columns.
            Must cover only the TARGET session (pre-filtered by caller).
        symbol: Symbol for tick_size lookup. Overridden by tick_size.
        tick_size: Explicit tick size.

    Returns:
        Tuple of (score, shape, confidence, available):
            score: 0-100 integer
            shape: 'D', 'b', 'P', or 'Thin'
            confidence: 0.0-1.0 from classifier
            available: False when bars are empty or computation failed
    """
    if len(session_bars) == 0:
        return (0, "", 0.0, False)

    try:
        from src.engine.indicators.profile_shape_classifier import classify_profile_shape

        tick = tick_size if tick_size is not None else _get_tick_size(symbol)
        levels = compute_volume_profile(session_bars, tick_size=tick)

        if levels.poc == 0.0 and levels.vah == 0.0:
            # Degenerate profile — no real data
            return (0, "D", 0.0, False)

        shape_result = classify_profile_shape(levels, atr_20d=None)
        score = compute_session_shape_score(shape_result.shape, shape_result.confidence)
        return (score, shape_result.shape, shape_result.confidence, True)
    except Exception:
        return (0, "", 0.0, False)


# ─── CLI entrypoint (Track 2 — paper-parity contract) ─────────────────────────
#
# Contract consumed by src/server/services/volume-profile-service.ts:
#   python -m src.engine.indicators.volume_profile --symbol <SYM> --date <YYYY-MM-DD>
# Emits a single JSON object on stdout:
#   { poc, vah, val, naked_pocs, shape, shape_confidence,
#     ib_high, ib_low, ib_extension_status, open_classification, developing_poc }
# Fail-CLOSED: any error → non-zero exit + JSON error on stdout. The service
# treats any non-conforming output as an incomplete VP day and skips the upsert.

def _cli_main() -> int:
    import argparse
    import json
    import sys
    import traceback
    from datetime import date as _date, timedelta

    parser = argparse.ArgumentParser(description="Volume Profile daily compute (Track 2 contract).")
    parser.add_argument("--symbol", required=True, help="Futures symbol (e.g. MES, MNQ, MCL)")
    parser.add_argument("--date", required=True, help="Session date YYYY-MM-DD (Eastern Time)")
    parser.add_argument("--timeframe", default="5min", help="Intraday bar timeframe (default 5min)")
    parser.add_argument("--lookback-days", type=int, default=NAKED_POC_LOOKBACK_DAYS)
    args = parser.parse_args()

    try:
        from src.engine.data_loader import load_ohlcv
        from src.engine.indicators.profile_shape_classifier import classify_profile_shape
        from src.engine.indicators.initial_balance import compute_initial_balance
        from src.engine.context.open_relative_to_value import classify_open_relative_to_value

        session_date = _date.fromisoformat(args.date)
        tick = _get_tick_size(args.symbol)

        # Load intraday bars for the session (RTH + ETH window; classifier filters as needed)
        intraday = load_ohlcv(
            symbol=args.symbol,
            timeframe=args.timeframe,
            start=args.date,
            end=args.date,
        )

        # Load lookback daily/intraday history for naked POCs + prior-day open classification
        lookback_start = (session_date - timedelta(days=args.lookback_days + 5)).isoformat()
        lookback_end = (session_date - timedelta(days=1)).isoformat()
        history = load_ohlcv(
            symbol=args.symbol,
            timeframe=args.timeframe,
            start=lookback_start,
            end=lookback_end,
        )

        # 1. Current-session VP levels (POC/VAH/VAL + bin map for shape classifier)
        levels = compute_volume_profile(intraday, symbol=args.symbol, tick_size=tick)

        # 2. Profile shape (D / b / P / Thin)
        shape_result = classify_profile_shape(levels, atr_20d=None)
        shape = shape_result.shape
        shape_confidence = float(shape_result.confidence)

        # 3. Initial Balance (9:30–10:30 ET)
        ib = compute_initial_balance(intraday)
        ib_high = float(ib.ib_high) if ib is not None else None
        ib_low = float(ib.ib_low) if ib is not None else None
        ib_extension_status = ib.ib_extension_status if ib is not None else None

        # 4. Open classification (today's open vs MOST-RECENT prior-session VA only)
        #    BUG FIX: previously `compute_volume_profile(history, ...)` aggregated
        #    ALL lookback days into one VP. Open classification needs prior-session
        #    levels, so filter to the most recent prior date's bars before computing.
        open_classification = None
        if len(intraday) > 0 and len(history) > 0 and "ts_event" in history.columns:
            history_with_date = history.with_columns(
                pl.col("ts_event").dt.date().alias("_date")
            )
            prior_dates_all = history_with_date["_date"].unique().sort().to_list()
            prior_dates_all = [d for d in prior_dates_all if d < session_date]
            if prior_dates_all:
                most_recent_prior = prior_dates_all[-1]
                prior_session_bars = history_with_date.filter(
                    pl.col("_date") == most_recent_prior
                ).drop("_date")
                prior_levels = compute_volume_profile(
                    prior_session_bars, symbol=args.symbol, tick_size=tick
                )
                today_open = float(intraday["open"][0])
                open_class = classify_open_relative_to_value(
                    open_price=today_open,
                    prior_levels=prior_levels,
                    tolerance=tick,
                )
                open_classification = open_class.classification

        # 5. Naked POCs (history must include a date column at session granularity)
        naked = compute_naked_pocs(
            daily_bars=history,
            current_date_str=args.date,
            symbol=args.symbol,
            tick_size=tick,
            lookback_days=args.lookback_days,
        )
        naked_pocs_payload = [
            {
                "price": float(price),
                "source_date": (src_date.isoformat() if hasattr(src_date, "isoformat") else str(src_date)),
            }
            for src_date, price in naked
        ]

        out = {
            "poc": float(levels.poc),
            "vah": float(levels.vah),
            "val": float(levels.val),
            "naked_pocs": naked_pocs_payload,
            "shape": shape,
            "shape_confidence": shape_confidence,
            "ib_high": ib_high,
            "ib_low": ib_low,
            "ib_extension_status": ib_extension_status,
            "open_classification": open_classification,
            "developing_poc": float(levels.poc),
        }
        sys.stdout.write(json.dumps(out))
        sys.stdout.flush()
        return 0
    except Exception as exc:  # noqa: BLE001 — fail-CLOSED with structured error
        sys.stdout.write(json.dumps({
            "error": str(exc),
            "traceback": traceback.format_exc(),
        }))
        sys.stdout.flush()
        return 1


if __name__ == "__main__":
    raise SystemExit(_cli_main())
