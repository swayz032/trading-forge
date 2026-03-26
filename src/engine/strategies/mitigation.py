"""ICT Mitigation Block strategy — failed OB (no new HH/LL) + BOS = re-entry zone.

One-sentence: Enter when price retests an order block that failed to extend the trend
(no new swing extreme) and was confirmed by a Break of Structure in the opposite direction.

Key distinction from Breaker: a Breaker sweeps liquidity (makes new HH/LL) before reversing;
a Mitigation Block FAILS to make new HH/LL — the OB just stops working and structure shifts.

Exit logic: ATR-based stop loss (1.5x ATR beyond zone edge) + ATR-based take profit (3x ATR)
+ opposite signal.
"""

from __future__ import annotations

import numpy as np
import polars as pl
from numba import njit

from src.engine.strategy_base import BaseStrategy
from src.engine.indicators.market_structure import detect_swings, detect_bos
from src.engine.indicators.order_flow import detect_bullish_ob, detect_bearish_ob
from src.engine.indicators.core import compute_atr


@njit(cache=True)
def _apply_exits(entry_long_raw, entry_short_raw, closes, highs, lows,
                 atr_vals, sl_mult, tp_mult, n):
    """Walk forward: track position, apply ATR stop/target, exit on opposite signal."""
    entry_long = np.zeros(n, dtype=np.bool_)
    exit_long = np.zeros(n, dtype=np.bool_)
    entry_short = np.zeros(n, dtype=np.bool_)
    exit_short = np.zeros(n, dtype=np.bool_)

    in_long = False
    in_short = False
    entry_price = 0.0
    stop_price = 0.0
    target_price = 0.0

    for i in range(n):
        atr_val = atr_vals[i]
        if atr_val != atr_val or atr_val <= 0:  # NaN check
            continue

        # ─── Exit checks first ────────────────────────────
        if in_long:
            if lows[i] <= stop_price:
                exit_long[i] = True
                in_long = False
            elif highs[i] >= target_price:
                exit_long[i] = True
                in_long = False
            elif entry_short_raw[i]:
                exit_long[i] = True
                in_long = False

        if in_short:
            if highs[i] >= stop_price:
                exit_short[i] = True
                in_short = False
            elif lows[i] <= target_price:
                exit_short[i] = True
                in_short = False
            elif entry_long_raw[i]:
                exit_short[i] = True
                in_short = False

        # ─── Entry checks (only if flat) ──────────────────
        if not in_long and not in_short:
            if entry_long_raw[i]:
                entry_long[i] = True
                in_long = True
                entry_price = closes[i]
                stop_price = entry_price - sl_mult * atr_val
                target_price = entry_price + tp_mult * atr_val
            elif entry_short_raw[i]:
                entry_short[i] = True
                in_short = True
                entry_price = closes[i]
                stop_price = entry_price + sl_mult * atr_val
                target_price = entry_price - tp_mult * atr_val

    return entry_long, exit_long, entry_short, exit_short


