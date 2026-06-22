# Indicator Catalog — Trading Forge KB Card

> **Loaded by:** `strategy_proposer`, `critic_evaluator`, and `transcript_extractor` roles via `model-router.ts:loadSystemPrompt`.
> **Purpose:** Canonical list of indicators the Trading Forge DSL compiler accepts, with parameter ranges, regime fit, and known failure modes. Treat as the authoritative reference — strategies proposing indicators outside this set will fail compile.
> **Schema source-of-truth:** `src/engine/compiler/strategy_schema.py` (mirrored to `kb/strategy-schema-snapshot.json` by build hook).
> **Asset class focus:** Intraday futures (MES, MNQ, MCL). Daily-bar adaptations are noted per indicator.
> **Last updated:** 2026-05-04. Aligned with `vectorbt 0.27`, `pandas-ta 0.3.x`, and Trading Forge fixture vocabulary (`scalper_mes`, `trend_mnq`, `heavy_mcl`, `range_fade_mnq`, `opening_range_breakout_mes`, `news_fade_mcl`, `overnight_drift_mes`).

## How to use this catalog

1. Pick the indicator that matches the **regime** the strategy targets (see "best regime" per entry).
2. Use parameter values from the **canonical range** column. Strategies with parameters tighter than the canonical range (e.g. RSI period=11.7, EMA fast=9.3) trigger overfitting flags in `dsl_quality_critic`.
3. Read the **gotchas** section before proposing — most reasons a backtest looks great but paper trades blow up are listed there.
4. If the input research-find references an indicator NOT on this list, the proposer must either map it to the closest equivalent on this list OR return `{ reject: true, reason: "indicator_not_supported: <name>" }`.

---

## Category: TREND

Tools that buy strength and sell weakness. Best when ADX ≥ 25 or directional moves persist. They lag — that's the cost of being on the right side of a sustained move.

### `ema_crossover`
**Description.** Fast Exponential Moving Average crosses above/below a slower EMA. Standard trend-following primitive — used in `trend_mnq.json` (Trading Forge production fixture).

**Required params:**
| Param | Range | Default | Notes |
|---|---|---|---|
| `fast_period` | 5–50 | 9 | EMA half-life — shorter = more whipsaws |
| `slow_period` | 20–200 | 21 | Must satisfy `slow_period >= 2 * fast_period` |
| `confirmation_bars` | 1–5 | 2 | Bars price must hold above/below cross before signal |

**Best regime:** `TRENDING_UP`, `TRENDING_DOWN`. ADX ≥ 25.
**Worst regime:** `RANGE_BOUND` (whipsaws every 30 min on intraday).
**Gotchas:**
- Wrong on first day of every regime change. Combine with ADX filter or a "no trades in first 60 min after regime classifier flip" rule.
- 9/21 EMA on 5m MES will fire 4–6 signals per session in chop. Use confirmation_bars ≥ 2 to halve the count.
- Crossovers within the ATR-wide chop band before 9:30 ET should be ignored — opening drive isn't yet established.

### `macd_crossover`
**Description.** MACD line crosses signal line. Adds momentum filter on top of dual-EMA (12/26 default). Slower than `ema_crossover` but produces fewer fakeouts.

**Required params:**
| Param | Range | Default | Notes |
|---|---|---|---|
| `fast_period` | 8–16 | 12 | MACD fast EMA |
| `slow_period` | 20–30 | 26 | MACD slow EMA |
| `signal_period` | 7–12 | 9 | EMA of MACD line |

**Best regime:** `TRENDING_UP`, `TRENDING_DOWN`.
**Worst regime:** `OPENING_RANGE` (no momentum yet — MACD lags too much for first 30 min).
**Gotchas:**
- MACD histogram peaks BEFORE the price peak. Don't exit on histogram-down alone — wait for the line crossover.
- Divergences are powerful but appear in only 5–10% of sessions; treat as a confirmation filter, not a primary signal.

### `donchian_breakout`
**Description.** Price breaks the highest high or lowest low of the last N bars (Turtle-style). Pure breakout primitive.

**Required params:**
| Param | Range | Default | Notes |
|---|---|---|---|
| `period` | 10–55 | 20 | Lookback bars |
| `confirmation_bars` | 1–3 | 1 | Bar close above/below the channel |

**Best regime:** `TRENDING_UP`, `TRENDING_DOWN`, `HIGH_VOL`.
**Worst regime:** `RANGE_BOUND` (every breakout is a fade setup, not a follow-through).
**Gotchas:**
- Combine with an ATR-expansion filter — Donchian alone fires breakouts on every dull-volume drift to a new local high.
- Don't confuse with a session-open Donchian — that needs `session_open_breakout` (different lookback semantics).

### `supertrend`
**Description.** ATR-based trailing trend filter. Flips long/short when price closes through the supertrend line.

**Required params:**
| Param | Range | Default | Notes |
|---|---|---|---|
| `atr_period` | 7–21 | 10 | ATR window |
| `multiplier` | 1.5–4.0 | 3.0 | Trail width as ATR multiples |

**Best regime:** `TRENDING_UP`, `TRENDING_DOWN`.
**Worst regime:** `LOW_VOL` (ATR collapses, supertrend hugs price, every wiggle is a flip).
**Gotchas:**
- Higher multiplier = fewer flips but larger drawdowns when wrong. Stick to 2.5–3.0 for intraday futures.
- Supertrend repaints intra-bar; only act on bar close.

### `ichimoku_cloud`
**Description.** Multi-line trend filter — Tenkan/Kijun cross plus cloud confirmation. Slow but high-quality signals.

**Required params:**
| Param | Range | Default | Notes |
|---|---|---|---|
| `tenkan_period` | 7–11 | 9 | Conversion line |
| `kijun_period` | 22–30 | 26 | Base line |
| `senkou_b_period` | 50–60 | 52 | Cloud thickness |

