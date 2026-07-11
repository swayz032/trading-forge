/**
 * Checkpoint 4 — re-root the existing axes into ONE confirmation node (integration).
 * Acceptance: (1) a single evaluateConfirmation is used by BOTH immediate and wait-state paths
 * (observational equivalence — same node + same features → same verdict in either path), (2) confirmation
 * provenance (contributors/blocked_by) is rich, (3) the strength axis is re-rooted (CALLED here), (4) the
 * frozen-6 fidelity suite still passes (regression — run alongside).
 */
import { describe, it, expect } from "vitest";
import { evaluateConfirmation, type ConfirmationBarContext } from "../confirmation-evaluator.js";
import { runStateMachine, type ReplayBar } from "../state-machine-runtime.js";
import { lowerToStateMachineIR } from "../state-machine-lowering.js";
import { EXPLICIT, COMPILER, type ConfirmationNode, type StrategyIR, type WaitPredicateKind } from "../state-machine-ir.js";
import type { CompoundConfirmation } from "../confirmation-compiler.js";

const seq = (...actions: string[]) => actions.map((action, i) => ({ step: i + 1, action }));
const compound = (over: Partial<CompoundConfirmation> = {}): CompoundConfirmation => ({
  predicate_type: "single", operator: "SEQUENCE", enforcement: "primary_plus_confluence", primary_order: 1,
  legs: [{ kind: "retest_reject", level_ref: "order_block", evidence_quote: "retest the order block", order: 1, role: "primary" }],
  ...over,
});
const node = (c: CompoundConfirmation): ConfirmationNode => ({ kind: "confirmation", compound: c, provenance: EXPLICIT("enter on the retest") });
const STRONG: ConfirmationBarContext = { legs_satisfied: { 1: true }, strength_features: { range_atr_ratio: 1.8, body_ratio: 0.85, break_distance_atr: 1.2, follow_through: 2 } };
const WEAK: ConfirmationBarContext = { legs_satisfied: { 1: true }, strength_features: { range_atr_ratio: 0.3, body_ratio: 0.15, break_distance_atr: 0.1, follow_through: 0 } };

// minimal IRs that SHARE one confirmation node, differing only in entry-timing
const zeroWaitIR = (c: ConfirmationNode): StrategyIR => ({
  schema_version: "state_machine_v1", bias: null, eligibility: [], structural_event: null, execution_context: null,
  wait_state: { provenance: COMPILER("zero-wait"), active: false, until: { kind: "now", provenance: COMPILER("now") }, confirmation: c },
  entry: { kind: "entry", order_type: "market", direction: "long", provenance: COMPILER("market") },
});
const waitIR = (c: ConfirmationNode, until: WaitPredicateKind = "retest"): StrategyIR => ({
  ...zeroWaitIR(c),
  wait_state: { provenance: EXPLICIT("wait"), active: true, until: { kind: until, provenance: EXPLICIT("retest") }, confirmation: c },
});

describe("CP4 — unified confirmation evaluator (re-rooted axes)", () => {
  it("★ confirmation provenance: a passing confirmation lists CONTRIBUTORS (multi-leg/anchor/strength)", () => {
    const c = compound({ legs: [{ kind: "retest_reject", level_ref: "order_block", evidence_quote: "x", order: 1, role: "primary", strength_requirement: { required: true, min: "strong", evidence: "clean" } }] });
    const r = evaluateConfirmation(node(c), STRONG);
    expect(r.passed).toBe(true);
    expect(r.contributors).toEqual(expect.arrayContaining([expect.stringContaining("primary:"), "anchor:named_level", expect.stringContaining("strength:")]));
    expect(r.blocked_by).toEqual([]);
  });

  it("★ confirmation provenance: a FAIL reports blocked_by (the explainability the operator asked for)", () => {
    const c = compound({ legs: [{ kind: "structure_shift", level_ref: "prior_swing", evidence_quote: "x", order: 1, role: "primary", strength_requirement: { required: true, min: "strong", evidence: "clean" } }] });
    const r = evaluateConfirmation(node(c), WEAK);
    expect(r.passed).toBe(false);
    expect(r.blocked_by).toContain("weak_confirmation"); // strength axis re-rooted + reporting WHY
  });

  it("all_required enforcement blocks when a leg is unmet", () => {
    const c = compound({ enforcement: "all_required", primary_order: 2, legs: [
      { kind: "close_through", level_ref: "opening_range_edge", evidence_quote: "x", order: 1, role: "confluence" },
      { kind: "retest_reject", level_ref: "order_block", evidence_quote: "y", order: 2, role: "primary" },
    ] });
    expect(evaluateConfirmation(node(c), { legs_satisfied: { 2: true } }).passed).toBe(false);
    expect(evaluateConfirmation(node(c), { legs_satisfied: { 1: true, 2: true } }).passed).toBe(true);
  });

  it("★ OBSERVATIONAL EQUIVALENCE: ONE confirmation node, BOTH runtime paths agree on the evaluator's verdict", () => {
    const c = node(compound({ legs: [{ kind: "retest_reject", level_ref: "order_block", evidence_quote: "x", order: 1, role: "primary", strength_requirement: { required: true, min: "strong", evidence: "clean" } }] }));
    // PASS features → BOTH paths enter (immediate on the bar; wait after the return)
    expect(runStateMachine(zeroWaitIR(c), [{ i: 0, confirmation_ctx: STRONG }]).entry_bar).toBe(0);
    expect(runStateMachine(waitIR(c), [{ i: 0, event: true }, { i: 1, until_satisfied: true, confirmation_ctx: STRONG }]).entry_bar).toBe(1);
    // FAIL (weak) features → NEITHER path enters (same evaluator verdict gates both)
    expect(runStateMachine(zeroWaitIR(c), [{ i: 0, confirmation_ctx: WEAK }]).entry_bar).toBeNull();
    expect(runStateMachine(waitIR(c), [{ i: 0, event: true }, { i: 1, until_satisfied: true, confirmation_ctx: WEAK }, { i: 2, until_satisfied: true, confirmation_ctx: WEAK }]).entry_bar).toBeNull();
  });

  it("eligibility precondition gates BOTH paths (context axis re-rooted into the runtime)", () => {
    const ir = lowerToStateMachineIR({ transcript: "only trade during the new york session", entry_sequence: seq("enter on a close through the range edge") });
    const bars: ReplayBar[] = [{ i: 0, confirmation: true }];
    expect(runStateMachine(ir, bars, { gateState: { session_region: "LONDON" } }).entry_bar).toBeNull(); // wrong session
    expect(runStateMachine(ir, bars, { gateState: { session_region: "NY" } }).entry_bar).toBe(0);
  });
});
