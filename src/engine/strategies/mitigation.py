"""ICT Mitigation Block strategy — failed OB that gets mitigated becomes re-entry zone.

One-sentence: Enter when price retests a mitigated order block zone (an OB that was broken through),
treating the broken level as a new area of institutional interest.
"""

from __future__ import annotations

import polars as pl

from src.engine.strategy_base import BaseStrategy
from src.engine.indicators.market_structure import detect_swings
from src.engine.indicators.order_flow import detect_bullish_ob, detect_bearish_ob, detect_mitigation
from src.engine.indicators.core import compute_atr


class MitigationStrategy(BaseStrategy):
    """Mitigation Block — broken OB becomes re-entry zone.

    A bearish OB that gets mitigated (price breaks through it to the upside)
    becomes a bullish re-entry zone. A bullish OB that gets mitigated (price
    breaks through it to the downside) becomes a bearish re-entry zone.
    Entry triggers when price retests the mitigated zone.

    Params (3):
        lookback: swing detection sensitivity
        mitigation_threshold: minimum % of OB that must be penetrated to count
        retest_tolerance: how close price must come to mitigation level (ATR multiple)
    """

    name = "mitigation"
    preferred_regime = "RANGE_BOUND"

    def __init__(
        self,
        lookback: int = 5,
        mitigation_threshold: float = 50.0,
        retest_tolerance: float = 0.5,
    ):
        self.lookback = lookback
        self.mitigation_threshold = mitigation_threshold
        self.retest_tolerance = retest_tolerance
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
        atr = compute_atr(df, 14)
        atr_vals = atr.to_list()

        bull_obs = detect_bullish_ob(df, swings)
        bear_obs = detect_bearish_ob(df, swings)

        # Combine OBs for mitigation detection
        all_obs_list = []
        if len(bull_obs) > 0:
            all_obs_list.append(bull_obs)
        if len(bear_obs) > 0:
            all_obs_list.append(bear_obs)

        if all_obs_list:
            all_obs = pl.concat(all_obs_list)
            mitigations = detect_mitigation(df, all_obs)
        else:
            mitigations = pl.DataFrame(schema={
                "index": pl.Int64, "top": pl.Float64, "bottom": pl.Float64,
                "type": pl.Utf8, "mitigated_at": pl.Int64, "penetration_pct": pl.Float64,
            })

        # Filter by mitigation threshold
        if len(mitigations) > 0:
            mitigations = mitigations.filter(
                pl.col("penetration_pct") >= self.mitigation_threshold
            )

        closes = df["close"].to_list()
        highs = df["high"].to_list()
        lows = df["low"].to_list()

        entry_long = [False] * n
        entry_short = [False] * n
        exit_long = [False] * n
        exit_short = [False] * n

        # Pre-extract mitigation zones for fast iteration.
        mit_zones = _extract_mitigations(mitigations)

        for i in range(n):
            curr_atr = atr_vals[i]
            if curr_atr is None or curr_atr != curr_atr:  # NaN check
                continue

            tolerance = self.retest_tolerance * curr_atr

            for m_idx, m_top, m_bottom, m_type, m_at in mit_zones:
                # Zone only active after mitigation occurs
                if i <= m_at:
                    continue

                zone_size = m_top - m_bottom
                if zone_size <= 0:
                    continue

                # Entry long: bearish OB was mitigated (broken to upside).
                # Price retests the mitigated zone from above.
                if m_type == "bearish_mitigation":
                    # Price comes down near the top of the mitigated zone
                    if lows[i] <= m_top + tolerance and closes[i] >= m_bottom:
                        entry_long[i] = True

                # Entry short: bullish OB was mitigated (broken to downside).
                # Price retests the mitigated zone from below.
                elif m_type == "bullish_mitigation":
                    # Price rallies up near the bottom of the mitigated zone
                    if highs[i] >= m_bottom - tolerance and closes[i] <= m_top:
                        entry_short[i] = True

            # Exit long: price moves 2x zone size below entry zone OR opposing mitigation signal
            if entry_short[i]:
                exit_long[i] = True
            for m_idx, m_top, m_bottom, m_type, m_at in mit_zones:
                if i <= m_at:
                    continue
                zone_size = m_top - m_bottom
                if m_type == "bearish_mitigation" and zone_size > 0:
                    if closes[i] < m_bottom - 2.0 * zone_size:
                        exit_long[i] = True
                        break

            # Exit short: price moves 2x zone size above entry zone OR opposing mitigation signal
            if entry_long[i]:
                exit_short[i] = True
            for m_idx, m_top, m_bottom, m_type, m_at in mit_zones:
                if i <= m_at:
                    continue
                zone_size = m_top - m_bottom
                if m_type == "bullish_mitigation" and zone_size > 0:
                    if closes[i] > m_top + 2.0 * zone_size:
                        exit_short[i] = True
                        break

        result = df.with_columns([
            pl.Series("entry_long", entry_long),
            pl.Series("entry_short", entry_short),
            pl.Series("exit_long", exit_long),
            pl.Series("exit_short", exit_short),
            atr.alias("atr_14"),
        ])
        return result

    def get_params(self) -> dict:
        return {
            "lookback": self.lookback,
            "mitigation_threshold": self.mitigation_threshold,
            "retest_tolerance": self.retest_tolerance,
        }

    def get_default_config(self) -> dict:
        return {
            "lookback": 5,
            "mitigation_threshold": 50.0,
            "retest_tolerance": 0.5,
        }


# ─── Helpers ──────────────────────────────────────────────────────


def _extract_mitigations(
    mitigations: pl.DataFrame,
) -> list[tuple[int, float, float, str, int]]:
    """Extract mitigation zones as (index, top, bottom, type, mitigated_at)."""
    if len(mitigations) == 0:
        return []
    return [
        (
            int(mitigations["index"][i]),
            float(mitigations["top"][i]),
            float(mitigations["bottom"][i]),
            str(mitigations["type"][i]),
            int(mitigations["mitigated_at"][i]),
        )
        for i in range(len(mitigations))
    ]
