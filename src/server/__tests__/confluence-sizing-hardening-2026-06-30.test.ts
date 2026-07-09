import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { evidenceBackedFactorCount } from "../lib/confluence-provenance.js";
import { resolveConfluenceMultiplier } from "../lib/risk-sizing.js";

// Deep-scan #22 loop-3 (2026-07-09): the confluence-weighted upsize is now gated behind
// CONFLUENCE_SIZE_UPSIZE_ENABLED (default false — see risk-sizing.ts::resolveConfluenceMultiplier).
// This file specifically tests the upsize FEATURE, so it opts in for its entire duration and
// restores the prior value afterward so it doesn't leak into other test files.
const _PRIOR_UPSIZE_ENV = process.env.CONFLUENCE_SIZE_UPSIZE_ENABLED;
beforeAll(() => {
  process.env.CONFLUENCE_SIZE_UPSIZE_ENABLED = "true";
});
afterAll(() => {
  if (_PRIOR_UPSIZE_ENV === undefined) delete process.env.CONFLUENCE_SIZE_UPSIZE_ENABLED;
  else process.env.CONFLUENCE_SIZE_UPSIZE_ENABLED = _PRIOR_UPSIZE_ENV;
});

/**
 * Confluence→sizing hardening (2026-06-30).
 *
 * Bug: paper-signal-service.ts sized the 1.5×/2× position-size multiplier off the CONFIGURED
 * `confirming_indicators.length`, so graduator-injected auto_floor confluences (regime_match /
 * structural_setup — Trading Forge overlay, NOT YouTube-extracted edge) could upsize live position
 * size without being real edge. Fix: size only on EVIDENCE-BACKED (non-auto_floor) factors.
 */
describe("confluence→sizing hardening: auto_floor confluences must not upsize", () => {
  it("excludes auto_floor factors (regime_match / structural_setup) from the evidence-backed count", () => {
    expect(evidenceBackedFactorCount(["regime_match", "structural_setup"])).toBe(0);
    expect(evidenceBackedFactorCount(["liquidity_target_clear", "vwap_alignment"])).toBe(2);
    expect(evidenceBackedFactorCount(["liquidity_target_clear", "regime_match", "structural_setup"])).toBe(1);
  });

  it("auto_floor-only confluences do NOT trigger the 1.5×/2× size upsize (fail-safe)", () => {
    const confirming = ["regime_match", "structural_setup"]; // graduator floor padding only
    const confluenceCount = evidenceBackedFactorCount(confirming) + 1; // +1 = primary entry always counts
    expect(confluenceCount).toBe(1);
    expect(resolveConfluenceMultiplier(confluenceCount)).toBe(1.0); // NO upsize
  });

  it("regression guard: the OLD configured-length formula would have over-sized; the fix prevents it", () => {
    const confirming = ["regime_match", "structural_setup", "structural_setup"];
    const oldBuggyCount = confirming.length + 1; // = 4 → 2.0× (the over-sizing bug)
    expect(resolveConfluenceMultiplier(oldBuggyCount)).toBe(2.0);
    const fixedCount = evidenceBackedFactorCount(confirming) + 1; // = 1 → 1.0×
    expect(resolveConfluenceMultiplier(fixedCount)).toBe(1.0);
  });

  it("genuine evidence-backed confluence still upsizes correctly", () => {
    const confirming = ["liquidity_target_clear", "vwap_alignment", "smt_confirmation"]; // 3 extracted
    const count = evidenceBackedFactorCount(confirming) + 1; // = 4 → 2.0×
    expect(count).toBe(4);
    expect(resolveConfluenceMultiplier(count)).toBe(2.0);
    // one extracted confirming → count 2 → 1.0× (one confirmation is not enough to upsize, per W23H.4)
    expect(resolveConfluenceMultiplier(evidenceBackedFactorCount(["vwap_alignment"]) + 1)).toBe(1.0);
  });
});
