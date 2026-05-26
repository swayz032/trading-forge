/**
 * wave26-pass-h2-archetype-implied-factors.test.ts
 * Wave 26 Pass H2 (2026-05-26)
 *
 * Verifies that:
 *   1. inferFactorsFromArchetype() returns correct factor sets for known archetypes
 *   2. Prefix stripping works ("archetype:ict_bias_aligned_continuation" == bare name)
 *   3. Unknown archetypes return []
 *   4. classifyFactorSources() correctly injects kb_inferred factors → rich
 *   5. Mixed scenarios (archetype + some extracted factors) work correctly
 *   6. Non-archetype entry_indicators (e.g. "ema_crossover") → no inference → unchanged
 *   7. The "fallback_only" path for non-archetype zero-extraction is unchanged
 *   8. Source contract: classifyFactorSources signature includes entryIndicator param
 *   9. Source contract: graduation call-site uses finalConfluenceFactors
 *  10. Source contract: archetype-implied-factors.ts imported in graduator
 *
 * Pattern: inferFactorsFromArchetype is imported directly from the lib module
 * (no DB dependency). classifyFactorSources logic is inlined (same pattern as
 * wave26-pass-g-b2-auditor-gates.test.ts) to avoid DATABASE_URL bootstrap.
 * Static source tests verify the graduator source matches the inline logic.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ─── Direct import — archetype-implied-factors.ts has NO DB dependency ────────
import {
  inferFactorsFromArchetype,
  ARCHETYPE_IMPLIED_FACTORS,
} from "../lib/archetype-implied-factors.js";

// ─── Static source for contract verification ─────────────────────────────────
const GRADUATOR_SRC = fs.readFileSync(
  path.resolve(__dirname, "../services/direct-bucket-graduator.ts"),
  "utf-8",
);

// ─── Inlined classifyFactorSources (Wave 26 Pass H2 version) ─────────────────
// Re-implemented to avoid DATABASE_URL bootstrap in the graduator import chain.
// Static source tests below verify the real graduator source matches.

type FactorSourceLabel = "extracted" | "auto_floor" | "kb_inferred";

function classifyFactorSources(
  rawFactors: string[],
  finalFactors: string[],
  entryIndicator?: string | null,
): {
  factor_sources: Record<string, FactorSourceLabel>;
  factor_quality: "rich" | "thin" | "fallback_only";
  mergedFactors: string[];
} {
  const rawSet = new Set(rawFactors);

  const impliedFactors: string[] = entryIndicator
    ? inferFactorsFromArchetype(entryIndicator)
    : [];

  const mergedSet = new Set(finalFactors);
  const kbInferredAdded: string[] = [];
  for (const implied of impliedFactors) {
    if (!mergedSet.has(implied)) {
      mergedSet.add(implied);
      kbInferredAdded.push(implied);
    }
  }
  const mergedFactors = [...mergedSet];
  const kbInferredSet = new Set(kbInferredAdded);

  const sources: Record<string, FactorSourceLabel> = {};
  for (const factor of mergedFactors) {
    if (rawSet.has(factor))            sources[factor] = "extracted";
    else if (kbInferredSet.has(factor)) sources[factor] = "kb_inferred";
    else                               sources[factor] = "auto_floor";
  }

  const realCount = mergedFactors.filter(
    (f) => sources[f] === "extracted" || sources[f] === "kb_inferred",
  ).length;

  let factor_quality: "rich" | "thin" | "fallback_only";
  if (realCount >= 2) {
    factor_quality = "rich";
  } else if (realCount === 1) {
    factor_quality = "thin";
  } else {
    factor_quality = "fallback_only";
  }

  return { factor_sources: sources, factor_quality, mergedFactors };
}

// ─────────────────────────────────────────────────────────────────────────────
// §1  inferFactorsFromArchetype() — direct lib tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Wave 26 Pass H2 — inferFactorsFromArchetype()", () => {

  it("returns 5 factors for ict_bias_aligned_continuation (bare name)", () => {
    const factors = inferFactorsFromArchetype("ict_bias_aligned_continuation");
    expect(factors).toHaveLength(5);
    expect(factors).toContain("market_structure_aligned");
    expect(factors).toContain("htf_bias_aligned");
    expect(factors).toContain("fvg_present_or_ob");
    expect(factors).toContain("liquidity_target_clear");
    expect(factors).toContain("killzone_active");
  });

  it("returns 5 factors for ict_bias_aligned_continuation (archetype: prefix)", () => {
    const factors = inferFactorsFromArchetype("archetype:ict_bias_aligned_continuation");
    expect(factors).toHaveLength(5);
    expect(factors).toContain("market_structure_aligned");
    expect(factors).toContain("htf_bias_aligned");
    expect(factors).toContain("fvg_present_or_ob");
    expect(factors).toContain("liquidity_target_clear");
    expect(factors).toContain("killzone_active");
  });

  it("prefix and bare name return identical arrays", () => {
    const bare   = inferFactorsFromArchetype("ict_bias_aligned_continuation");
    const prefixed = inferFactorsFromArchetype("archetype:ict_bias_aligned_continuation");
    expect(bare).toEqual(prefixed);
  });

  it("returns [] for unknown archetype name", () => {
    expect(inferFactorsFromArchetype("unknown_archetype_xyz")).toEqual([]);
  });

  it("returns [] for empty string", () => {
    expect(inferFactorsFromArchetype("")).toEqual([]);
  });

  it("returns 4 factors for ict_silver_bullet_ny_am, killzone_active first", () => {
    const factors = inferFactorsFromArchetype("ict_silver_bullet_ny_am");
    expect(factors).toHaveLength(4);
    expect(factors[0]).toBe("killzone_active");
  });

  it("returns 2 factors for fvg_retrace", () => {
    const factors = inferFactorsFromArchetype("fvg_retrace");
    expect(factors).toHaveLength(2);
    expect(factors).toContain("fvg_present_or_ob");
    expect(factors).toContain("market_structure_aligned");
  });

  it("all archetypes in the map have ≤5 implied factors (no over-stuffing guard)", () => {
    for (const [archetype, factors] of Object.entries(ARCHETYPE_IMPLIED_FACTORS)) {
      expect(
        factors.length,
        `Archetype "${archetype}" has ${factors.length} factors — max is 5`,
      ).toBeLessThanOrEqual(5);
    }
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// §2  classifyFactorSources() — kb_inferred injection via archetype
// ─────────────────────────────────────────────────────────────────────────────

describe("Wave 26 Pass H2 — classifyFactorSources() archetype kb_inferred path", () => {

  it("archetype with 0 extracted factors → factor_quality=rich (all kb_inferred)", () => {
    // The exact evidence scenario from the bug report:
    // Gemma emits ict_bias_aligned_continuation, LLM gives 0 confluence factors,
    // floor guard injects ["regime_match", "structural_setup"].
    // Result before H2: fallback_only.  After H2: rich.
    const rawLlm:     string[] = [];
    const afterFloor            = ["regime_match", "structural_setup"];
    const entryIndicator        = "archetype:ict_bias_aligned_continuation";

    const { factor_sources, factor_quality, mergedFactors } = classifyFactorSources(
      rawLlm,
      afterFloor,
      entryIndicator,
    );

    expect(factor_quality).toBe("rich");

    // All 5 archetype-implied factors must be present and tagged kb_inferred
    expect(factor_sources["market_structure_aligned"]).toBe("kb_inferred");
    expect(factor_sources["htf_bias_aligned"]).toBe("kb_inferred");
    expect(factor_sources["fvg_present_or_ob"]).toBe("kb_inferred");
    expect(factor_sources["liquidity_target_clear"]).toBe("kb_inferred");
    expect(factor_sources["killzone_active"]).toBe("kb_inferred");

    // Auto-floor factors are still tagged auto_floor
    expect(factor_sources["regime_match"]).toBe("auto_floor");
    expect(factor_sources["structural_setup"]).toBe("auto_floor");

    // mergedFactors includes both floor + implied
    expect(mergedFactors).toContain("market_structure_aligned");
    expect(mergedFactors).toContain("regime_match");
    // Total: 2 auto_floor + 5 kb_inferred = 7
    expect(mergedFactors).toHaveLength(7);
  });

  it("archetype with 1 extracted factor → rich (extracted + kb_inferred ≥ 2)", () => {
    const rawLlm     = ["killzone_active"];     // LLM got one right
    const afterFloor = ["killzone_active", "regime_match"];
    const entryIndicator = "archetype:ict_bias_aligned_continuation";

    const { factor_quality, factor_sources } = classifyFactorSources(
      rawLlm,
      afterFloor,
      entryIndicator,
    );

    expect(factor_quality).toBe("rich");
    // The one the LLM extracted is "extracted"
    expect(factor_sources["killzone_active"]).toBe("extracted");
    // Implied ones not already present are kb_inferred
    expect(factor_sources["market_structure_aligned"]).toBe("kb_inferred");
    expect(factor_sources["htf_bias_aligned"]).toBe("kb_inferred");
    expect(factor_sources["fvg_present_or_ob"]).toBe("kb_inferred");
    expect(factor_sources["liquidity_target_clear"]).toBe("kb_inferred");
    // regime_match was in afterFloor, NOT in the archetype's implied set that wasn't already there
    expect(factor_sources["regime_match"]).toBe("auto_floor");
  });

  it("archetype with 3 extracted factors → rich, remaining implied still kb_inferred", () => {
    const rawLlm     = ["market_structure_aligned", "killzone_active", "fvg_present_or_ob"];
    const afterFloor = [...rawLlm]; // no floor additions needed
    const entryIndicator = "archetype:ict_bias_aligned_continuation";

    const { factor_quality, factor_sources } = classifyFactorSources(
      rawLlm,
      afterFloor,
      entryIndicator,
    );

    expect(factor_quality).toBe("rich");
    expect(factor_sources["market_structure_aligned"]).toBe("extracted");
    expect(factor_sources["killzone_active"]).toBe("extracted");
    expect(factor_sources["fvg_present_or_ob"]).toBe("extracted");
    // 2 remaining implied
    expect(factor_sources["htf_bias_aligned"]).toBe("kb_inferred");
    expect(factor_sources["liquidity_target_clear"]).toBe("kb_inferred");
  });

  it("non-archetype entry_indicator → no inference → fallback_only when 0 extracted", () => {
    const rawLlm:    string[] = [];
    const afterFloor           = ["regime_match", "structural_setup"];
    const entryIndicator       = "ema_crossover"; // parametric, NOT an archetype

    const { factor_quality, factor_sources, mergedFactors } = classifyFactorSources(
      rawLlm,
      afterFloor,
      entryIndicator,
    );

    expect(factor_quality).toBe("fallback_only");
    expect(Object.values(factor_sources).every((s) => s === "auto_floor")).toBe(true);
    expect(mergedFactors).toEqual(["regime_match", "structural_setup"]);
  });

  it("null entryIndicator → no inference → fallback_only when 0 extracted", () => {
    const { factor_quality } = classifyFactorSources([], ["regime_match", "structural_setup"], null);
    expect(factor_quality).toBe("fallback_only");
  });

  it("undefined entryIndicator → no inference → fallback_only when 0 extracted", () => {
    const { factor_quality } = classifyFactorSources([], ["regime_match", "structural_setup"]);
    expect(factor_quality).toBe("fallback_only");
  });

  it("does not duplicate factors already present in afterFloor", () => {
    // market_structure_aligned is in the archetype implied set AND in rawLlm/afterFloor
    const rawLlm     = ["market_structure_aligned"];
    const afterFloor = ["market_structure_aligned", "regime_match"];
    const entryIndicator = "archetype:ict_bias_aligned_continuation";

    const { mergedFactors } = classifyFactorSources(rawLlm, afterFloor, entryIndicator);

    const count = mergedFactors.filter((f) => f === "market_structure_aligned").length;
    expect(count).toBe(1);
  });

  it("unknown archetype → no inference → classifies by extracted factors only", () => {
    const rawLlm     = ["market_structure_aligned"];
    const afterFloor = ["market_structure_aligned", "regime_match"];
    const entryIndicator = "archetype:completely_unknown_archetype_xyz";

    const { factor_quality, mergedFactors } = classifyFactorSources(
      rawLlm,
      afterFloor,
      entryIndicator,
    );

    // 1 extracted factor → thin (unknown archetype adds nothing)
    expect(factor_quality).toBe("thin");
    expect(mergedFactors).toEqual(["market_structure_aligned", "regime_match"]);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// §3  Static source contracts
// ─────────────────────────────────────────────────────────────────────────────

describe("Wave 26 Pass H2 — static source contracts", () => {

  it("imports inferFactorsFromArchetype from archetype-implied-factors.js", () => {
    expect(GRADUATOR_SRC).toContain("inferFactorsFromArchetype");
    expect(GRADUATOR_SRC).toContain("archetype-implied-factors.js");
  });

  it("classifyFactorSources signature includes entryIndicator as third parameter", () => {
    expect(GRADUATOR_SRC).toContain(
      "entryIndicator?: string | null",
    );
  });

  it("classifyFactorSources call-site in graduation hot-path passes entryIndicator", () => {
    expect(GRADUATOR_SRC).toMatch(
      /classifyFactorSources\s*\(\s*rawConfluenceFactors\s*,\s*confluenceFactors\s*,\s*entryIndicator\s*\)/,
    );
  });

  it("classifyFactorSources returns mergedFactors and hot-path uses it as finalConfluenceFactors", () => {
    expect(GRADUATOR_SRC).toContain("mergedFactors: finalConfluenceFactors");
    expect(GRADUATOR_SRC).toContain("confluence_factors: finalConfluenceFactors");
  });

  it("entryQualityBlock.confluence_factors is finalConfluenceFactors (not rawConfluenceFactors)", () => {
    const assignIdx = GRADUATOR_SRC.indexOf("const entryQualityBlock: EntryQualityWithSources");
    expect(assignIdx).toBeGreaterThan(0);
    const block = GRADUATOR_SRC.slice(assignIdx, assignIdx + 400);
    expect(block).toContain("finalConfluenceFactors");
    expect(block).not.toContain("confluence_factors: confluenceFactors,");
  });

  it("kb_inferred is a valid FactorSourceLabel type in graduator", () => {
    expect(GRADUATOR_SRC).toContain('"kb_inferred"');
  });

});
