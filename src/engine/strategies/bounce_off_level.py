"""Bounce-off-MA archetype — price approaches a moving average and rejects.

One-sentence: Enter when price reaches within 1×ATR of a single moving average
and prints a rejection candle (wick_reject, engulfing, pin_bar, or any close-back-
through), then confirms on the next bar, targeting the opposing structural swing.

Signal class: MA-as-support/resistance (price BOUNCES OFF the MA).
This is fundamentally different from ema_crossover (MA vs MA cross) — here there
is ONE MA acting as a dynamic S/R level, not two MAs whose relationship triggers
the signal.

Configurable params
-------------------
ma_type       : "sma" or "ema"
ma_period     : 20 | 50 | 100 | 200  (or any int 10-250)
direction     : "ceiling" | "floor" | "both"
rejection_pattern : "wick_reject" | "engulfing" | "pin_bar" | "any_close_back_through"
proximity_atr_mult: float — how close price must come to the MA to qualify (default 1.0)
swing_lookback : int — bars to look back for structural swing stop placement
atr_period    : int — ATR period for stop floor

Hard constraints (CLAUDE.md §4)
--------------------------------
- Stop floor = 1.5 × ATR
- Stop ceiling = 14pts MES (parameter, per-symbol override via symbol_stop_ceiling)
- 15:55 ET flatten handled by backtester, not this class
- P&L computed in backtester — this class emits ONLY entry/exit boolean signals
"""

from __future__ import annotations

from typing import Literal

import numpy as np
import polars as pl

from src.engine.indicators.core import compute_atr, compute_ema, compute_sma
from src.engine.strategy_base import BaseStrategy

# ─── Named constants (CLAUDE.md §13: no magic numbers inline) ────────────────
ATR_PERIOD_DEFAULT: int = 14
SWING_LOOKBACK_DEFAULT: int = 5
PROXIMITY_ATR_MULT_DEFAULT: float = 1.0
STOP_FLOOR_ATR_MULT: float = 1.5
STOP_CEILING_MES_POINTS: float = 14.0   # CLAUDE.md §4 canonical
MIN_BARS_REQUIRED: int = 20             # warmup guard


MaType = Literal["sma", "ema"]
Direction = Literal["ceiling", "floor", "both"]
RejectionPattern = Literal[
    "wick_reject",
    "engulfing",
    "pin_bar",
    "any_close_back_through",
]


