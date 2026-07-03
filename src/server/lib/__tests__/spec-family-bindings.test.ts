/**
 * spec-family-bindings.test.ts — Band C (spec-execution-semantics, 2026-07-02)
 *
 * Unit tests for the TS mirror of src/engine/spec_family_bindings.py.
 * See that module's docstring for the Ledger E parity contract these two
 * files must maintain.
 */
import { describe, it, expect } from "vitest";
import {
  bindCondition,
  compileBindingPlan,
  resolveSessionKeyword,
  MIN_SPINE_BOUND_RATIO,
} from "../spec-family-bindings.js";

describe("spec-family-bindings — bindCondition per-family", () => {
  it("WAIT_SESSION binds on a recognized keyword, no approximation", () => {
    const b = bindCondition({ id: "c1", type: "WAIT_SESSION", object: "london session", role: "spine" });
    expect(b.bindable).toBe(true);
    expect(b.sessionZone).toBe("london");
    expect(b.approximation).toBe(false);
  });

  it("WAIT_SESSION is honestly unbindable on unrecognized vocabulary", () => {
    const b = bindCondition({ id: "c1", type: "WAIT_SESSION", object: "information events", role: "confluence" });
    expect(b.bindable).toBe(false);
    expect(b.reason).toBe("no_recognized_session_keyword");
  });

  it("WAIT_STRUCTURE binds with approximation=true", () => {
    const b = bindCondition({ id: "c1", type: "WAIT_STRUCTURE", object: "vwap and volume profile combination", role: "spine" });
    expect(b.bindable).toBe(true);
    expect(b.approximation).toBe(true);
  });

  it("INVALIDATE binds without approximation (direct primitive reuse)", () => {
    const b = bindCondition({ id: "c1", type: "INVALIDATE", object: "strong close through vwap", role: "invalidation" });
    expect(b.bindable).toBe(true);
    expect(b.approximation).toBe(false);
  });

  it("EXIT_HINT is bindable but never executed (provenance only)", () => {
    const b = bindCondition({ id: "c1", type: "EXIT_HINT", object: "reassess position", role: "spine" });
    expect(b.bindable).toBe(true);
    expect(b.executed).toBe(false);
  });

  it("RESET / EXCEPTION are unsupported with an explicit reason", () => {
    const reset = bindCondition({ id: "c1", type: "RESET", object: "reset", role: "spine" });
    const exc = bindCondition({ id: "c2", type: "EXCEPTION", object: "exc", role: "spine" });
    expect(reset.bindable).toBe(false);
    expect(reset.reason).toBe("control_flow_reset_unsupported");
    expect(exc.reason).toBe("control_flow_exception_unsupported");
  });

  it("unknown condition types are honestly unbindable, never guessed", () => {
    const b = bindCondition({ id: "c1", type: "SOME_FUTURE_TYPE", object: "x", role: "spine" });
    expect(b.bindable).toBe(false);
    expect(b.reason).toBe("unknown_condition_type");
  });
});

describe("spec-family-bindings — compileBindingPlan role semantics", () => {
  it("spine ratio below MIN_SPINE_BOUND_RATIO queues the spec", () => {
    const spec = {
      entry_conditions: [
        { id: "t1", type: "ENABLE_ENTRY", object: "entry", role: "trigger" },
        { id: "s1", type: "RESET", object: "x", role: "spine" },
        { id: "s2", type: "EXCEPTION", object: "y", role: "spine" },
      ],
      invalidations: [],
      entry_trigger_id: "t1",
    };
    const plan = compileBindingPlan(spec);
    expect(plan.compiled).toBe(false);
    expect(plan.queueReasons.length).toBeGreaterThan(0);
  });

  it("a bare trigger with zero spine conditions stays queued (Band B vwapSpec regression guard)", () => {
    const spec = {
      entry_conditions: [
        { id: "t1", type: "ENTER", object: "vwap slope reversal cross", role: "trigger" },
        { id: "c1", type: "FILTER", object: "vwap band width", role: "confluence" },
      ],
      invalidations: [],
      entry_trigger_id: "t1",
    };
    const plan = compileBindingPlan(spec);
    expect(plan.triggerBound).toBe(true);
    expect(plan.spineTotal).toBe(0);
    expect(plan.compiled).toBe(false);
    expect(plan.queueReasons.some((r) => r.reason === "no_spine_conditions_present")).toBe(true);
  });

  it("confluence-role conditions never gate the compile decision", () => {
    const spec = {
      entry_conditions: [
        { id: "t1", type: "ENABLE_ENTRY", object: "entry", role: "trigger" },
        { id: "s1", type: "WAIT_SESSION", object: "london session", role: "spine" },
        { id: "c1", type: "RESET", object: "x", role: "confluence" },
      ],
      invalidations: [],
      entry_trigger_id: "t1",
    };
    const plan = compileBindingPlan(spec);
    expect(plan.compiled).toBe(true);
    expect(plan.confluenceBound).toBe(0);
  });

  it("unbindable trigger blocks the whole spec", () => {
    const spec = {
      entry_conditions: [{ id: "t1", type: "RESET", object: "entry somehow", role: "trigger" }],
      invalidations: [],
      entry_trigger_id: "t1",
    };
    const plan = compileBindingPlan(spec);
    expect(plan.triggerBound).toBe(false);
    expect(plan.compiled).toBe(false);
  });

  it("approximationUsed reflects only executed, bindable, approximate conditions", () => {
    const specApprox = {
      entry_conditions: [
        { id: "t1", type: "ENABLE_ENTRY", object: "entry", role: "trigger" },
        { id: "s1", type: "WAIT_STRUCTURE", object: "structure", role: "spine" },
      ],
      invalidations: [],
      entry_trigger_id: "t1",
    };
    expect(compileBindingPlan(specApprox).approximationUsed).toBe(true);

    const specExact = {
      entry_conditions: [
        { id: "t1", type: "ENABLE_ENTRY", object: "entry", role: "trigger" },
        { id: "s1", type: "WAIT_SESSION", object: "london session", role: "spine" },
      ],
      invalidations: [],
      entry_trigger_id: "t1",
    };
    expect(compileBindingPlan(specExact).approximationUsed).toBe(false);
  });

  it("MIN_SPINE_BOUND_RATIO is a sane constant", () => {
    expect(MIN_SPINE_BOUND_RATIO).toBeGreaterThan(0);
    expect(MIN_SPINE_BOUND_RATIO).toBeLessThanOrEqual(1);
  });

  it("determinism: same spec produces the same plan across repeated calls", () => {
    const spec = {
      entry_conditions: [
        { id: "t1", type: "ENABLE_ENTRY", object: "entry", role: "trigger" },
        { id: "s1", type: "WAIT_SESSION", object: "london session", role: "spine" },
        { id: "s2", type: "WAIT_STRUCTURE", object: "structure", role: "spine" },
      ],
      invalidations: [{ id: "i1", type: "INVALIDATE", object: "break", role: "invalidation" }],
      entry_trigger_id: "t1",
    };
    const a = JSON.stringify(compileBindingPlan(spec));
    const b = JSON.stringify(compileBindingPlan(spec));
    expect(a).toBe(b);
  });
});

describe("spec-family-bindings — resolveSessionKeyword false-positive guard", () => {
  it("does not false-positive-match a padded substring (mirrors Band B's ' ote ' bugfix)", () => {
    expect(resolveSessionKeyword("keynotes about the market")).toBeNull();
  });
});
