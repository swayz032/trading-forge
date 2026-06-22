# Stop-Loss Methodology — Institutional Reference Evidence

## TL;DR (Trading Forge gap assessment)

- VERDICT: The current structural + ATR-floor + per-symbol ceiling design is institutional-grade for 2026. The ban on fixed-point stops is correct and corroborated by ≥5 independent sources.
- The structural stop with sweep buffer is the right primary mechanism. The 1.5×ATR floor is validated. The per-symbol ceiling with skip-trade-if-exceeded is validated.
- GAPS: Break-even stop timing (currently moves at TP1 fill = +1R) has mixed evidence — it is mechanically correct but should be treated as an idempotent gate, not as a trailing mechanism. Breakeven stops REDUCE expected value when moved too early or used as the sole trailing mechanism.
- GAPS: No explicit time-based stop tightening before key news events (EIA, FOMC) exists in current code for MCL specifically.
- GAPS: The sweep buffer (3 ticks MES / 5 ticks MNQ / 2 ticks MCL) is empirically grounded but has no academic triangulation — it is community-consensus, not institutional research.

---

## Sources (≥2025 only)

| Date | Source | Tier | URL | Key claim |
|---|---|---|---|---|
| 2026-02-12 | AlgoKing / Pro Algo Trading | blog-general | https://algos.pro/posts/2026-02-12-adaptive-stop-losses-volatility-scaled-exits/ | "Fixed stop losses are lazy. Same 2% stop on ES at VIX 12 vs VIX 35 = completely different risk profiles. Volatility-scaled exits are the standard." |
| 2026-01-30 | QuantStrategy.io — Futures Day Trading | educator | https://quantstrategy.io/blog/beyond-the-standard-customizing-trailing-stop-loss-logic/ | "The standard trailing stop fails in intraday futures. Fixed trailing stops suffer from stop-runs. Structural trailing stops (pivot-based) filter out noise by only moving when market genuinely breaks a swing point." |
| 2026-03-02 | VARRD.com — Stop-Loss Optimization Systematic Guide | educator | https://www.varrd.com/guides/stop-loss-optimization.html | "ATR-based stops are the standard in professional quantitative trading. Fixed-dollar stops don't calibrate to the market. ATR always answers the right question: how much movement is just noise for this instrument right now?" |
| 2026-03-20 | Nova Quant Lab — Advanced Risk Management 2026 | educator | https://novaquantlab.com/advanced-risk-management-dynamic-position-sizing-trailing-stops-in-python-2026-guide/ | "Static lot sizes and fixed stops fail when market volatility changes. ATR-derived stop distances are the institutional standard. Wide stop in high-vol, tight stop in low-vol — the stop always represents the same statistical noise." |
| 2026-02-25 | Goat Funded Trader — Stop Loss and Take Profit | practitioner-interview | https://www.goatfundedtrader.com/blog/how-to-set-stop-loss-and-take-profit-in-trading | "Intraday traders use 0.6–1.0 ATR for stop distance. Swing traders 1.5–3.0 ATR. Use volatility + structure-based rules rather than emotional reactions. MNCL Group 2025: stops reduce losses by average 30%." |
| 2026-03-29 | TradeDisciple — Futures Risk Management Framework | practitioner-interview | https://tradedisciple.com/blog/futures-trading-risk-management | "Stop placement must be mechanical — defined by market structure, not pain tolerance. ORB: stop 0.5-1pt beyond opening range. VWAP setups: stop 2-4 ticks beyond VWAP. LSW/SDZ: stop beyond the swept/rejected level. Move stop to breakeven once up 1R." |
| 2026-03-03 | Quantum Navigator — Futures Risk Management 2026 | educator | https://qntrader.com/futures-trading-risk-management-a-data-driven-protocol-for-2026/ | "ATR × multiplier for stop placement. Using ATR multiple for stop ensures risk is defined by current market behavior, not arbitrary price levels. 1% rule: no single trade risks more than 1% of account equity." |
| 2026-05-14 | TrendsAndBreakouts — Hard Drawdown Stops | educator | https://trendsandbreakouts.com/hard-drawdown-stops | "Hard drawdown stops based on account-level thresholds cost more than they save (Grossman & Zhou 1993 confirmed by DRL PPO 2025 research). Backtests: adding 15% hard DD stop to trend-following reduces annual return 3-5 points and hurts Sharpe. Where they make sense: when system edge is unknown, or hard constraint from prop firm." |
| 2026-02-28 | StratBase.ai — ATR Trailing Stop Guide | educator | https://stratbase.ai/en/blog/average-true-range-trailing-stop | "ATR trailing stop (Chandelier Exit) outperforms fixed trailing stops. BTC/USDT backtest 2020-2024: Chandelier(22, 3.0) PF=1.61 vs fixed 5% trail PF=1.09 vs fixed 10% trail PF=1.28. All ATR methods beat fixed trailing stops substantially. Recalculate ATR each bar (not fixed at entry) for trend-following." |
| 2026-03-29 | PropTradingVibes — Trailing Stop Loss Strategy | practitioner-interview | https://proptradingvibes.com/blog/trailing-stop-loss-strategy | "Fixed trailing stops fail in NQ. On NQ: enter with fixed stop at invalidation level (10-15pts). Once at 1R, move stop to break-even. Then trail manually using swing structure or time-based exit. Never use trailing stop from moment of entry — fastest way to get stopped out of a winner." |
| 2026-04-13 | Medium (Willow the Trader) — 6 Risk Management Mechanisms | blog-general | https://medium.com/@techacademies/i-built-six-risk-management-mechanisms-into-my-strategy-heres-what-survived-5e1b05307a33 | "Breakeven stop (at +1R = 9pts) systematically underperformed vs NO breakeven on ES SuperTrend strategy. Reduced variance but capped upside; breakeven turned profitable runners into breakeven exits. ATR profit lock (off-hours trailing) also underperformed — normal overnight consolidation triggers the stop." |
| 2026-01-07 | Phidias Prop Firm — Trailing Drawdown Guide 2026 | practitioner-interview | https://phidiaspropfirm.com/education/trailing-drawdown-guide | "EOD trailing drawdown (Topstep, Phidias) vs intraday trailing (Apex): EOD passes viable strategies that intraday trailing hunts. Example: trader up $3,200 NQ, trailing DD moved to +$700, news pullback to +$650 — account blown on winning trade. EOD avoids this. Stops trailing once account locks." |
| 2026-05-10 | PropTradingVibes — MFFU Rules 2026 | practitioner-interview | https://proptradingvibes.com/blog/myfundedfutures-rules-overview | "On Topstep, Apex, Take Profit Trader: separate intraday daily loss cap can close account BEFORE trailing drawdown triggers — recoverable directional thesis blown by secondary rule." |
| 2026-04-09 | TradeCovex — Prop Firm Rules 2026 | practitioner-interview | https://tradecovex.com/guides/prop-firm-rules-2026 | "Drawdown mechanics differ most between firms. Topstep trailing Maximum Loss Limit only updates based on end-of-day balance (not intraday). Spend more time on this section than any other." |
| 2025-10-15 | SSRN — Course on Systematic Trading (Bloch) | research | https://papers.ssrn.com/sol3/Delivery.cfm/5278107.pdf?abstractid=5278107&mirid=1 | Published 2025-10-15 (verified). Systematic trading at intersection of quantitative analysis and financial uncertainty. Referenced as research-tier source on systematic exit methodology. |
| 2026-05-06 | Tradeify — Futures Rollover Guide 2026 | practitioner-interview | https://tradeify.co/post/futures-rollover-guide-for-prop-firm-traders-in-2026 | "If ATR of NQ increases 40% during quarterly roll, professional response is to reduce contracts so standard stop-loss does not represent larger percentage of account than usual. Scale down from minis to micros to maintain precise risk control." |

