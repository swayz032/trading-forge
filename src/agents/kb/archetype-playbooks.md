# Archetype Playbooks — Trading Forge KB Card

> **Loaded by:** `trade_critique` (via `critique-knowledge-retriever.ts`). The retriever injects the ONE archetype section matching the trade's strategy, so the critique grounds on what the strategy ACTUALLY claims to trade — not a generic pattern (evidence file R8: "the strategy's own DSL source thesis... not a generic pattern").
> **Purpose:** Institutional entry/exit thesis + what good execution looks like + common failure modes, one section per archetype family. The critique uses this to judge whether the trade was faithful to its archetype's edge, and to attribute failures to the right dimension.
> **Section-key convention:** each family is headed `## ARCHETYPE: <key>` (lowercase snake). Keys map from strategy `name`/`entry_indicator` via the keyword map in `critique-knowledge-retriever.ts`.
> **Authority:** Reference. Cite institutional/established methodology. Anything not directly citable is marked "(operator-configurable heuristic)".
> **Last updated:** 2026-07-05.

---

## KEY convention & mapping

| `## ARCHETYPE:` key | Maps from (name/indicator keywords) |
|---|---|
| `silver_bullet`         | silver bullet, ict, judas, killzone, ny_am, ny_pm |
| `opening_range`         | opening range, orb, session_open_breakout, opening_range_breakout |
| `mean_reversion`        | mean reversion, rsi_reversal, fade to mean, revert |
| `breakout`              | breakout, donchian, atr_breakout, range breakout, squeeze release |
| `vwap_fade`             | vwap fade, vwap reject, vwap band, anchored vwap |
| `trend_continuation`    | trend continuation, ema_crossover, macd, supertrend, bias_aligned_continuation |
| `support_bounce`        | support bounce, bounce_off_level, ma bounce, demand zone |
| `resistance_rejection`  | resistance rejection, supply zone, rejection |
| `squeeze`               | squeeze, keltner, bollinger squeeze, compression |

---

## ARCHETYPE: silver_bullet

**Institutional thesis.** The ICT Silver Bullet is a fixed-time-window liquidity model: price sweeps a session liquidity pool, prints a market-structure shift, and delivers to the opposing draw-on-liquidity inside a narrow killzone (10-11 AM / 2-3 PM / 3-4 AM ET). Edge is TIME + liquidity + displacement, not an indicator crossover (ICT concepts; `kb/indicator-catalog.md` silver_bullet section; `src/engine/session_windows.py`).

**What good execution looks like.** Entry inside the killzone AFTER a documented sweep + MSS/CHoCH; stop beyond the sweep extreme + sweep buffer; TP1 at the first intraday draw-on-liquidity (min 0.8R), runner to the opposing pool. Structure_state and nearest_liquidity_level are BOTH populated — a Silver Bullet critique that lacks them cannot attribute to `structure`/`liquidity` faithfully.

**Common failure modes.** (1) Firing OUTSIDE the killzone (time gate slipped) → attribute to `narrative`/`exit_plan`. (2) Entering on the sweep instead of after the MSS confirmation → `structure`. (3) Targeting the wrong side of liquidity (chasing the pool that was just swept) → `liquidity`. (4) Runner given back because 15:55 flatten caught it flat → `exit_plan`.

## ARCHETYPE: opening_range

**Institutional thesis.** Opening-Range Breakout trades the first 15-60 min RTH range as an equilibrium; a decisive break with order-flow confirmation signals directional conviction for the session (Edgeful ORB studies; `kb/regime-taxonomy.md` OPENING_RANGE). Edge concentrates in the 9:30-10:30 ET window on index futures.

**What good execution looks like.** Range defined on real RTH bars; entry on the retest/hold of the broken edge (not the first spike); stop back inside the range; TP scaled at prior-session VAH/VAL or measured-move. Volume/delta confirmation on the break.

**Common failure modes.** (1) False breakout in the lunch dead zone (11:30-13:30 ET blackout exists precisely for this — >60% false-breakout rate, Tradeify dataset) → `regime`/`narrative`. (2) Chasing the first 5-min spike on a release day → `fill`. (3) Range taken from ETH not RTH bars → `structure`. (4) No order-flow confirmation → `confluence`.

## ARCHETYPE: mean_reversion

**Institutional thesis.** Fade extensions back toward a statistical mean (VWAP, POC, MA, band midline) ONLY in balancing regimes (RANGE_BOUND / BALANCE_DAY). Edge is regime-conditional — a mean-reversion signal in a trend day is a knife-catch (`kb/regime-taxonomy.md` RANGE_BOUND/BALANCE_DAY; QuantifiedStrategies mean-reversion research).

**What good execution looks like.** Entry at a band/level extreme with a reversal trigger, in a confirmed low-ADX regime (ADX < 20); tight stop beyond the extreme; target the mean (POC/VWAP), 0.5-1R harvest, no runner in chop. Reject at HVN, target POC.

**Common failure modes.** (1) Fading a TREND_DAY / IB-extension → `regime` (the dominant failure). (2) Mean not yet established (pre-10:00 ET) → `narrative`. (3) Target set past the mean expecting continuation → `exit_plan`. (4) Extension extended further in HIGH_VOL → `decay`/`regime`.

## ARCHETYPE: breakout

**Institutional thesis.** Trade genuine range/structure breaks with volatility expansion; breakouts pay in HIGH_VOL, TREND_DAY, and post-compression regimes and bleed in RANGE_BOUND where every break fades (`kb/regime-taxonomy.md` HIGH_VOL/TREND_DAY; Donchian/Turtle lineage; Hurst-Ooi-Pedersen trend evidence).

