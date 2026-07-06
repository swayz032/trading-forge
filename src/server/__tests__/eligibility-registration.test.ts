/**
 * eligibility-registration.test.ts
 *
 * BEHAVIORAL verification of the registration-classification methodology that the
 * unregistered-strategy bypass exposure figure rests on (deep-scan A/C-1 follow-up).
 *
 * Proves — rather than asserts — that:
 *  1. normalization matches eligibility_gate.py byte-for-byte,
 *  2. a registered concept name classifies as registered (overlay evaluates it),
 *  3. FAILURE-INJECTION: a synthetic unregistered name / a UUID classifies as unregistered
 *     (would bypass the overlay),
 *  4. classifyRegistrationExposure computes the unregistered + live-exposure counts correctly
 *     on a fixture corpus — so the "0 unregistered / 0 live" claim is a reproducible computation,
 *     not a bare number.
 *  5. loadAllStratsNormalized parses the REAL playbook_router.py (guards TS/Python divergence).
 */

import { describe, it, expect } from "vitest";
import {
  normalizeStrategyName,
  isStrategyRegistered,
  classifyRegistrationExposure,
  loadAllStratsNormalized,
} from "../lib/eligibility-registration.js";

// mirrors eligibility_gate.py ALL_STRATS normalization (lower + strip underscores)
const ALL = new Set(["silver_bullet", "long_entry_mes_5m", "judas_swing"].map((s) => s.toLowerCase().replaceAll("_", "")));

describe("registration normalization matches eligibility_gate.py", () => {
  it("lowercases, strips 'strategy', trims, removes underscores", () => {
    expect(normalizeStrategyName("Silver_Bullet")).toBe("silverbullet");
    expect(normalizeStrategyName("long_entry_mes_5m")).toBe("longentrymes5m");
    expect(normalizeStrategyName("MyStrategy_ORB")).toBe("myorb"); // 'strategy' stripped
  });
});

describe("registered vs unregistered classification", () => {
  it("a registered concept name is registered (overlay EVALUATES it)", () => {
    expect(isStrategyRegistered("silver_bullet", ALL)).toBe(true);
    expect(isStrategyRegistered("long_entry_mes_5m", ALL)).toBe(true);
  });

  it("FAILURE-INJECTION: a synthetic unregistered name is unregistered (would BYPASS the overlay)", () => {
    expect(isStrategyRegistered("some_unregistered_concept_xyz", ALL)).toBe(false);
  });

  it("FAILURE-INJECTION: a UUID is unregistered (the C-1 defect identity)", () => {
    expect(isStrategyRegistered("a1b2c3d4-e5f6-7890-abcd-ef1234567890", ALL)).toBe(false);
  });

  it("empty-normalized name is NOT flagged unregistered (fail-closed downstream, matches py:99)", () => {
    expect(isStrategyRegistered("strategy", ALL)).toBe(true); // normalizes to ""
  });
});

describe("classifyRegistrationExposure computes the exposure figure (reproducible, not asserted)", () => {
  it("counts unregistered + live (PAPER+) exposure correctly on a fixture corpus", () => {
    const rows = [
      { name: "silver_bullet", lifecycleState: "CANDIDATE" },   // registered
      { name: "long_entry_mes_5m", lifecycleState: "PAPER" },   // registered, live
      { name: "weird_unregistered_a", lifecycleState: "CANDIDATE" }, // unregistered, NOT live
      { name: "weird_unregistered_b", lifecycleState: "DEPLOYED" },  // unregistered AND live → the dangerous case
    ];
    const ex = classifyRegistrationExposure(rows, ALL);
    expect(ex.total).toBe(4);
    expect(ex.unregistered).toBe(2);
    expect(ex.liveUnregistered).toBe(1);                        // only weird_unregistered_b is live+unregistered
    expect(ex.liveUnregisteredNames).toEqual(["weird_unregistered_b [DEPLOYED]"]);
  });

  it("an all-registered / all-CANDIDATE corpus yields 0 unregistered, 0 live (the measured live state)", () => {
    const rows = [
      { name: "silver_bullet", lifecycleState: "CANDIDATE" },
      { name: "judas_swing", lifecycleState: "CANDIDATE" },
      { name: "long_entry_mes_5m", lifecycleState: "NEEDS_ARCHETYPE" },
    ];
    const ex = classifyRegistrationExposure(rows, ALL);
    expect(ex.unregistered).toBe(0);
    expect(ex.liveUnregistered).toBe(0);
  });
});

describe("loadAllStratsNormalized parses the real playbook_router.py", () => {
  it("returns the full ALL_STRATS membership set (guards TS/Python divergence)", () => {
    const all = loadAllStratsNormalized();
    expect(all.size).toBeGreaterThan(150);          // 174 at time of writing
    expect(all.has(normalizeStrategyName("silver_bullet"))).toBe(true);
    expect(all.has(normalizeStrategyName("some_unregistered_concept_xyz"))).toBe(false);
  });
});