**Best regime:** `TRENDING_UP`, `TRENDING_DOWN` on higher timeframes (15m, 1h, 4h).
**Worst regime:** `RANGE_BOUND`, intraday < 5m (signals lag too much).
**Gotchas:**
- Don't trust signals when price is INSIDE the cloud — that is by definition no-edge territory.
- Cloud thickness is a vol proxy. Thin cloud = mean-reverting, thick cloud = trending.

### `bounce_off_level`
**Description.** Price approaches a **single** moving average (SMA or EMA) acting as a dynamic support/resistance level, prints a rejection candle, and entry fires on the confirmation bar close.

**Signal class: MA-as-S/R (NOT MA-vs-MA cross).** This is the correct indicator for concepts like:
- "200 MA ceiling/floor", "50 SMA support", "100 EMA resistance"
- "trendline bounce setup", "price tests MA and rejects"
- "<N>_ma_<bounce|reject|holds|test>" concept names

**DO NOT confuse with `ema_crossover`:** `ema_crossover` requires TWO MAs crossing each other (fast over/under slow). `bounce_off_level` uses ONE MA as a price level. If the research source describes price bouncing off a single MA, use `bounce_off_level`.

**Required params:**
| Param | Range | Default | Notes |
|---|---|---|---|
| `ma_period` | 10–250 | 200 | The MA period — 20/50/100/200 are the institutional defaults |

**Optional params:**
| Param | Range | Default | Notes |
|---|---|---|---|
| `proximity_atr_mult` | 0.5–3.0 | 1.0 | How close (in ATR units) price must get to the MA to qualify as a touch |
| `swing_lookback` | 3–20 | 5 | Bars to look back for structural swing (stop placement) |
| `atr_period` | 7–21 | 14 | ATR period for stop floor and proximity zone |

**String params (not validated numerically):**
- `ma_type`: `"sma"` or `"ema"` (default `"sma"`)
- `direction`: `"ceiling"` | `"floor"` | `"both"` (default `"both"`)
- `rejection_pattern`: `"wick_reject"` | `"engulfing"` | `"pin_bar"` | `"any_close_back_through"` (default `"any_close_back_through"`)

**Best regime:** `TRENDING_UP`, `TRENDING_DOWN` (MA is rising/falling and acts as dynamic S/R); also works in `RANGE_BOUND` when MA is flat.
**Worst regime:** `HIGH_VOL_MACRO` (MA loses its S/R significance when price gaps through levels).
**Gotchas:**
- The 200 SMA is the most respected institutional level — use `ma_period: 200` as your default for any "MA ceiling/floor" concept. The 50 SMA is the second most common.
- ATR proximity filter (`proximity_atr_mult`) prevents entries when price approaches the MA without actually touching it — keeps you out of "near miss" setups.
- Stop placement: structural swing + 1.5×ATR floor + 14pt MES ceiling (CLAUDE.md §4). If stop exceeds ceiling, skip the trade.
- Confirmation bar prevents entries on the rejection candle itself (avoids chasing a wick).

**Example DSL:**
```json
{
  "name": "200_ma_ceiling_floor_mes_15m",
  "entry_indicator": "archetype:bounce_off_level",
  "entry_params": {
    "ma_period": 200,
    "ma_type": "sma",
    "direction": "both",
    "rejection_pattern": "any_close_back_through",
    "proximity_atr_mult": 1.0
  },
  "direction": "both",
  "symbol": "MES",
  "timeframe": "15m"
}
```

---

## Category: MEAN REVERSION

Tools that fade extremes back to a mean. Best when ADX < 20 or price oscillates within a defined range. They print the early money but bleed when a regime change starts trending.

### `rsi_reversal`
**Description.** Buy oversold, sell overbought. The textbook mean-reverter.

**Required params:**
| Param | Range | Default | Notes |
|---|---|---|---|
| `period` | 7–21 | 14 | RSI lookback |
| `oversold` | 20–40 | 30 | Long entry threshold |
| `overbought` | 60–80 | 70 | Short entry threshold |

**Best regime:** `RANGE_BOUND`, `LOW_VOL`.
**Worst regime:** `TRENDING_UP`, `TRENDING_DOWN`. RSI can stay oversold for days in a downtrend — every long is a knife-catch.
**Gotchas:**
- Use the regime filter to disable during trending days.
- RSI period < 7 or > 21 is overfitting bait — stick to canonical range.
- Pairs well with a higher-timeframe trend filter (e.g. only take long oversold signals when 1h is bullish).

### `bollinger_breakout`
**Description.** Price closes outside Bollinger Band. Two interpretations — fade (mean reversion) or follow (volatility expansion). The DSL must declare which via `entry_type`.

**Required params:**
| Param | Range | Default | Notes |
|---|---|---|---|
| `period` | 10–30 | 20 | Moving average + std-dev lookback |
| `std_dev` | 1.5–3.0 | 2.0 | Band width |
| `confirmation_bars` | 1–3 | 1 | Close-outside duration |

**Best regime (fade interpretation):** `RANGE_BOUND`. **Best regime (follow):** `HIGH_VOL`, breakout sessions.
**Gotchas:**
- Bollinger band width contracting predicts an expansion — but doesn't predict direction. Pair with a directional filter.
- Std-dev > 3.0 produces almost no signals on 5m intraday; std-dev < 1.5 produces noise.

### `vwap_fade`
**Description.** Fade extension above/below session VWAP. Used in `range_fade_mnq.json` fixture.

**Required params:**
| Param | Range | Default | Notes |
|---|---|---|---|
| `deviation_threshold` | 0.5–3.0 | 1.5 | Distance from VWAP in standard deviations |
| `confirmation_bars` | 1–5 | 2 | Bars price must remain extended before fade signal |

**Best regime:** `RANGE_BOUND`, `LOW_VOL`, RTH.
**Worst regime:** `NEWS_DRIVEN`, `OPENING_RANGE` (VWAP itself is whipping).
**Gotchas:**
- VWAP re-anchors at session open. The 9:30 ET print is meaningless — wait for ~30 min for VWAP to stabilize.
- Strong trending days (`TRENDING_UP` / `TRENDING_DOWN`) will keep extending — fade strategies bleed on trend days.
- Better paired with a regime gate: only take VWAP fades when ADX < 22.

