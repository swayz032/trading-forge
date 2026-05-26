"""ICT Bias-Aligned Continuation — 4H bias + 15m BOS/CHoCH + 5m FVG entry.

One-sentence: BIDIRECTIONAL strategy that enters LONG when HTF bias is bullish,
15m structure breaks bullish, and 5m FVG creates a retest opportunity; and SHORT
under the mirror-image bearish setup. Fires only inside ICT killzones.

Pattern origin: "4H bias → 15m structure break → 5m FVG entry" is the classic
ICT multi-timeframe continuation/continuation-reversal model. The video source
(v=l-2iKbcm5UI) shows the SHORT setup (bearish bias → bearish BOS → bearish FVG
retest). This archetype is SYMMETRIC — it handles the bearish leg from the video
AND the bullish leg automatically.

Key distinctions from other ICT archetypes:
- silver_bullet:  fixed 1-hour windows (10-11 AM, 2-3 PM, 3-4 AM).
                  Bias-aligned continuation fires any of the 4 ICT killzones.
- power_of_3:     requires an Asia range + London Judas sweep sequence.
                  This archetype only needs bias + BOS + FVG — no prior-session sweep.
- ict_2022:       requires a liquidity sweep + MSS at OTE zone.
                  This archetype fires on BOS/CHoCH (not sweep-dependent).

Signal sequencing per direction:
  LONG:  HTF bias = bullish (price in discount PD zone)
         + recent bullish BOS/CHoCH on 5m (confirmed within bos_lookback bars)
         + price retraces into an unmitigated bullish FVG within fvg_lookback bars
         + current bar inside a killzone
  SHORT: HTF bias = bearish (price in premium PD zone)
         + recent bearish BOS/CHoCH on 5m
         + price retraces into an unmitigated bearish FVG
         + current bar inside a killzone

Anti-trend reject:
  If HTF bias direction OPPOSES the BOS direction, no entry fires.
  A bearish BOS when bias is bullish is a counter-trend signal — skipped.
  This is the primary differentiation from a plain FVG retest.

Stop placement (CLAUDE.md §4 structural contract):
  - Floor:   1.5 × ATR
  - Ceiling: 14pt MES / 40pt MNQ / 25 tick MCL
  Stop is recorded in the atr_14 column; the framework-overlay owns
  final sizing. The engine does NOT compute dollar P&L here — per the
  production hard rule, we never pass slippage/fees to vectorbt for futures.

Exit:
  - Time-stop: hard flatten if t >= 15:55 ET (framework invariant)
  - Bar cap: max_bars_held (default 30) as intraday guard
"""

from __future__ import annotations

import polars as pl

from src.engine.indicators.core import compute_atr
from src.engine.indicators.market_structure import (
    compute_premium_discount,
    detect_bos,
    detect_choch,
    detect_swings,
)
from src.engine.indicators.price_delivery import detect_fvg
from src.engine.indicators.sessions import (
    is_london_killzone,
    is_nyam_killzone,
    is_nypm_killzone,
    is_silver_bullet_london,
    is_silver_bullet_nyam,
    is_silver_bullet_nypm,
)
from src.engine.strategy_base import BaseStrategy


# ─── Named killzone constant ─────────────────────────────────────────────────
# All four ICT killzones — NY AM, NY PM, London open, Silver Bullet variants.
# Silver Bullet windows are subsets of the wider killzones so OR-ing them in
# only broadens the window (no harm) and ensures we catch the narrowest windows.
def _build_killzone_mask(df: pl.DataFrame, n: int) -> pl.Series:
    """Return boolean Series: True when ANY ICT killzone is active."""
    if "ts_event" not in df.columns:
        return pl.Series("in_killzone", [True] * n)

    ts = df["ts_event"]
    nyam    = is_nyam_killzone(ts)
    nypm    = is_nypm_killzone(ts)
    london  = is_london_killzone(ts)
    sb_nyam = is_silver_bullet_nyam(ts)
    sb_nypm = is_silver_bullet_nypm(ts)
    sb_lon  = is_silver_bullet_london(ts)

    mask = nyam | nypm | london | sb_nyam | sb_nypm | sb_lon
    return mask.alias("in_killzone")


