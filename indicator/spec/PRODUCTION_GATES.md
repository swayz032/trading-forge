# Production Gates

The indicator is not "edge-worthy" until all applicable gates pass.

## Gate A — semantic exactness
- Every rule in V1_RULEBOOK maps to a named function/state transition.
- No live decision uses prose-only concepts such as "strong", "close", "big", "good", or "important".
- Remaining human terms are listed in AMBIGUITY_REGISTER.md with owner and calibration method.
- Same input + same config => same output.

## Gate B — state-machine safety
- One input event can advance at most one momentum stage.
- Repeated equal price cannot manufacture a push.
- Hard recoil cannot reuse stale momentum.
- New 5m bar resets the live chain and promotes the just-finished bar's extreme to reference.
- Symbol/contract changes clear live state.
- Malformed, duplicate, and out-of-order data fail closed.
- Serialize/restore produces an identical continuation.

## Gate C — no future leak / repaint discipline
- Higher-timeframe swing points become eligible only after their confirmation bars exist.
- Daily/Weekly levels use completed native candles only.
- Historical tests never infer an unknown intrabar path from 5m OHLC.
- Realtime-only state is explicitly marked realtime-only.
- Pine live/reload differences are recorded and classified.

## Gate D — cross-implementation parity
Golden market fixtures must produce the same reason-coded transitions in:
1. Python reference engine
2. TradingView Pine v6 implementation
3. FX Replay implementation

No tolerance is allowed for state identity. Price-value tolerance, if required by platform feed precision, must be explicit and tick-bounded.

## Gate E — mutation coverage
Each prohibited behavior must be deliberately planted and must cause at least one test failure:
- nearest-wick auto-selection
- trendline-break bias flip
- multi-stage single-tick advance
- failed Candle-3 reset
- far-wick TP
- future-leaking swing
- silent missing-data fallback

If a mutation survives, testing is insufficient.

## Gate F — real-market edge validation
Requires real NQ/MNQ lower-timeframe history.

Minimum evidence:
- chronological train/validation/test separation
- walk-forward evaluation
- multiple volatility/trend/chop/reversal regimes
- 69-tick stop-first vs target-first outcome analysis
- MAE/MFE distribution
- conservative-TP penetration analysis
- candidate-level false-break analysis
- sensitivity surfaces (stable plateau, not one magic parameter)
- ablation tests
- bootstrap / Monte Carlo of trade sequence
- transaction-cost/slippage sensitivity
- live shadow / forward test before any live reliance

## Gate G — operational fail-safe
- stale or delayed feed is visible in UI
- platform/session mismatch is visible
- no-signal state is first-class
- reason codes accompany every armed/rejected/ready state
- resource limits do not silently drop required calculations
- contract roll behavior is explicit

## Release labels
- `PROTOTYPE`: reference semantics under active change
- `ENGINEERING_PASS`: deterministic software gates A-E pass
- `RESEARCH_PASS`: real-market Gate F passes out-of-sample
- `SHADOW_PASS`: live shadow parity and operational Gate G pass
- `LIVE_DECISION_SUPPORT`: only after all prior labels; still not a guarantee of profit