### `keltner_squeeze`
**Description.** Volatility compression between Keltner channels and Bollinger bands signals a coming expansion. Used in `heavy_mcl.json` fixture.

**Required params:**
| Param | Range | Default | Notes |
|---|---|---|---|
| `bb_period` | 15–25 | 20 | Bollinger band period |
| `kc_period` | 15–25 | 20 | Keltner channel period |
| `kc_multiplier` | 1.0–2.0 | 1.5 | Keltner width as ATR multiple |

**Best regime:** Pre-`HIGH_VOL` (compression before expansion).
**Worst regime:** Already-trending markets — squeeze rarely sets up.
**Gotchas:**
- Squeeze is directionless until it fires. Pair with a momentum confirmation (e.g. MACD direction at the moment of fire).
- MCL has wider noise than MES/MNQ; use `kc_multiplier=1.5` minimum on crude.

---

## Category: VOLATILITY

Tools that measure or exploit volatility regime changes. Always use ATR-based sizing — fixed contracts on volatile bars is the fastest way to blow a prop account.

### `atr_breakout`
**Description.** Price breaks ATR-multiple range. Used in `scalper_mes.json` fixture.

**Required params:**
| Param | Range | Default | Notes |
|---|---|---|---|
| `period` | 10–30 | 14 | ATR lookback |
| `multiplier` | 1.0–3.0 | 1.5 | Range expansion threshold |

**Best regime:** `HIGH_VOL`, `OPENING_RANGE`.
**Worst regime:** `LOW_VOL` (no breakouts to catch).
**Gotchas:**
- `multiplier < 1.0` produces noise; `multiplier > 3.0` rarely fires intraday.
- Combine with a session filter — overnight ATR breakouts rarely follow through to RTH.

### `atr_trailing_stop`
**Description.** Trailing stop at N × ATR below highest high since entry (long). Standard trend-protection mechanic.

**Required params:**
| Param | Range | Default | Notes |
|---|---|---|---|
| `atr_period` | 10–20 | 14 | ATR window |
| `multiplier` | 1.5–3.5 | 2.0 | Trail width |

**Used as:** `exit_type="trailing_stop"` in DSL. Not an entry indicator on its own — pair with a trend-entry like `ema_crossover`.
**Gotchas:**
- Tighter trail = better win rate but smaller average winner. The math says wider is better when in a real trend.
- Set `break_even_at_r` (trail-stop W5b extension) to lock in a free trade after 1R.

---

## Category: VOLUME / ORDER FLOW

Tools that integrate volume or microstructure. Mostly require Level-1+ data; some require Level-2. Trading Forge backtester handles tape volume — Level-2 (DOM) is paper-only.

### `cumulative_delta`
**Description.** Net buying vs selling pressure (uptick vol − downtick vol). Reveals absorption and divergence.

**Required params:**
| Param | Range | Default | Notes |
|---|---|---|---|
| `window` | 30–120 | 60 | Bars to accumulate delta |
| `divergence_threshold` | 0.5–2.0 | 1.0 | Standard deviations of delta vs price divergence to trigger |

**Best regime:** `OPENING_RANGE`, intraday news, where flow leads price.
**Worst regime:** `LOW_VOL`, overnight (delta noise dominates signal).
**Gotchas:**
- CME tick rule for futures means delta calc is approximate from non-tick feeds. Best on Databento or DOM-grade data.
- Divergence signals are unreliable on micros (MES/MNQ) compared to ES/NQ — fewer participants per tick.

### `vwap_order_flow`
**Description.** VWAP plus volume-conditioned bias — flow above VWAP on increasing volume = continuation; flow above VWAP on decreasing volume = exhaustion.

**Required params:**
| Param | Range | Default | Notes |
|---|---|---|---|
| `volume_lookback` | 20–60 | 30 | Bars for volume normalization |
| `bias_threshold` | 0.6–1.5 | 0.9 | Flow strength to fire |

**Best regime:** `TRENDING_UP`, `TRENDING_DOWN`, RTH.
**Worst regime:** Overnight (low participation, VWAP noise).
**Gotchas:**
- Session VWAP only — never use cumulative VWAP across sessions.

### `volume_profile`
**Description.** Identify HVNs (high-volume nodes) and LVNs (low-volume nodes) in a session/day. Trade rejection at HVNs (mean reversion) or break-and-go through LVNs (continuation). **PREFERRED FOR EXIT LOGIC** — POC, VAH, and VAL are the authoritative structural levels for trailing stops and TP targets. Prefer VAH/VAL/POC over arbitrary horizontal levels when the source describes a volume-anchored setup.

**Required params:**
| Param | Range | Default | Notes |
|---|---|---|---|
| `profile_window` | 1–5 sessions | 1 | Sessions to build profile |
| `node_threshold_pct` | 70–90 | 80 | Volume percentile threshold for HVN |

**Best regime:** All — universal levels respect.
**Worst regime:** None inherently — the issue is that HVN/LVN computation is expensive, so prefer pre-computed daily profile loaded at session start.
**Gotchas:**
- Yesterday's HVN matters. Today's developing profile is noisy in first 30 min — don't act before 10:00 ET.
- Use pre-computed daily VP levels from `daily_volume_profile_levels` table (computed at 5:30 PM ET) rather than computing intra-session.

### `profile_shape`
**Description.** Classification of the daily VP distribution shape: D (balanced/neutral), b (bottom-heavy/bullish), P (top-heavy/bearish), Thin (narrow/trending). Drives playbook routing and Style C runner eligibility.

**Values:** `D` | `b` | `P` | `Thin`
**No params** — derived from `volume_profile` computation.

**Best regime:** All — shape is a regime classifier itself.
**Gotchas:**
- D-shape + IB_HOLD = balance day → prefer MEAN_REVERSION
- b-shape = demand profile → prefer SWEEP_REVERSAL_LONG on pullbacks
- P-shape = supply profile → prefer SWEEP_REVERSAL_SHORT on rallies
- Thin = directional day → prefer TREND_CONTINUATION aligned with HTF