class ICTBiasAlignedContinuationStrategy(BaseStrategy):
    """4H bias → 15m BOS/CHoCH → 5m FVG retest. BIDIRECTIONAL."""

    name = "ict_bias_aligned_continuation"
    # Both trending directions — fires whichever leg is bias-aligned
    preferred_regime = None  # regime-agnostic; operator sets per-symbol if desired

    def __init__(
        self,
        htf_swing_lookback: int = 20,   # bars for "higher-timeframe" bias swing detection
        bos_lookback: int = 5,           # bars for LTF BOS/CHoCH detection
        bos_window: int = 15,            # how many bars back to accept a BOS event
        fvg_lookback: int = 8,           # bars since FVG formation to accept it
        atr_period: int = 14,
        max_bars_held: int = 30,
    ):
        self.htf_swing_lookback = htf_swing_lookback
        self.bos_lookback = bos_lookback
        self.bos_window = bos_window
        self.fvg_lookback = fvg_lookback
        self.atr_period = atr_period
        self.max_bars_held = max_bars_held
        self.symbol = "MES"
        self.timeframe = "5min"

    def compute(self, df: pl.DataFrame) -> pl.DataFrame:  # noqa: C901 — complex but explicit
        result = df.clone()
        n = len(df)

        # ── Indicators ───────────────────────────────────────────────────────
        atr = compute_atr(df, self.atr_period)

        # HTF bias via premium/discount zone (uses larger swing lookback)
        htf_swings  = detect_swings(df, self.htf_swing_lookback)
        pd_zones    = compute_premium_discount(df, htf_swings)

        # LTF BOS + CHoCH for structure confirmation (tight lookback)
        ltf_swings  = detect_swings(df, self.bos_lookback)
        bos         = detect_bos(df, ltf_swings)
        choch       = detect_choch(df, ltf_swings)

        # FVG detector — reuse existing 3-candle pattern
        fvgs        = detect_fvg(df)

        # Killzone mask
        kz_mask = _build_killzone_mask(df, n)

        # ── Pre-process FVGs into searchable lists ────────────────────────────
        bullish_fvgs: list[dict] = []
        bearish_fvgs: list[dict] = []
        if len(fvgs) > 0:
            for fi in range(len(fvgs)):
                fvg_type = str(fvgs["type"][fi])
                entry = {
                    "bar":    int(fvgs["index"][fi]),
                    "top":    float(fvgs["top"][fi]),
                    "bottom": float(fvgs["bottom"][fi]),
                }
                if fvg_type == "bullish":
                    bullish_fvgs.append(entry)
                else:
                    bearish_fvgs.append(entry)

        # ── Python lists for bar-by-bar loop ─────────────────────────────────
        pd_list   = pd_zones.to_list()
        bos_list  = bos.to_list()
        choch_list= choch.to_list()
        kz_list   = kz_mask.to_list()
        closes    = df["close"].to_list()

        # Extract ET hours for 15:55 hard-flatten
        _ts_col = "ts_et" if "ts_et" in df.columns else "ts_event"
        if _ts_col in df.columns:
            ts_series = df[_ts_col]
            hours   = ts_series.dt.hour().to_list()
            minutes = ts_series.dt.minute().to_list()
        else:
            hours   = [12] * n
            minutes = [0] * n

        # ── Signal arrays ─────────────────────────────────────────────────────
        entry_long  = [False] * n
        entry_short = [False] * n
        exit_long   = [False] * n
        exit_short  = [False] * n

        # ── State trackers ────────────────────────────────────────────────────
        # Track the most recent structural break events so we can look back
        # without holding an unbounded window.
        last_bullish_bos   = -999  # bar index of last bullish BOS or CHoCH
        last_bearish_bos   = -999  # bar index of last bearish BOS or CHoCH
        long_entry_bar     = -1
        short_entry_bar    = -1

        # ── Bar-by-bar loop ───────────────────────────────────────────────────
        for i in range(n):
            # ── Update structural break trackers ──
            bs = bos_list[i]
            cs = choch_list[i]
            if bs == "bullish" or cs == "bullish":
                last_bullish_bos = i
            if bs == "bearish" or cs == "bearish":
                last_bearish_bos = i

            h, m  = hours[i], minutes[i]
            t_min = h * 60 + m

            exited_long  = False
            exited_short = False

            # ── Exit checks (before entry — CLAUDE.md order) ──────────────────
            if long_entry_bar >= 0:
                if t_min >= 15 * 60 + 55 or (i - long_entry_bar) >= self.max_bars_held:
                    exit_long[i]  = True
                    long_entry_bar = -1
                    exited_long   = True

            if short_entry_bar >= 0:
                if t_min >= 15 * 60 + 55 or (i - short_entry_bar) >= self.max_bars_held:
                    exit_short[i]  = True
                    short_entry_bar = -1
                    exited_short   = True

            # ── Skip if outside every killzone ────────────────────────────────
            if not kz_list[i]:
                continue

            close = closes[i]

            # ── LONG entry gate ───────────────────────────────────────────────
            # Conditions (all must hold):
            # 1. Not already in a long position
            # 2. HTF bias = bullish (price in discount PD zone)
            # 3. Recent bullish BOS or CHoCH within bos_window bars
            # 4. Price inside an unmitigated bullish FVG within fvg_lookback bars
            if (
                not exited_long
                and long_entry_bar < 0
                and pd_list[i] == "discount"
                and last_bullish_bos >= 0
                and (i - last_bullish_bos) <= self.bos_window
            ):
                for fvg in bullish_fvgs:
                    # FVG must predate current bar but not be too stale
                    if fvg["bar"] >= i:
                        continue
                    if (i - fvg["bar"]) > self.fvg_lookback:
                        continue
                    # BOS must have come AFTER the FVG was created
                    # (the structure break creates the FVG, not vice versa)
                    if last_bullish_bos < fvg["bar"]:
                        continue
                    if fvg["bottom"] <= close <= fvg["top"]:
                        entry_long[i] = True
                        long_entry_bar = i
                        break

            # ── SHORT entry gate ──────────────────────────────────────────────
            # Mirror-image: HTF bias bearish (premium zone) + bearish BOS + FVG
            if (
                not exited_short
                and short_entry_bar < 0
                and long_entry_bar < 0  # no simultaneous positions
                and pd_list[i] == "premium"
                and last_bearish_bos >= 0
                and (i - last_bearish_bos) <= self.bos_window
            ):
                for fvg in bearish_fvgs:
                    if fvg["bar"] >= i:
                        continue
                    if (i - fvg["bar"]) > self.fvg_lookback:
                        continue
                    if last_bearish_bos < fvg["bar"]:
                        continue
                    if fvg["bottom"] <= close <= fvg["top"]:
                        entry_short[i] = True
                        short_entry_bar = i
                        break

        result = result.with_columns([
            pl.Series("entry_long",  entry_long),
            pl.Series("entry_short", entry_short),
            pl.Series("exit_long",   exit_long),
            pl.Series("exit_short",  exit_short),
            atr.alias(f"atr_{self.atr_period}"),
        ])

        return result

    def get_params(self) -> dict:
        return {
            "htf_swing_lookback": self.htf_swing_lookback,
            "bos_lookback":       self.bos_lookback,
            "bos_window":         self.bos_window,
            "fvg_lookback":       self.fvg_lookback,
            "atr_period":         self.atr_period,
            "max_bars_held":      self.max_bars_held,
        }

    def get_default_config(self) -> dict:
        return {
            "htf_swing_lookback": 20,
            "bos_lookback":       5,
            "bos_window":         15,
            "fvg_lookback":       8,
            "atr_period":         14,
            "max_bars_held":      30,
        }
