# Edge Validation Research Plan

Purpose: determine whether the indicator concepts add measurable out-of-sample edge instead of merely reproducing attractive historical charts.

No experiment may use the final holdout to choose thresholds. Thresholds/weights are learned only on the allowed calibration windows, then frozen.

## 1. Data contract

Required minimum:
- NQ/MNQ 5-minute execution bars
- lower-timeframe ordering inside each 5-minute bar, preferably tick or 1-second data
- stable contract/roll identifier
- timestamps normalized consistently while preserving platform-native Daily/Weekly candles for PDH/PDL/PWH/PWL parity tests
- explicit commissions/slippage assumptions

Historical 5-minute OHLC alone is insufficient for proving the live Push-1/Push-2 sequence.

## 2. Reaction-zone validity experiment

Question: do coded `REACTION_ZONE`s actually predict a higher probability/magnitude of reaction than comparable non-zone prices?

For every first revisit to a zone, record:
- approach direction and speed
- zone timeframe and age
- reaction count and confluence
- penetration depth
- maximum adverse/favorable move after first touch
- reverse vs pause/pullback-then-continue outcome

Control group:
- matched non-zone price locations with similar time-of-day, volatility, distance traveled, and trend context

Required analysis:
- reaction probability uplift vs controls
- confidence intervals / bootstrap
- effect by zone age, timeframe, prior reaction count, and approach speed
- no claim that a historical zone contains current resting orders unless order-book evidence independently supports it

## 3. Yellow anti-fakeout proof-level experiment

Compare candidate policies on the exact same market episodes:
A. nearest eligible wick
B. structurally meaningful proof level with minimum distance
C. Goldilocks selector: reject too-close and too-far candidates

Measure:
- percentage of candidates reached
- false-break/reclaim rate after crossing
- 69-tick stop-first rate after momentum entry
- missed-move rate because proof was too far
- MAE/MFE
- expectancy after costs

The winning policy must improve a stable neighborhood of parameters, not a single exact threshold.

## 4. Momentum confirmation experiment

Compare entries from the same armed setup:
- proof-level cross only
- reference break
- Push 1
- Push 2 / `ENTRY_READY`

Measure the tradeoff between:
- lower false-entry/stop-out rate
- later/worse entry price
- lost MFE from waiting
- realized target reach
- net expectancy and drawdown

Feature ablations:
- displacement distance
- elapsed time/speed
- recoil percentage
- wick growth
- hold near extreme
- body/range dominance
- push acceleration/deceleration
- optional volume/footprint evidence

Any feature with no stable out-of-sample incremental value is removed.

## 5. Candle-2 vs Candle-3 reset experiment

When Candle 2 fails to qualify, compare:
- force entry anyway
- abandon setup permanently
- current rule: promote Candle 2 extreme and restart on Candle 3

Measure stop-first rate, opportunity loss, MFE, and expectancy. This directly tests the user's reset logic rather than assuming it helps.

## 6. Conservative TP experiment

For every qualified target reaction zone, evaluate penetration targets from near edge toward far extreme.

Compare:
- exact far wick/extreme
- fixed-tick front-run
- normalized-volatility front-run
- reaction-zone penetration fractions

Measure:
- fill probability before meaningful reversal
- average profit captured
- profit left on table
- reversal-before-target frequency
- target robustness across zone width and volatility regimes

The production fraction/rule must come from a broad stability plateau, not an arbitrary 50% midpoint.

## 7. Context-sensitive target experiment

Test the rule:
- weak move -> nearest valid zone
- strong with-trend move -> may skip a very close minor zone
- countertrend move -> prefer nearest conservative zone

Use identical setup episodes and compare against always-nearest and always-next-major baselines.

## 8. Trend-context experiment

The red trendline is direction context only. It cannot directly flip intraday bias.

Test whether overall-direction context improves results by comparing:
- no trend context
- user trend context + yellow proof rule
- any proposed future automated trend model

A trendline break by itself is never used as the bullish/bearish intraday label in V1.

## 9. Statistical robustness

Required:
- chronological train/validation/test split
- rolling walk-forward tests
- trend/chop/high-vol/low-vol/reversal regime slices
- sensitivity surfaces for every calibrated threshold
- bootstrap confidence intervals
- Monte Carlo trade-sequence stress
- multiple-testing/selection-bias controls where applicable
- parameter-neighborhood stability
- transaction-cost and slippage stress
- separate NQ and MNQ checks when data permits

## 10. Live shadow gate

Before any live decision-support label:
- run realtime without sending orders
- record every candidate, rejection reason, transition, and target
- compare live state to post-session/reloaded state
- compare Python reference vs Pine vs FXR reason codes on shared fixtures
- investigate every discrepancy; do not average them away

## 11. Pre-registration rule

Before opening the final holdout period, freeze:
- feature set
- thresholds/weights
- pass/fail metrics
- transaction cost assumptions
- stop definition (including the 69-tick research outcome when applicable)
- target semantics

If the holdout fails, return to research with a new version and a new untouched holdout. Never tune on the failed holdout and still call it out-of-sample.