### `initial_balance`
**Description.** First 60-minute RTH range (9:30–10:30 ET). IB extension (break of IB high/low) signals continuation. IB hold signals balance day. Use with `profile_shape` for regime confirmation.

**Values:** `IB_HOLD` | `IB_EXTENSION_UP` | `IB_EXTENSION_DOWN` | `IB_EXTENSION_BOTH`
**No params** — derived from `volume_profile` computation.

**Gotchas:**
- IB extension aligned with HTF = strong trend signal
- IB extension against HTF = fade opportunity (consider SWEEP_REVERSAL)
- IB_HOLD with D-shape = balance day → don't chase breakouts

### `open_relative_to_value`
**Description.** Classification of where price opened relative to yesterday's Value Area (VA): Open-In-Value (neutral), Open-Outside-Value-Up/Down (fade back), Open-Outside-Range (trend day).

**Values:** `Open-In-Value` | `Open-Outside-Value-Up` | `Open-Outside-Value-Down` | `Open-Outside-Range`
**No params** — derived from `volume_profile` computation.

**Gotchas:**
- Open-Outside-Range + IB extension = strong trend day → force TREND_CONTINUATION
- Open-Outside-Value + IB_HOLD = price opened outside VA but didn't extend IB → fade back into value (MEAN_REVERSION)

---

## Category: SESSION / TIME-BASED

Strategies that exploit deterministic time-of-day patterns. The cleanest edge in futures because participation cycles are real and persistent.

### `session_open_breakout`
**Description.** Define an opening range (first N minutes of RTH). Long on break above, short on break below. Used in `opening_range_breakout_mes.json` fixture.

**Required params:**
| Param | Range | Default | Notes |
|---|---|---|---|
| `range_minutes` | 5–60 | 30 | Opening range width in time |
| `buffer_ticks` | 1–10 | 2 | Ticks beyond range high/low for confirmation |

**Best regime:** `OPENING_RANGE`. RTH only.
**Worst regime:** Holiday/half-day sessions (range is meaningless).
**Gotchas:**
- 9:30–10:00 ET is the canonical window. Wider windows (60 min) reduce signal count drastically.
- Combine with a "no trade if economic release within 15 min of open" rule (CPI/NFP scheduled at 8:30 ET still bleed into open).

### `overnight_drift`
**Description.** Asia → Europe directional drift exploited at RTH open via mean-reversion or continuation. Used in `overnight_drift_mes.json` fixture.

**Required params:**
| Param | Range | Default | Notes |
|---|---|---|---|
| `drift_session` | "asia" \| "europe" \| "both" | "both" | Source session for drift |
| `entry_window_minutes` | 5–60 | 30 | Window after RTH open to enter |

**Best regime:** `OVERNIGHT_DRIFT`. ETH/RTH boundary.
**Worst regime:** `NEWS_DRIVEN` overnight (geopolitical events break the drift pattern).
**Gotchas:**
- Drift direction must be measured from prior settlement, not midnight. Mismeasurement = wrong-side entries.

### `fifo_session_open`
**Description.** Trade the first inventory imbalance after the cash open (9:30 ET). FIFO order book bias bleeds into the first 5–15 minutes of price action.

**Required params:**
| Param | Range | Default | Notes |
|---|---|---|---|
| `imbalance_window_seconds` | 30–300 | 90 | Window to measure imbalance |
| `imbalance_threshold` | 1.5–4.0 | 2.5 | Bid-ask imbalance ratio to trigger |

**Best regime:** `OPENING_RANGE`. RTH cash open.
**Worst regime:** Half-day sessions, holidays.
**Gotchas:**
- Requires sub-minute data; not viable on 5m bars alone.
- Massive (real-time WebSocket) provides this; backtests need DOM-grade history.

---

## Category: EVENT-DRIVEN

Strategies whose entire premise is a scheduled or unscheduled event. Must set `bypass_news_blackout: true` in DSL or they will be filtered out by the macro blackout gate.

### `news_fade_mco` (Energy / EIA inventory)
**Description.** Fade the first violent move following a scheduled inventory release (EIA Wednesday 10:30 ET) on MCL. Used in `news_fade_mcl.json` fixture.

**Required params:**
| Param | Range | Default | Notes |
|---|---|---|---|
| `release_window_seconds` | 60–600 | 180 | Window after release to allow violent move |
| `fade_threshold_atr` | 1.5–4.0 | 2.5 | ATR multiples of move to trigger fade |

**Best regime:** `NEWS_DRIVEN`, EIA Wednesdays only on MCL.
**Worst regime:** Non-release days. Strategy must self-disable when no release scheduled.
**Gotchas:**
- Must opt into the FOMC/CPI/NFP blackout via `bypass_news_blackout: true` AND must register the EIA event source. Generic "news_fade" without event registration is rejected.
- Requires a slippage model 3× normal in the first 60 seconds.

### `liquidity_sweep_breakout`
**Description.** Identify a sweep of stops below recent low (or above recent high), then trade the reversal. Inspired by ICT/Wyckoff but expressed in pure-volume terms.

**Required params:**
| Param | Range | Default | Notes |
|---|---|---|---|
| `sweep_lookback` | 10–60 | 20 | Bars to identify the swept level |
| `volume_spike_multiplier` | 1.5–3.0 | 2.0 | Volume vs lookback average to confirm sweep |

**Best regime:** Both `TRENDING` and `RANGE_BOUND` — sweep-and-reverse is a structural pattern not a regime.
**Worst regime:** `LOW_VOL` (no real liquidity to sweep).
**Gotchas:**
- ICT pure-pattern naming (order blocks, FVGs) is NOT compiler-supported. Express the same idea as a swept-low-plus-volume-spike pattern; the compiler accepts that.

---

## Category: ADAPTIVE / MODERN

Indicators with built-in adaptation to volatility or regime. Higher complexity but better robustness across regimes.

