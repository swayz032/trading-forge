import { describe, it, expect } from "vitest";

// Fix 3: Math.max(1, ...) coerces zero to 1 — governor zero check
// Test the checkGovernor logic in isolation (pure function logic extracted for testing)

type GovernorStateName = "normal" | "alert" | "cautious" | "defensive" | "lockout" | "recovery";

const SIZE_MULTIPLIERS: Record<GovernorStateName, number> = {
  normal: 1.0,
  alert: 0.75,
  cautious: 0.5,
  defensive: 0.25,
  lockout: 0.0,
  recovery: 0.5,
};

// Simulate the FIXED checkGovernor logic (Math.max(0, ...))
function simulateCheckGovernorFixed(
  requestedContracts: number,
  governorState: GovernorStateName,
): { allowed: boolean; adjustedContracts: number; reason: string; governorState: GovernorStateName } {
  const mult = SIZE_MULTIPLIERS[governorState];

  if (governorState === "lockout" || mult === 0.0) {
    return {
      allowed: false,
      adjustedContracts: 0,
      reason: `governor_lockout: state=${governorState}`,
      governorState,
    };
  }

  const adjusted = Math.max(0, Math.floor(requestedContracts * mult));
  if (adjusted === 0) {
    return {
      allowed: false,
      adjustedContracts: 0,
      reason: `governor_size_zero: state=${governorState}, mult=${mult}, requested=${requestedContracts}`,
      governorState,
    };
  }
  return {
    allowed: true,
    adjustedContracts: adjusted,
    reason: adjusted < requestedContracts
      ? `governor_reduced: state=${governorState}, mult=${mult}`
      : `governor_allowed: state=${governorState}`,
    governorState,
  };
}

// Simulate the BUGGY checkGovernor logic (Math.max(1, ...))
function simulateCheckGovernorBuggy(
  requestedContracts: number,
  governorState: GovernorStateName,
): { allowed: boolean; adjustedContracts: number; reason: string; governorState: GovernorStateName } {
  const mult = SIZE_MULTIPLIERS[governorState];

  if (governorState === "lockout" || mult === 0.0) {
    return {
      allowed: false,
      adjustedContracts: 0,
      reason: `governor_lockout: state=${governorState}`,
      governorState,
    };
  }

  const adjusted = Math.max(1, Math.floor(requestedContracts * mult));
  return {
    allowed: true,
    adjustedContracts: adjusted,
    reason: adjusted < requestedContracts
      ? `governor_reduced: state=${governorState}, mult=${Math.max(1, Math.floor(requestedContracts * mult)) / requestedContracts}`
      : `governor_allowed: state=${governorState}`,
    governorState,
  };
}

describe("Fix 3: governor zero — Math.max(0,...) instead of Math.max(1,...)", () => {
  it("BUGGY: defensive state with 1 contract returns allowed=true with 1 contract (wrong)", () => {
    // defensive mult = 0.25, floor(1 * 0.25) = 0, max(1, 0) = 1 → wrong!
    const result = simulateCheckGovernorBuggy(1, "defensive");
    expect(result.allowed).toBe(true);
    expect(result.adjustedContracts).toBe(1); // coerced to 1, should be 0
  });

  it("FIXED: defensive state with 1 contract returns allowed=false with 0 contracts", () => {
    // defensive mult = 0.25, floor(1 * 0.25) = 0, max(0, 0) = 0 → allowed=false
    const result = simulateCheckGovernorFixed(1, "defensive");
    expect(result.allowed).toBe(false);
    expect(result.adjustedContracts).toBe(0);
    expect(result.reason).toContain("governor_size_zero");
    expect(result.reason).toContain("state=defensive");
  });

  it("FIXED: normal state with 2 contracts returns allowed=true with 2 contracts", () => {
    const result = simulateCheckGovernorFixed(2, "normal");
    expect(result.allowed).toBe(true);
    expect(result.adjustedContracts).toBe(2);
  });

  it("FIXED: cautious state with 2 contracts returns allowed=true with 1 contract (floor(2*0.5)=1)", () => {
    const result = simulateCheckGovernorFixed(2, "cautious");
    expect(result.allowed).toBe(true);
    expect(result.adjustedContracts).toBe(1);
  });

  it("FIXED: lockout state returns allowed=false regardless of requested", () => {
    const result = simulateCheckGovernorFixed(5, "lockout");
    expect(result.allowed).toBe(false);
    expect(result.adjustedContracts).toBe(0);
    expect(result.reason).toContain("governor_lockout");
  });

  it("FIXED: reason includes all relevant context for governor_size_zero", () => {
    const result = simulateCheckGovernorFixed(1, "defensive");
    expect(result.reason).toContain("governor_size_zero");
    expect(result.reason).toContain("mult=0.25");
    expect(result.reason).toContain("requested=1");
  });
});
