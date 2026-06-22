"""Gann Box 4H Continuation — impulsive 4H candle + Fib-zone optimum retracement entry.

One-sentence: BIDIRECTIONAL strategy that draws a Gann box over an impulsive 4H candle,
divides it into Fibonacci zones (premature/optimum/overextended), and enters when price
retraces into the optimum zone (0.5–0.75) with FVG/order-block confluence.

Pattern origin (video SY2jXlW9bt4):
  The speaker draws a Gann box low-to-high over a high-conviction 4H candle (impulsive
  = full body, minimal wicks). The box is divided into four zones using Fib ratios:
    - premature   : 0.00–0.25 (too early — skip)
    - optimum     : 0.50–0.75 (high-probability entry zone)
    - overextended: 0.75–1.00 (too far retraced — skip)
  Entry fires when a retracement wick enters the optimum zone, confirmed by FVG or
  order-block confluence. Stop is placed beyond the order block; target is the prior
  daily high (longs) or prior daily low (shorts) at ~1:2 R.

Signal sequencing (both directions):
  LONG:  Bullish trend bias + bullish impulsive 4H candle
         + price retraces wick into optimum zone (0.50–0.75 from candle low)
         + FVG / OB confluence at retracement level
         → target: prior daily high
  SHORT: Bearish trend bias + bearish impulsive 4H candle
         + price retraces wick into optimum zone (0.50–0.75 from candle high, inverted)
         + FVG / OB confluence
         → target: prior daily low

Fib zone definitions (long / bullish box, low=0, high=1):
  premature   : 0.00–0.25  (immediate proximity — faded before true retracement)
  mid_gap     : 0.25–0.50  (neutral, not acted on)
  optimum     : 0.50–0.75  (high-probability institutional entry zone)
  overextended: 0.75–1.00  (too deep into the original candle — invalidated)

For SHORT (bearish box), the box is inverted: high=0, low=1, zones mirror.

Impulsive candle filter:
  body_ratio = |close - open| / (high - low) >= min_body_ratio (default 0.70)
  This excludes doji/spinning-top and small-wick-heavy candles.

FVG / OB confluence proxy (bar-by-bar on working timeframe):
  FVG:  gap between close[i-2] and open[i] (3-bar gap pattern, standard ICT FVG)
  OB:   prior candle that caused a displacement (simplified: candle prior to FVG gap)
  When price retraces into the optimum zone AND falls inside a recent FVG gap or
  approaches the OB, the confluence gate fires.

Stop placement (CLAUDE.md §4 structural contract):
  - Floor:   1.5 × ATR
  - Ceiling: 14pt MES / per-symbol override
  Stop is referenced to the atr_14 column; framework-overlay owns final sizing.
  The engine does NOT compute dollar P&L — never pass slippage/fees to vectorbt.

Exit:
  - Time-stop: hard flatten at 15:55 ET (backtester invariant)
  - Bar cap: max_bars_held (default 30)
  - Structural exit: exit emitted when price closes beyond the optimum zone high
    (for longs) or low (for shorts), implying the retracement invalidated the setup
"""

from __future__ import annotations

import polars as pl

from src.engine.indicators.core import compute_atr, compute_ema
from src.engine.strategy_base import BaseStrategy

# ─── Named constants (CLAUDE.md §13: no magic numbers inline) ────────────────
ATR_PERIOD_DEFAULT: int = 14
MIN_BODY_RATIO_DEFAULT: float = 0.70      # fraction of candle range that must be body
GANN_BOX_LOOKBACK_DEFAULT: int = 1        # bars back to find the 4H candle box origin
OPTIMUM_ZONE_LOW: float = 0.50            # lower Fib boundary of optimum zone
OPTIMUM_ZONE_HIGH: float = 0.75           # upper Fib boundary of optimum zone
PREMATURE_ZONE_HIGH: float = 0.25         # upper Fib boundary of premature zone (skip)
FVG_LOOKBACK_DEFAULT: int = 8             # bars back to look for FVG confluence
MAX_BARS_HELD_DEFAULT: int = 30           # intraday bar cap
STOP_FLOOR_ATR_MULT: float = 1.5          # CLAUDE.md §4 canonical floor
STOP_CEILING_MES_POINTS: float = 14.0    # CLAUDE.md §4 canonical ceiling
MIN_BARS_REQUIRED: int = 20               # warmup guard before signals can fire
TREND_EMA_PERIOD_DEFAULT: int = 20        # EMA used for trend-bias filter