### `dema_crossover`
**Description.** Double-Exponential MA crossover. Less lag than EMA at the cost of slightly more whipsaws.

**Required params:**
| Param | Range | Default | Notes |
|---|---|---|---|
| `fast_period` | 5–30 | 10 | Fast DEMA |
| `slow_period` | 20–60 | 30 | Slow DEMA |

**Best regime:** Fast `TRENDING_UP`, `TRENDING_DOWN`.
**Worst regime:** `RANGE_BOUND` (more whipsaws than EMA).

### `alma_filter`
**Description.** Arnaud Legoux Moving Average — Gaussian-weighted smoother. Slower whipsaws than EMA but with the lag of SMA.

**Required params:**
| Param | Range | Default | Notes |
|---|---|---|---|
| `period` | 9–50 | 21 | Lookback |
| `offset` | 0.5–1.0 | 0.85 | Gaussian center (0=SMA, 1=EMA) |
| `sigma` | 4–8 | 6 | Smoothing |

**Best regime:** `TRENDING_UP`, `TRENDING_DOWN`.
**Worst regime:** Volatility breakouts (ALMA is too smooth to catch sudden moves).

### `rsi_divergence`
**Description.** RSI prints a higher low while price prints a lower low (bullish divergence) or vice versa. Stronger reversal signal than RSI level alone.

**Required params:**
| Param | Range | Default | Notes |
|---|---|---|---|
| `period` | 7–21 | 14 | RSI lookback |
| `divergence_lookback` | 10–60 | 20 | Bars to scan for divergence |

**Best regime:** `RANGE_BOUND` end-of-trend reversal.
**Worst regime:** Strong `TRENDING` (divergences fail repeatedly in real trends).
**Gotchas:**
- Divergence is a confirmation signal, not a primary entry. Pair with a structural trigger (level break, volume spike).

---

## Category: ICT STRUCTURAL ARCHETYPES

These are structural (detector-driven) archetypes registered in `ARCHETYPE_REGISTRY`.
They compile via the `archetype:<name>` route — NOT via `pattern_library`. When you
identify one of these patterns in a transcript, emit the archetype name as
`entry_indicator` — do NOT try to shoehorn the pattern into a parametric indicator.

### `ict_bias_aligned_continuation`
**Description.** BIDIRECTIONAL by default. Fires LONG when HTF bias is bullish + 15m
structure breaks bullish (BOS or CHoCH) + 5m FVG retest fires inside a killzone.
Fires SHORT under the mirror-image bearish conditions.

**Direction contract (critical for Gemma):**
- The source video may show ONLY the short setup (4H bearish bias → 15m bearish BOS → 5m
  bearish FVG retrace into premium zone). That is the bearish **leg** of this archetype.
- The archetype is SYMMETRIC — it will fire longs when bias flips bullish. You must set
  `direction: "both"` even if the source only shows one direction.
- If you set `direction: "short"`, the long side is permanently disabled. Do not do this.

**Signal sequence (both directions):**
```
LONG:  HTF bias = bullish (discount PD zone)
       + recent bullish BOS or CHoCH (structure confirms shift)
       + price retraces into unmitigated bullish FVG (entry trigger)
       + current bar inside a killzone (NY AM / NY PM / London / Silver Bullet)

SHORT: HTF bias = bearish (premium PD zone)
       + recent bearish BOS or CHoCH
       + price retraces into unmitigated bearish FVG
       + current bar inside a killzone
```

**Anti-trend reject:** If HTF bias is bullish but a bearish BOS fires, the archetype
does NOT take a short. Bias must align with the structure break direction.

**Key distinction from silver_bullet:**
- `silver_bullet` fires only in the 1-hour windows 10-11 AM, 2-3 PM, 3-4 AM ET.
  It requires a displacement candle to validate the FVG.
- `ict_bias_aligned_continuation` fires during ANY of the 4 ICT killzones
  (NY AM 8-11, NY PM 1:30-4, London 2-5 AM, Silver Bullet windows).
  It requires BOS/CHoCH to validate the directional bias alignment — no displacement candle required.

**Key distinction from power_of_3:**
- `power_of_3` requires an Asia session range, followed by a London Judas sweep.
- `ict_bias_aligned_continuation` does NOT require a prior-session sweep.
  It only needs HTF bias + LTF BOS + FVG.

**DSL fields to emit:**
```json
{
  "entry_indicator": "archetype:ict_bias_aligned_continuation",
  "direction": "both",
  "bias_timeframe": "4h",
  "entry_long": "high < low",
  "entry_short": "high < low"
}
```
Both `entry_long` and `entry_short` are the never-true sentinel `"high < low"` because
the archetype's detector path handles the actual signal — not a DSL expression.

**Required params:** None — the archetype uses structural detection internally.
**Best regime:** `TRENDING_UP` (for longs), `TRENDING_DOWN` (for shorts). Avoid `RANGE_BOUND`.
**Worst regime:** `HIGH_VOL_MACRO` — FVGs form but fill too fast and the bias is noisy.
**Gotchas:**
- If you see a transcript describing "4H bias" + "15 minute structure break" + "5 minute
  FVG entry" + "killzone filter", that is this archetype. Do not emit `ema_crossover`.
- The source video may title the strategy "short setup" or "bearish setup". Ignore the
  direction framing in the title — always emit `direction: "both"`.
- Concept names that map here: `multi_confluence_short_setup`, `bias_aligned_short_continuation`,
  `ict_short_continuation`, `bias_aligned_continuation`, `htf_bias_continuation`,
  `4h_bias_structure_fvg`, `ict_3_layer_model`, `ict_multi_timeframe_continuation`,
  `htf_bias_sfp_displacement_fvg_continuation`.

### `gann_box_4h_continuation`
**Description.** BIDIRECTIONAL by default. Identifies an IMPULSIVE 4H candle (full body,
minimal wicks), draws a Gann box from the candle's low to its high, divides it into four
Fibonacci zones, and enters when price retraces a wick into the OPTIMUM zone (0.50–0.75
from the base) with FVG or order-block confluence.

