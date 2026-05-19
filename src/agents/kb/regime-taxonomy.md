# Regime Taxonomy — Trading Forge KB Card

> **Loaded by:** `strategy_proposer`, `critic_evaluator`. Used to set or evaluate `preferred_regime` on every strategy.
> **Authority:** Canonical. Trading Forge now has 10 regimes (8 original + BALANCE_DAY + TREND_DAY from Track 2 VP expansion). New regimes require a schema migration. Aligns with 2026 industry standards (verified Pass A research).
> **Last updated:** 2026-05-04.

## Why a regime taxonomy

A strategy without a regime tag bleeds money on regime transitions. The single most consistent finding from production trading systems (Marcos López de Prado, Goldman Sachs regime literature, Trading Forge's own A4 Frankenstein gate) is that strategies optimized over mixed-regime windows look great in-sample and fail out-of-sample because the regime balance flips.

Every Trading Forge strategy declares ONE `preferred_regime`. The `regime-classifier` (live ADX + ATR percentile + macro-state HMM) gates entry signals to that regime. Strategies attempting entries outside their declared regime are filtered.

---

## The 8 regimes

### `TRENDING_UP`

**Description.** Sustained directional drift with positive slope. New highs print frequently, pullbacks are shallow, dips are bought.

**Selection criteria:**
- ADX ≥ 25 over the last 20 bars
- 20-bar slope of close prices is positive AND > 0.3 ATRs per 20 bars
- Higher highs and higher lows in the last 60 bars
- Macro overlay: `prob_growth > 0.55` OR `prob_easing > 0.45` (from C11 HMM)

**Indicator pairings that work:**
- `ema_crossover` (canonical 9/21 EMA cross)
- `macd_crossover`
- `donchian_breakout`
- `supertrend`
- `atr_breakout` (long side)
- `vwap_order_flow` (continuation bias)

**Indicator pairings that fail:**
- `rsi_reversal` (RSI stays oversold for hours in genuine downtrends, mirrored on the long side)
- `vwap_fade` (fading a real trend = bleeding)
- `bollinger_breakout` (fade interpretation) — bands ride the trend; faders die

**Macro context:** Risk-on, bullish equities, declining VIX (< 18), positive earnings revisions. ES/NQ usually lead.

### `TRENDING_DOWN`

**Description.** Sustained directional drift with negative slope. Lower lows print frequently, rallies are sold.

**Selection criteria:**
- ADX ≥ 25 over the last 20 bars
- 20-bar slope is negative AND < −0.3 ATRs per 20 bars
- Lower highs and lower lows in the last 60 bars
- Macro overlay: `prob_crisis > 0.40` OR `prob_inflation > 0.55`

**Indicator pairings that work:** Mirror of `TRENDING_UP` — short-side `ema_crossover`, `donchian_breakout`, `supertrend`, `atr_breakout` (short).
**Indicator pairings that fail:** Short-side equivalents of the `TRENDING_UP` failures, especially long-side mean reversion.

**Macro context:** Risk-off, rising VIX (> 22), credit spreads widening. C11 HMM crisis probability often elevated.

### `RANGE_BOUND`

**Description.** Choppy oscillation within a defined band. No trend, no breakouts, every extension reverts.

**Selection criteria:**
- ADX < 20 over the last 20 bars
- Price within ±1.5 ATRs of a 60-bar moving average
- ATR percentile (60-bar) is in the 30–70 range (not LOW_VOL, not HIGH_VOL)

**Indicator pairings that work:**
- `rsi_reversal` (canonical fade)
- `bollinger_breakout` (fade interpretation)
- `vwap_fade`
- `keltner_squeeze` (during compression sub-regime)

**Indicator pairings that fail:**
- All trend-followers (`ema_crossover`, `macd_crossover`, `donchian_breakout`) — every signal is a whipsaw
- Breakout strategies — every breakout fades back

**Macro context:** Low macro news flow, neutral Fed posture, positions unwinding before next catalyst.

### `OPENING_RANGE`

**Description.** First 30–60 minutes of RTH. Order flow is establishing, ranges are forming, no regime is yet active.

**Selection criteria:**
- Time is between 9:30 ET and 10:30 ET (RTH open)
- Symbol is in {MES, MNQ, ES, NQ}
- Session is a regular trading day (not holiday/half-day)

**Indicator pairings that work:**
- `session_open_breakout` (canonical ORB)
- `fifo_session_open` (DOM imbalance)
- `cumulative_delta` (flow-leads-price during open)
- `atr_breakout` with short ATR window (5–10 bar)

**Indicator pairings that fail:**
- VWAP-based fades (VWAP isn't stable yet)
- Trend-followers with long lookbacks (60-bar EMA hasn't seen any new bars)
- Mean reversion before 10:00 ET (no mean to revert to)

**Macro context:** Pre-cash-open economic releases (8:30 ET CPI/NFP) bleed into the open. Avoid first 5 min on release days.

### `NEWS_DRIVEN`

**Description.** Scheduled or breaking news triggers violent price moves. The classic event-trade window.

**Selection criteria:**
- Within ±30 min of FOMC, CPI, NFP, ISM, or other Tier-1 release
- For MCL: within ±15 min of EIA Wednesday 10:30 ET inventory release
- For all symbols: spike in headline-volume detected by `brave-news-watcher` (5M)

**Indicator pairings that work:**
- `news_fade_mco` (specifically MCL EIA fade)
- `liquidity_sweep_breakout` (capitalize on stop runs)
- Volatility-expansion strategies

**Indicator pairings that fail:**
- Mean reversion (the move is real, not a fade setup)
- Trend-followers with slow lookbacks (the trend reverses before they confirm)

**Macro context:** All hands. C11 macro hard-gates BLOCK new entries during scheduled releases unless the strategy declares `bypass_news_blackout: true`.

**Special compliance note:** Most prop firms allow news trading; some restrict it. Check `prop-firm-rules-summary.md` per firm.

### `OVERNIGHT_DRIFT`

**Description.** Asia → Europe → London handoff. Directional drift accumulates while US is sleeping.

**Selection criteria:**
- Time is between 18:00 ET (prior day) and 09:30 ET
- Session filter is ETH or both
- Drift magnitude (Asia close vs prior US settle) > 0.5 ATRs

**Indicator pairings that work:**
- `overnight_drift` (canonical Asia-Europe drift exploiter)
- Slow trend-followers on 15m+ timeframe
- Position-trade-style entries with hold-through-RTH-open

**Indicator pairings that fail:**
- Fast scalpers (volume too thin)
- Mean reversion (drift is real, not a fade setup)

**Macro context:** Asian PMI, Chinese policy, European CPI all bleed into ETH session. Watch for geopolitical headlines (gold + crude fly first).

### `HIGH_VOL`

**Description.** Volatility regime in upper percentile. Wide ranges, large gaps, big-stops-required.

**Selection criteria:**
- ATR percentile (60-bar) > 80
- VIX > 25 (for ES/NQ derived markets)
- Recent gap > 1.5 ATRs

**Indicator pairings that work:**
- `atr_breakout` (genuine breakouts more common)
- `donchian_breakout`
- Trend-following with widened stops (multiplier 2.5–3.5)

**Indicator pairings that fail:**
- Tight-stop scalpers (stops blown by noise)
- Mean reversion (extensions extend further than usual)

**Macro context:** Often accompanies `TRENDING_DOWN` or `NEWS_DRIVEN`. Check C11 crisis probability — if > 0.60, hard gate may have already fired.

### `LOW_VOL`

**Description.** Compressed range, narrow ATR, vol-storm pending.

**Selection criteria:**
- ATR percentile (60-bar) < 20
- Volume below 60-bar average by > 30%
- VIX < 14 (for equity-derived futures)

**Indicator pairings that work:**
- `keltner_squeeze` (compression precedes expansion)
- `bollinger_breakout` (when bands contract)
- Mean reversion with wider entry thresholds

**Indicator pairings that fail:**
- ATR-sized scalpers (sizing collapses to 1 contract, profit too thin to matter)
- Breakouts (no breakouts in low vol)

**Macro context:** Pre-FOMC, summer doldrums, holiday weeks. The lull before the storm — strategies that perform in LOW_VOL must transition cleanly to HIGH_VOL or be paused.

---

## Regime detection thresholds (canonical)

These thresholds are referenced by `agent-service.ts:detectRegime()` and the C11 HMM macro overlay. Strategies must use these EXACT thresholds in their backtest filters or they will be flagged for inconsistent regime tagging.

| Threshold | Value | Source |
|---|---|---|
| ADX trending floor | 25 | DiNapoli, RobotWealth 2026 |
| ADX range ceiling | 20 | Mirror of trending floor with 5-pt no-mans-land |
| ATR percentile HIGH_VOL | > 80 | Trading Forge fixture defaults |
| ATR percentile LOW_VOL | < 20 | Trading Forge fixture defaults |
| Macro crisis hard-gate | C11 `prob_crisis > 0.60` | C11 design (W18) |
| ISM-RRP combined-stress | ISM < 49 AND RRP < $20B | C11 Nov 28 2025 case |

---

## NOTE — FCIX (Financial Chaos Index) HMM overlay (future enhancement)

**Status:** Documented for the next iteration. Not yet implemented.

The 2026 quant survey (arXiv:2510.05533) suggests an HMM overlay distinguishing three macro chaos states:

- **LC — Low-Chaos.** Normal markets. Default state ~70% of trading days.
- **IC — Intermediate-Chaos.** Elevated risk-off without crisis. ~25% of days.
- **HC — High-Chaos.** Crisis-period overlay. ~5% of days, but accounts for most strategy failures.

**Why not implemented yet.** C11 already provides a 4-state HMM (Growth / Inflation / Crisis / Easing) sufficient to drive the existing hard gates. FCIX would be additive — useful for sizing-modulation but not for blocking entries. Adding it requires:
1. A FRED-equivalent feed for FCIX components (NIPA chaos index, credit spreads, term premium)
2. Schema columns on `macro_regime_states` for `fcix_state` and `fcix_score`
3. Sizing modulator: HC → 0.5× position, IC → 0.75×, LC → 1.0×

**Trigger to revisit.** When the strategy portfolio grows beyond 5 simultaneous DEPLOYED strategies and aggregate-portfolio chaos sensitivity becomes a measurable risk. Currently single-strategy-at-a-time so the simpler 4-state HMM suffices.

---

## Track 2 Volume-Profile-Derived Regimes (VP EXPANDED)

Two additional regimes derived from IB extension status. These are INTRADAY classifiers — they augment the daily bias state but are NOT standalone `preferred_regime` values on strategies (use the 8 base regimes for DSL `preferred_regime`). They drive playbook routing in `playbook_router.py`.

### `BALANCE_DAY`

**Derived from:** `ib_extension_status = 'IB_HOLD'` AND `profile_shape = 'D'`

**Description.** Price opened and held within or near yesterday's value area. IB not extended by 10:30 ET. Market participants are in balance — no directional conviction from large players. Expect oscillation within a defined range.

**Playbook routing:** MEAN_REVERSION (both directions, toward VA center/POC).

**Indicator pairings that work:** `vwap_fade`, `ny_lunch_reversal`, `midnight_open` (mean reversion setups). Reject at HVNs, target POC.

**Indicator pairings that fail:** `ema_crossover`, `donchian_breakout`, `atr_breakout` — any momentum indicator. Balance days chew them up with whipsaws.

**Key levels to watch:** POC (magnet), VAH (rejection zone), VAL (rejection zone), naked POCs from prior sessions.

**Strategy hint:** When profile_shape=D and IB_HOLD, don't chase breakouts. Size down. Target 0.5R mean-reversion setups only.

---

### `TREND_DAY`

**Derived from:** `ib_extension_status IN ('IB_EXTENSION_UP', 'IB_EXTENSION_DOWN', 'IB_EXTENSION_BOTH')` OR `profile_shape = 'Thin'` OR `open_classification = 'Open-Outside-Range'`

**Description.** Price broke the IB (or opened outside range), signaling large player directional conviction. Expect continuation in the extension direction. These days often close at or near the day's extreme — fading them is dangerous.

**Playbook routing:** TREND_CONTINUATION (direction = IB extension direction, confirmed by HTF alignment).

**Indicator pairings that work:** `ema_crossover`, `donchian_breakout`, `atr_breakout` (long/short per direction), `supertrend`, `vwap_order_flow` (continuation bias).

**Indicator pairings that fail:** `vwap_fade`, `rsi_reversal`, mean-reversion setups. Fading a trend day bleeds multiple ATRs.

**Key levels to watch:** IB high/low as support/resistance post-extension. Prior session VAH/VAL as continuation targets. Naked POCs as potential magnet zones above/below.

**Style C eligibility:** Thin profile + IB extension + HTF-aligned bias = Style C runner allowed. Trail developing session POC.

---

## Macro overlay context (current — C11 W18)

The C11 macro layer adds a 4-state HMM (Growth, Inflation, Crisis, Easing) with these conditional behaviors:

- **Crisis hard-gate.** `prob_crisis > 0.60` blocks new long-side ES/NQ/MES/MNQ entries with horizon > 2 hr.
- **ISM-RRP combined-stress.** ISM < 49 AND RRP < $20B blocks ES/NQ longs.
- **FOMC proximity.** Within ±1 day of FOMC reduces position size 50% via `compute_position_sizes()`.
- **Macro release day.** Blocks new entries from −1 hr to +3 hr around the release.

Strategies must NOT include explicit macro probability checks in their entry logic — the macro gates run at the engine level. The regime tag tells the strategy WHEN it should be allowed to fire; the macro layer tells the engine WHEN to block regardless.

---

## Sources

- arXiv:2510.05533 (Columbia 2026 quant survey) — regime taxonomy comparison
- arXiv:2412.20138 (TradingAgents 2025) — regime-conditional alpha
- Marcos López de Prado, "Advances in Financial Machine Learning" — regime detection
- Goldman Sachs Quant Research, regime rotation losses 2024–2025
- AlphaArchitect — regime-blind strategies and survivorship bias
- Trading Forge `src/engine/regime_classifier.py` — current implementation
- Trading Forge `src/engine/macro_regime_classifier.py` — C11 HMM
- Trading Forge `CLAUDE.md` § "Macro Regime Overlay (W18 / C11)" — operational rules
