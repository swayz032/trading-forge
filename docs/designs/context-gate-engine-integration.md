# Context-Gate → Engine Integration (Phase 3A wiring)

> **Status:** Part 1 SHIPPED (signal-time evaluator + harness). Part 2 = the cross-language engine attach
> (follow-on; engine is pre-live by design). Closes the operator's Option-B gap: "extraction grades high
> in static analysis, but compiled-extraction → real-signal-firing is unvalidated."

## 1. The two halves of trade validity

```
trade_valid = evaluateContextGates(context_gates, marketState).allowed   // WHERE (3A)
            AND primary_confirmation_leg_fires                           // WHEN (2A/2B)
```
The WHERE half is now a pure function (`evaluateContextGates`) + a passing harness proving it changes
firing (zone bounds in/out, POI distance, session execution, fail-closed, formation-not-an-entry-gate).

## 2. Current wiring reality (honest)

The fidelity compiler (`confirmation-compiler.ts` + `context-gate.ts`) is a **standalone extraction-fidelity
subsystem**. It is NOT yet consumed by the production signal path (`paper-signal-service.ts` Path-C
confluence) or the Python backtester. So Phase 3A is, today: **represented + evaluatable + harness-validated
in isolation** — not yet affecting live signals. That's the gap Part 2 closes.

## 3. The contract (extraction → strategy config → engine)

Compiled output attaches to the strategy config the engine already reads:
```
entry_quality: {
  confirmation: CompoundConfirmation,   // legs[], primary_order, enforcement (2A/2B)
  context_gates: ContextGate[],         // WHERE gates (3A); required entry gates gate the signal
}
```
- Set by the graduator when it persists a fidelity-compiled strategy (the place `entry_quality` is built today).
- Backward-compat: strategies without `context_gates` evaluate exactly as now (empty → `allowed=true`).

## 4. Signal-time hook (where to call it)

Two call sites, mirroring the existing two-engine pattern (TS canonical + Python mirror, parity-tested
like the adaptive exit engine):

| engine | call site | builds GateMarketState from |
|---|---|---|
| **TS live/paper** | `paper-signal-service.ts` before a trade fires (alongside Path-C) | killzone helper (session), bias_state / liquidity_levels (POI distance), structure/box (range_position), institutional_regime |
| **Python backtest** | `backtester.py` entry-eligibility, before `np.roll` fill | bar price vs anchor range, ATR distance to levels, session-of-bar, regime column |

`GateMarketState` (the evaluator input):
- `range_position` — price as a fraction [0,1] of the gate's anchor range (zone gates). For `htf_box`:
  `(price − box_low) / (box_high − box_low)`.
- `level_distance_atr` — `|price − level| / ATR` per named POI (asia_low, pdh, …) from `liquidity_levels`.
- `session_region` — current killzone region (reuse `killzone.ts`).
- `regime` — current `institutional_regime`.

## 5. Fail-closed semantics (carried into the engine)

A REQUIRED entry gate with no market-state input → BLOCK (`unevaluable` → not allowed). Rationale: a
missing zone/POI check OVER-fires (the iU8 lesson). Only `target`/`stop_anchor` levels and `formation`
sessions are excluded from entry gating (the 2D payoff — O9cz checks LONDON execution, not ASIA formation).

## 6. What's validated vs what remains

- ✅ **Validated now (Part 1):** the pure evaluator + AND-aggregator + harness (`context-gate-integration.test.ts`)
  prove gates change firing across zone/POI/session/regime, fail-closed, and formation-exclusion.
- ⏳ **Remaining (Part 2):** (a) graduator emits `entry_quality.context_gates`; (b) TS signal-path hook +
  GateMarketState builder; (c) Python `evaluate_context_gates()` mirror + parity test (5 fixtures, like
  `check:ts-python-exit-parity`); (d) a real backtest-replay showing a gated strategy fires fewer/no
  out-of-zone trades vs ungated (the true "doesn't misfire in replay" proof — needs the engine run, which
  is pre-live by design).

## 7. Why Part 1 first was right

It de-risks the integration logic deterministically (no engine run needed) and pins the contract before
the cross-language work. Part 2 is mechanical wiring against a fixed, tested contract — not new design.
After Part 2, the WHERE axis is live; then Phase 3B (confirmation-strength) closes the last frozen-6 PARTIAL (2u9).
