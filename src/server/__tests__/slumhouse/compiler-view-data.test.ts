import { describe, expect, it } from "vitest";
import { buildCompilerViewReceipt } from "../../lib/slumhouse/compiler-view-data.js";

const strategy = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Opening Heist Atlas",
  symbol: "MES",
  timeframe: "5m",
  lifecycleState: "CANDIDATE",
};

describe("compiler view receipt adapter", () => {
  it("emits a source-only receipt with no trading values when no compiled receipt exists", () => {
    const result = buildCompilerViewReceipt(strategy, null);

    expect(result).toMatchObject({
      state: "uncompiled",
      receiptHash: null,
      graphHash: null,
      direction: null,
      binding: null,
    });
    expect(result.chambers.map((chamber) => chamber.key)).toEqual([
      "context",
      "setup",
      "entry",
      "stop",
      "exit",
      "sizing",
      "filters",
    ]);
    expect(result.chambers.every((chamber) => chamber.state === "unbound")).toBe(true);
    expect(result.chambers.every((chamber) => chamber.rules.length === 0)).toBe(true);
  });

  it("maps only persisted compiler facts into fixed rule chambers", () => {
    const result = buildCompilerViewReceipt(strategy, {
      ignored_secret: "must-not-leak",
      stop_loss: { type: "atr", multiplier: 1.5 },
      exit_type: "trailing_stop",
      exit_params: { style: "c", move_stop_to: "BE+1tick" },
      position_size: { type: "risk_derived_pyramid", max_risk_pct_per_trade: 0.02 },
      compiled_spec: {
        spec_hash: "spec-hash-123",
        graph_canonical_hash: "graph-hash-456",
        spec: {
          direction: "both",
          entry_conditions: [
            {
              id: "WAIT_SESSION:rth#0",
              type: "WAIT_SESSION",
              object: "regular trading hours",
              role: "spine",
              evidence: "Trade only during RTH.",
              span: { start: 12, end: 34 },
              provenance: { origin: "extracted" },
            },
            {
              id: "WAIT_STRUCTURE:orb#0",
              type: "WAIT_STRUCTURE",
              object: "opening range established",
              role: "spine",
              evidence: "Mark the first thirty minutes.",
              span: { start: 40, end: 72 },
            },
            {
              id: "ENABLE_ENTRY:breakout#0",
              type: "ENABLE_ENTRY",
              object: "close breaks opening range",
              role: "trigger",
              evidence: "Enter on the first close outside.",
              span: { start: 80, end: 118 },
            },
            {
              id: "FILTER:news#0",
              type: "FILTER",
              object: "skip FOMC",
              role: "filter",
              evidence: "No FOMC days.",
              span: { start: 120, end: 134 },
            },
          ],
        },
        binding_plan_summary: {
          compiled: true,
          approximation_used: false,
          spine_bound: 2,
          spine_total: 2,
          trigger_bound: true,
          queue_reasons: [],
        },
      },
    });

    expect(result).toMatchObject({
      state: "compiled",
      receiptHash: "spec-hash-123",
      graphHash: "graph-hash-456",
      direction: "both",
      binding: {
        compiled: true,
        approximationUsed: false,
        spineBound: 2,
        spineTotal: 2,
        triggerBound: true,
        queueReasons: [],
      },
    });
    expect(result.chambers.find((chamber) => chamber.key === "context")?.rules[0]).toMatchObject({
      id: "WAIT_SESSION:rth#0",
      label: "regular trading hours",
      evidence: "Trade only during RTH.",
      origin: "explicit",
      span: { start: 12, end: 34 },
    });
    expect(result.chambers.find((chamber) => chamber.key === "entry")?.rules[0]?.label).toBe("close breaks opening range");
    expect(result.chambers.find((chamber) => chamber.key === "stop")?.rules[0]?.expression).toBe('{"type":"atr","multiplier":1.5}');
    expect(result.chambers.find((chamber) => chamber.key === "exit")?.rules).toHaveLength(2);
    expect(result.chambers.find((chamber) => chamber.key === "sizing")?.rules[0]?.expression).toContain("risk_derived_pyramid");
    expect(JSON.stringify(result)).not.toContain("ignored_secret");
    expect(JSON.stringify(result)).not.toContain("must-not-leak");
  });

  it("marks a persisted binding refusal without calling it compiled", () => {
    const result = buildCompilerViewReceipt(strategy, {
      compiled_spec: {
        spec_hash: "refused-spec",
        spec: { direction: "long", entry_conditions: [] },
        binding_plan_summary: {
          compiled: false,
          approximation_used: false,
          spine_bound: 0,
          spine_total: 2,
          trigger_bound: false,
          queue_reasons: ["unsupported_structure", "missing_trigger"],
        },
      },
    });

    expect(result.state).toBe("refused");
    expect(result.binding?.queueReasons).toEqual(["unsupported_structure", "missing_trigger"]);
    expect(result.chambers.every((chamber) => chamber.state === "refused" || chamber.state === "unbound")).toBe(true);
  });
});
