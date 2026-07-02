import { describe, it, expect } from "vitest";
import { evaluateSpec } from "../spec-semantics.js";
import type { EngineStrategySpec, EngineCondition } from "../graph-to-engine.js";

const c = (id: string, role: EngineCondition["role"] = "spine"): EngineCondition =>
  ({ id, type: "WAIT_STRUCTURE", object: id, role });

const spec = (over: Partial<EngineStrategySpec>): EngineStrategySpec => ({
  direction: "long",
  entry_conditions: [], and_groups: [], or_branches: [], invalidations: [],
  entry_trigger_id: "t",
  framework_overlay: { stop: "framework_owned", take_profit: "framework_owned", sizing: "framework_owned" },
  ...over,
});

describe("spec semantics — the normative EngineStrategySpec evaluator", () => {
  it("arms only when ALL individual conditions are satisfied (AND default)", () => {
    const s = spec({ entry_conditions: [c("a"), c("b"), c("t", "trigger")] });
    expect(evaluateSpec(s, new Set(["a", "b", "t"])).armed).toBe(true);
    const r = evaluateSpec(s, new Set(["a", "t"]));
    expect(r.armed).toBe(false);
    expect(r.blocked_by).toEqual(["b"]);
  });

  it("or-branch members are alternatives: ANY member satisfies the branch; members not individually required", () => {
    const s = spec({ entry_conditions: [c("x"), c("y"), c("t", "trigger")], or_branches: [["x", "y"]] });
    expect(evaluateSpec(s, new Set(["x", "t"])).armed).toBe(true);   // y not needed
    expect(evaluateSpec(s, new Set(["y", "t"])).armed).toBe(true);   // x not needed
    const r = evaluateSpec(s, new Set(["t"]));                        // neither → branch unmet
    expect(r.armed).toBe(false);
    expect(r.blocked_by).toEqual(["or:x|y"]);
  });

  it("a satisfied invalidation VETOES even a fully-satisfied entry", () => {
    const s = spec({ entry_conditions: [c("a"), c("t", "trigger")], invalidations: [c("kill", "invalidation")] });
    expect(evaluateSpec(s, new Set(["a", "t"])).armed).toBe(true);
    const r = evaluateSpec(s, new Set(["a", "t", "kill"]));
    expect(r.armed).toBe(false);
    expect(r.blocked_by).toEqual(["invalidated:kill"]);
  });

  it("a null entry trigger can never arm", () => {
    const s = spec({ entry_conditions: [c("a")], entry_trigger_id: null });
    const r = evaluateSpec(s, new Set(["a"]));
    expect(r.armed).toBe(false);
    expect(r.blocked_by).toEqual(["no_trigger"]);
  });

  it("blocked_by is deterministic (sorted) across categories", () => {
    const s = spec({
      entry_conditions: [c("z"), c("a"), c("m"), c("n"), c("t", "trigger")],
      or_branches: [["m", "n"]],
      invalidations: [c("kill", "invalidation")],
    });
    const r = evaluateSpec(s, new Set(["kill"])); // everything unmet + veto
    expect(r.blocked_by).toEqual(["a", "invalidated:kill", "or:m|n", "t", "z"]);
  });
});
