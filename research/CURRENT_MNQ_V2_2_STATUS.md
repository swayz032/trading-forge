# Current MNQ Strategy v2.2 — Execution Status Receipt

Status: **RESEARCH / VALIDATION BLOCKED — NOT LIVE APPROVED**
Branch: `research/current-mnq-strategy-v2-2-robustness`

## What is now implemented

- Frozen 40-finding v2.2 repair charter was written before v2.2 P&L.
- Correct breakout polarity:
  - REV long = support rejection
  - REV short = resistance rejection
  - BRK long = resistance failure/acceptance
  - BRK short = support failure/acceptance
- Weak breakout confirmation is bound to a NEW 15m close after the specific attempt.
- Zone existence, quality and confluence are separate gates; touch count no longer automatically passes A+ location.
- Counter-bias reversal permission uses actual completed control-story state.
- Blockers and destinations are separate; a nearby strong blocker cannot be silently discarded because it is too close to be a TP.
- All executable prices are normalized to MNQ 0.25 ticks.
- Zone lifecycle includes rejection, breach, durable acceptance, failed-breakout reclaim and role-flip semantics.
- Repeated-wick S/R uses an interpretable quality vector instead of a magic touch-count winner.
- Premarket state is represented as a plan object with structure/location/overnight context rather than only a direction color.
- Partial FVG mitigation and overlapping-FVG consolidation are implemented.
- 60-calendar-day warmup is mandatory before scoring a trade.
- Data hashes/row counts/timestamp coverage are pinned; hash mismatch refuses.
- 1m→5m parity/data-quality gate is mandatory.
- ProjectX history adapter understands unit 1 as SECOND, respects the 20,000-bar response cap with safe chunking, and refuses saturated responses.
- CME-style quarterly MNQ contract resolver maps each session to an explicit H/M/U/Z contract under the frozen roll policy.
- Persistent one-trade lock, restart reconciliation, stale-feed/size/loss/slippage/contract kill switches, emergency disable, and live-order refusal are implemented.
- Fail-closed ProjectX REST broker adapter performs active-account/contract checks, position/order reconciliation, unique custom tags and server-side stop/target brackets; live use still requires credentials + healthy realtime user/market hubs.
- Heavy contaminated-development P&L workflows are now manual-only so architecture changes cannot accidentally keep rerunning and influencing rule selection.

## Architecture verification

Final architecture workflow run: `32073712540`
Result: **21 passed / 0 failed**.

The passing suite covers:
- contract roll mapping/provenance refusal;
- coverage-safe ProjectX history behavior;
- broker preflight/refusal/bracket/one-trade behavior;
- gold-set failed-breakout lifecycle;
- execution-bounded MAE logic;
- final engine composition.

## Data lock made before first v2.2 P&L

Pinned upstream commit: `60abd3fb6369c6ce0b6a4a65b0f2562fc96b1264`

- 5m SHA256: `1e42bc9a8a682c19e7cd460ab003b522b8643bda23b70e5f8235633d1ccf08f4`
- 1m SHA256: `129623f45308a98a1a345473ac5fe4d03d5d53f7dd177a608d946eb3d3d6ea99`
- upstream file called `tick` SHA256: `0db60ca733f6d47c69230485b0ecb0d3f250c50e19f762fcd544d22fbb30a244` (later disqualified for execution validation; see below)

## Frozen-family development smoke test

This is **not strategy certification**. It used the pinned generic M26 source and only 17 sessions survived the required 60-day warmup.

Base smoke test:
- 17 scoreable sessions: 2026-03-23 through 2026-04-15
- 4 trades
- win rate 25%
- net P&L **-$755.70**
- Profit Factor **0.5364**
- 1 long / 3 short
- median target distance **44.25 MNQ points**
- average target distance **43.94 points**

Finite parameter family (BASE + 24 predeclared LHS perturbations):
- 25 total versions
- 3 profitable / 25
- 0 versions positive in at least 3 of 4 chronological folds
- median net **-$1,395.60**
- worst **-$3,259.80**
- best **+$343.50**
- median PF **0.4161**

This family **failed robustness** on this tiny engineering sample. No best variant was promoted and no parameter was changed to rescue the result.

Exact BASE repeat produced byte-identical evidence files, including the ledger, so the smoke-test result is deterministic.

## Why that smoke-test P&L is not a verdict on the user's strategy

The upstream generic MNQ files were sourced as M26. Under the frozen roll policy, sessions before the March 16, 2026 roll belong to H26 for then-lead-contract research. The required 60-day warmup therefore uses the wrong contract for part of the zone/premarket history. The smoke test is useful for engineering behavior but is not clean market evidence.

In addition, the user gold set exposed a failed-breakout/reclaim lifecycle correction after that smoke-test run. That correction was derived from the user's chart semantics, not P&L, and the contaminated smoke-test period has deliberately NOT been rerun to choose/tune rules.

## Upstream `tick` file disqualified

Diagnostic result:
- the file is actually ProjectX unit-1 **one-second bars**, not true tick-by-tick quotes/trades;
- 528,939 rows aggregated to 9,838 one-minute buckets;
- only **95.6287%** exact OHLC parity against the pinned 1m stream;
- max close difference **221.75 points**;
- **0 rows** existed inside each of the four base trade windows.

Therefore it cannot be used as execution-order certification. v2.2 now has a coverage-safe ProjectX second/minute retriever that chunks requests below the API cap and refuses saturation.

## Trader-fidelity gold set

Private chart/video bytes are not stored in the public repository. A hashed semantic manifest is stored instead.

Current accepted gold examples include:
- strong bullish 5m breakout;
- bearish control shift/reversal;
- major 15m zone failure/continuation;
- upper S/R rejection and seller takeover;
- failed upper breakout/reclaim followed by bearish control transfer.

Still missing: immutable **tempting NO-TRADE examples** from the user. These are required before A+ selectivity can be considered fidelity-complete.

## Remaining hard blockers before live approval

1. Acquire roll-correct then-active-contract MNQ intraday history across multiple years, with each session tied to an explicit H/M/U/Z contract.
2. Freeze final v2.2 semantics and run genuinely unseen multi-year OOS/walk-forward data. Do not rescue failed OOS by changing rules.
3. Add immutable user-labeled NO-TRADE gold fixtures.
4. Validate execution with complete one-second/realtime trade+quote evidence; historical one-second OHLC alone cannot model bid/ask queue perfectly.
5. Run realistic Topstep risk/latency/slippage/shadow simulations using corrected execution-bounded MAE.
6. Connect/validate ProjectX credentials and realtime user/market hubs in a paper/shadow account before live submission is even armed.
7. Require a paper/shadow period with zero strategy-rule changes before any small live rollout.

## Promotion rule

**DO NOT PROMOTE TO LIVE MONEY.**

The next performance run must use roll-correct/new data. The purpose is to find out whether the corrected computer translation has an edge, not to make the backtest green.
