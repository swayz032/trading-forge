/**
 * Uncertainty propagation — honest under simulation.
 * A trade carries its edge's grounding class + weakest-link confidence; the backtest segregates edge by
 * grounding so it can answer: did the educator teach this edge, or did the compiler invent it?
 */
import { describe, it, expect } from "vitest";
import { tradeGrounding, segregateBacktest } from "../uncertainty-propagation.js";
import { lowerToStateMachineIR } from "../state-machine-lowering.js";
import { SPAN, DERIVED, COMPILER, type StrategyIR, type ConfirmationNode } from "../state-machine-ir.js";

const seq = (...actions: string[]) => actions.map((action, i) => ({ step: i + 1, action }));

describe("tradeGrounding — propagate edge certainty into the trade", () => {
  it("★ a fully transcript-bound edge → FULLY_GROUNDED, high confidence", () => {
    const transcript = "we wait for a break of structure, then price comes back to the order block, enter on the bullish engulfing.";
    const ir = lowerToStateMachineIR({ transcript, entry_sequence: seq("break of structure", "wait for price to come back to the order block", "enter on the bullish engulfing"), direction: "long" });
    const g = tradeGrounding(ir);
    expect(g.grounding_class).toBe("FULLY_GROUNDED");
    expect(g.inference_dependencies).toEqual([]);
    expect(g.trade_confidence).toBeGreaterThan(0.9); // span-bound nodes are high-confidence
  });

  it("★ one inferred edge node (confirmation not transcript-bound) → INFERENCE_DEPENDENT, lower confidence", () => {
    // edge with event/zone/until span-bound but confirmation DERIVED (compiler couldn't verbatim-bind it)
    const ir: StrategyIR = {
      schema_version: "state_machine_v1", bias: null, eligibility: [],
      structural_event: { kind: "structural_event", event: "bos", provenance: SPAN("break of structure", 0, 18) },
      execution_context: { kind: "execution_context", zone: "order_block", provenance: SPAN("order block", 30, 41) },
      wait_state: {
        provenance: SPAN("comes back", 42, 52), active: true,
        until: { kind: "price_reenters", provenance: SPAN("comes back", 42, 52) },
        confirmation: { kind: "confirmation", compound: null, provenance: DERIVED("confirmation from extraction; no verbatim transcript span") } as ConfirmationNode,
      },
      entry: { kind: "entry", order_type: "market", direction: "long", provenance: COMPILER("market default") },
    };
    const g = tradeGrounding(ir);
    expect(g.grounding_class).toBe("INFERENCE_DEPENDENT");
    expect(g.inference_dependencies).toContain("wait_state.confirmation");
    expect(g.trade_confidence).toBeLessThan(0.9); // weakest-link (DERIVED=0.72) drags it down
  });

  it("no transcript at all → everything inferred → INFERENCE_DEPENDENT", () => {
    const ir = lowerToStateMachineIR({ entry_sequence: seq("break of structure", "wait for retest", "enter on confirmation"), direction: "long" });
    expect(tradeGrounding(ir).grounding_class).toBe("INFERENCE_DEPENDENT");
  });
});

describe("segregateBacktest — is the edge real or compiler-invented?", () => {
  const grounded = (pnl: number) => ({ grounding_class: "FULLY_GROUNDED" as const, pnl });
  const inferred = (pnl: number) => ({ grounding_class: "INFERENCE_DEPENDENT" as const, pnl });

  it("★ GROUNDED_EDGE: grounded trades profitable → faithful to the educator", () => {
    const trades = [grounded(2), grounded(1.5), grounded(-1), grounded(3), grounded(2), inferred(-1), inferred(0.5), inferred(-2), inferred(-1), inferred(0.2)];
    const r = segregateBacktest(trades);
    expect(r.verdict).toBe("GROUNDED_EDGE");
    expect(r.fully_grounded.avg_pnl).toBeGreaterThan(0);
  });

  it("★ INFERENCE_EDGE_SUSPECT: edge ONLY in inference-dependent trades → the compiler invented it", () => {
    const trades = [grounded(-1), grounded(-2), grounded(0.5), grounded(-1), grounded(-0.5), inferred(3), inferred(2), inferred(2.5), inferred(1), inferred(2)];
    const r = segregateBacktest(trades);
    expect(r.verdict).toBe("INFERENCE_EDGE_SUSPECT");
    expect(r.note).toMatch(/compiler invented/i);
  });

  it("MIXED: both classes profitable", () => {
    const trades = [grounded(2), grounded(1), grounded(2), grounded(1), grounded(2), inferred(2), inferred(1), inferred(2), inferred(1), inferred(2)];
    expect(segregateBacktest(trades).verdict).toBe("MIXED");
  });

  it("NO_EDGE: neither profitable", () => {
    const trades = [grounded(-1), grounded(-2), grounded(-1), grounded(-1), grounded(-2), inferred(-1), inferred(-2), inferred(-1), inferred(-1), inferred(-2)];
    expect(segregateBacktest(trades).verdict).toBe("NO_EDGE");
  });

  it("INSUFFICIENT_DATA below the per-class floor", () => {
    expect(segregateBacktest([{ grounding_class: "FULLY_GROUNDED", pnl: 2 }]).verdict).toBe("INSUFFICIENT_DATA");
  });

  it("★ honesty: the SAME pooled P&L can hide an invented edge — segregation exposes it", () => {
    // pooled avg is positive, but ALL the profit is inference-dependent; grounded trades lose
    const trades = [grounded(-1), grounded(-1), grounded(-1), grounded(-1), grounded(-1), inferred(3), inferred(3), inferred(3), inferred(3), inferred(3)];
    const pooledAvg = trades.reduce((a, t) => a + t.pnl, 0) / trades.length; // +1.0 — looks great pooled
    expect(pooledAvg).toBeGreaterThan(0);
    expect(segregateBacktest(trades).verdict).toBe("INFERENCE_EDGE_SUSPECT"); // but it's a mirage
  });
});
