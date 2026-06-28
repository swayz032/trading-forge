/**
 * Evidence mode — replay-attribution. Separates visual-grounding-debt failures from bad-strategy failures.
 * Heuristic: VISUAL concepts (sweep/displacement/mss/OB/FVG/structure-shift) vs LEXICAL (computable).
 */
import { describe, it, expect } from "vitest";
import { classifyEvidenceMode } from "../evidence-mode.js";
import { SPAN, COMPILER, DERIVED, type StrategyIR } from "../state-machine-ir.js";

const ir = (over: Partial<StrategyIR> = {}): StrategyIR => ({
  schema_version: "state_machine_v1",
  bias: { kind: "bias", direction: "short", provenance: DERIVED("d") },
  eligibility: [],
  structural_event: { kind: "structural_event", event: "breakout", provenance: SPAN("breakout", 0, 8) },
  execution_context: { kind: "execution_context", zone: "range_edge", ref: "ORH", provenance: SPAN("range", 0, 5) },
  wait_state: { active: true, provenance: SPAN("x", 0, 1), until: { kind: "retest", provenance: SPAN("retest", 0, 6) },
    confirmation: { kind: "confirmation", compound: null, provenance: COMPILER("none") } },
  entry: { kind: "entry", order_type: "market", direction: "short", provenance: COMPILER("d") },
  ...over,
});

describe("classifyEvidenceMode", () => {
  it("★ indicator/level strategy (breakout + range_edge + retest) → TRANSCRIPT_ONLY", () => {
    expect(classifyEvidenceMode(ir()).mode).toBe("TRANSCRIPT_ONLY");
  });

  it("★ ICT strategy (sweep + supply_demand + structure_shift) → VISUAL_REQUIRED", () => {
    const r = classifyEvidenceMode(ir({
      structural_event: { kind: "structural_event", event: "sweep", provenance: SPAN("sweep", 0, 5) },
      execution_context: { kind: "execution_context", zone: "supply_demand", ref: "zone", provenance: SPAN("supply", 0, 6) },
      wait_state: { active: true, provenance: SPAN("x", 0, 1), until: { kind: "reclaim", provenance: SPAN("reclaim", 0, 7) },
        confirmation: { kind: "confirmation", compound: { primary_order: 0, legs: [{ kind: "structure_shift" }] } as any, provenance: SPAN("mss", 0, 3) } },
    }));
    expect(r.mode).toBe("VISUAL_REQUIRED");
    expect(r.lexical_concepts).toEqual([]);
  });

  it("★ mixed: lexical event + visual zone → MIXED", () => {
    const r = classifyEvidenceMode(ir({
      execution_context: { kind: "execution_context", zone: "order_block", ref: "ob", provenance: SPAN("order block", 0, 11) },
    }));
    expect(r.mode).toBe("MIXED");
    expect(r.visual_concepts).toContain("zone:order_block");
    expect(r.lexical_concepts).toContain("event:breakout");
  });

  it("named_level + close_through stays TRANSCRIPT_ONLY (computable)", () => {
    const r = classifyEvidenceMode(ir({
      execution_context: { kind: "execution_context", zone: "named_level", ref: "PDH", provenance: SPAN("PDH", 0, 3) },
      wait_state: { active: true, provenance: SPAN("x", 0, 1), until: { kind: "now", provenance: COMPILER("now") },
        confirmation: { kind: "confirmation", compound: { primary_order: 0, legs: [{ kind: "close_through" }] } as any, provenance: SPAN("close above", 0, 11) } },
    }));
    expect(r.mode).toBe("TRANSCRIPT_ONLY");
  });
});
