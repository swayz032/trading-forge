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