class MitigationStrategy(BaseStrategy):
    """Mitigation Block — failed OB (no new extreme) + BOS confirms re-entry zone.

    ICT Mitigation Block formation:
      Bullish MB: bearish OB forms in downtrend -> price reaches OB but FAILS to make
        new LL -> price reverses and breaks above prior LH (bullish BOS) -> the failed
        bearish OB zone becomes a bullish re-entry zone on retest.
      Bearish MB: bullish OB forms in uptrend -> price reaches OB but FAILS to make
        new HH -> price reverses and breaks below prior HL (bearish BOS) -> the failed
        bullish OB zone becomes a bearish re-entry zone on retest.

    NOT a Breaker Block: breakers require liquidity sweep (new HH/LL) before reversing.
    Mitigation Blocks fail BEFORE making new extremes.

    Params (3):
        lookback: swing detection sensitivity
        atr_period: ATR period for tolerance and stop sizing
        retest_tolerance: how close price must come to MB zone (ATR multiple)
    """

    name = "mitigation"
    preferred_regime = None  # structural concept, works in any regime

    def __init__(
        self,
        lookback: int = 5,
        atr_period: int = 14,
        retest_tolerance: float = 0.3,
        sl_mult: float = 1.5,
        tp_mult: float = 3.0,
    ):
        self.lookback = lookback
        self.atr_period = atr_period
        self.retest_tolerance = retest_tolerance
        self.sl_mult = sl_mult
        self.tp_mult = tp_mult
        self.symbol = "ES"
        self.timeframe = "15min"

    def compute(self, df: pl.DataFrame) -> pl.DataFrame:
        n = len(df)

        # Edge case: not enough data
        if n < 2 * self.lookback + 10:
            return df.with_columns([
                pl.lit(False).alias("entry_long"),
                pl.lit(False).alias("entry_short"),
                pl.lit(False).alias("exit_long"),
                pl.lit(False).alias("exit_short"),
            ])

        swings = detect_swings(df, self.lookback)
        bos = detect_bos(df, swings)
        atr = compute_atr(df, self.atr_period)

        bull_obs = detect_bullish_ob(df, swings)
        bear_obs = detect_bearish_ob(df, swings)

        # Extract swing data for "failed to make new extreme" check
        swing_highs = swings.filter(pl.col("type") == "high")
        swing_lows = swings.filter(pl.col("type") == "low")

        # Find mitigation blocks: OBs that failed + BOS confirmed
        mb_zones = _find_mitigation_blocks(
            df, bull_obs, bear_obs, swing_highs, swing_lows, bos
        )

        # Generate raw entry signals from retest of MB zones
        atr_vals = atr.to_numpy().astype(np.float64)
        atr_vals_clean = np.nan_to_num(atr_vals, nan=0.0)

        entry_long_raw, entry_short_raw = _compute_mb_signals(
            df["close"].to_numpy(),
            df["high"].to_numpy(),
            df["low"].to_numpy(),
            atr_vals_clean,
            mb_zones,
            self.retest_tolerance,
            n,
        )

        # Apply exit logic: ATR stop/target + opposite signal
        entry_long, exit_long, entry_short, exit_short = _apply_exits(
            entry_long_raw, entry_short_raw,
            df["close"].to_numpy(), df["high"].to_numpy(), df["low"].to_numpy(),
            atr_vals_clean, self.sl_mult, self.tp_mult, n,
        )

        return df.with_columns([
            pl.Series("entry_long", entry_long),
            pl.Series("entry_short", entry_short),
            pl.Series("exit_long", exit_long),
            pl.Series("exit_short", exit_short),
            atr.alias(f"atr_{self.atr_period}"),
        ])

    def get_params(self) -> dict:
        return {
            "lookback": self.lookback,
            "atr_period": self.atr_period,
            "retest_tolerance": self.retest_tolerance,
        }

    def get_default_config(self) -> dict:
        return {
            "lookback": 5,
            "atr_period": 14,
            "retest_tolerance": 0.3,
        }


# ─── Helpers ──────────────────────────────────────────────────────


