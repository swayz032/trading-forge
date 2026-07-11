/**
 * Gate 1.5 — semantic determinism. "Can a dumb engine execute this without a human?"
 * Pass = 0 MISSING + 0 AMBIGUOUS on extraction-owned fields. IMPLIED passes executability but is
 * faithfulness debt. stop/tp/risk are FRAMEWORK_OWNED, never scored as extraction gaps.
 */
import { describe, it, expect } from "vitest";
import { scoreDeterminism } from "../semantic-determinism.js";
import { EXPLICIT, DERIVED, COMPILER, SPAN, type StrategyIR } from "../state-machine-ir.js";

const base = (over: Partial<StrategyIR> = {}): StrategyIR => ({
  schema_version: "state_machine_v1",
  bias: { kind: "bias", direction: "short", provenance: DERIVED("from direction_class") },
  eligibility: [],
  structural_event: { kind: "structural_event", event: "sweep", provenance: SPAN("sweep liquidity", 0, 14) },
  execution_context: { kind: "execution_context", zone: "named_level", ref: "PDH", provenance: SPAN("above PDH", 20, 29) },
  wait_state: {
    active: true, provenance: SPAN("reject", 30, 36), until: { kind: "retest", provenance: SPAN("reject", 30, 36) },
    confirmation: { kind: "confirmation", compound: { legs: [], primary_order: 0 } as any, provenance: SPAN("close below vwap", 40, 56) },
  },
  entry: { kind: "entry", order_type: "market", direction: "short", provenance: COMPILER("default") },
  ...over,
});

describe("scoreDeterminism — executability gate", () => {
  it("★ fully-specified edge → determinism PASS, framework fields not counted", () => {
    const r = scoreDeterminism(base());
    expect(r.determinism_pass).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.framework_owned).toEqual(["stop_loss", "take_profit", "risk_model"]);
  });

  it("★ no compiled confirmation + NOT zero-wait → entry_trigger MISSING → FAIL (the psH/h6T class)", () => {
    const ir = base({ wait_state: { active: true, provenance: DERIVED("retest"), until: { kind: "retest", provenance: DERIVED("retest") },
      confirmation: { kind: "confirmation", compound: null, provenance: COMPILER("no confirmation compiled (confirmation_no_level)") } },
      meta: { quarantine_reason: "confirmation_no_level" } });
    const r = scoreDeterminism(ir);
    expect(r.missing).toContain("entry_trigger");
    expect(r.determinism_pass).toBe(false);
  });

  it("★ zero-wait: structural event IS the trigger → executable even with no compound", () => {
    const ir = base({ wait_state: { active: false, provenance: COMPILER("zero-wait"), until: { kind: "now", provenance: COMPILER("zero-wait") },
      confirmation: { kind: "confirmation", compound: null, provenance: COMPILER("event is confirmation") } } });
    const r = scoreDeterminism(ir);
    expect(r.missing).not.toContain("entry_trigger");
    expect(r.fields.find((f) => f.field === "entry_trigger")!.status).not.toBe("MISSING");
  });

  it("★ zone named but NO ref/bounds → setup_context AMBIGUOUS → FAIL (engine can't resolve)", () => {
    const ir = base({ execution_context: { kind: "execution_context", zone: "named_level", provenance: SPAN("a zone", 0, 6) } });
    const r = scoreDeterminism(ir);
    expect(r.ambiguous).toContain("setup_context");
    expect(r.determinism_pass).toBe(false);
  });

  it("★ unresolved OR-alternatives → entry_trigger AMBIGUOUS (engine can't pick a branch)", () => {
    const ir = base();
    ir.wait_state.confirmation.alternatives = [{ kind: "confirmation", compound: null, provenance: COMPILER("alt") }];
    expect(scoreDeterminism(ir).ambiguous).toContain("entry_trigger");
  });

  it("★ IMPLIED passes executability but is faithfulness debt, not a gate failure", () => {
    // derived direction + no session + no invalidation → all IMPLIED, but still executable (0 missing/ambiguous)
    const ir = base({ eligibility: [] });
    const r = scoreDeterminism(ir);
    expect(r.determinism_pass).toBe(true);
    expect(r.faithfulness_debt).toContain("direction");      // derived, not taught
    expect(r.faithfulness_debt).toContain("session_filter"); // absent → always-on default
  });

  it("explicit direction → PRESENT, not faithfulness debt", () => {
    const ir = base({ bias: { kind: "bias", direction: "short", provenance: EXPLICIT("we're only looking for shorts") } });
    expect(scoreDeterminism(ir).faithfulness_debt).not.toContain("direction");
  });

  it("no bias node → direction MISSING → FAIL", () => {
    const r = scoreDeterminism(base({ bias: null }));
    expect(r.missing).toContain("direction");
    expect(r.determinism_pass).toBe(false);
  });
});