**Fib zone definitions (both directions):**
```
Zone         Fib range (from base)  Action
premature    0.00–0.25              Skip — retracement too shallow / faded fast
mid_gap      0.25–0.50              Neutral — not acted on
optimum      0.50–0.75              ENTRY ZONE — high-probability institutional fill
overextended 0.75–1.00              Skip — setup invalidated (too deep)
```
For LONG: base = candle low (Fib 0), top = candle high (Fib 1).
For SHORT: inverted — base = candle high (Fib 0), top = candle low (Fib 1).

**Impulsive candle filter:** body / (high - low) >= 0.70 (default). Excludes doji,
spinning tops, and candles with dominant wicks. Only high-conviction directional candles
qualify to anchor the Gann box.

**Signal sequence (both directions):**
```
LONG:  Bullish trend bias (price above EMA)
       + bullish impulsive 4H candle detected
       + price retraces wick into optimum zone (0.50–0.75 from candle low)
       + FVG or order-block confluence inside the optimum zone
       → entry long; target: prior daily high

SHORT: Bearish trend bias (price below EMA)
       + bearish impulsive 4H candle detected
       + price retraces wick into optimum zone (0.50–0.75 from candle high, inverted)
       + FVG or order-block confluence inside the optimum zone
       → entry short; target: prior daily low
```

**Stop placement:** Beyond the order block that created the FVG. Engine records the
structural stop via ATR floor (1.5×ATR) / ceiling (14pt MES); framework-overlay owns
final sizing. Do NOT compute futures P&L in the archetype — framework handles it.

**Key distinctions:**
- vs `ict_bias_aligned_continuation`: that archetype requires killzone timing + BOS/CHoCH.
  This archetype fires purely on the 4H candle Gann box retrace — no killzone gate.
- vs `ict_ote`: `ict_ote` uses a fixed 62–79% OTE retracement after a swing BOS.
  This archetype draws the Gann box OVER A SINGLE 4H CANDLE, not a swing range.
- vs `bounce_off_level`: `bounce_off_level` uses an MA as the level. Gann box is price-
  structure-derived from the candle range, not a moving average.

**Direction contract (critical for Gemma):**
- Source video (SY2jXlW9bt4) may demonstrate only one direction. The archetype is
  SYMMETRIC — always emit `direction: "both"` regardless of which direction the
  tutorial shows.

**DSL fields to emit:**
```json
{
  "entry_indicator": "archetype:gann_box_4h_continuation",
  "direction": "both",
  "entry_long": "high < low",
  "entry_short": "high < low"
}
```
Both `entry_long` / `entry_short` are the never-true sentinel `"high < low"` — the
archetype's detector handles the actual signal, not a DSL expression.

**Required params:** None — the archetype uses structural detection internally.
**Best regime:** `TRENDING_UP` (for longs), `TRENDING_DOWN` (for shorts).
**Worst regime:** `RANGE_BOUND` — no sustained directional impulse candles; Gann boxes
form and immediately re-enter, making the optimum zone meaningless.
**Gotchas:**
- The impulsive-candle filter is the gating condition. If the video describes "any 4H
  candle" without emphasizing a strong directional candle, Gann box still applies — the
  filter will handle the selection internally.
- Gann box must be anchored to THE 4H TIMEFRAME candle, not the 1m or 5m. If the source
  describes a shorter-timeframe box, still route to `gann_box_4h_continuation` — the
  operator confirmed 4H as canonical for this pattern class.
- Concept names that map here: `gann_box_fib_zone_entry`, `4h_candle_box_continuation`,
  `fib_zone_optimum_retracement`, `gann_box_4h_retrace`, `impulsive_candle_gann_entry`,
  `4h_impulse_retrace_fib`, `candle_box_fib_zone`, `optimum_zone_fib_entry`,
  `4h_continuation_fib_zones`.

---

## v11 Entry Sequence Vocabulary — Canonical Names for Rule Extraction

> **Wave 26 Pass I (2026-05-26).** These canonical names map speaker phrases to `entry_sequence[].name` values and `indicators_used[].name` values. Use these exact names in v11 entry_sequence extraction.

### Entry Sequence Step Names

| Canonical `name` | Speaker phrases that trigger this name | `indicators_needed` |
|---|---|---|
| `htf_bias_confirmed` | "weekly/daily/4H bias", "HTF trending direction", "higher timeframe says bullish/bearish", "all higher timeframes aligned", "trending market on the higher timeframe", "MSS on the daily", "macro direction" | `["market_structure", "trend_continuity"]` |
| `liquidity_raid_sfp` | "swing failure pattern", "SFP", "wick takes everybody out then closes back", "liquidity raid", "price takes out the high and reverses", "swept the lows and closed above", "fake breakout then reversal close", "turtle soup", "stop run then close back through" | `["swing_highs_lows", "candle_closure"]` |
| `displacement_with_fvg_entry` | "displacement candle", "large body candle creates a fair value gap", "FVG forms after the raid", "displacement + FVG", "imbalance created by displacement", "enter inside the gap", "retrace into the fair value gap" | `["fair_value_gap", "displacement_candle", "market_structure_break"]` |
| `bos_confirmation` | "break of structure", "BOS", "price broke through the swing high", "confirmed higher high on LTF", "structure break to the upside/downside" | `["market_structure", "swing_points"]` |
| `choch_confirmation` | "change of character", "CHoCH", "first sign of reversal", "initial structure flip", "character changed on the 15-minute" | `["market_structure", "swing_points"]` |
| `mss_confirmation` | "market structure shift", "MSS", "price shifted structure", "reclaimed above the swing", "closed above the most recent swing high" | `["market_structure", "swing_points"]` |
| `fvg_retrace_entry` | "fair value gap", "FVG", "imbalance", "price filling the gap", "retrace into the imbalance", "gap between the wicks" | `["fair_value_gap"]` |
| `order_block_entry` | "order block", "OB", "last bearish candle before the rally", "last bullish candle before the drop", "institutional OB", "entry at the order block" | `["order_block"]` |
| `killzone_timing` | "killzone", "NY AM session", "10 to 11 AM", "London open", "only during the kill zone", "within the kill zone window" | `["session_time", "killzone"]` |
| `sfp_plus_ob_confluence` | "swing failure at the order block", "SFP into an OB", "wick into order block then closes", "OB + SFP confluence" | `["swing_highs_lows", "order_block", "candle_closure"]` |
| `ma_bias_filter` | "price above the 200 SMA", "200 MA as bias filter", "above/below the moving average for direction", "MA defines the trend" | `["moving_average"]` |
| `htf_premium_discount` | "price in premium", "price in discount", "trading at equilibrium", "50% of the range", "premium zone for shorts", "discount zone for longs" | `["price_level", "range_midpoint"]` |
| `equal_highs_lows_target` | "equal highs", "equal lows", "double top liquidity", "double bottom liquidity", "price will seek equal highs", "those equal lows are the target" | `["liquidity_pools", "swing_points"]` |
| `rr_filter` | "minimum 2R", "risk-reward must be at least 2", "skip if not enough room to target", "only take it if R:R is 2 or better" | `["price_level"]` |

