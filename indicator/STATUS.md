# Indicator Verification Status

As of 2026-08-09.

## Current classification

- Software stage: `PROTOTYPE`
- Deterministic reference architecture: active
- Market edge: **NOT YET PROVEN**
- Live-decision-support approval: **NOT GRANTED**

## Executed local verification

Latest full local discovery run:

- **42 / 42 tests PASS**
- no failures

Coverage includes:
- 5-minute live momentum state sequence
- one-event/one-stage invariant
- hard-recoil reset
- Candle-2 -> Candle-3 reference promotion/reset
- duplicate/out-of-order/malformed input fail-closed behavior
- snapshot/restart determinism
- symbol/contract reset
- 20,000 mirrored LONG/SHORT property cases
- 50,000 randomized entry-chain cases
- anti-fakeout proof-level selection
- too-close and too-far candidate rejection
- countertrend requires stronger structure than with-trend
- deterministic candidate ordering / tie-breaking
- conservative near-side target placement
- context-sensitive close-pool vs next-pool targeting
- confirmed swing no-future-leak behavior
- equal-high/equal-low ambiguity rejection
- deterministic reaction-cluster construction
- single wick is not automatically labeled a reaction pool
- candle geometry invariants
- explicit parameterized doji detection
- direction-normalized wick-rejection and hold features
- explicit recoil fraction, speed, and push-acceleration measurements

Previously executed torture runs retained as evidence baseline:
- 250,000 randomized intrabar paths: 0 entry-invariant failures
- 20,000 mirrored paths: 0 symmetry failures
- 5,000 random restart cuts: 0 mismatches
- 1,000,000-update load run completed

## What is now made non-ambiguous in code

Human visual terms are separated into explicit measurements:
- `REACTION_ZONE` (UI may say Liquidity Pool)
- `PROOF_LEVEL` (yellow)
- `OVERALL_DIRECTION` (red trendline context only)
- confirmed swings with explicit confirmation time
- candle body fraction
- upper/lower wick fractions
- close location
- push distance
- push speed
- recoil fraction
- hold near favorable extreme
- push acceleration/deceleration ratio

## Still calibration-required — no hidden production defaults allowed

- reaction-zone merge distance / width
- swing-window parameters and structural strength
- Goldilocks proof-level distance range
- calibrated proof-level `selection_score`
- Push-2 quality thresholds / weights
- doji veto threshold
- conservative target penetration fraction
- definition of a close minor pool vs skippable pool
- big-displacement/intermediate-zone rule

## Real-market evidence still required

Real NQ/MNQ tick or 1-second intrabar history is required before edge claims. Required gates include:
- reaction-zone revisit vs matched non-zone controls
- nearest-wick vs structural-proof vs Goldilocks proof selector
- cross-only vs BREAK vs PUSH_1 vs PUSH_2 entry comparison
- Candle-2 failure / Candle-3 reset experiment
- 69-tick stop-first vs target-first analysis
- MAE/MFE
- conservative TP penetration study
- regime slicing
- walk-forward / untouched holdout
- sensitivity plateaus
- ablation tests
- bootstrap / Monte Carlo
- commission/slippage stress
- TradingView Pine vs Python parity
- FX Replay vs Python parity
- live shadow / reload parity

No synthetic P&L will be used to claim market edge.