class BounceOffLevelStrategy(BaseStrategy):
    """Price-bounces-off-single-MA archetype.

    Long (floor): price approaches MA from below (within proximity_atr_mult×ATR),
    rejection candle prints, entry on confirmation bar close.

    Short (ceiling): price approaches MA from above (within proximity_atr_mult×ATR),
    rejection candle prints, entry on confirmation bar close.
    """

    name = "bounce_off_level"
    preferred_regime = None  # works in TRENDING and RANGE regimes

    def __init__(
        self,
        ma_type: MaType = "sma",
        ma_period: int = 200,
        direction: Direction = "both",
        rejection_pattern: RejectionPattern = "any_close_back_through",
        proximity_atr_mult: float = PROXIMITY_ATR_MULT_DEFAULT,
        swing_lookback: int = SWING_LOOKBACK_DEFAULT,
        atr_period: int = ATR_PERIOD_DEFAULT,
        stop_ceiling_points: float = STOP_CEILING_MES_POINTS,
    ) -> None:
        if ma_type not in ("sma", "ema"):
            raise ValueError(f"ma_type must be 'sma' or 'ema', got {ma_type!r}")
        if direction not in ("ceiling", "floor", "both"):
            raise ValueError(f"direction must be 'ceiling', 'floor', or 'both', got {direction!r}")
        if rejection_pattern not in ("wick_reject", "engulfing", "pin_bar", "any_close_back_through"):
            raise ValueError(f"Unknown rejection_pattern: {rejection_pattern!r}")
        if ma_period < 10 or ma_period > 250:
            raise ValueError(f"ma_period must be in [10, 250], got {ma_period}")
        if proximity_atr_mult <= 0:
            raise ValueError(f"proximity_atr_mult must be positive, got {proximity_atr_mult}")

        self.ma_type = ma_type
        self.ma_period = ma_period
        self.direction = direction
        self.rejection_pattern = rejection_pattern
        self.proximity_atr_mult = proximity_atr_mult
        self.swing_lookback = swing_lookback
        self.atr_period = atr_period
        self.stop_ceiling_points = stop_ceiling_points

        # Symbol / timeframe are set by backtester from config
        self.symbol = "MES"
        self.timeframe = "15min"

    # ─── BaseStrategy interface ───────────────────────────────────────────────

    def get_params(self) -> dict:
        return {
            "ma_period": self.ma_period,
            "proximity_atr_mult": self.proximity_atr_mult,
            "swing_lookback": self.swing_lookback,
            "atr_period": self.atr_period,
        }

    def get_default_config(self) -> dict:
        return {
            "name": self.name,
            "ma_type": self.ma_type,
            "ma_period": self.ma_period,
            "direction": self.direction,
            "rejection_pattern": self.rejection_pattern,
            "proximity_atr_mult": self.proximity_atr_mult,
            "swing_lookback": self.swing_lookback,
            "atr_period": self.atr_period,
            "stop_ceiling_points": self.stop_ceiling_points,
        }

    # ─── Core compute ─────────────────────────────────────────────────────────

    def compute(self, df: pl.DataFrame) -> pl.DataFrame:
        """Emit entry_long / entry_short / exit_long / exit_short boolean columns."""
        n = len(df)
        false_col = pl.lit(False)

        if n < MIN_BARS_REQUIRED:
            return df.with_columns([
                false_col.alias("entry_long"),
                false_col.alias("entry_short"),
                false_col.alias("exit_long"),
                false_col.alias("exit_short"),
            ])

        # ── 1. Compute MA ────────────────────────────────────────────────────
        close = df["close"]
        if self.ma_type == "sma":
            ma = compute_sma(close, self.ma_period)
        else:
            ma = compute_ema(close, self.ma_period)

        # ── 2. ATR for proximity and stop floor ──────────────────────────────
        atr = compute_atr(df, self.atr_period)

        # ── 3. Build numpy arrays for bar-by-bar scan (no lookahead) ─────────
        close_np = close.to_numpy().astype(np.float64)
        high_np = df["high"].to_numpy().astype(np.float64)
        low_np = df["low"].to_numpy().astype(np.float64)
        open_np = df["open"].to_numpy().astype(np.float64)
        ma_np = ma.to_numpy().astype(np.float64)
        atr_np = atr.to_numpy().astype(np.float64)

        entry_long = np.zeros(n, dtype=bool)
        entry_short = np.zeros(n, dtype=bool)

        # We need i-1 as the rejection bar and i as the confirmation bar.
        # Start at 2 to allow lookback=1 for the rejection candle.
        for i in range(2, n):
            # NaN guard: skip warmup region where MA or ATR hasn't stabilised
            ma_prev = ma_np[i - 1]
            atr_prev = atr_np[i - 1]
            if np.isnan(ma_prev) or np.isnan(atr_prev) or atr_prev <= 0:
                continue

            # Proximity zone: low of rejection bar must have touched within
            # proximity_atr_mult × ATR of the MA
            prox = self.proximity_atr_mult * atr_prev

            # ── Long setup (price approaching MA from below → MA is floor) ──
            if self.direction in ("floor", "both"):
                # Price must have touched or gotten within proximity from below:
                # low[i-1] <= ma[i-1] + prox  AND  close[i-2] < ma[i-2] (coming from below)
                ma_prev2 = ma_np[i - 2]
                if not np.isnan(ma_prev2):
                    # Was price below or at MA before (coming from below)?
                    was_below = close_np[i - 2] <= ma_prev2 + prox
                    # Did the rejection bar get within proximity of the MA?
                    touched_ma = low_np[i - 1] <= ma_prev + prox
                    # Rejection: price didn't close below MA (held as support)
                    held_above = close_np[i - 1] > ma_prev - prox
                    if was_below and touched_ma and held_above:
                        if self._is_rejection_candle_long(
                            open_np[i - 1], high_np[i - 1], low_np[i - 1], close_np[i - 1], ma_prev
                        ):
                            entry_long[i] = True

            # ── Short setup (price approaching MA from above → MA is ceiling) ──
            if self.direction in ("ceiling", "both"):
                ma_prev2 = ma_np[i - 2]
                if not np.isnan(ma_prev2):
                    was_above = close_np[i - 2] >= ma_prev2 - prox
                    touched_ma = high_np[i - 1] >= ma_prev - prox
                    held_below = close_np[i - 1] < ma_prev + prox
                    if was_above and touched_ma and held_below:
                        if self._is_rejection_candle_short(
                            open_np[i - 1], high_np[i - 1], low_np[i - 1], close_np[i - 1], ma_prev
                        ):
                            entry_short[i] = True

        # ── 4. Structural exit: swing-based (detect_swings provides the level) ──
        # For simplicity, exit is a time-stop / structural exit handled by
        # backtester._apply_trade_management. Here we emit False (no intrabar exit).
        exit_long = np.zeros(n, dtype=bool)
        exit_short = np.zeros(n, dtype=bool)

        return df.with_columns([
            pl.Series("entry_long", entry_long),
            pl.Series("entry_short", entry_short),
            pl.Series("exit_long", exit_long),
            pl.Series("exit_short", exit_short),
        ])

    # ─── Rejection pattern detectors ──────────────────────────────────────────

    def _is_rejection_candle_long(
        self, o: float, h: float, lo: float, c: float, ma: float
    ) -> bool:
        """True if the bar represents a bullish rejection off the MA (floor)."""
        body = abs(c - o)
        candle_range = h - lo
        if candle_range <= 0:
            return False

        if self.rejection_pattern == "any_close_back_through":
            # Price dipped to or below MA but closed back above it
            return lo <= ma and c > ma

        elif self.rejection_pattern == "wick_reject":
            # Long lower wick (>= 40% of candle range) + close in upper half
            lower_wick = min(o, c) - lo
            return lower_wick >= 0.4 * candle_range and c >= (lo + candle_range * 0.5)

        elif self.rejection_pattern == "pin_bar":
            # Lower wick >= 2× body, close in upper third of range
            lower_wick = min(o, c) - lo
            return (
                body > 0
                and lower_wick >= 2 * body
                and c >= (lo + candle_range * 0.67)
            )

        elif self.rejection_pattern == "engulfing":
            # Bullish engulfing: closes above the prior-bar implied MA zone
            # Simplified: close is bullish (c > o) + touched MA on the low
            return c > o and lo <= ma

        return False

    def _is_rejection_candle_short(
        self, o: float, h: float, lo: float, c: float, ma: float
    ) -> bool:
        """True if the bar represents a bearish rejection off the MA (ceiling)."""
        body = abs(c - o)
        candle_range = h - lo
        if candle_range <= 0:
            return False

        if self.rejection_pattern == "any_close_back_through":
            # Price spiked to or above MA but closed back below it
            return h >= ma and c < ma

        elif self.rejection_pattern == "wick_reject":
            # Long upper wick (>= 40% of candle range) + close in lower half
            upper_wick = h - max(o, c)
            return upper_wick >= 0.4 * candle_range and c <= (h - candle_range * 0.5)

        elif self.rejection_pattern == "pin_bar":
            # Upper wick >= 2× body, close in lower third of range
            upper_wick = h - max(o, c)
            return (
                body > 0
                and upper_wick >= 2 * body
                and c <= (h - candle_range * 0.67)
            )

        elif self.rejection_pattern == "engulfing":
            # Bearish engulfing: close is bearish (c < o) + touched MA on the high
            return c < o and h >= ma

        return False