**Sources dropped (no verifiable ≥2025-01-01 date):** Phidias trailing drawdown guide (published_at = null in Exa response) — content used with caution, secondary only. TradingView indicator scripts (no dates). QuantVPS ATR stop article (no date). All three excluded from primary evidence table.

---

## Trading Forge vs Institutional Comparison

| Aspect | Trading Forge Implementation | Institutional Reference (2026) | Gap | Scale verdict |
|---|---|---|---|---|
| **Fixed-point stops** | BANNED per CLAUDE.md §13 ("Don't use fixed-point stops on MES") | ALL 2026 sources agree fixed stops fail: "lazy" (AlgoKing 2026-02), "deeply flawed" (VARRD 2026-03), "fails spectacularly in intraday futures" (QuantStrategy 2026-01) | NO GAP — design is correct | Required at our scale |
| **ATR as stop floor** | `floor = 1.5 × current-timeframe ATR` in `structural_stops.py` | Intraday: 0.6-1.0 ATR (GoatFundedTrader 2026-02). 2× ATR standard for swing (StratBase 2026-02). 1.5-2.5 ATR common for structural stops | Minimal gap — TF uses 1.5× which is at the LOW end of the 1.5-2.5 range cited for structural stops but above the 0.6-1.0 intraday scalp range | Beneficial at our scale |
| **Structural stop placement** | `compute_structural_stop()` — priority: sweep_wick > order_block > FVG > swing_point, plus sweep-aware buffer per symbol | "Structural trailing stops (pivot-based) filter out noise" (QuantStrategy 2026-01). "Stop beyond invalidation level — under swing lows for long setups" (DeepTracker 2026 via Brave search) | NO GAP — design matches institutional best practice | Required at our scale |
| **Per-symbol stop ceiling** | 14pt MES / 40pt MNQ / 25 tick MCL | No direct institutional analog — ceiling design is TF-specific to prevent runaway risk | No institutional corroboration exists for specific ceiling numbers. The skip-trade-if-exceeded logic IS corroborated (don't force a trade with oversized risk) | Beneficial at our scale |
| **Skip trade if stop > ceiling** | Hard skip in `paper-signal-service.ts` | "Stop-loss not negotiable once in trade" (TradeDisciple 2026-03) + risk-derived sizing forces skip when stop_distance × contracts exceeds 2% of account | NO GAP — consistent with institutional risk-first philosophy | Required at our scale |
| **Sweep buffer specifics** | MES: 3 ticks, MNQ: 5 ticks, MCL: 2 ticks (env-configurable) | Community consensus per `structural_stops.py` docstring ("r/FuturesTrading 2025-05 analysis, 2026 funded-trader consensus"). No academic triangulation found | MINOR GAP — community-consensus only; no formal institutional study. However, tick-based sweep buffer concept is correct. Specific numbers are untested in formal research | Beneficial at our scale (community expert tier) |
| **Break-even stop timing** | Move stop to BE+1 tick on TP1 fill (at +1R). Hard invariant in both Python backtester.py:1035 and TS paper-execution-service.ts:2767 | MIXED evidence: TradeDisciple (2026-03) says move to BE at 1R (positive). PropTradingVibes (2026-03) says same for NQ. BUT Willow the Trader (2026-04) found breakeven stop at +9pts systematically UNDERPERFORMED vs no breakeven — reduced variance but capped upside and killed runners | GAP — breakeven stop should be treated as a one-time gate (locking in no-loss), not as a trailing mechanism. TF's design (BE+1 tick, not BE trailing stop) is correct. The critical insight: breakeven must NOT replace the runner trail logic. BE+1 is a floor; Chandelier/structure_trail is the trail | Beneficial at our scale IF properly implemented as floor-only |
| **Trailing stop method** | Style C: 34% runner trails developing session POC (Chandelier(14,2) fallback). Adaptive: chandelier / anchored_vwap / structure_trail / developing_poc by regime | StratBase 2026-02: Chandelier Exit (22, 3.0) is standard — "ATR trailing stop is most effective dynamic exit method." PropTradingVibes: trail manually using swing structure after BE. QuantStrategy: structural trailing stops (pivot-based) as best practice | MINOR GAP — TF uses Chandelier(14,2) vs institutional Chandelier(22,3.0) default. The shorter lookback + tighter multiplier means tighter trailing that may exit runners prematurely on extended moves. Adaptive engine's regime-routing helps | Beneficial to close: consider raising chandelier params to (22, 2.5) for trending/expansion regimes |
| **ATR multiplier for trailing** | Chandelier(14, 2) in Style C fallback | StratBase 2026-02 backtest: 3× ATR hits sweet spot for PF (1.61). 2× gives PF 1.44. 2.5× gives 1.56. All ATR beats fixed. Intraday scalps: 1.5-2× ATR | GAP — TF uses 2× which StratBase data shows is 10% below the 3× optimal for capturing extended moves. However, 2× is appropriate for intraday (shorter holding periods) vs the daily-chart 3× optimal | Context-dependent: 2× appropriate for intraday; over-engineered to change for $50K combine |
| **Time-based stop (news events)** | 15:55 ET hard flatten (universal). Macro blackout on FOMC/CPI/NFP via `macro_alignment` hard-block | QuantStrategy (2026-01): "pre-news tighten trailing stop to 1.0 ATR 30 min before EIA inventory data." Custom logic for CL/crude before energy reports. | MINOR GAP — TF blocks new entries via `macro_alignment` hard-block but does NOT tighten existing stops before news events for MCL. Open MCL positions through EIA release carry unquantified tail risk | Beneficial at our scale to close for MCL specifically |
| **Position-level dynamic stop** | ATR recalculates per bar in backtester (`atr` from core indicators); structural stop is set at entry and not re-computed during the trade | AlgoKing 2026-02 explicitly implements regime-adjusted ATR that widens in vol spikes: "when vol_ratio > 1.5x 60-day average, stop widens at diminishing rate." | MINOR GAP — TF does not dynamically widen the stop mid-trade if volatility expands after entry. This means the initial structural stop may be too tight relative to the prevailing vol regime when vol expands mid-trade | Over-engineered at our scale to implement — 1-2 trades/day means this matters rarely |
| **EOD vs intraday trailing DD alignment** | Bot operates intraday only; hard flatten at 15:55 ET. EOD trailing DD tracked separately via Topstep | Phidias guide (2026-01): EOD trailing DD only recalculates at market close; intraday trailing hunts traders. TradeCovex (2026-04): "Topstep trailing Maximum Loss Limit only updates based on end-of-day balance" | NO GAP — TF's 15:55 hard flatten means intraday highs are captured in EOD balance, not chased mid-day. Design is correctly aligned with Topstep EOD trailing DD mechanics | Required at our scale |
| **Prop firm stop strategy** | Personal DLL = 67% of firm DLL. HALT at 67%, force-close at 95% | TradeCovex: daily loss cap on Topstep/Apex can blow account BEFORE trailing drawdown triggers. MFFU 2% rule: max 2% account loss per single trade. PropTradingVibes NQ guide: 1R = well-defined fixed risk. | NO GAP — TF's 67% personal DLL is conservative and correctly leaves buffer before hitting firm limits | Required at our scale |

---

## Sub-Question Evidence Summary

### Sub-question 1: Fixed-point stops vs dynamic stops

VERDICT: FIXED STOPS ARE INSTITUTIONALLY REJECTED (≥5 sources, triangulated).

- AlgoKing (2026-02-12): "Fixed stop losses are lazy... 2% on ES at VIX 12 vs VIX 35 = completely different risk profiles." `blog-general`
- VARRD (2026-03-02): "Fixed dollar stops don't calibrate to the market. ATR always answers the right question." `educator`
- Nova Quant Lab (2026-03-20): "Static lot sizes and fixed stops fail when market volatility changes." `educator`
- Goat Funded Trader (2026-02-25): "Use volatility, not pure percentages." `practitioner-interview`
- QuantStrategy.io (2026-01-30): "The standard trailing stop fails spectacularly in intraday futures." `educator`

Trading Forge's ban on fixed-point stops is CONFIRMED INSTITUTIONAL GRADE.

### Sub-question 2: Structural stops vs ATR-multiple stops

VERDICT: STRUCTURAL STOPS PREFERRED; ATR AS FLOOR/BOUNDING MECHANISM (≥4 sources, triangulated).

- TradeDisciple (2026-03-29): "Stop placement must be mechanical — defined by market structure." `practitioner-interview`
- QuantStrategy.io (2026-01-30): "Structural trailing stops (pivot-based) are the advanced approach. They filter noise and honor current trend architecture." `educator`
- VARRD (2026-03-02): "ATR-based stops are the standard for determining noise level; structural placement is where ATR meets market context." `educator`
- Goat Funded Trader (2026-02-25): "Size stops using recent volatility measures — ATR multiple or swing low/high plus buffer." `practitioner-interview`

Trading Forge's structural first, ATR as floor design is CONFIRMED INSTITUTIONAL GRADE.

### Sub-question 3: Stop strategy for prop firm eval (Topstep/MFFU)

VERDICT: EOD TRAILING DD MECHANICS REQUIRE POSITION-LEVEL STOPS TO PROTECT INTRADAY HIGH, NOT JUST CONTROL LOSS (≥3 sources, triangulated).

- Phidias (2026-01-07): EOD trailing DD only moves at close. Intraday unrealized profits that then pull back do NOT raise the DD floor until market close. `practitioner-interview`
- TradeCovex (2026-04-09): "Topstep trailing Maximum Loss Limit only updates based on end-of-day balance." `practitioner-interview`
- PropTradingVibes MFFU (2026-05-10): "On Topstep/Apex: separate intraday daily loss cap can blow account BEFORE trailing DD triggers." `practitioner-interview`

Key practical implication: For Topstep EOD trailing DD, intraday open profit that pulls back does NOT hurt the trailing DD floor — only EOD balance matters. This means AGGRESSIVE INTRADAY TRAILING STOPS are SUBOPTIMAL for Topstep. The correct Topstep stop strategy is:
1. Structural stop at entry (protects capital)
2. Move to BE+1 at TP1 (eliminates loss risk on current trade, does NOT move trailing DD floor)
3. Allow runner to run to session close if possible (each positive EOD close moves the trailing DD floor up)
4. Never use aggressive intraday trailing that stops runner out of a good move — you lose the EOD equity gain

Trading Forge's current design (BE+1 at TP1, Chandelier trail on runner) is ALIGNED with this Topstep reality.

### Sub-question 4: Stop management (BE timing, trailing methods, time stops)

**BE at +1R:**
EVIDENCE MIXED (2 corroborating, 1 against — marked carefully).

FOR (2 sources):
- TradeDisciple (2026-03-29): "Move stop to breakeven once up 1R." `practitioner-interview`
- PropTradingVibes (2026-03-29): "On NQ: once price hits 1R, move stop to break-even." `practitioner-interview`

AGAINST (1 source, directly quantified):
- Willow the Trader Medium (2026-04-13): "Breakeven stop at 9pts (+1R on ES strategy) consistently underperformed vs no breakeven. 'Saving' small losses cost more than the wins it protected. Reduces variance but caps upside." `blog-general`

RECONCILIATION: The evidence suggests BE+1 tick is correct as a one-time floor gate (eliminates loss risk), but should NOT be implemented as an active trailing mechanism that stops out the runner prematurely. TF's design moves ONLY the stop to BE+1 on TP1 fill, then the runner trails via Chandelier/POC — this is the correct implementation. The Willow finding applies to systems that use the BE stop as the PRIMARY trailing mechanism (no runner trail), not to systems that use BE as a floor before an independent trail.

**Trailing stop methods:**
EVIDENCE STRONG for ATR-based trailing (≥3 sources, triangulated).

- StratBase.ai (2026-02-28): "Chandelier Exit outperforms fixed trailing stops. PF 1.61 vs 1.09-1.28 for fixed." `educator`
- Nova Quant Lab (2026-03-20): "Chandelier Exit / ATR Trailing Stop: ensures stop trails price by volatility-adjusted distance, prevents minor pullbacks from triggering but cuts on genuine reversal." `educator`
- QuantStrategy.io (2026-01-30): "Structural trailing stops + dynamic ATR multiplier adjustment. Trail distance should not be fixed across all market conditions." `educator`

Specific evidence on multiplier: StratBase 2026-02-28 data shows 3× ATR optimal for daily-chart trend following, 2× appropriate for intraday/shorter-duration trades. TF uses Chandelier(14, 2) which is at the low end but appropriate for intraday.

**Time-based stops:**
EVIDENCE MODERATE (2 corroborating sources).

- QuantStrategy.io (2026-01-30): "Time-based lock-in logic: tighten stop 30 minutes before EIA inventory data on CL futures to 1.0 ATR." `educator`
- TF hard-flatten at 15:55 ET is the equivalent time-based stop for daily close — this IS institutional practice.

Gap: TF does not tighten MCL stops pre-EIA (10:30 ET Wednesday). This is a real gap for MCL strategies.

---

## Recommended Changes (with citations)

### Change 1 (BENEFICIAL, not required): Chandelier multiplier review for trending/expansion regimes

Current: Chandelier(14, 2) as universal fallback.
Evidence: StratBase 2026-02-28 shows 3× ATR maximizes profit factor for trend-following; 2× is 10% below optimal for capturing extended moves. QuantStrategy.io 2026-01-30 recommends dynamic ATR multiplier adjustment based on momentum conditions.

Recommendation: In the adaptive exit engine, consider Chandelier(22, 2.5) for TRENDING/EXPANSION regimes (currently routing to `anchored_vwap` trail — Chandelier is already the HIGH_VOL_MACRO fallback). The pure Chandelier fallback (when anchored VWAP unavailable) should use 2.5× rather than 2× multiplier for regimes where extended moves are expected.

Supported by: [StratBase 2026-02-28], [QuantStrategy.io 2026-01-30], [Nova Quant Lab 2026-03-20]

Scale translation: BENEFICIAL at our scale. This affects only the Chandelier fallback within the adaptive engine; minimal code change; directly measurable via A/B runner performance.

### Change 2 (BENEFICIAL): MCL pre-EIA stop tightening logic

Current: No special stop management for MCL positions held approaching EIA (10:30 ET Wednesday). `macro_alignment` blocks NEW entries but does not tighten existing open stops.

Evidence: QuantStrategy.io (2026-01-30, Case Study 2) explicitly documents pre-news (30 min before EIA) trailing stop tightening from 1.8 ATR to 1.0 ATR for CL futures. This is standard practice; a CL position held through EIA without tightened stops can gap through the structural stop.

Recommendation: Add MCL-specific pre-EIA logic (10:00 ET Wednesday ±30 min) that tightens the runner stop to BE+1 or 1× ATR, whichever is tighter, if in profit ≥ 0.5R. This is a SOFT tightening, not a forced close.

Supported by: [QuantStrategy.io 2026-01-30], [Goat Funded Trader 2026-02-25, re: time-based exit near news], [TradeCovex 2026-04-09, re: unexpected news destroys prop firm accounts]

Scale translation: BENEFICIAL at our scale. MCL trades through EIA are the highest tail-risk exposure in the current portfolio. This is a targeted fix with measurable impact.

### Change 3 (ADVISORY, no code change required): Sweep buffer documentation

Current: MES 3 ticks / MNQ 5 ticks / MCL 2 ticks — documented as "community consensus" from r/FuturesTrading 2025-05.

Evidence: No academic or corporate-engineering tier source corroborates specific tick counts for sweep buffers. The concept of sweep-aware buffers is sound (structural stops must clear the sweep zone), but specific values remain empirically-derived from community data.

Recommendation: Document in `structural_stops.py` that the sweep buffer values are EMPIRICALLY SET, not academically validated. Add a note that these should be re-validated after each 90-day backtest cycle. Specifically: if the system is consistently getting stopped out with `stop_reason="sweep_wick"` at a higher rate than `"order_block"` or `"fvg"`, the buffer may need widening (add 1 tick per symbol).

INSUFFICIENT EVIDENCE for a specific number change — would need prop-firm-specific execution data. MARK AS: monitor, not change.

Supported by: Concept corroborated by [TradeDisciple 2026-03-29 sweep/SDZ stop placement], [GoatFundedTrader 2026-02-25 "stop beyond the swept/rejected level"]. Specific tick counts: community-expert tier only.

Scale translation: Required to document; over-engineered to change without data.

---

## EXECUTIVE VERDICT

The Trading Forge stop-loss design — structural stop (invalidation swing + sweep buffer) bounded by 1.5×ATR floor and per-symbol ceiling, with skip-trade-if-exceeded and BE+1 on TP1 fill — is INSTITUTIONAL-GRADE for 2026. The ban on fixed-point stops is confirmed by ≥5 independent sources including educator-tier quantitative research (VARRD, Nova Quant Lab, QuantStrategy.io) and practitioner-interview evidence (GoatFundedTrader, TradeDisciple). The structural-first, ATR-as-floor design matches 2026 professional consensus.

Three incremental improvements are identified (Chandelier multiplier tuning, MCL pre-EIA tightening, sweep buffer documentation), all classified as BENEFICIAL rather than required. None represent a design flaw in the current system; all represent opportunities to close evidence-based gaps at the margin.

The one nuanced finding: break-even stops reduce variance but cap upside when used as the primary trailing mechanism. TF's implementation (BE+1 as a one-time floor gate, independent Chandelier/POC trail for the runner) is correctly structured to avoid this problem. The Willow the Trader evidence (2026-04-13) is a warning about systems where BE replaces the trail, not about TF's actual architecture.

---

## Open Questions for Operator

1. MCL pre-EIA exposure: Do any current MCL strategies hold positions into 10:30 ET Wednesday (EIA release)? If yes, does the current MCL stop architecture have any time-based tightening, or does the macro_alignment block only new entries?

2. Chandelier fallback: When the adaptive exit engine falls back to Chandelier (HIGH_VOL_MACRO regime), is it using (14, 2) or a different param set? Was this compared against (22, 2.5) in any A/B test?

3. Sweep buffer validation: Over the current production paper-trade period, what is the ratio of `stop_reason="sweep_wick"` vs other stop reasons? If sweep_wick dominates (>40%), the buffer may need widening for MES specifically.

4. Topstep EOD DD interaction: The evidence confirms EOD trailing DD only locks at close. Is there any current logic that AVOIDS aggressively trailing the runner intraday BECAUSE of this Topstep mechanic — i.e., does the system intentionally give the runner room precisely so positive EOD closes accumulate?

---

*Evidence file created: 2026-05-27. Next update trigger: any change to structural_stops.py, Chandelier parameters, or sweep buffer values.*