def _find_mitigation_blocks(
    df: pl.DataFrame,
    bull_obs: pl.DataFrame,
    bear_obs: pl.DataFrame,
    swing_highs: pl.DataFrame,
    swing_lows: pl.DataFrame,
    bos: pl.Series,
) -> list[tuple[float, float, str, int]]:
    """Identify valid Mitigation Blocks.

    Returns list of (top, bottom, direction, bos_bar) where:
      - direction: "long" (bullish MB) or "short" (bearish MB)
      - bos_bar: bar index where BOS confirmed the MB (entry only valid after this)

    Bullish MB: bearish OB fails to push price to new LL, then bullish BOS fires.
    Bearish MB: bullish OB fails to push price to new HH, then bearish BOS fires.
    """
    n = len(df)
    bos_list = bos.to_list()
    lows_arr = df["low"].to_numpy()
    highs_arr = df["high"].to_numpy()

    sh_indices = swing_highs["index"].to_list() if len(swing_highs) > 0 else []
    sh_prices = swing_highs["price"].to_list() if len(swing_highs) > 0 else []
    sl_indices = swing_lows["index"].to_list() if len(swing_lows) > 0 else []
    sl_prices = swing_lows["price"].to_list() if len(swing_lows) > 0 else []

    mb_zones = []

    # ── Bullish Mitigation Blocks (from failed bearish OBs) ──
    # A bearish OB forms near a swing high in a downtrend.
    # If after the OB, price fails to make a new LL, then reverses with bullish BOS,
    # the bearish OB zone becomes a bullish MB.
    if len(bear_obs) > 0:
        for k in range(len(bear_obs)):
            ob_idx = int(bear_obs["index"][k])
            ob_top = float(bear_obs["top"][k])
            ob_bottom = float(bear_obs["bottom"][k])

            if ob_top <= ob_bottom or ob_idx + 1 >= n:
                continue

            # Find the most recent swing low BEFORE this bearish OB
            prev_sl_price = None
            for j in range(len(sl_indices) - 1, -1, -1):
                if sl_indices[j] < ob_idx:
                    prev_sl_price = sl_prices[j]
                    break

            if prev_sl_price is None:
                continue

            # Check: after OB, did price FAIL to make new LL?
            # Scan forward from OB to find if price went below prior swing low
            made_new_ll = False
            scan_end = min(ob_idx + 60, n)  # reasonable lookahead
            for i in range(ob_idx + 1, scan_end):
                if lows_arr[i] < prev_sl_price:
                    made_new_ll = True
                    break

            if made_new_ll:
                continue  # This would be a breaker setup, not mitigation

            # Find bullish BOS after the OB (confirms structure shift)
            bos_bar = None
            for i in range(ob_idx + 1, scan_end):
                if bos_list[i] == "bullish":
                    bos_bar = i
                    break

            if bos_bar is not None:
                mb_zones.append((ob_top, ob_bottom, "long", bos_bar))

    # ── Bearish Mitigation Blocks (from failed bullish OBs) ──
    # A bullish OB forms near a swing low in an uptrend.
    # If after the OB, price fails to make a new HH, then reverses with bearish BOS,
    # the bullish OB zone becomes a bearish MB.
    if len(bull_obs) > 0:
        for k in range(len(bull_obs)):
            ob_idx = int(bull_obs["index"][k])
            ob_top = float(bull_obs["top"][k])
            ob_bottom = float(bull_obs["bottom"][k])

            if ob_top <= ob_bottom or ob_idx + 1 >= n:
                continue

            # Find the most recent swing high BEFORE this bullish OB
            prev_sh_price = None
            for j in range(len(sh_indices) - 1, -1, -1):
                if sh_indices[j] < ob_idx:
                    prev_sh_price = sh_prices[j]
                    break

            if prev_sh_price is None:
                continue

            # Check: after OB, did price FAIL to make new HH?
            made_new_hh = False
            scan_end = min(ob_idx + 60, n)
            for i in range(ob_idx + 1, scan_end):
                if highs_arr[i] > prev_sh_price:
                    made_new_hh = True
                    break

            if made_new_hh:
                continue  # Would be a breaker, not mitigation

            # Find bearish BOS after the OB (confirms structure shift)
            bos_bar = None
            for i in range(ob_idx + 1, scan_end):
                if bos_list[i] == "bearish":
                    bos_bar = i
                    break

            if bos_bar is not None:
                mb_zones.append((ob_top, ob_bottom, "short", bos_bar))

    return mb_zones


def _compute_mb_signals(
    closes: np.ndarray,
    highs: np.ndarray,
    lows: np.ndarray,
    atr_vals: np.ndarray,
    mb_zones: list[tuple[float, float, str, int]],
    retest_tolerance: float,
    n: int,
) -> tuple[np.ndarray, np.ndarray]:
    """Generate entry signals when price retests a validated MB zone.

    Bullish MB (direction="long"): price pulls back to the zone from above -> buy.
    Bearish MB (direction="short"): price rallies back to the zone from below -> sell.

    A zone is only active after BOS confirmation and expires after 60 bars.
    """
    entry_long = np.zeros(n, dtype=np.bool_)
    entry_short = np.zeros(n, dtype=np.bool_)

    zone_age_limit = 60  # MB zone expires after 60 bars past BOS

    for mb_top, mb_bottom, direction, bos_bar in mb_zones:
        zone_size = mb_top - mb_bottom
        if zone_size <= 0:
            continue

        start = bos_bar + 1
        end = min(bos_bar + zone_age_limit, n)

        for i in range(start, end):
            curr_atr = atr_vals[i]
            if curr_atr <= 0:
                continue

            tolerance = retest_tolerance * curr_atr

            if direction == "long":
                # Bullish MB: price pulls back down into / near the zone top
                # Entry when low touches the zone (with tolerance) and close is at or above zone
                if lows[i] <= mb_top + tolerance and closes[i] >= mb_bottom:
                    entry_long[i] = True
                    break  # one entry per zone

            elif direction == "short":
                # Bearish MB: price rallies up into / near the zone bottom
                # Entry when high reaches the zone (with tolerance) and close is at or below zone
                if highs[i] >= mb_bottom - tolerance and closes[i] <= mb_top:
                    entry_short[i] = True
                    break  # one entry per zone

    return entry_long, entry_short
