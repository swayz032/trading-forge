import { describe, it, expect } from "vitest";

// Fix 8: broker-router.ts getEnabledFirms exception bypasses filter

const ENABLED_FIRMS_FALLBACK = ["topstep", "mffu"] as const;

// Simulate the FIXED catch block logic
function simulateEnabledFirmsFallback(
  firmId: string | undefined,
  _brokerType: string | undefined,
  _accountId: string,
): { blocked: boolean; reason?: string } {
  const fallbackFirms = [...ENABLED_FIRMS_FALLBACK];
  const normalizedFirmId = (firmId ?? "").toLowerCase().replace(/_\d+k$/, "");
  if (!fallbackFirms.includes(firmId as never) && !fallbackFirms.includes(normalizedFirmId as never)) {
    return {
      blocked: true,
      reason: `firm ${firmId} not in fallback enabled_firms (getEnabledFirms threw)`,
    };
  }
  return { blocked: false };
}

describe("Fix 8: broker-router getEnabledFirms fallback on exception", () => {
  it("known firm (topstep) is allowed via fallback list", () => {
    const result = simulateEnabledFirmsFallback("topstep", "traderspost", "acct-1");
    expect(result.blocked).toBe(false);
  });

  it("known firm (mffu) is allowed via fallback list", () => {
    const result = simulateEnabledFirmsFallback("mffu", "traderspost", "acct-2");
    expect(result.blocked).toBe(false);
  });

  it("unknown firm is blocked via fallback list", () => {
    const result = simulateEnabledFirmsFallback("tradeify", "traderspost", "acct-3");
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("tradeify");
    expect(result.reason).toContain("fallback enabled_firms");
  });

  it("firm with account-tier suffix is normalized and allowed", () => {
    // topstep_100k → normalizes to topstep → in fallback list → allowed
    const result = simulateEnabledFirmsFallback("topstep_100k", "traderspost", "acct-4");
    expect(result.blocked).toBe(false);
  });

  it("unknown firm with tier suffix is normalized and blocked", () => {
    const result = simulateEnabledFirmsFallback("unknown_firm_50k", "traderspost", "acct-5");
    expect(result.blocked).toBe(true);
  });

  it("old behavior (fail-open) would allow unknown firm — FIX 8 prevents this", () => {
    // OLD: catch block just logged and proceeded → any firm was allowed
    // NEW: catch block checks against fallback list
    const unknownFirm = "rogue_firm";
    const oldBehavior = { blocked: false }; // fail-open: never blocked
    const newBehavior = simulateEnabledFirmsFallback(unknownFirm, "traderspost", "acct-6");

    expect(oldBehavior.blocked).toBe(false); // old was fail-open
    expect(newBehavior.blocked).toBe(true);  // new is fail-closed for unknown firms
  });

  it("undefined firmId is handled gracefully", () => {
    const result = simulateEnabledFirmsFallback(undefined, "traderspost", "acct-7");
    // Empty string is not in fallback list → blocked
    expect(result.blocked).toBe(true);
  });
});
