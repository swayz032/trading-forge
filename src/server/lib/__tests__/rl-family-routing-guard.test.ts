/**
 * rl-family-routing-guard.test.ts — MED-2 (quantum re-scan 2026-07-10)
 *
 * Behavioral coverage for the family A/B-routing invariant that previously had NONE
 * (paper-signal-service.ts inline override was only naming/schema-asserted). rl-challenger
 * paper routing is OPERATOR-ONLY — a family strategy must never route to rl-challenger.
 */

import { describe, it, expect } from "vitest";
import { resolveEffectiveRouting } from "../rl-family-routing-guard.js";

describe("resolveEffectiveRouting — family invariant (MED-2)", () => {
  it("FORCES rl-challenger → baseline for a FAMILY strategy (the invariant)", () => {
    const r = resolveEffectiveRouting("rl-challenger", true);
    expect(r.effectiveRouting).toBe("baseline");
    expect(r.overridden).toBe(true);
  });

  it("KEEPS rl-challenger for a NON-family (operator) strategy", () => {
    const r = resolveEffectiveRouting("rl-challenger", false);
    expect(r.effectiveRouting).toBe("rl-challenger");
    expect(r.overridden).toBe(false);
  });

  it("baseline passes through unchanged (family or not)", () => {
    expect(resolveEffectiveRouting("baseline", true)).toEqual({ effectiveRouting: "baseline", overridden: false });
    expect(resolveEffectiveRouting("baseline", false)).toEqual({ effectiveRouting: "baseline", overridden: false });
  });

  it("only rl-challenger is guarded — an unknown routing value on a family strategy is NOT overridden", () => {
    // The guard is narrow by design: it only rescues the specific dangerous case
    // (rl-challenger on family). Any other value is passed through as-is.
    const r = resolveEffectiveRouting("some-future-routing", true);
    expect(r.effectiveRouting).toBe("some-future-routing");
    expect(r.overridden).toBe(false);
  });
});

// ─── Wiring guard: paper-signal-service actually uses the helper for the override ──
describe("wiring contract — paper-signal-service uses resolveEffectiveRouting (MED-2)", () => {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const { fileURLToPath } = require("node:url") as typeof import("node:url");
  const { dirname, resolve } = require("node:path") as typeof import("node:path");
  const src = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../services/paper-signal-service.ts"),
    "utf-8",
  );

  it("imports and calls resolveEffectiveRouting with (routingDecision, isFamilyStrategy)", () => {
    expect(src).toContain('from "../lib/rl-family-routing-guard.js"');
    expect(src).toMatch(/resolveEffectiveRouting\s*\(\s*routingDecision\s*,\s*isFamilyStrategy\s*\)/);
    // The effective routing must come from the guard result (not a hard-coded "baseline").
    expect(src).toMatch(/effectiveRoutingDecision\s*=\s*familyGuard\.effectiveRouting/);
    // The override branch must gate on the guard's decision.
    expect(src).toMatch(/if\s*\(\s*familyGuard\.overridden\s*\)/);
  });
});
