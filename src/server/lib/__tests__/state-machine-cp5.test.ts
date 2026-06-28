/**
 * Checkpoint 5 — Decision Provenance (tracing beliefs).
 * The non-negotiable invariant: every executable decision is explicit (evidence) XOR inferred
 * (justification), no third category — mechanized + adversarially tested. Plus: six-question decision
 * record, bidirectional chains, edge confidence, honesty dashboard.
 */
import { describe, it, expect } from "vitest";
import {
  labelOf, assertProvenanceInvariant, buildDecisionRecord, provenanceDashboard, confidenceOf,
  ProvenanceInvariantError,
} from "../decision-provenance.js";
import { lowerToStateMachineIR } from "../state-machine-lowering.js";
import { runStateMachine, type ReplayBar } from "../state-machine-runtime.js";
import { evaluateConfirmation } from "../confirmation-evaluator.js";
import { EXPLICIT, COMPILER, NORMALIZED } from "../state-machine-ir.js";

const seq = (...actions: string[]) => actions.map((action, i) => ({ step: i + 1, action }));

describe("CP5 — the non-negotiable invariant (explicit XOR inferred, no third)", () => {
  it("explicit node with evidence → explicit label; inferred node with justification → inferred label", () => {
    expect(labelOf(EXPLICIT("wait for the retest"), "x").kind).toBe("explicit");
    expect(labelOf(NORMALIZED("synonym", "comes back to the OB"), "x").kind).toBe("explicit");
    expect(labelOf(COMPILER("market default"), "x").kind).toBe("inferred");
  });

  it("★ ADVERSARIAL: an explicit node with NO evidence VIOLATES the invariant (throws)", () => {
    expect(() => labelOf({ confidence: "explicit", origin: "explicit", inferred: false }, "bias")).toThrow(ProvenanceInvariantError);
  });
  it("★ ADVERSARIAL: an inferred node with NO justification VIOLATES the invariant (throws)", () => {
    expect(() => labelOf({ confidence: "inferred", origin: "compiler_generated", inferred: true }, "entry")).toThrow(ProvenanceInvariantError);
  });

  it("★ a real lowered IR satisfies the invariant — every node is explicit-or-inferred", () => {
    const ir = lowerToStateMachineIR({ entry_sequence: seq("break of structure", "wait for the retest of the order block", "enter on confirmation"), direction: "long" });
    const inv = assertProvenanceInvariant(ir); // throws if any node is neither
    expect(inv.explicit + inv.inferred).toBeGreaterThan(0);
    expect(inv.inferred).toBeGreaterThan(0); // the market-default entry is honestly inferred, not hidden
  });
});

describe("CP5 — decision record (the six questions, bidirectional, evidence-backed)", () => {
  const ir = lowerToStateMachineIR({ entry_sequence: seq("break of structure to the upside", "wait for price to come back and retest the order block", "no trade if it closes below the order block", "enter on the bullish confirmation"), direction: "long" });
  const bars: ReplayBar[] = [{ i: 0, event: true }, { i: 1, until_satisfied: true, confirmation: true }];

  it("★ answers all six belief questions, each evidence-or-inference backed with confidence", () => {
    const run = runStateMachine(ir, bars);
    const confirmation = evaluateConfirmation(ir.wait_state.confirmation, { legs_satisfied: { [ir.wait_state.confirmation.compound!.primary_order]: true } });
    const rec = buildDecisionRecord(ir, run.entry_bar, confirmation);
    const qs = rec.steps.map((s) => s.question);
    expect(qs).toEqual(["setup_existed", "still_valid", "waiting_completed", "confirmation_happened", "entry_legal", "confidence_sufficient"]);
    rec.steps.forEach((s) => { expect(["explicit", "inferred"]).toContain(s.label.kind); expect(s.confidence).toBeGreaterThan(0); });
    // structural event + wait + invalidation were TAUGHT → explicit; market entry → inferred (honest)
    expect(rec.steps.find((s) => s.node === "structural_event")?.label.kind).toBe("explicit");
    expect(rec.steps.find((s) => s.node === "entry")?.label.kind).toBe("inferred");
  });

  it("★ bidirectional: forward (setup→entry) and reverse (click-a-trade) chains are inverses", () => {
    const rec = buildDecisionRecord(ir, 1);
    expect(rec.reverse_chain).toEqual([...rec.forward_chain].reverse());
    expect(rec.forward_chain[0]).toContain("structural_event");          // begins at the setup
    expect(rec.reverse_chain[0]).toContain("confirmation_result");       // click-a-trade begins at the final decision node
  });

  it("★ HONESTY: a missing invalidation is surfaced as an INFERRED assumption, not hidden", () => {
    const noInval = lowerToStateMachineIR({ entry_sequence: seq("break of structure", "wait for the retest", "enter on confirmation"), direction: "long" });
    const rec = buildDecisionRecord(noInval, 1);
    const validStep = rec.steps.find((s) => s.question === "still_valid")!;
    expect(validStep.label.kind).toBe("inferred");
    expect(validStep.answer).toContain("ASSUMED");
  });

  it("edge confidence: explicit > derived > compiler_generated (extraction uncertainty is graded)", () => {
    expect(confidenceOf(EXPLICIT("x"))).toBeGreaterThan(confidenceOf(COMPILER("y")));
  });
});

describe("CP5 — honesty dashboard (taught vs compiler-inferred)", () => {
  it("★ quantifies how much of the strategy is TAUGHT vs compiler-filled", () => {
    const ir = lowerToStateMachineIR({ entry_sequence: seq("break of structure", "wait for the retest of the order block", "enter on confirmation"), direction: "long" });
    const conservation = { total: 10, executed: 7, normalized: 1, ignored: 1, silent_loss: [{ name: "x" }] };
    const d = provenanceDashboard(ir, conservation);
    expect(d.transcript_units).toBe(10);
    expect(d.represented).toBe(8);
    expect(d.unused).toBe(1);
    expect(d.ir_explicit + d.ir_inferred).toBeGreaterThan(0);
    expect(d.honesty_ratio).toBeGreaterThan(0);
    expect(d.honesty_ratio).toBeLessThanOrEqual(1);
  });
});
