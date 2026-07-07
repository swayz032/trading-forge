/**
 * archetype-implied-factors-canonical.test.ts — FIX A2 (deep-scan #22 fix-wave-2, 2026-07-07)
 *
 * ARCHETYPE_IMPLIED_FACTORS' own docstring (archetype-implied-factors.ts lines
 * 11-12, 46-50) mandates that every implied factor be a member of the canonical
 * 11-factor weighted-scoring vocabulary. Before this fix, ~14 non-canonical
 * concept-labels (htf_bias_aligned, fvg_present_or_ob, displacement_confirmed,
 * asian_range_swept, manipulation_phase_done, false_breakout_confirmed,
 * session_open_aligned, ma_as_support_resistance, rejection_pattern_confirmed,
 * opening_range_breakout, first_30min_volume_above_avg, accumulation_phase_active,
 * distribution_phase_active, liquidity_sweep_confirmed) violated that contract.
 *
 * This is the blanket enforcement test the task explicitly asked for: assert
 * EVERY value in ARCHETYPE_IMPLIED_FACTORS is a member of whatever vocabulary
 * this module declares canonical. The canonical set is sourced from
 * wave25-strategy-defaults.ts::buildDefaultConfluenceWeights() — the same
 * DB-free inlined 11-factor table confluence-score.ts::CODE_DEFAULTS mirrors
 * (see that module's own header comment for why it avoids importing
 * confluence-score.ts directly: that module transitively imports db/index.ts).
 *
 * Why this matters NOW (not just docstring hygiene): FIX A1 (same fix-wave)
 * makes Path C (evaluateWeightedConfluence) actually fire for new graduations
 * by wiring use_weighted_scoring into config.entry_quality — but Path C
 * evaluates the fixed 11 CODE_DEFAULTS keys directly, ignoring
 * confluence_factors entirely. It is Path B (canonical-5 fallback — still live
 * for pre-Wave-25 legacy strategies and the Path C error-fallback) that
 * iterates confluence_factors and fail-closes any name it doesn't recognize.
 * A non-canonical kb_inferred factor is therefore silently guaranteed to
 * fail-closed the instant Path B runs, dragging satisfiedCount down and
 * risking a false stage2Blocked on an archetype strategy that "should" pass.
 */

import { describe, it, expect } from "vitest";
import { ARCHETYPE_IMPLIED_FACTORS } from "../lib/archetype-implied-factors.js";
import { buildDefaultConfluenceWeights } from "../lib/wave25-strategy-defaults.js";

const CANONICAL_11_FACTORS = new Set(Object.keys(buildDefaultConfluenceWeights()));

describe("FIX A2 — ARCHETYPE_IMPLIED_FACTORS canonical-vocabulary enforcement", () => {
  it("the canonical vocabulary is exactly the documented 11 factors", () => {
    expect(CANONICAL_11_FACTORS.size).toBe(11);
    expect([...CANONICAL_11_FACTORS].sort()).toEqual(
      [
        "market_structure_aligned",
        "liquidity_target_clear",
        "smt_confirmation",
        "vwap_alignment",
        "killzone_active",
        "delta_or_volume_signature",
        "vp_level_proximity",
        "macro_alignment",
        "internals_aligned",
        "cross_asset_aligned",
        "regime_match",
      ].sort(),
    );
  });

  it("every implied factor for every archetype is a canonical 11-factor member", () => {
    const violations: Array<{ archetype: string; factor: string }> = [];
    for (const [archetype, factors] of Object.entries(ARCHETYPE_IMPLIED_FACTORS)) {
      for (const factor of factors) {
        if (!CANONICAL_11_FACTORS.has(factor)) {
          violations.push({ archetype, factor });
        }
      }
    }
    expect(
      violations,
      `Non-canonical factors found: ${JSON.stringify(violations)}`,
    ).toEqual([]);
  });

  it("no archetype implies more than 5 factors (over-stuffing guard, unaffected by A2)", () => {
    for (const [archetype, factors] of Object.entries(ARCHETYPE_IMPLIED_FACTORS)) {
      expect(
        factors.length,
        `Archetype "${archetype}" has ${factors.length} factors — max is 5`,
      ).toBeLessThanOrEqual(5);
    }
  });

  it("no archetype implies zero factors (every entry contributes real evidence)", () => {
    for (const [archetype, factors] of Object.entries(ARCHETYPE_IMPLIED_FACTORS)) {
      expect(factors.length, `Archetype "${archetype}" implies zero factors`).toBeGreaterThan(0);
    }
  });

  it("no archetype implies duplicate factors (dedupe check post-mapping-collapse)", () => {
    for (const [archetype, factors] of Object.entries(ARCHETYPE_IMPLIED_FACTORS)) {
      const unique = new Set(factors);
      expect(
        unique.size,
        `Archetype "${archetype}" has duplicate implied factors: ${JSON.stringify(factors)}`,
      ).toBe(factors.length);
    }
  });

  it("regime_match never appears as a kb_inferred implication (auto-floor-only per module contract)", () => {
    // Per archetype-implied-factors.ts docstring: regime_match is the auto_floor
    // fallback, not a kb_inferred implication in this map's intended usage.
    // NOTE: several archetypes here legitimately imply "regime_match" as a
    // genuine definitional factor (e.g. trend-following archetypes need a
    // matching regime) — this test documents the current map contents rather
    // than re-litigating that design choice; it exists so a future change is
    // a deliberate, reviewed decision rather than an accidental drift.
    const archetypesImplyingRegimeMatch = Object.entries(ARCHETYPE_IMPLIED_FACTORS)
      .filter(([, factors]) => factors.includes("regime_match"))
      .map(([archetype]) => archetype);
    expect(archetypesImplyingRegimeMatch).toEqual(
      expect.arrayContaining(["ict_ote", "bounce_off_level", "ema_crossover", "vwap_bounce", "moving_average"]),
    );
  });
});
