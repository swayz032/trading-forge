/**
 * Decision closure — graph integrity (no dangling refs / orphans / impossible states) + the three-proof gate.
 */
import { describe, it, expect } from "vitest";
import { checkDecisionClosure, threeProofs } from "../decision-closure.js";
import { SPAN, COMPILER, DERIVED, type StrategyIR } from "../state-machine-ir.js";

const ir = (over: Partial<StrategyIR> = {}): StrategyIR => ({
  schema_version: "state_machine_v1",
  bias: { kind: "bias", direction: "short", provenance: DERIVED("d") },
  eligibility: [],
  structural_event: { kind: "structural_event", event: "sweep", level_ref: "PDH", provenance: SPAN("sweep PDH", 0, 9) },
  execution_context: { kind: "execution_context", zone: "supply_demand", ref: "PDH", provenance: SPAN("supply", 0, 6) },
  wait_state: { active: true, provenance: SPAN("x", 0, 1), until: { kind: "retest", target_ref: "PDH", provenance: SPAN("retest", 0, 6) },
    confirmation: { kind: "confirmation", compound: { primary_order: 0, legs: [{ kind: "close_through" }] } as any, provenance: SPAN("close", 0, 5) } },
  entry: { kind: "entry", order_type: "market", direction: "short", provenance: COMPILER("d") },
  ...over,
});

describe("checkDecisionClosure", () => {
  it("★ fully-wired graph → closed, entry reachable", () => {
    const r = checkDecisionClosure(ir());
    expect(r.closed).toBe(true);
    expect(r.reachable_to_entry).toBe(true);
  });

  it("★ no confirmation + not zero-wait → IMPOSSIBLE_STATE (entry unreachable — the psH/h6T defect as reachability)", () => {
    const r = checkDecisionClosure(ir({ wait_state: { active: true, provenance: DERIVED("w"), until: { kind: "retest", target_ref: "PDH", provenance: DERIVED("r") },
      confirmation: { kind: "confirmation", compound: null, provenance: COMPILER("no compound") } }, meta: { quarantine_reason: "confirmation_no_level" } }));
    expect(r.closed).toBe(false);
    expect(r.violations.some((x) => x.kind === "IMPOSSIBLE_STATE" && x.node === "entry")).toBe(true);
  });

  it("★ non-zero wait with no anchor → IMPOSSIBLE_STATE (waiting for nothing)", () => {
    const r = checkDecisionClosure(ir({ structural_event: null, execution_context: null,
      wait_state: { active: true, provenance: DERIVED("w"), until: { kind: "retest", provenance: DERIVED("r") },
        confirmation: { kind: "confirmation", compound: { primary_order: 0, legs: [{ kind: "close_through" }] } as any, provenance: SPAN("c", 0, 1) } } }));
    expect(r.violations.some((x) => x.kind === "IMPOSSIBLE_STATE" && x.node === "wait_state")).toBe(true);
  });

  it("★ until.target_ref not provided by any upstream node → DANGLING_REF", () => {
    const r = checkDecisionClosure(ir({ wait_state: { active: true, provenance: DERIVED("w"), until: { kind: "retest", target_ref: "GHOST_LEVEL", provenance: DERIVED("r") },
      confirmation: { kind: "confirmation", compound: { primary_order: 0, legs: [{ kind: "close_through" }] } as any, provenance: SPAN("c", 0, 1) } } }));
    expect(r.violations.some((x) => x.kind === "DANGLING_REF")).toBe(true);
  });

  it("zero-wait with event (no compound) → reachable (event IS the trigger), closed", () => {
    const r = checkDecisionClosure(ir({ execution_context: null,
      wait_state: { active: false, provenance: COMPILER("zw"), until: { kind: "now", provenance: COMPILER("now") },
        confirmation: { kind: "confirmation", compound: null, provenance: COMPILER("event is trigger") } } }));
    expect(r.reachable_to_entry).toBe(true);
  });
});

describe("threeProofs — evidence + decision + dependency", () => {
  it("all three hold → trade allowed", () => expect(threeProofs({ evidence_grounded: true, decision_executable: true, dependency_closed: true }).trade_allowed).toBe(true));
  it("★ any one fails → no trade, names the failed proof", () => {
    const r = threeProofs({ evidence_grounded: true, decision_executable: false, dependency_closed: true });
    expect(r.trade_allowed).toBe(false);
    expect(r.failed_proofs).toEqual(["DECISION_PROOF"]);
  });
  it("dependency failure alone blocks the trade", () =>
    expect(threeProofs({ evidence_grounded: true, decision_executable: true, dependency_closed: false }).failed_proofs).toEqual(["DEPENDENCY_PROOF"]));
});
