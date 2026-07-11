/**
 * STATE-MACHINE RUNTIME — Checkpoint 3 (the FIRST execution change).
 *
 * Executes a StrategyIR over a bar stream: the machine can now REMAIN in an active setup (S4 Waiting) instead
 * of emitting an entry on the structural event. This is the architectural hypothesis under test — does a
 * zone-return strategy reach its entry on the RETURN to the zone (not on the event), using only generic IR
 * constructs (no strategy-specific primitive)?
 *
 * CP3 ISOLATION: bars carry the engine-computed PREDICATE SIGNALS (until_satisfied / confirmation /
 * invalidation / event), NOT raw OHLC. This isolates the STATE-MACHINE LOGIC (wait → confirm → entry,
 * invalidation, expiry) from indicator math — real OHLC→signal evaluation is the later engine-attach. So any
 * divergence here is attributable to the EXECUTION MODEL, exactly the isolation the checkpoint plan requires.
 *
 * The frozen control's model (`runEventCentric`) is kept alive for the side-by-side differential.
 */

import { isZeroWait, type StrategyIR } from "./state-machine-ir.js";
import { evaluateConfirmation, type ConfirmationBarContext } from "./confirmation-evaluator.js";
import { evaluateContextGates, type GateMarketState } from "./context-gate.js";

export interface ReplayBar {
  i: number;
  event?: boolean;          // the structural event fired on this bar (what the OLD model entered on)
  until_satisfied?: boolean;// the wait predicate is met on this bar (price re-entered zone / retest / sweep / …)
  confirmation?: boolean;   // CP3 synthetic shortcut for lifecycle tests (boolean overrides the evaluator)
  confirmation_ctx?: ConfirmationBarContext; // CP4: real per-bar features → the UNIFIED confirmation evaluator
  invalidation?: boolean;   // the setup was invalidated on this bar (before entry)
}

/**
 * CP4 — the SINGLE confirmation code path. Both the immediate and the wait-state branches call this, so
 * confirmation is observationally equivalent regardless of entry-timing (the operator's acceptance #3).
 * A synthetic boolean (CP3 lifecycle tests) short-circuits identically in both paths; otherwise the real
 * unified `evaluateConfirmation` runs over the bar's features.
 */
function confirmationFired(ir: StrategyIR, bar: ReplayBar): boolean {
  if (typeof bar.confirmation === "boolean") return bar.confirmation; // synthetic shortcut (same in both paths)
  if (bar.confirmation_ctx) return evaluateConfirmation(ir.wait_state.confirmation, bar.confirmation_ctx).passed;
  return false;
}

export interface TransitionCounts { wait_created: number; confirmed: number; invalidated: number; expired: number }
export interface RunResult { entry_bar: number | null; transitions: TransitionCounts; trace: string[] }

const zeroCounts = (): TransitionCounts => ({ wait_created: 0, confirmed: 0, invalidated: 0, expired: 0 });

/** The FROZEN baseline's execution model: enter on the structural event (or first confirmation). Control. */
export function runEventCentric(bars: ReplayBar[]): RunResult {
  const t = zeroCounts();
  for (const b of bars) {
    if (b.event || b.confirmation) { t.confirmed++; return { entry_bar: b.i, transitions: t, trace: [`bar ${b.i}: event-centric entry`] }; }
  }
  return { entry_bar: null, transitions: t, trace: ["event-centric: no entry"] };
}

/** The new state-machine execution model. Zero-wait ⇒ behaves like the baseline (parity); wait ⇒ holds state.
 * `opts.gateState` feeds the eligibility PRECONDITION (context_gates, 3A) — re-rooted here as the gate that
 * decides whether a setup may be sought at all (same code for immediate + wait). */
export function runStateMachine(ir: StrategyIR, bars: ReplayBar[], opts?: { gateState?: GateMarketState }): RunResult {
  const t = zeroCounts();
  const trace: string[] = [];
  const hasInval = !!ir.wait_state.invalidated_by;
  const timeout = ir.wait_state.timeout_bars ?? Infinity;

  // PRECONDITION (eligibility / context axis) — gates BOTH paths identically. Fail-closed if a required gate fails.
  if (opts?.gateState && ir.eligibility.length) {
    const gate = evaluateContextGates(ir.eligibility, opts.gateState);
    if (!gate.allowed) { trace.push(`precondition: eligibility BLOCKED (${gate.failed.map((g) => g.name).join(",") || "unevaluable"})`); return { entry_bar: null, transitions: t, trace }; }
    trace.push("precondition: eligibility passed");
  }

  // Zero-wait degenerate = the old model: no wait created, enter on the first confirmation (the event IS it).
  if (isZeroWait(ir)) {
    for (const b of bars) {
      if (hasInval && b.invalidation) { t.invalidated++; trace.push(`bar ${b.i}: invalidated`); return { entry_bar: null, transitions: t, trace }; }
      if (confirmationFired(ir, b) || b.event) { t.confirmed++; trace.push(`bar ${b.i}: immediate entry (zero-wait)`); return { entry_bar: b.i, transitions: t, trace }; }
    }
    trace.push("zero-wait: no confirmation"); return { entry_bar: null, transitions: t, trace };
  }

  // Wait-state path: arm on the first bar, then hold until the predicate is met, THEN seek confirmation.
  t.wait_created++;
  const armBar = bars.length ? bars[0].i : 0;
  trace.push(`wait_state created @ bar ${armBar} (until=${ir.wait_state.until.kind})`);
  let satisfied = false;
  for (const b of bars) {
    if (hasInval && b.invalidation) { t.invalidated++; trace.push(`bar ${b.i}: INVALIDATED → S0`); return { entry_bar: null, transitions: t, trace }; }
    if (b.i - armBar > timeout) { t.expired++; trace.push(`bar ${b.i}: timeout (${timeout}) EXPIRED`); return { entry_bar: null, transitions: t, trace }; }
    if (!satisfied && b.until_satisfied) { satisfied = true; trace.push(`bar ${b.i}: until satisfied → S5 confirming`); }
    if (satisfied && confirmationFired(ir, b)) { t.confirmed++; trace.push(`bar ${b.i}: confirmed → S6 ENTRY`); return { entry_bar: b.i, transitions: t, trace }; }
  }
  t.expired++; trace.push("end of bars: wait unfulfilled → EXPIRED"); return { entry_bar: null, transitions: t, trace };
}

/** Transition matrix across a set of runs (operator's before/after instrumentation). */
export function aggregateTransitions(results: RunResult[]): TransitionCounts & { entries: number; no_entry: number } {
  const agg = { ...zeroCounts(), entries: 0, no_entry: 0 };
  for (const r of results) {
    agg.wait_created += r.transitions.wait_created;
    agg.confirmed += r.transitions.confirmed;
    agg.invalidated += r.transitions.invalidated;
    agg.expired += r.transitions.expired;
    if (r.entry_bar != null) agg.entries++; else agg.no_entry++;
  }
  return agg;
}