### Target Type Canonical Names (for `targets[].type`)

| Canonical type | Speaker phrases |
|---|---|
| `equal_highs_lows` | "equal highs", "equal lows", "double top liquidity above", "double bottom liquidity below", "those equal highs are my target" |
| `equal_highs` | "equal highs", "the equal highs up there", "that liquidity above the equal highs" |
| `equal_lows` | "equal lows", "the equal lows below", "that liquidity sitting at the equal lows" |
| `previous_daily_high` | "previous day high", "yesterday's high", "prior daily high", "PDH" |
| `previous_daily_low` | "previous day low", "yesterday's low", "prior daily low", "PDL" |
| `previous_weekly_high` | "previous weekly high", "last week's high", "prior weekly high", "PWH" |
| `previous_weekly_low` | "previous weekly low", "last week's low", "prior weekly low", "PWL" |
| `range_high` | "top of the range", "range high", "high of the range", "session high" |
| `range_low` | "bottom of the range", "range low", "low of the range", "session low" |
| `fvg_high` | "top of the fair value gap", "FVG high", "upper boundary of the imbalance" |
| `fvg_low` | "bottom of the fair value gap", "FVG low", "lower boundary of the imbalance" |
| `ob_high` | "top of the order block", "OB high", "upper boundary of the OB" |
| `ob_low` | "bottom of the order block", "OB low", "lower boundary of the OB" |

### Stop Loss Anchor Canonical Names (for `stop_loss.anchor`)

| Canonical anchor | Speaker phrases |
|---|---|
| `swing_low_below_entry` | "stop below the swing low", "stop below the most recent low", "invalidate below this swing", "stop at the swing that created the setup" |
| `swing_high_above_entry` | "stop above the swing high", "stop above the most recent high", "invalidate above this level" |
| `swing_after_sfp` | "stop below the swing that was raided", "below the low that got swept", "stop at the swing failure point" |
| `fvg_low` | "stop at the bottom of the FVG", "if price leaves the fair value gap I'm out" |
| `fvg_high` | "stop at the top of the FVG", "stop above the imbalance" |
| `displacement_candle_low` | "stop below the displacement candle", "the candle that created the FVG is my stop anchor" |
| `ob_low` | "stop below the order block", "if price closes below the OB I'm wrong" |
| `ob_high` | "stop above the order block" |
| `atr_multiple` | "1.5 ATR stop", "ATR-based stop", "stop is 1 ATR from entry" |
| `fixed_points` | "12-point stop", "10-tick stop", "fixed stop distance" |

---

## Confluence Factor Vocabulary — Wave 25 11-Factor Reference

> **Loaded by:** `transcript_extractor` at call time. This section maps spoken/written phrases to the canonical factor tokens used by the A+ confluence gate and the 11-factor weighted-scoring model.

The operator's 2026 library audit found 66 of 99 strategies with only the auto-injected `regime_match + structural_setup` fallback pair — Gemma was extracting 0-1 real confluence factors per video. The 2026 institutional standard is **≥3 factors per strategy**. This vocabulary table exists so Gemma can match spoken phrases to the correct tokens.

### Instructions for Gemma

After identifying the primary archetype, scan the ENTIRE transcript for phrases from the left column. When found, emit both the `confluence_factors` token (closed 5-enum for the A+ gate) AND a corresponding `confirming_indicators` entry (for the richer weighted-scoring path).

Bias toward INCLUSION. A missed factor scores the strategy wrong permanently until re-extracted. The operator prunes false positives; the system cannot add missing true positives after graduation.

### Trigger phrase → factor mapping