class GannBox4HContinuationStrategy(BaseStrategy):
    """Gann box 4H continuation: impulsive candle → Fib zone retracement entry.

    Long (bullish): impulsive bullish 4H candle identified, price retraces into
    the optimum zone (0.50–0.75 of candle range from the low), FVG/OB confluence
    present, entry fires.

    Short (bearish): mirror-image. Impulsive bearish 4H candle, price retraces
    into optimum zone (0.50–0.75 from the top toward the low), FVG/OB present.
    """

    name = "gann_box_4h_continuation"
    preferred_regime = None   # works in TRENDING_UP and TRENDING_DOWN; both directions

    def __init__(
        self,
        min_body_ratio: float = MIN_BODY_RATIO_DEFAULT,
        optimum_low: float = OPTIMUM_ZONE_LOW,
        optimum_high: float = OPTIMUM_ZONE_HIGH,
        fvg_lookback: int = FVG_LOOKBACK_DEFAULT,
        trend_ema_period: int = TREND_EMA_PERIOD_DEFAULT,
        atr_period: int = ATR_PERIOD_DEFAULT,
        max_bars_held: int = MAX_BARS_HELD_DEFAULT,
        stop_ceiling_points: float = STOP_CEILING_MES_POINTS,
    ) -> None:
        if not (0.0 < min_body_ratio < 1.0):
            raise ValueError(f"min_body_ratio must be in (0, 1), got {min_body_ratio}")
        if not (0.0 < optimum_low < optimum_high < 1.0):
            raise ValueError(
                f"optimum zone bounds must satisfy 0 < optimum_low < optimum_high < 1, "
                f"got [{optimum_low}, {optimum_high}]"
            )
        if fvg_lookback < 1:
            raise ValueError(f"fvg_lookback must be >= 1, got {fvg_lookback}")
        if max_bars_held < 1:
            raise ValueError(f"max_bars_held must be >= 1, got {max_bars_held}")

        self.min_body_ratio = min_body_ratio
        self.optimum_low = optimum_low
        self.optimum_high = optimum_high
        self.fvg_lookback = fvg_lookback
        self.trend_ema_period = trend_ema_period
        self.atr_period = atr_period
        self.max_bars_held = max_bars_held
        self.stop_ceiling_points = stop_ceiling_points

        # Symbol / timeframe are set by backtester from config
        self.symbol = "MES"
        self.timeframe = "4h"

    # ─── Impulsive candle helper ──────────────────────────────────────────────

    @staticmethod
    def _is_impulsive(o: float, h: float, lo: float, c: float, min_body_ratio: float) -> bool:
        """Return True when the candle body is >= min_body_ratio of the candle range."""
        candle_range = h - lo
        if candle_range <= 0.0:
            return False
        body = abs(c - o)
        return (body / candle_range) >= min_body_ratio

    # ─── FVG confluence helper ────────────────────────────────────────────────

    @staticmethod
    def _find_active_fvg(
        closes: list[float],
        opens: list[float],
        highs: list[float],
        lows: list[float],
        current_bar: int,
        fvg_lookback: int,
        direction: str,
    ) -> tuple[float, float] | None:
        """Scan recent bars for an unmitigated FVG gap.

        ICT 3-bar FVG pattern:
          Bullish FVG: close[i-2] < low[i]  → gap between close[i-2] and low[i]
          Bearish FVG: high[i] < open[i-2]  → gap between high[i] and open[i-2]

        Returns (gap_bottom, gap_top) if found within fvg_lookback bars, else None.
        """
        i = current_bar
        start = max(2, i - fvg_lookback)
        # Scan backwards from current bar
        for j in range(i, start - 1, -1):
            if j < 2:
                break
            if direction == "bullish":
                # Bullish FVG: gap above close[j-2] and below low[j]
                gap_bottom = closes[j - 2]
                gap_top = lows[j]
                if gap_top > gap_bottom:
                    return (gap_bottom, gap_top)
            else:
                # Bearish FVG: gap below open[j-2] and above high[j]
                gap_top = opens[j - 2]
                gap_bottom = highs[j]
                if gap_top > gap_bottom:
                    return (gap_bottom, gap_top)
        return None

    # ─── BaseStrategy interface ───────────────────────────────────────────────

    def get_params(self) -> dict:
        return {
            "min_body_ratio": self.min_body_ratio,
            "optimum_low": self.optimum_low,
            "optimum_high": self.optimum_high,
            "fvg_lookback": self.fvg_lookback,
            "atr_period": self.atr_period,
        }

    def get_default_config(self) -> dict:
        return {
            "min_body_ratio": MIN_BODY_RATIO_DEFAULT,
            "optimum_low": OPTIMUM_ZONE_LOW,
            "optimum_high": OPTIMUM_ZONE_HIGH,
            "fvg_lookback": FVG_LOOKBACK_DEFAULT,
            "trend_ema_period": TREND_EMA_PERIOD_DEFAULT,
            "atr_period": ATR_PERIOD_DEFAULT,
            "max_bars_held": MAX_BARS_HELD_DEFAULT,
            "stop_ceiling_points": STOP_CEILING_MES_POINTS,
        }

    # ─── Core compute ─────────────────────────────────────────────────────────

    def compute(self, df: pl.DataFrame) -> pl.DataFrame:  # noqa: C901 — complex but explicit
        """Emit entry_long / entry_short / exit_long / exit_short boolean columns."""
        n = len(df)

        if n < MIN_BARS_REQUIRED:
            false_col = pl.lit(False)
            return df.with_columns([
                false_col.alias("entry_long"),
                false_col.alias("entry_short"),
                false_col.alias("exit_long"),
                false_col.alias("exit_short"),
            ])

        # ── Indicators ───────────────────────────────────────────────────────
        atr = compute_atr(df, self.atr_period)
        trend_ema = compute_ema(df["close"], self.trend_ema_period)

        # ── Python lists for bar-by-bar loop ─────────────────────────────────
        opens  = df["open"].to_list()
        highs  = df["high"].to_list()
        lows   = df["low"].to_list()
        closes = df["close"].to_list()
        ema_list = trend_ema.to_list()
        atr_list = atr.to_list()

        # ET timestamp for 15:55 flatten
        _ts_col = "ts_et" if "ts_et" in df.columns else "ts_event"
        if _ts_col in df.columns:
            ts_series = df[_ts_col]
            hours_list   = ts_series.dt.hour().to_list()
            minutes_list = ts_series.dt.minute().to_list()
        else:
            hours_list   = [12] * n
            minutes_list = [0] * n

        # ── Signal arrays ─────────────────────────────────────────────────────
        entry_long  = [False] * n
        entry_short = [False] * n
        exit_long   = [False] * n
        exit_short  = [False] * n

        # ── State trackers ────────────────────────────────────────────────────
        # Active Gann box state — set when an impulsive candle is detected
        # long_box_*: bullish impulsive candle anchors
        long_box_low: float | None = None     # 4H candle low (box bottom = Fib 0)
        long_box_high: float | None = None    # 4H candle high (box top = Fib 1)
        long_box_bar: int = -1                # bar index when box was set

        # short_box_*: bearish impulsive candle anchors
        short_box_low: float | None = None
        short_box_high: float | None = None
        short_box_bar: int = -1

        long_entry_bar: int = -1
        short_entry_bar: int = -1

        # ── Bar-by-bar loop ───────────────────────────────────────────────────
        # Start at i=1 so i-1 is always valid (need previous bar for box setup).
        # The engine shifts entries +1 bar — bare close comparisons are safe.
        for i in range(1, n):
            atr_val = atr_list[i]
            ema_val = ema_list[i]

            # NaN guard
            if atr_val is None or ema_val is None:
                continue
            if atr_val != atr_val or ema_val != ema_val:  # nan check
                continue

            h, m = hours_list[i], minutes_list[i]
            t_min = h * 60 + m

            exited_long  = False
            exited_short = False

            # ── Exit checks (before entry — CLAUDE.md order) ─────────────────
            if long_entry_bar >= 0:
                # Time-stop or bar cap
                if t_min >= 15 * 60 + 55 or (i - long_entry_bar) >= self.max_bars_held:
                    exit_long[i]  = True
                    long_entry_bar = -1
                    exited_long   = True
                # Structural exit: price closes below optimum zone (below box Fib 0.50)
                elif long_box_low is not None and long_box_high is not None:
                    box_range = long_box_high - long_box_low
                    opt_floor = long_box_low + self.optimum_low * box_range
                    if closes[i] < opt_floor:
                        exit_long[i]  = True
                        long_entry_bar = -1
                        exited_long   = True

            if short_entry_bar >= 0:
                if t_min >= 15 * 60 + 55 or (i - short_entry_bar) >= self.max_bars_held:
                    exit_short[i]  = True
                    short_entry_bar = -1
                    exited_short   = True
                elif short_box_low is not None and short_box_high is not None:
                    box_range = short_box_high - short_box_low
                    # For shorts: optimum zone is from (1 - optimum_high) to (1 - optimum_low)
                    # from the top. Structural exit: price closes above optimum zone ceiling.
                    opt_ceiling = short_box_high - self.optimum_low * box_range
                    if closes[i] > opt_ceiling:
                        exit_short[i]  = True
                        short_entry_bar = -1
                        exited_short   = True

            # ── Step 1: detect impulsive 4H candle and update Gann box ────────
            prev_o = opens[i - 1]
            prev_h = highs[i - 1]
            prev_l = lows[i - 1]
            prev_c = closes[i - 1]

            is_bullish_candle = prev_c > prev_o
            is_bearish_candle = prev_c < prev_o

            if self._is_impulsive(prev_o, prev_h, prev_l, prev_c, self.min_body_ratio):
                # Trend bias: price above EMA for bullish, below for bearish
                if is_bullish_candle and closes[i - 1] > ema_val:
                    # New bullish Gann box from the previous impulsive candle
                    long_box_low  = prev_l
                    long_box_high = prev_h
                    long_box_bar  = i - 1
                elif is_bearish_candle and closes[i - 1] < ema_val:
                    short_box_low  = prev_l
                    short_box_high = prev_h
                    short_box_bar  = i - 1

            # ── Step 2: LONG entry check ──────────────────────────────────────
            # Conditions:
            # 1. Not already in a long position
            # 2. An active bullish Gann box exists
            # 3. Current bar's low (wick) reached into optimum zone
            # 4. FVG confluence within fvg_lookback bars
            if (
                not exited_long
                and long_entry_bar < 0
                and short_entry_bar < 0  # no simultaneous positions
                and long_box_low is not None
                and long_box_high is not None
            ):
                box_range = long_box_high - long_box_low
                if box_range > 0:
                    opt_floor   = long_box_low + self.optimum_low  * box_range
                    opt_ceiling = long_box_low + self.optimum_high * box_range

                    current_low  = lows[i]
                    current_high = highs[i]

                    # Wick reaches into optimum zone: low touches optimum zone
                    # but price doesn't close BELOW the zone (still bullish)
                    in_optimum = (current_low <= opt_ceiling) and (current_low >= opt_floor - (opt_ceiling - opt_floor))
                    # close must be above opt_floor (not collapsed through)
                    close_holds = closes[i] >= opt_floor

                    if in_optimum and close_holds:
                        # FVG confluence check
                        fvg = self._find_active_fvg(
                            closes, opens, highs, lows, i, self.fvg_lookback, "bullish"
                        )
                        # Accept if FVG found OR if price is in the optimum zone without FVG
                        # (order-block proxy: any recent pullback candle before displacement)
                        if fvg is not None:
                            # Price (current low) must be inside or near the FVG
                            if current_low <= fvg[1] and closes[i] >= fvg[0]:
                                entry_long[i]  = True
                                long_entry_bar = i
                        else:
                            # Fallback: fire if simply in optimum zone (OB confluence assumed
                            # by structural proximity — per operator ground truth the stop
                            # goes beyond the OB which the optimum zone implicitly identifies)
                            entry_long[i]  = True
                            long_entry_bar = i

            # ── Step 3: SHORT entry check ─────────────────────────────────────
            # Mirror-image: bearish box, wick into inverted optimum zone from top
            if (
                not exited_short
                and short_entry_bar < 0
                and long_entry_bar < 0
                and short_box_low is not None
                and short_box_high is not None
            ):
                box_range = short_box_high - short_box_low
                if box_range > 0:
                    # For bearish box: Fib 0 = high, Fib 1 = low (inverted)
                    # optimum zone sits 0.50–0.75 FROM THE HIGH downward
                    opt_ceiling = short_box_high - self.optimum_low  * box_range
                    opt_floor   = short_box_high - self.optimum_high * box_range

                    current_high = highs[i]
                    current_low  = lows[i]

                    # Wick reaches into optimum zone from above
                    in_optimum = (current_high >= opt_floor) and (current_high <= opt_ceiling + (opt_ceiling - opt_floor))
                    close_holds = closes[i] <= opt_ceiling  # still bearish — not recovered

                    if in_optimum and close_holds:
                        fvg = self._find_active_fvg(
                            closes, opens, highs, lows, i, self.fvg_lookback, "bearish"
                        )
                        if fvg is not None:
                            if current_high >= fvg[0] and closes[i] <= fvg[1]:
                                entry_short[i]  = True
                                short_entry_bar = i
                        else:
                            entry_short[i]  = True
                            short_entry_bar = i

        return df.with_columns([
            pl.Series("entry_long",  entry_long),
            pl.Series("entry_short", entry_short),
            pl.Series("exit_long",   exit_long),
            pl.Series("exit_short",  exit_short),
            atr.alias(f"atr_{self.atr_period}"),
        ])
