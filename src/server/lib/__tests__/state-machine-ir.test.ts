/**
 * State-machine IR — Checkpoint 1 schema tests (TYPES ONLY; no compiler/execution behavior).
 * Proves: (1) the schema represents the dominant zone-return case as DATA, (2) the frozen event-centric
 * baseline is expressible as the zero-wait degenerate, (3) provenance/inferred is queryable on every node.
 */
import { describe, it, expect } from "vitest";
import {
  fromEventCentric, isZeroWait, inferredNodes, EXPLICIT, INFERRED,
  type StrategyIR, type WaitState, type ConfirmationNode,
} from "../state-machine-ir.js";
import type { CompoundConfirmation } from "../confirmation-compiler.js";

const fakeCompound: CompoundConfirmation = {
  predicate_type: "single", operator: "SEQUENCE", enforcement: "primary_plus_confluence", primary_order: 1,
  legs: [{ kind: "retest_reject", level_ref: "order_block", confluence: "fair_value_gap", evidence_quote: "retest of the order block", order: 1, role: "primary" }],
};

describe("state-machine IR — Checkpoint 1 schema", () => {
  it("★ the frozen event-centric output is expressible as the zero-wait degenerate (baseline representable)", () => {
    const ir = fromEventCentric({ compound: fakeCompound, direction: "long" });
    expect(ir.schema_version).toBe("state_machine_v1");
    expect(isZeroWait(ir)).toBe(true);                                   // event IS the confirmation
    expect(ir.wait_state.confirmation.compound).toBe(fakeCompound);     // the 5 axes preserved verbatim
    expect(ir.entry.order_type).toBe("market");
  });

  it("★ the dominant case (zone-return) is DATA, not a new primitive — until: price_reenters(zone)", () => {
    const confirmation: ConfirmationNode = { kind: "confirmation", compound: fakeCompound, provenance: EXPLICIT("enter on the bullish engulfing inside the order block") };
    const wait: WaitState = {
      provenance: EXPLICIT("wait for price to come back to the order block"),
      active: true,
      until: { kind: "price_reenters", target_ref: "order_block", provenance: EXPLICIT("price returns to the OB") },
      confirmation,
      invalidated_by: { kind: "invalidation", condition: "close_below(order_block)", provenance: EXPLICIT("if it closes below the OB, no trade") },
      expires: "session_end",
      timeout_bars: 30,
    };
    const ir: StrategyIR = {
      schema_version: "state_machine_v1",
      bias: { kind: "bias", direction: "long", provenance: EXPLICIT("HTF is bullish") },
      eligibility: [],
      structural_event: { kind: "structural_event", event: "bos", level_ref: "prior_swing", provenance: EXPLICIT("break of structure to the upside") },
      execution_context: { kind: "execution_context", zone: "order_block", provenance: EXPLICIT("mark the order block") },
      wait_state: wait,
      entry: { kind: "entry", order_type: "market", direction: "long", provenance: EXPLICIT("enter on confirmation") },
    };
    expect(isZeroWait(ir)).toBe(false);                                  // it WAITS — the 92% case
    expect(ir.wait_state.until.kind).toBe("price_reenters");
    expect(ir.wait_state.invalidated_by?.condition).toContain("order_block");
  });

  it("★ provenance distinguishes explicit instruction from inferred completion (the faithfulness query)", () => {
    const ir = fromEventCentric({ compound: fakeCompound, direction: "long" });
    const inferred = inferredNodes(ir);
    // the baseline INFERS the wait/until/entry (the old model never captured them) — flagged, not hidden
    expect(inferred.map((n) => n.at)).toEqual(expect.arrayContaining(["wait_state", "wait_state.until", "entry"]));
    expect(ir.wait_state.confirmation.provenance.inferred).toBe(false); // the confirmation IS real (explicit)
    expect(INFERRED("x").confidence).toBe("inferred");
    expect(EXPLICIT().confidence).toBe("explicit");
  });

  it("alternatives (OR-operator) is first-class on the confirmation node", () => {
    const alt: ConfirmationNode = { kind: "confirmation", compound: fakeCompound, provenance: EXPLICIT("or a standalone retest") };
    const c: ConfirmationNode = { kind: "confirmation", compound: fakeCompound, alternatives: [alt], provenance: EXPLICIT("breakout") };
    expect(c.alternatives).toHaveLength(1);
  });
});
