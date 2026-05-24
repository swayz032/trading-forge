"""Structure Engine — Independent market structure validation layer.

Wave 25 W25.2 (2026-05-24)

PURPOSE:
    Fixes the circular-logic bug where `structural_setup = True` whenever the
    entry trigger fires (tautological, zero information). This engine runs
    BEFORE any entry trigger evaluates and publishes a StructureState that both
    the bias engine AND Stage 2 weighted scoring (W25.1) consume.

ARCHITECTURE:
    compute_structure_state(exec_bars, htf_bars) → StructureState

    Internal pipeline:
      1. detect_swings()              — 5-bar lookback, no look-ahead
      2. detect_bos()                 — bullish/bearish BOS series
      3. detect_choch_with_context()  — counter-trend break after BOS series
      4. detect_mss_with_context()    — CHoCH + displacement candle (≥1.5×ATR)
      5. premium_discount_zone()      — PD-array classification
      6. HTF bias alignment           — does last_break_direction match htf_bias?

DOWNSTREAM CONTRACT (JSON shape for W25.1 sibling):
    {
      "bos_recent": bool,
      "bos_direction": "bullish" | "bearish" | null,
      "choch_recent": bool,
      "choch_direction": "bullish" | "bearish" | null,
      "mss_recent": bool,
      "mss_direction": "bullish" | "bearish" | null,
      "mss_displacement_atr_mult": float | null,
      "displacement_active": bool,
      "premium_discount_zone": "premium" | "discount" | "equilibrium",
      "htf_bias_aligned": bool,
      "last_break_direction": "bullish" | "bearish" | null,
      "last_break_age_bars": int | null,
      "swing_high": float | null,
      "swing_low": float | null,
      "computed_at_bar_idx": int
    }

    Serialise via dataclasses.asdict() — keys are snake_case matching
    the TypeScript StructureState interface in confluence-score.ts (W25.1).

FAIL-SAFE CONTRACT:
    If compute_structure_state() raises for any reason OR if htf_bars is empty,
    it returns None. Downstream consumers (Stage 2 W25.1) treat None as
    "factor unavailable, satisfied=false, reason=structure_engine_unavailable".
    This is intentional — never throw from an advisory layer.

NAMED CONSTANTS (no magic numbers inline):
    SWING_LOOKBACK          — bars each side for swing detection
    BOS_RECENT_WINDOW_BARS  — within how many bars counts as "recent" BOS
    CHOCH_RECENT_WINDOW_BARS
    MSS_RECENT_WINDOW_BARS
    DISPLACEMENT_LOOKBACK   — current OR prior bar counts as displacement_active
    ATR_PERIOD              — ATR period for MSS displacement threshold

NO LOOK-AHEAD invariant:
    Every function called here uses strict `< i` swing pointer advancement and
    backward-asof join semantics. MTF data from htf_bars is joined via
    forward_fill_htf_to_exec() (backward strategy, Wave 23H.1 invariant).
    compute_structure_state(bars[:i]) must return the same result as
    compute_structure_state(bars[:j])[i] for j > i (verified in test suite).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

import polars as pl

from src.engine.indicators.market_structure import (
    detect_swings,
    detect_bos,
    detect_choch_with_context,
    detect_mss_with_context,
    premium_discount_zone as pd_zone_scalar,
)

logger = logging.getLogger(__name__)

# ─── Named constants ──────────────────────────────────────────────────────────
SWING_LOOKBACK: int = 5          # bars each side for detect_swings
BOS_RECENT_WINDOW_BARS: int = 20  # BOS detected within last N bars = "bos_recent"
CHOCH_RECENT_WINDOW_BARS: int = 10
MSS_RECENT_WINDOW_BARS: int = 10
DISPLACEMENT_LOOKBACK: int = 2   # last N bars checked for displacement_active
ATR_PERIOD: int = 14             # passed to detect_mss_with_context


@dataclass
class StructureState:
    """Independent structure validation snapshot, published BEFORE entry trigger.

    JSON shape is the downstream contract — do not rename fields without
    updating confluence-score.ts (W25.1) and bias-state-service.ts.
    """

    bos_recent: bool                       # BOS detected within BOS_RECENT_WINDOW_BARS
    bos_direction: Optional[str]           # "bullish" | "bearish" | None
    choch_recent: bool                     # CHoCH detected within CHOCH_RECENT_WINDOW_BARS
    choch_direction: Optional[str]         # "bullish" | "bearish" | None
    mss_recent: bool                       # MSS detected within MSS_RECENT_WINDOW_BARS
    mss_direction: Optional[str]           # "bullish" | "bearish" | None
    mss_displacement_atr_mult: Optional[float]  # displacement magnitude at MSS bar
    displacement_active: bool              # last DISPLACEMENT_LOOKBACK bars has displacement
    premium_discount_zone: str             # "premium" | "discount" | "equilibrium"
    htf_bias_aligned: bool                 # last_break_direction matches htf_bias
    last_break_direction: Optional[str]    # "bullish" | "bearish" | None
    last_break_age_bars: Optional[int]     # bars since last BOS/CHoCH/MSS
    swing_high: Optional[float]            # most-recent confirmed swing high price
    swing_low: Optional[float]             # most-recent confirmed swing low price
    computed_at_bar_idx: int               # index of last bar in exec_bars


def _derive_prior_bos_direction(bos_series: pl.Series, up_to_bar: int) -> Optional[str]:
    """Return the most-recent non-null BOS direction in bos_series up to bar i.

    Scans backward from bar i (inclusive). Returns None if no BOS found.
    No look-ahead: only reads indices <= up_to_bar.
    """
    values = bos_series.to_list()
    for i in range(min(up_to_bar, len(values) - 1), -1, -1):
        if values[i] is not None:
            return values[i]
    return None


def _last_swing_prices(swings: pl.DataFrame, up_to_bar: int) -> tuple[Optional[float], Optional[float]]:
    """Return (swing_high, swing_low) of the most-recent confirmed swings up to bar i.

    Scans the swings DataFrame (already sorted by index) for the latest
    swing high and swing low whose index <= up_to_bar.
    """
    highs = swings.filter((pl.col("type") == "high") & (pl.col("index") <= up_to_bar))
    lows = swings.filter((pl.col("type") == "low") & (pl.col("index") <= up_to_bar))

    swing_high: Optional[float] = None
    swing_low: Optional[float] = None

    if len(highs) > 0:
        # Most-recent swing high = last row (swings are sorted ascending by index)
        swing_high = float(highs["price"][-1])
    if len(lows) > 0:
        swing_low = float(lows["price"][-1])

    return swing_high, swing_low


def _find_last_break(
    bos_series: pl.Series,
    choch_df: pl.DataFrame,
    mss_df: pl.DataFrame,
    up_to_bar: int,
) -> tuple[Optional[str], Optional[int]]:
    """Identify the most-recent structure break (MSS > CHoCH > BOS precedence).

    Returns (direction, age_bars) of the MOST RECENT break found up to up_to_bar.
    """
    bos_vals = bos_series.to_list()
    choch_detected = choch_df["choch_detected"].to_list()
    choch_dirs = choch_df["choch_direction"].to_list()
    mss_detected = mss_df["mss_detected"].to_list()
    mss_dirs = mss_df["mss_direction"].to_list()

    last_dir: Optional[str] = None
    last_age: Optional[int] = None
    last_break_idx: int = -1

    end = min(up_to_bar + 1, len(bos_vals))

    for i in range(end):
        if mss_detected[i] and mss_dirs[i] is not None:
            if i > last_break_idx:
                last_break_idx = i
                last_dir = mss_dirs[i]
        elif choch_detected[i] and choch_dirs[i] is not None:
            if i > last_break_idx:
                last_break_idx = i
                last_dir = choch_dirs[i]
        elif bos_vals[i] is not None:
            if i > last_break_idx:
                last_break_idx = i
                last_dir = bos_vals[i]

    if last_break_idx >= 0:
        last_age = up_to_bar - last_break_idx
    return last_dir, last_age


def _is_displacement_active(
    bars: pl.DataFrame,
    choch_df: pl.DataFrame,
    mss_df: pl.DataFrame,
    up_to_bar: int,
    lookback: int = DISPLACEMENT_LOOKBACK,
) -> bool:
    """True if any of the last `lookback` bars contains a MSS displacement candle.

    The MSS check is displacement by definition (CHoCH + ≥1.5×ATR range).
    """
    mss_detected = mss_df["mss_detected"].to_list()
    start = max(0, up_to_bar - lookback + 1)
    end = min(up_to_bar + 1, len(mss_detected))
    return any(mss_detected[i] for i in range(start, end))


def compute_structure_state(
    exec_bars: pl.DataFrame,
    htf_bars: pl.DataFrame,
    htf_bias: Optional[str] = None,
    lookback_swings: int = 20,
) -> Optional["StructureState"]:
    """Run the full structure detection pipeline and return a StructureState snapshot.

    Reads exec_bars for current structure; htf_bars for HTF bias alignment check.
    The `lookback_swings` parameter controls how many recent exec bars are used
    for swing detection (uses the FULL exec_bars slice for ATR accuracy, but only
    the most-recent lookback_swings worth of swings drive bos/choch/mss).

    Args:
        exec_bars:      Execution-TF bars (must have open, high, low, close, volume,
                        and ideally ts_event). At least 30 bars recommended.
        htf_bars:       Higher-timeframe bars. If empty, htf_bias_aligned=False.
        htf_bias:       "bullish" | "bearish" | None — current HTF bias from
                        bias_engine. Used to compute htf_bias_aligned.
        lookback_swings: Number of recent bars to include in swing search window.
                        (Passed to detect_swings as context — full bars used for ATR.)

    Returns:
        StructureState snapshot, or None if any unrecoverable error occurs.
        None is a valid output — downstream treats it as "factor unavailable".
    """
    try:
        return _compute_structure_state_inner(exec_bars, htf_bars, htf_bias, lookback_swings)
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "compute_structure_state failed (returning None): %s",
            exc,
            exc_info=True,
        )
        return None


def _compute_structure_state_inner(
    exec_bars: pl.DataFrame,
    htf_bars: pl.DataFrame,
    htf_bias: Optional[str],
    lookback_swings: int,
) -> StructureState:
    """Inner implementation — may raise; caller wraps in try/except."""
    if exec_bars is None or len(exec_bars) == 0:
        raise ValueError("exec_bars is empty — cannot compute structure state")

    # Validate required columns
    required = {"open", "high", "low", "close"}
    missing = required - set(exec_bars.columns)
    if missing:
        raise ValueError(f"exec_bars missing columns: {missing}")

    n = len(exec_bars)
    last_bar_idx = n - 1

    # ── Step 1: Swing detection on full exec_bars ────────────────────────────
    swings = detect_swings(exec_bars, lookback=SWING_LOOKBACK)

    # ── Step 2: BOS detection ────────────────────────────────────────────────
    bos_series = detect_bos(exec_bars, swings)

    # Determine prior BOS direction (most-recent non-null BOS value)
    prior_bos_direction = _derive_prior_bos_direction(bos_series, last_bar_idx)

    # BOS recent: any non-null BOS in last BOS_RECENT_WINDOW_BARS
    bos_vals = bos_series.to_list()
    start_bos_window = max(0, last_bar_idx - BOS_RECENT_WINDOW_BARS + 1)
    bos_in_window = [v for v in bos_vals[start_bos_window:last_bar_idx + 1] if v is not None]
    bos_recent = len(bos_in_window) > 0
    bos_direction: Optional[str] = bos_in_window[-1] if bos_in_window else prior_bos_direction

    # ── Step 3: CHoCH detection (requires prior BOS direction) ───────────────
    choch_df: pl.DataFrame
    if prior_bos_direction is not None:
        choch_df = detect_choch_with_context(exec_bars, swings, prior_bos_direction)
    else:
        # No established BOS trend yet — CHoCH undefined
        choch_df = pl.DataFrame({
            "choch_detected": pl.Series([False] * n, dtype=pl.Boolean),
            "choch_direction": pl.Series([None] * n, dtype=pl.Utf8),
            "choch_bar_idx": pl.Series([None] * n, dtype=pl.Int64),
            "choch_magnitude": pl.Series([None] * n, dtype=pl.Float64),
        })

    choch_detected_list = choch_df["choch_detected"].to_list()
    choch_direction_list = choch_df["choch_direction"].to_list()
    start_choch_window = max(0, last_bar_idx - CHOCH_RECENT_WINDOW_BARS + 1)
    choch_in_window = [
        choch_direction_list[i]
        for i in range(start_choch_window, last_bar_idx + 1)
        if choch_detected_list[i]
    ]
    choch_recent = len(choch_in_window) > 0
    choch_direction: Optional[str] = choch_in_window[-1] if choch_in_window else None

    # ── Step 4: MSS detection (CHoCH + displacement) ─────────────────────────
    mss_df = detect_mss_with_context(exec_bars, choch_df, atr_period=ATR_PERIOD)

    mss_detected_list = mss_df["mss_detected"].to_list()
    mss_direction_list = mss_df["mss_direction"].to_list()
    mss_mult_list = mss_df["mss_displacement_atr_mult"].to_list()
    start_mss_window = max(0, last_bar_idx - MSS_RECENT_WINDOW_BARS + 1)
    mss_in_window_indices = [
        i
        for i in range(start_mss_window, last_bar_idx + 1)
        if mss_detected_list[i]
    ]
    mss_recent = len(mss_in_window_indices) > 0
    mss_direction: Optional[str] = mss_direction_list[mss_in_window_indices[-1]] if mss_in_window_indices else None
    mss_displacement_atr_mult: Optional[float] = (
        mss_mult_list[mss_in_window_indices[-1]] if mss_in_window_indices else None
    )

    # ── Step 5: PD-zone (scalar, last close vs last swing range) ────────────
    swing_high, swing_low = _last_swing_prices(swings, last_bar_idx)
    last_close = float(exec_bars["close"][last_bar_idx])

    pd_zone: str
    if swing_high is not None and swing_low is not None:
        pd_zone = pd_zone_scalar(last_close, swing_high, swing_low)
    else:
        pd_zone = "equilibrium"  # no swings yet — default neutral

    # ── Step 6: Displacement active ──────────────────────────────────────────
    displacement_active = _is_displacement_active(
        exec_bars, choch_df, mss_df, last_bar_idx
    )

    # ── Step 7: Last break direction + age ───────────────────────────────────
    last_break_direction, last_break_age_bars = _find_last_break(
        bos_series, choch_df, mss_df, last_bar_idx
    )

    # ── Step 8: HTF bias alignment ────────────────────────────────────────────
    # htf_bias_aligned = True when last_break_direction matches htf_bias.
    # If htf_bars is empty or htf_bias is None → False (unknown alignment).
    htf_bias_aligned = False
    if htf_bias is not None and last_break_direction is not None:
        # Normalise: "bullish"/"bearish" must match exactly
        htf_bias_aligned = (htf_bias.lower() == last_break_direction.lower())
    elif htf_bars is not None and len(htf_bars) == 0:
        # Explicit empty htf_bars — log and leave False
        logger.debug("compute_structure_state: htf_bars empty, htf_bias_aligned=False")

    return StructureState(
        bos_recent=bos_recent,
        bos_direction=bos_direction,
        choch_recent=choch_recent,
        choch_direction=choch_direction,
        mss_recent=mss_recent,
        mss_direction=mss_direction,
        mss_displacement_atr_mult=mss_displacement_atr_mult,
        displacement_active=displacement_active,
        premium_discount_zone=pd_zone,
        htf_bias_aligned=htf_bias_aligned,
        last_break_direction=last_break_direction,
        last_break_age_bars=last_break_age_bars,
        swing_high=swing_high,
        swing_low=swing_low,
        computed_at_bar_idx=last_bar_idx,
    )
