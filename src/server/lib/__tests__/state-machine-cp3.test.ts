/**
 * Checkpoint 3 — wait-state ACTIVATION (first execution change).
 * Canonical acceptance: a zone-return strategy compiles into a wait_state via GENERIC IR constructs (no
 * strategy-specific primitive) and replay reaches entry AFTER the return to the zone. Plus: differential vs
 * the frozen event-centric control, immediate-entry parity (regression guard), and the transition matrix.
 */
import { describe, it, expect } from "vitest";
import { lowerToStateMachineIR } from "../state-machine-lowering.js";
import { runStateMachine, runEventCentric, aggregateTransitions, type ReplayBar } from "../state-machine-runtime.js";
import { isZeroWait } from "../state-machine-ir.js";

const seq = (...actions: string[]) => actions.map((action, i) => ({ step: i + 1, action }));

describe("CP3 — wait-state activation (execution model)", () => {
  it("★ CANONICAL ACCEPTANCE: zone-return compiles to a generic wait_state and replay enters ON THE RETURN, not the event", () => {
    // Lowered from a real zone-return entry_sequence — GENERIC constructs only (no zone-return primitive).
    const ir = lowerToStateMachineIR({
      entry_sequence: seq(
        "break of structure to the upside, mark the order block",
        "wait for price to come back and retest the order block",
        "enter on the bullish confirmation inside the zone",
      ),
      direction: "long",
    });
    expect(isZeroWait(ir)).toBe(false); // it WAITS via a generic wait_state — the architectural hypothesis

    // bar 0: event (BOS) — old model would enter HERE.  bars 1-2: price away.  bar 3: returns (until_satisfied)
    // + confirmation → the educator's actual entry.
    const bars: ReplayBar[] = [
      { i: 0, event: true },
      { i: 1 }, { i: 2 },
      { i: 3, until_satisfied: true, confirmation: true },
    ];
    const r = runStateMachine(ir, bars);
    expect(r.entry_bar).toBe(3);              // enters on the RETURN, not the event
    expect(r.transitions.wait_created).toBe(1);
    expect(r.transitions.confirmed).toBe(1);
  });

  it("★ DIFFERENTIAL vs frozen control: zone-return DIVERGES (event-centric enters early; state-machine waits)", () => {
    const ir = lowerToStateMachineIR({ entry_sequence: seq("break of structure", "wait for the retest", "enter on confirmation"), direction: "long" });
    const bars: ReplayBar[] = [{ i: 0, event: true }, { i: 1 }, { i: 2, until_satisfied: true, confirmation: true }];
    const baseline = runEventCentric(bars);
    const sm = runStateMachine(ir, bars);
    expect(baseline.entry_bar).toBe(0);  // OLD model enters on the event (the systematic-divergence bug)
    expect(sm.entry_bar).toBe(2);        // NEW model enters on the return — the intended fix
    expect(sm.entry_bar).not.toBe(baseline.entry_bar);
  });

  it("★ REGRESSION GUARD: immediate strategy → state-machine entry bar == event-centric entry bar (parity)", () => {
    const ir = lowerToStateMachineIR({ entry_sequence: seq("enter on a close through the opening range edge"), direction: "long" });
    expect(isZeroWait(ir)).toBe(true);
    const bars: ReplayBar[] = [{ i: 0, event: true, confirmation: true }];
    expect(runStateMachine(ir, bars).entry_bar).toBe(runEventCentric(bars).entry_bar); // both = 0
  });

  it("invalidation before return → no entry (wait invalidated)", () => {
    const ir = lowerToStateMachineIR({ entry_sequence: seq("break of structure", "wait for the retest of the order block", "no trade if it closes below the order block", "enter on confirmation"), direction: "long" });
    const bars: ReplayBar[] = [{ i: 0, event: true }, { i: 1, invalidation: true }, { i: 2, until_satisfied: true, confirmation: true }];
    const r = runStateMachine(ir, bars);
    expect(r.entry_bar).toBeNull();
    expect(r.transitions.invalidated).toBe(1);
  });

  it("price never returns within timeout → wait expires, no entry", () => {
    const ir = lowerToStateMachineIR({ entry_sequence: seq("break of structure", "wait for the retest", "enter on confirmation"), direction: "long" });
    ir.wait_state.timeout_bars = 2;
    const bars: ReplayBar[] = [{ i: 0, event: true }, { i: 1 }, { i: 2 }, { i: 3, until_satisfied: true, confirmation: true }];
    const r = runStateMachine(ir, bars);
    expect(r.entry_bar).toBeNull();
    expect(r.transitions.expired).toBe(1);
  });

  it("★ transition matrix across a mixed set behaves sensibly", () => {
    const zoneReturn = lowerToStateMachineIR({ entry_sequence: seq("break of structure", "wait for the retest", "enter on confirmation") });
    const immediate = lowerToStateMachineIR({ entry_sequence: seq("enter on a close through the range edge") });
    const results = [
      runStateMachine(zoneReturn, [{ i: 0, event: true }, { i: 1, until_satisfied: true, confirmation: true }]), // confirmed
      runStateMachine(zoneReturn, [{ i: 0, event: true }, { i: 1 }, { i: 2 }]),                                   // expired (never returns)
      runStateMachine(immediate, [{ i: 0, confirmation: true }]),                                                 // immediate entry, no wait
    ];
    const m = aggregateTransitions(results);
    expect(m.wait_created).toBe(2);  // 2 wait-state strategies armed
    expect(m.confirmed).toBe(2);     // 1 zone-return confirmed + 1 immediate
    expect(m.expired).toBe(1);       // 1 zone-return expired
    expect(m.entries).toBe(2);       // 2 reached entry
    expect(m.no_entry).toBe(1);
  });
});