**What good execution looks like.** Break of a well-tested level with expanding range and volume; entry on the break or first higher-low retest; widened ATR stop (breakouts need room); runner allowed when HTF-aligned. Structural stop, never fixed-point.

**Common failure modes.** (1) Breakout in RANGE_BOUND → immediate fade → `regime`. (2) Stop too tight, blown by breakout noise → `fill`/`exit_plan`. (3) Chasing an extended break (poor location) → `liquidity`. (4) No volatility expansion behind the break → `confluence`.

## ARCHETYPE: vwap_fade

**Institutional thesis.** Institutional discount/premium model around session VWAP + bands: fade the 1σ/2σ band extreme back to VWAP in balance, or reject at anchored-VWAP retest. LONG is satisfied when price is BELOW VWAP (discount), SHORT when ABOVE (premium) — this CORRECTS the retail "long above VWAP" assumption (Wave 25 Pass 5 `evalVwapAlignment`; `kb/indicator-catalog.md`).

**What good execution looks like.** Entry at 1σ/2σ band reject or anchored-VWAP retest in the discount/premium direction; stop beyond the band; target VWAP/POC. Session VWAP reset at Globex 18:00 ET.

**Common failure modes.** (1) Fading VWAP in a trend day (VWAP rides the trend) → `regime`. (2) Using retail long-above-VWAP polarity → `structure`/`confluence`. (3) VWAP not yet stable (opening range) → `narrative`. (4) Anchored-VWAP anchor stale → `decay`.

## ARCHETYPE: trend_continuation

**Institutional thesis.** Enter WITH an established HTF trend on pullbacks/continuation triggers (EMA cross, MACD, supertrend, ICT bias-aligned continuation). Edge requires HTF alignment; counter-trend continuation is a contradiction in terms (`kb/regime-taxonomy.md` TRENDING_UP/TREND_DAY; `ict_bias_aligned_continuation` archetype).

**What good execution looks like.** HTF bias confirmed (daily/HTF timeframe aligned); entry on a shallow pullback or continuation trigger; stop below the pullback swing; runner trailed (developing POC / anchored VWAP) to capture the trend leg.

**Common failure modes.** (1) Firing against HTF narrative → `narrative`/`regime`. (2) Entering late in an exhausted trend leg → `liquidity`/`decay`. (3) Pullback stop too shallow → `fill`. (4) Exiting the runner early, forfeiting the trend payoff → `exit_plan`.

## ARCHETYPE: support_bounce

**Institutional thesis.** Buy a demand zone / support level / MA-as-support with a rejection trigger, expecting a bounce toward the next resistance. Level quality (tested, HTF-significant, untouched) and regime (not a knife-down trend) determine edge (`bounce_off_level` archetype — `src/engine/strategies/bounce_off_level.py`; Grimes support/resistance methodology).

**What good execution looks like.** Level is HTF-significant and not yet mitigated; entry on a rejection/reclaim trigger AT the level (not anticipating it); stop below the level + sweep buffer; target the next liquidity level.

**Common failure modes.** (1) Buying support in a TRENDING_DOWN regime (support breaks) → `regime`. (2) Anticipating the level instead of waiting for the reaction → `structure`. (3) Level already tested 3+ times (weak, likely to break) → `decay`. (4) Stop inside the sweep zone, swept then reversed → `liquidity`/`fill`.

## ARCHETYPE: resistance_rejection

**Institutional thesis.** Short a supply zone / resistance / MA-as-resistance on a rejection trigger, expecting a move toward the next support. Mirror of support_bounce; regime and level quality gate the edge (Grimes; `bounce_off_level` short side).

**What good execution looks like.** HTF-significant unmitigated resistance; rejection trigger AT the level; stop above the level + sweep buffer; target the next downside liquidity pool.

**Common failure modes.** (1) Shorting resistance in TRENDING_UP (resistance breaks) → `regime`. (2) Front-running the level → `structure`. (3) Equal-highs that get raided before reversal → `liquidity`. (4) Over-touched level → `decay`.

## ARCHETYPE: squeeze

**Institutional thesis.** Compression (Keltner-inside-Bollinger, narrow ATR, LOW_VOL) precedes volatility expansion; trade the RELEASE in the resolved direction, not the squeeze itself (`kb/regime-taxonomy.md` LOW_VOL; keltner_squeeze; Bollinger squeeze lineage). Edge is the transition LOW_VOL → HIGH_VOL.

**What good execution looks like.** Confirmed compression (bands contracted, ATR percentile < 20); entry on the expansion break with a directional trigger; stop inside the compression range; runner allowed because expansion legs travel multiple ATRs.

**Common failure modes.** (1) Entering during the squeeze before resolution (no edge in the compression) → `confluence`. (2) Fading the expansion (mean-reverting a real break) → `regime`. (3) Wrong-direction break-then-reverse (compression traps both sides) → `liquidity`. (4) Position sized on tight squeeze ATR then expansion blows the stop → `fill`.

---

## Sources

- ICT concepts (Silver Bullet, killzones, MSS/CHoCH, draw-on-liquidity) — `kb/indicator-catalog.md`, `src/engine/session_windows.py`.
- Edgeful / QuantifiedStrategies — ORB + mean-reversion backtest evidence.
- Grimes, *The Art & Science of Technical Analysis* — support/resistance, level quality.
- Hurst, Ooi, Pedersen — trend-following evidence (breakout/continuation).
- Trading Forge `kb/regime-taxonomy.md` — regime-conditional archetype fit.
- Trading Forge archetype engines — `src/engine/strategies/*.py`, `direct-bucket-graduator.ts` ARCHETYPE_REGISTRY.
- CLAUDE.md §4 (Style C canonical), §2b (Stage 2 weighted scoring), lunch-blackout evidence (Tradeify 13-yr dataset).
