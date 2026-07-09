import { describe, it, expect } from "vitest";
import {
  deriveEvidenceBackedConfluenceCount,
  evidenceBackedFactorCount,
} from "../lib/confluence-provenance.js";
import { resolveConfluenceMultiplier } from "../lib/risk-sizing.js";

/**
 * Deep-scan #22 FIX F-1 (2026-07-09) — sizing-provenance type-bug.
 *
 * THE BUG: paper-signal-service.ts:5294-5304 (pre-fix) derived the sizing
 * `confluenceCount` by passing `entry_quality.confirming_indicators` — an array
 * of `{indicator, params, direction}` OBJECTS (deep-scan #22 FIX A1 populated
 * this shape) — into `evidenceBackedFactorCount(factors: string[])`. Since
 * `AUTO_FLOOR_FACTORS.has(object)` is always false, the 2026-06-30
 * auto_floor-exclusion control never fired: every confluence strategy was
 * credited as fully evidence-backed and could size up (1.5x/2x) on
 * graduator-injected quality-floor factors (regime_match / structural_setup),
 * not real YouTube-extracted edge.
 *
 * THE FIX: `deriveEvidenceBackedConfluenceCount()` reads the CORRECT field
 * (`entry_quality.confluence_factors`, the string[] Stage 2 already reads at
 * paper-signal-service.ts:4880) and prefers the per-factor `factor_sources`
 * provenance map over the static AUTO_FLOOR_FACTORS set when present.
 */
describe("deep-scan #22 FIX F-1 — deriveEvidenceBackedConfluenceCount", () => {
  it("undefined entry_quality → 1 (primary always counts)", () => {
    expect(deriveEvidenceBackedConfluenceCount(undefined)).toBe(1);
    expect(deriveEvidenceBackedConfluenceCount(null)).toBe(1);
  });

  it("all-auto_floor confluence_factors (static AUTO_FLOOR_FACTORS fallback, no factor_sources) → 1", () => {
    expect(
      deriveEvidenceBackedConfluenceCount({
        confluence_factors: ["regime_match", "structural_setup"],
      }),
    ).toBe(1);
  });

  it("mixed evidence-backed + auto_floor factors (static fallback) → 3", () => {
    expect(
      deriveEvidenceBackedConfluenceCount({
        confluence_factors: ["vwap_alignment", "smt_confirmation", "regime_match"],
      }),
    ).toBe(3);
  });

  it("factor_sources provenance map OVERRIDES static AUTO_FLOOR_FACTORS set — explicit auto_floor tag excludes even a non-canonical name", () => {
    expect(
      deriveEvidenceBackedConfluenceCount({
        confluence_factors: ["x"],
        factor_sources: { x: "auto_floor" },
      }),
    ).toBe(1);
  });

  it("factor_sources provenance map: extracted + kb_inferred both count as evidence-backed → 3", () => {
    expect(
      deriveEvidenceBackedConfluenceCount({
        confluence_factors: ["a", "b"],
        factor_sources: { a: "extracted", b: "kb_inferred" },
      }),
    ).toBe(3);
  });

  it("empty confluence_factors array → 1", () => {
    expect(deriveEvidenceBackedConfluenceCount({ confluence_factors: [] })).toBe(1);
  });

  it("REGRESSION: the OLD bug shape (confirming_indicators objects, empty confluence_factors) now yields 1, was inflating to 2 pre-fix", () => {
    // This mirrors the exact malformed input the pre-fix call site produced:
    // entry_quality carrying FIX-A1-shaped confirming_indicators objects but an
    // empty (or absent) confluence_factors array. The OLD code path passed
    // confirming_indicators (typed as ConfirmingIndicator[] objects) into
    // evidenceBackedFactorCount(factors: string[]) — AUTO_FLOOR_FACTORS.has(obj)
    // is always false, so the OLD buggy count = confirming_indicators.length + 1 = 2.
    const buggyEntryQuality = {
      confluence_factors: [] as string[],
      confirming_indicators: [{ indicator: "ema", params: {}, direction: "agree" as const }],
    };

    // Prove the OLD bug shape, standalone (does not touch the fixed helper):
    const oldBuggyCount =
      evidenceBackedFactorCount(
        // @ts-expect-error — deliberately passing objects where string[] is expected,
        // reproducing the pre-fix type-bug call site verbatim for the regression proof.
        buggyEntryQuality.confirming_indicators,
      ) + 1;
    expect(oldBuggyCount).toBe(2); // the bug: AUTO_FLOOR_FACTORS.has(object) always false

    // The FIXED helper reads confluence_factors (empty here) and ignores
    // confirming_indicators entirely — correct result is 1, not 2.
    const fixedCount = deriveEvidenceBackedConfluenceCount(buggyEntryQuality);
    expect(fixedCount).toBe(1);
  });
});

describe("deep-scan #22 FIX F-1 — fix reaches sizing (multiplier map)", () => {
  it("all-auto_floor confluence_count=1 produces a SMALLER-OR-EQUAL multiplier than genuine confluence_count=3", () => {
    const allAutoFloorCount = deriveEvidenceBackedConfluenceCount({
      confluence_factors: ["regime_match", "structural_setup"],
    });
    const genuineCount = deriveEvidenceBackedConfluenceCount({
      confluence_factors: ["vwap_alignment", "smt_confirmation", "liquidity_target_clear"],
    });
    expect(allAutoFloorCount).toBe(1);
    expect(genuineCount).toBe(4);

    const allAutoFloorMultiplier = resolveConfluenceMultiplier(allAutoFloorCount);
    const genuineMultiplier = resolveConfluenceMultiplier(genuineCount);

    expect(allAutoFloorMultiplier).toBe(1.0); // no upsize
    expect(genuineMultiplier).toBe(2.0); // full upsize
    expect(allAutoFloorMultiplier).toBeLessThanOrEqual(genuineMultiplier);
  });

  it("FAIL-pre / PASS-post: reproduces the pre-fix inflated count feeding a bigger multiplier than the fixed count", () => {
    // Pre-fix: confirming_indicators (objects) length + 1, AUTO_FLOOR_FACTORS.has(object) always
    // false → count is never reduced regardless of provenance.
    const preFixConfirmingIndicators = [
      { indicator: "regime_match_proxy", params: {}, direction: "agree" as const },
      { indicator: "structural_setup_proxy", params: {}, direction: "agree" as const },
      { indicator: "structural_setup_proxy_2", params: {}, direction: "agree" as const },
    ];
    const preFixCount =
      evidenceBackedFactorCount(
        // @ts-expect-error — reproducing the pre-fix type-bug call site
        preFixConfirmingIndicators,
      ) + 1;
    expect(preFixCount).toBe(4); // FAIL condition: bug inflates to max multiplier tier
    expect(resolveConfluenceMultiplier(preFixCount)).toBe(2.0); // pre-fix: wrongly full upsize

    // Post-fix: same underlying graduation, but entry_quality carries the CORRECT
    // confluence_factors (all auto_floor tags) — the fixed helper correctly excludes them.
    const postFixEntryQuality = {
      confluence_factors: ["regime_match", "structural_setup", "structural_setup"],
    };
    const postFixCount = deriveEvidenceBackedConfluenceCount(postFixEntryQuality);
    expect(postFixCount).toBe(1); // PASS condition: correctly excluded, no upsize
    expect(resolveConfluenceMultiplier(postFixCount)).toBe(1.0);

    // The fix only ever reduces or holds the multiplier — never increases it.
    expect(resolveConfluenceMultiplier(postFixCount)).toBeLessThanOrEqual(
      resolveConfluenceMultiplier(preFixCount),
    );
  });
});
