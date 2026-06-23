import { describe, it, expect, afterEach } from "vitest";
import { resolveConsistencyEnforced } from "../lib/consistency-lane.js";

describe("consistency-lane — opt-in consistency rule (Standard lane default OFF)", () => {
  const orig = { ...process.env };
  afterEach(() => { process.env = { ...orig }; });

  it("DEFAULT is OFF (funded Standard lane — big days allowed)", () => {
    delete process.env.TOPSTEP_CONSISTENCY_RULE_ENFORCED;
    delete process.env.CONSISTENCY_RULE_ENFORCED;
    expect(resolveConsistencyEnforced(null)).toBe(false);
    expect(resolveConsistencyEnforced({})).toBe(false);
  });

  it("explicit per-session boolean wins", () => {
    expect(resolveConsistencyEnforced({ consistency_rule_enforced: true })).toBe(true);
    expect(resolveConsistencyEnforced({ consistency_rule_enforced: false })).toBe(false);
  });

  it("lane/phase string: eval + consistency → ON; standard + funded → OFF", () => {
    expect(resolveConsistencyEnforced({ consistency_lane: "eval" })).toBe(true);
    expect(resolveConsistencyEnforced({ consistency_lane: "consistency" })).toBe(true);
    expect(resolveConsistencyEnforced({ consistency_lane: "standard" })).toBe(false);
    expect(resolveConsistencyEnforced({ phase: "eval" })).toBe(true);
    expect(resolveConsistencyEnforced({ phase: "funded" })).toBe(false);
  });

  it("env TOPSTEP_CONSISTENCY_RULE_ENFORCED=true flips default ON (for an eval run)", () => {
    process.env.TOPSTEP_CONSISTENCY_RULE_ENFORCED = "true";
    expect(resolveConsistencyEnforced(null)).toBe(true);
    expect(resolveConsistencyEnforced({})).toBe(true);
  });

  it("explicit boolean overrides env", () => {
    process.env.TOPSTEP_CONSISTENCY_RULE_ENFORCED = "true";
    expect(resolveConsistencyEnforced({ consistency_rule_enforced: false })).toBe(false);
  });
});
