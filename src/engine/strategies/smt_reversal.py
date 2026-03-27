"""ICT SMT Reversal strategy — cross-instrument divergence + MSS confirmation.

One-sentence: Enter when correlated instruments diverge (one makes new high/low,
the other doesn't), confirmed by Market Structure Shift on the primary instrument.

CRITICAL FIX: The original implementation used RSI divergence as a "proxy" for SMT.
RSI divergence is NOT SMT. SMT (Smart Money Technique) REQUIRES two correlated
instruments — it's a cross-instrument concept by definition.

This rewrite:
- Uses compute_multi() to receive both instruments
- Uses smt_divergence() from smt.py (which was already built but never used!)
- Confirms divergence with MSS
- Removes RSI entirely
"""

from __future__ import annotations

import polars as pl

from src.engine.strategy_base import BaseStrategy
from src.engine.indicators.core import compute_atr
from src.engine.indicators.market_structure import detect_swings, detect_mss
from src.engine.indicators.smt import smt_divergence


class SMTReversalStrategy(BaseStrategy):
    """SMT Reversal — cross-instrument divergence + MSS confirmation.

    Params (3):
        lookback: window for SMT divergence detection
        swing_lookback: swing detection sensitivity
        confirmation_bars: max bars to wait for MSS after divergence
    """

    name = "smt_reversal"
    preferred_regime = None  # divergence IS the regime signal

    def __init__(
        self,
        lookback: int = 20,
        swing_lookback: int = 5,
        confirmation_bars: int = 5,
    ):
        self.lookback = lookback
        self.swing_lookback = swing_lookback
        self.confirmation_bars = confirmation_bars
        self.symbol = "MES"
        self.timeframe = "15min"

    @property
    def is_multi_instrument(self) -> bool:
        return True

    def compute(self, df: pl.DataFrame) -> pl.DataFrame:
        """Single-instrument fallback — returns no signals with a warning.

        SMT REQUIRES two instruments. Use compute_multi() instead.
        """
        n = len(df)
        return df.with_columns([
            pl.lit(False).alias("entry_long"),
            pl.lit(False).alias("entry_short"),
            pl.lit(False).alias("exit_long"),
            pl.lit(False).alias("exit_short"),
        ])

    def compute_multi(self, dfs: dict[str, pl.DataFrame]) -> pl.DataFrame:
        """Multi-instrument SMT divergence computation.

        Args:
            dfs: Dict with exactly 2 instruments, e.g. {"ES": df_es, "NQ": df_nq}.
                 First key is treated as primary instrument (signals generated for it).
        """
        instruments = list(dfs.keys())
        if len(instruments) < 2:
            raise ValueError(
                f"SMT Reversal requires 2 instruments, got {len(instruments)}: {instruments}"
            )

        primary_key = instruments[0]
        secondary_key = instruments[1]
        df_primary = dfs[primary_key]
        df_secondary = dfs[secondary_key]

        n = len(df_primary)
        if n < self.lookback + self.swing_lookback + 10:
            return df_primary.with_columns([
                pl.lit(False).alias("entry_long"),
                pl.lit(False).alias("entry_short"),
                pl.lit(False).alias("exit_long"),
                pl.lit(False).alias("exit_short"),
            ])

        # Ensure same length (trim to shorter)
        min_len = min(len(df_primary), len(df_secondary))
        df_primary = df_primary.head(min_len)
        df_secondary = df_secondary.head(min_len)
        n = min_len

        # Detect cross-instrument divergence
        divergences = smt_divergence(df_primary, df_secondary, self.lookback)

        # Detect MSS on primary instrument
        swings = detect_swings(df_primary, self.swing_lookback)
        mss = detect_mss(df_primary, swings)
        atr = compute_atr(df_primary, 14)

        mss_vals = mss.to_list()

        # Build divergence lookup: bar -> type
        div_bars: dict[int, str] = {}
        if len(divergences) > 0:
            for row_idx in range(len(divergences)):
                bar = int(divergences["index"][row_idx])
                div_type = str(divergences["type"][row_idx])
                div_bars[bar] = div_type

        # Build signal arrays
        entry_long = [False] * n
        entry_short = [False] * n
        exit_long = [False] * n
        exit_short = [False] * n

        in_long = False
        in_short = False

        for i in range(n):
            exited_this_bar_long = False
            exited_this_bar_short = False

            # ─── Exit checks first ─────────────────────────────
            if in_long:
                # Exit on bearish divergence or bearish MSS
                if i in div_bars and div_bars[i] == "bearish":
                    exit_long[i] = True
                    in_long = False
                    exited_this_bar_long = True
                elif mss_vals[i] == "bearish":
                    exit_long[i] = True
                    in_long = False
                    exited_this_bar_long = True

            if in_short:
                if i in div_bars and div_bars[i] == "bullish":
                    exit_short[i] = True
                    in_short = False
                    exited_this_bar_short = True
                elif mss_vals[i] == "bullish":
                    exit_short[i] = True
                    in_short = False
                    exited_this_bar_short = True

            # ─── Entry: divergence + MSS confirmation ──────────
            # Long: bullish divergence (primary makes new low, secondary doesn't)
            #        + bullish MSS confirms reversal up
            if not exited_this_bar_long and not in_long:
                if mss_vals[i] == "bullish":
                    # Check for recent bullish divergence
                    for j in range(max(0, i - self.confirmation_bars), i + 1):
                        if j in div_bars and div_bars[j] == "bullish":
                            entry_long[i] = True
                            in_long = True
                            break

            # Short: bearish divergence + bearish MSS
            if not exited_this_bar_short and not in_short:
                if mss_vals[i] == "bearish":
                    for j in range(max(0, i - self.confirmation_bars), i + 1):
                        if j in div_bars and div_bars[j] == "bearish":
                            entry_short[i] = True
                            in_short = True
                            break

        result = df_primary.with_columns([
            pl.Series("entry_long", entry_long),
            pl.Series("entry_short", entry_short),
            pl.Series("exit_long", exit_long),
            pl.Series("exit_short", exit_short),
            atr.alias("atr_14"),
            mss.alias("mss"),
        ])
        return result

    def get_params(self) -> dict:
        return {
            "lookback": self.lookback,
            "swing_lookback": self.swing_lookback,
            "confirmation_bars": self.confirmation_bars,
        }

    def get_default_config(self) -> dict:
        return {
            "lookback": 20,
            "swing_lookback": 5,
            "confirmation_bars": 5,
        }
