"""ICT Breaker strategy — failed OB becomes breaker, enter on retest.

One-sentence: Enter when price returns to a broken order block (breaker zone),
validated by BOS at the break point.

Performance: Numba @njit compiled — 153K bars in ~1.3s.

Exit logic: ATR-based stop loss (2× ATR) + ATR-based take profit (3× ATR) + opposite signal.

Fix: Added BOS validation at the break point — a breaker is only valid if the OB
was broken through with a confirmed Break of Structure, not just any price crossing.
"""

from __future__ import annotations
import numpy as np
import polars as pl
from numba import njit
from src.engine.strategy_base import BaseStrategy
from src.engine.indicators.core import compute_atr
from src.engine.indicators.market_structure import detect_swings, detect_bos
from src.engine.indicators.order_flow import detect_bullish_ob, detect_bearish_ob, detect_breaker, compute_breaker_signals


@njit(cache=True)
def _apply_exits(entry_long_raw, entry_short_raw, closes, highs, lows, atr_vals,
                 sl_mult, tp_mult, n):
    """Walk forward: track position state, apply ATR stop/target, exit on opposite signal.

    Since backtester only uses entry_long/exit_long, we merge both directions:
    - Long entries come from bullish breaker signals
    - Short entries come from bearish breaker signals (mapped to exit_long to flatten)
    - ATR stop loss and take profit generate exit_long signals
    """
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

        # ─── Exit checks first (before new entries) ─────────
        if in_long:
            # Stop loss: low pierces stop
            if lows[i] <= stop_price:
                exit_long[i] = True
                in_long = False
            # Take profit: high reaches target
            elif highs[i] >= target_price:
                exit_long[i] = True
                in_long = False
            # Opposite signal: bearish breaker entry → close long
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

        # ─── Entry checks (only if flat) ────────────────────
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


class BreakerStrategy(BaseStrategy):
    name = "breaker"
    preferred_regime = None

    def __init__(self, swing_lookback: int = 5, atr_period: int = 14,
                 zone_age_limit: int = 30, sl_mult: float = 2.0, tp_mult: float = 3.0,
                 symbol: str = "MES", timeframe: str = "15min"):
        self.swing_lookback = swing_lookback
        self.atr_period = atr_period
        self.zone_age_limit = zone_age_limit
        self.sl_mult = sl_mult
        self.tp_mult = tp_mult
        self.symbol = symbol
        self.timeframe = timeframe

    def compute(self, df: pl.DataFrame) -> pl.DataFrame:
        result = df.clone()
        swings = detect_swings(df, self.swing_lookback)
        bos = detect_bos(df, swings)
        atr = compute_atr(df, self.atr_period)

        bull_obs = detect_bullish_ob(df, swings)
        bear_obs = detect_bearish_ob(df, swings)

        all_obs_list = []
        if len(bull_obs) > 0:
            all_obs_list.append(bull_obs)
        if len(bear_obs) > 0:
            all_obs_list.append(bear_obs)

        n = len(df)
        entry_long_raw = np.zeros(n, dtype=np.bool_)
        entry_short_raw = np.zeros(n, dtype=np.bool_)

        if all_obs_list:
            all_obs = pl.concat(all_obs_list)
            breakers = detect_breaker(df, all_obs)

            # Filter breakers: BOS must exist near the break point
            # A valid breaker has BOS confirming the break of the OB
            if len(breakers) > 0:
                bos_list = bos.to_list()
                valid_indices = []
                for b_idx in range(len(breakers)):
                    broken_at = int(breakers["broken_at"][b_idx])
                    breaker_type = str(breakers["type"][b_idx])
                    # Check if BOS occurred at or near the break point (±3 bars)
                    bos_found = False
                    for check_bar in range(max(0, broken_at - 3), min(n, broken_at + 4)):
                        if bos_list[check_bar] is not None:
                            # Bullish breaker = bearish OB broken = bearish BOS at break
                            if breaker_type == "bullish_breaker" and bos_list[check_bar] == "bullish":
                                bos_found = True
                                break
                            elif breaker_type == "bearish_breaker" and bos_list[check_bar] == "bearish":
                                bos_found = True
                                break
                    if bos_found:
                        valid_indices.append(b_idx)

                if valid_indices:
                    validated_breakers = breakers[valid_indices]
                    entry_long_raw, entry_short_raw = compute_breaker_signals(df, validated_breakers, self.zone_age_limit)
                # If no valid breakers after BOS filter, entry arrays stay zeros

        # Apply exit logic: ATR stop/target + opposite signal
        atr_vals = atr.to_numpy().astype(np.float64)
        # Fill NaN ATR values with 0 so Numba doesn't choke
        atr_vals = np.nan_to_num(atr_vals, nan=0.0)

        entry_long, exit_long, entry_short, exit_short = _apply_exits(
            entry_long_raw, entry_short_raw,
            df["close"].to_numpy(), df["high"].to_numpy(), df["low"].to_numpy(),
            atr_vals, self.sl_mult, self.tp_mult, n,
        )

        result = result.with_columns([
            pl.Series("entry_long", entry_long),
            pl.Series("entry_short", entry_short),
            pl.Series("exit_long", exit_long),
            pl.Series("exit_short", exit_short),
            atr.alias(f"atr_{self.atr_period}"),
        ])
        return result

    def get_params(self) -> dict:
        return {
            "swing_lookback": self.swing_lookback, "atr_period": self.atr_period,
            "zone_age_limit": self.zone_age_limit, "sl_mult": self.sl_mult, "tp_mult": self.tp_mult,
        }

    def get_default_config(self) -> dict:
        return {"swing_lookback": 5, "atr_period": 14, "zone_age_limit": 30, "sl_mult": 2.0, "tp_mult": 3.0}