| Trigger phrases (if you hear any of these...) | `confluence_factors` token | `confirming_indicators` indicator |
|---|---|---|
| "higher timeframe bias", "4H bias", "daily trend", "HTF direction", "weekly trend", "HTF in premium", "HTF in discount" | `regime_match` + `structural_setup` | `{"indicator": "htf_bias", "params": {}, "direction": "agree"}` |
| "killzone", "NY open", "NY AM session", "NY PM session", "London session", "10 AM window", "11 AM", "silver bullet hour", "2:30 PM reversal", "3 PM session" | `structural_setup` | `{"indicator": "killzone", "params": {}, "direction": "agree"}` |
| "volume spike", "delta divergence", "cumulative delta", "footprint chart", "absorption", "order flow confirmation", "CVD" | `volume_confirmation` | `{"indicator": "cumulative_delta", "params": {}, "direction": "agree"}` |
| "market breadth", "NYSE TICK", "ADD", "advance/decline", "internals confirm" | `volume_confirmation` | `{"indicator": "market_internals", "params": {}, "direction": "agree"}` |
| "POC", "VAH", "VAL", "value area", "volume profile", "high-volume node", "vacuum area", "low-volume node" | `vp_shape` | `{"indicator": "volume_profile", "params": {}, "direction": "agree"}` |
| "liquidity sweep", "stop run", "equal highs", "equal lows", "stop hunt", "swept the lows", "grabbed the stops" | `structural_setup` | `{"indicator": "liquidity_sweep", "params": {}, "direction": "agree"}` |
| "no FOMC", "no CPI", "no NFP", "avoid news", "check the calendar", "macro filter", "news blackout" | `macro_alignment` | `{"indicator": "macro_filter", "params": {}, "direction": "agree"}` |
| "ES and NQ confirm", "NQ leads ES", "SMT divergence", "smart money technique", "correlation divergence" | `structural_setup` | `{"indicator": "smt_divergence", "params": {}, "direction": "agree"}` |
| "VWAP", "anchored VWAP", "AVWAP", "above VWAP", "below VWAP", "VWAP reclaim" | `structural_setup` | `{"indicator": "vwap", "params": {}, "direction": "agree"}` |
| "DXY", "10-year yield", "dollar index", "bonds moving", "cross-asset" | `structural_setup` | `{"indicator": "cross_asset", "params": {}, "direction": "agree"}` |
| "BOS", "break of structure", "CHoCH", "change of character", "MSS", "market structure shift", "price broke structure" | `structural_setup` | `{"indicator": "market_structure_aligned", "params": {}, "direction": "agree"}` |
| "FVG", "fair value gap", "imbalance", "price fills the gap", "IFVG", "inversion FVG" | `structural_setup` | `{"indicator": "fvg_retrace", "params": {}, "direction": "agree"}` |
| "regime filter", "trending market", "only in trend", "ADX above", "uptrend confirmed", "downtrend confirmed" | `regime_match` | `{"indicator": "regime_filter", "params": {}, "direction": "agree"}` |
| "swing high", "swing low", "opening range", "previous high/low", "structural level", "key level" | `structural_setup` | `{"indicator": "structural_level", "params": {}, "direction": "agree"}` |

### How many factors is enough?

| Count | Assessment |
|---|---|
| 0 factors extracted | RED FLAG — re-scan the transcript. Most strategy videos describe at least regime + structure. |
| 1 factor | LIKELY UNDER-EXTRACTION — acceptable only for truly single-condition scalps (rare). |
| 2 factors | Minimum viable. Check if the video describes a regime or session window — likely 3 is achievable. |
| 3+ factors | INSTITUTIONAL STANDARD — this is the target for every extraction. |
| 5 factors | Rich confluence — typical for ICT/SMC multi-timeframe setups. |

---

## NOT Recommended for Intraday Futures

These are technically computable but consistently fail the Trading Forge performance gates on MES/MNQ/MCL data. Strategies proposing them should be rejected at synthesis time.

| Indicator | Why excluded |
|---|---|
| `stochastic` | Whipsaw machine on 5m intraday futures; fails OOS walk-forward in 80%+ of cases tested. |
| `cci` (Commodity Channel Index) | Lags more than RSI without offering distinct edge; fails diversity gate vs RSI. |
| `williams_pct_r` | Equivalent to inverted stochastic; same whipsaw failure mode. |
| `roc` (Rate of Change) | Pure momentum without smoothing; too noisy on tick-volatile micros. |
| `parabolic_sar` | Trailing-stop approximation; `atr_trailing_stop` is strictly superior for futures. |
| `obv` (On-Balance Volume) | Cumulative since session/symbol start — drift-prone, regime-blind. |
| ICT pure-pattern primitives (Order Blocks, FVGs, Breakers, Sweeps) | Codified in the indicator library but require specialized DSL extensions; until those ship, express ideas as volume-spike/level-break primitives. |

---

## Cross-cutting rules (apply to ALL indicator usage)

1. **Maximum 5 entry_params.** More is overfitting bait. The DSL schema enforces this (`extra="forbid"`).
2. **Parameters must work across the canonical range.** A strategy that requires `period=11.7` instead of `period=10..12` is overfit. Critic will flag values with > 1 decimal place precision.
3. **Match `entry_type` to indicator semantics.** `atr_breakout` → `entry_type: "breakout"`. `vwap_fade` → `entry_type: "mean_reversion"`. `news_fade_mcl` → `entry_type: "event_driven"`. Mismatches are auto-rejected.
4. **Always declare a `preferred_regime`.** Strategies without a regime tag bleed money in regime transitions.
5. **`stop_loss_atr_multiple` must be in 0.5–5.0 range.** Tighter stops blow out on slippage; wider stops violate prop drawdown.
6. **`take_profit_atr_multiple` must satisfy `> stop_loss_atr_multiple`.** Reverse-R:R strategies are auto-rejected.
7. **Symbol set is `MES`, `MNQ`, `MCL` only.** Engine pattern_library is built for these. Other symbols fail compile.
8. **Timeframes: `1m`, `5m`, `15m`, `30m`, `1h`, `4h`, `1d`.** Sub-minute data not in backtester pipeline.

---

## Sources

- vectorbt 0.27 indicator library: https://vectorbt.dev/api/indicators/
- pandas-ta 0.3.x: https://github.com/twopirllc/pandas-ta
- Quantpedia indicator screening 2026: https://quantpedia.com/
- RobotWealth — robust intraday futures: https://robotwealth.com/
- AlphaArchitect — survivorship and overfitting: https://alphaarchitect.com/
- arXiv 2412.20138 (TradingAgents 2025) — multi-agent strategy synthesis
- arXiv 2510.05533 (Columbia 2026 quant survey) — RAG-augmented LLM trading
- arXiv 2509.21507 (QuantMind) — chain-of-agents for systematic trading
- CME Group product specs (MES/MNQ/MCL contract details): https://www.cmegroup.com/markets/equities/equities.html
- MQL5 architecture posts 2026 — production LLM trading systems
- Trading Forge `src/engine/strategies/dsl_fixtures/` — production fixture archetypes
- Trading Forge `docs/RESEARCH-institutional-stop-placement.md` — stop-placement edge cases
