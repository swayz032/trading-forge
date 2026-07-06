/**
 * recon-severity-clamp.test.ts — deep-scan A / Option B fix F-1 (BEHAVIORAL).
 *
 * Proves the degraded-mode clamp respects a DYNAMIC effective independent-source count: a genuine
 * reconciliation breach is clamped to yellow while Option B is OFF (2 sources — honest "can't
 * verify"), but reaches RED once Option B is wired (3 sources) — instead of being permanently
 * hidden as yellow. Pure-function test (leaf lib, no db boot), so it directly exercises the
 * runtime decision the operator's daily panel + audit trail depend on.
 */
import { describe, it, expect } from "vitest";
import { deriveReconSeverity } from "../lib/recon-severity.js";

const RED = 3; // stand-in for RECON_CONFIG.RED_MISMATCH_COUNT — we assert the clamp behavior
const MIN = 3; // MIN_INDEPENDENT_SOURCES_FOR_RED

describe("recon severity respects the DYNAMIC effective independent-source count", () => {
  it("Option B OFF (2 sources), clean+verifiable → yellow (green clamped — honest degraded)", () => {
    expect(deriveReconSeverity({ mismatchCount: 0, hasVerifiableData: true, effectiveIndependentSources: 2, redMismatchCount: RED, minIndependentSourcesForRed: MIN }))
      .toEqual({ severity: "yellow", degraded: true });
  });

  it("Option B ON (3 sources), clean+verifiable → GREEN (clamp lifts)", () => {
    expect(deriveReconSeverity({ mismatchCount: 0, hasVerifiableData: true, effectiveIndependentSources: 3, redMismatchCount: RED, minIndependentSourcesForRed: MIN }))
      .toEqual({ severity: "green", degraded: false });
  });

  it("THE BUG F-1 TARGETS: Option B OFF (2 sources) + real breach → yellow (breach hidden as degraded)", () => {
    expect(deriveReconSeverity({ mismatchCount: RED, hasVerifiableData: true, effectiveIndependentSources: 2, redMismatchCount: RED, minIndependentSourcesForRed: MIN }))
      .toEqual({ severity: "yellow", degraded: true });
  });

  it("THE F-1 FIX: Option B ON (3 sources) + real breach → RED (a genuine sent-vs-confirmed breach reaches red)", () => {
    expect(deriveReconSeverity({ mismatchCount: RED, hasVerifiableData: true, effectiveIndependentSources: 3, redMismatchCount: RED, minIndependentSourcesForRed: MIN }))
      .toEqual({ severity: "red", degraded: false });
  });

  it("clean but NOT verifiable → yellow (never green), even with 3 sources", () => {
    expect(deriveReconSeverity({ mismatchCount: 0, hasVerifiableData: false, effectiveIndependentSources: 3, redMismatchCount: RED, minIndependentSourcesForRed: MIN }))
      .toEqual({ severity: "yellow", degraded: false });
  });

  it("sub-threshold mismatch → yellow (below RED count, not clamped)", () => {
    expect(deriveReconSeverity({ mismatchCount: 1, hasVerifiableData: true, effectiveIndependentSources: 3, redMismatchCount: RED, minIndependentSourcesForRed: MIN }))
      .toEqual({ severity: "yellow", degraded: false });
  });
});
