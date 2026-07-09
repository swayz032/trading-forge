/**
 * deepscan22-fix-a1-entry-quality-dead-path.test.ts — FIX A1 (deep-scan #22
 * fix-wave-2, 2026-07-07)
 *
 * THE BUG: direct-bucket-graduator.ts wrote `use_weighted_scoring` as a
 * TOP-LEVEL `strategies.use_weighted_scoring` DB column and `confirming_indicators`
 * at TOP-LEVEL `config.confirming_indicators` — but the runtime dispatcher in
 * paper-signal-service.ts (lines 4161-4177, 4363, 4767) reads BOTH fields from
 * INSIDE `config.entry_quality`. Every graduated strategy therefore silently
 * fell to legacy Path B (5-factor boolean counting), where Wave-vocabulary
 * confluence_factors (market_structure_aligned, liquidity_target_clear, etc.)
 * hit `unknown_factor_fail_closed` and could push satisfiedCount below
 * min_factors_satisfied — BLOCKING the entry outright.
 *
 * THE FIX: stamp `use_weighted_scoring` and (when the LLM genuinely extracted
 * structured confirming indicators) `confirming_indicators` INSIDE the
 * entryQualityBlock object written to config.entry_quality.
 *
 * This is a round-trip test: it builds the EXACT config shape the graduator
 * writes (pre-fix and post-fix), then reads it back through the EXACT
 * field-access expression paper-signal-service.ts uses at signal-evaluation
 * time (copied verbatim below, mirrored against the live source via the
 * static-contract tests in §3). Per repo convention for this file (heavy
 * DB import chain — see wave26-pass-i-graduator-v11-fields.test.ts and
 * wave26-pass-h2-archetype-implied-factors.test.ts), the reader logic is
 * exercised directly on plain objects rather than through a live DB round-trip.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ─── Exact reader expression, copied verbatim from paper-signal-service.ts:4161-4177 ──
interface ConfirmingIndicatorShape {
  indicator: string;
  params: Record<string, number>;
  direction: "agree" | "disagree" | "either";
  weight?: number;
}

interface EntryQualityShape {
  confluence_factors?: string[];
  min_factors_satisfied?: number;
  extraction_provenance?: string;
  confirming_indicators?: ConfirmingIndicatorShape[];
  use_weighted_scoring?: boolean;
}

function readEntryQuality(config: Record<string, unknown>): EntryQualityShape | undefined {
  const rawConfig = config as unknown as Record<string, unknown>;
  return (
    rawConfig.entry_quality ??
    (rawConfig.strategy as Record<string, unknown> | undefined)?.entry_quality
  ) as EntryQualityShape | undefined;
}

// Mirrors the paper-signal-service.ts dispatcher decision points exactly.
function resolveDispatch(config: Record<string, unknown>) {
  const entryQuality = readEntryQuality(config);
  const isLegacyStrategy = !entryQuality || entryQuality.extraction_provenance === "legacy_no_confluence";
  const useWeightedScoring = entryQuality?.use_weighted_scoring === true && !isLegacyStrategy;
  const customIndicators = entryQuality?.confirming_indicators ?? [];
  const usePerStrategy = customIndicators.length > 0;
  return { entryQuality, useWeightedScoring, customIndicators, usePerStrategy };
}

describe("FIX A1 — entry_quality dead-path round-trip", () => {
  it("PRE-FIX write shape: top-level use_weighted_scoring/confirming_indicators never reach Path C/A (regression proof)", () => {
    // Mirrors the OLD graduator INSERT shape: use_weighted_scoring lived ONLY
    // as the sibling strategies.useWeightedScoring DB column (never placed in
    // config JSONB at all), and confirming_indicators was a TOP-LEVEL config
    // key — never inside entry_quality.
    const preFixConfig: Record<string, unknown> = {
      entry_quality: {
        confluence_factors: ["market_structure_aligned", "killzone_active"],
        min_factors_satisfied: 2,
        extraction_provenance: "youtube_transcript",
        // NOTE: no use_weighted_scoring, no confirming_indicators here — this
        // is the exact pre-fix shape.
      },
      // Top-level sibling fields the reader never looks at:
      confirming_indicators: ["market_structure_aligned", "killzone_active"], // bare-string array (Wave 26 Pass E), wrong shape AND wrong location
    };

    const { useWeightedScoring, usePerStrategy } = resolveDispatch(preFixConfig);

    // THE BUG: Path C never fires (useWeightedScoring resolves false) even
    // though the DB column strategies.use_weighted_scoring might say true —
    // the dispatcher never sees it. Path A never fires either (confirming_indicators
    // read as undefined from entry_quality — the top-level copy is invisible).
    expect(useWeightedScoring).toBe(false);
    expect(usePerStrategy).toBe(false);
  });

  it("POST-FIX write shape: use_weighted_scoring inside entry_quality actually activates Path C", () => {
    const postFixConfig: Record<string, unknown> = {
      entry_quality: {
        confluence_factors: ["market_structure_aligned", "killzone_active"],
        min_factors_satisfied: 2,
        extraction_provenance: "youtube_transcript",
        use_weighted_scoring: true, // FIX A1: now stamped inside entry_quality
      },
    };

    const { entryQuality, useWeightedScoring } = resolveDispatch(postFixConfig);

    expect(entryQuality).toBeDefined();
    expect(entryQuality!.use_weighted_scoring).toBe(true);
    expect(useWeightedScoring).toBe(true);
  });

  it("POST-FIX write shape: genuinely LLM-extracted confirming_indicators inside entry_quality actually activates Path A", () => {
    const realConfirmingIndicators: ConfirmingIndicatorShape[] = [
      { indicator: "ema", params: { period: 50 }, direction: "agree" },
      { indicator: "vwap", params: {}, direction: "agree" },
    ];
    const postFixConfig: Record<string, unknown> = {
      entry_quality: {
        confluence_factors: ["market_structure_aligned"],
        min_factors_satisfied: 1,
        extraction_provenance: "youtube_transcript",
        use_weighted_scoring: false, // opted out of Path C for this test — exercising Path A
        confirming_indicators: realConfirmingIndicators, // FIX A1: now stamped inside entry_quality
      },
    };

    const { entryQuality, customIndicators, usePerStrategy } = resolveDispatch(postFixConfig);

    expect(entryQuality!.confirming_indicators).toEqual(realConfirmingIndicators);
    expect(usePerStrategy).toBe(true);
    expect(customIndicators).toHaveLength(2);
    // Each entry is a genuine ConfirmingIndicator OBJECT (indicator/params/direction),
    // NOT a bare confluence-factor-tag string — this is the shape
    // confirming-indicator-evaluator.ts requires to actually evaluate a factor
    // instead of fail-closing every entry as unknown_indicator:<value>.
    for (const ci of customIndicators) {
      expect(typeof ci).toBe("object");
      expect(ci).toHaveProperty("indicator");
      expect(ci).toHaveProperty("direction");
    }
  });

  it("POST-FIX: absent confirming_indicators (the common case — no LLM confluence extraction) stays dormant, unchanged from pre-fix behavior", () => {
    // The vast majority of graduations do NOT have genuinely LLM-extracted
    // confirming_indicators (W23G.11 confluence extraction is rare). FIX A1
    // must NOT populate entry_quality.confirming_indicators with the Wave 26
    // Pass E bare-string array (v11MergedConfirmingIndicators) in this case —
    // doing so would misroute the Path C error-fallback into a guaranteed-
    // reject Path A instead of the intended Path B canonical-5 checklist.
    const postFixConfig: Record<string, unknown> = {
      entry_quality: {
        confluence_factors: ["regime_match", "structural_setup"],
        min_factors_satisfied: 2,
        extraction_provenance: "youtube_transcript",
        use_weighted_scoring: true,
        // no confirming_indicators key — the common case
      },
    };

    const { usePerStrategy, customIndicators } = resolveDispatch(postFixConfig);
    expect(usePerStrategy).toBe(false);
    expect(customIndicators).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — Static source contracts: prove the fix landed in BOTH files
// ─────────────────────────────────────────────────────────────────────────────

const GRADUATOR_SRC = fs.readFileSync(
  path.resolve(__dirname, "../services/direct-bucket-graduator.ts"),
  "utf8",
);
const PAPER_SIGNAL_SRC = fs.readFileSync(
  path.resolve(__dirname, "../services/paper-signal-service.ts"),
  "utf8",
);

describe("FIX A1 — static source contracts", () => {
  it("EntryQualityWithSources interface declares use_weighted_scoring and confirming_indicators", () => {
    const ifaceIdx = GRADUATOR_SRC.indexOf("export interface EntryQualityWithSources");
    expect(ifaceIdx).toBeGreaterThan(0);
    const ifaceEnd = GRADUATOR_SRC.indexOf("\n}", ifaceIdx);
    const block = GRADUATOR_SRC.slice(ifaceIdx, ifaceEnd);
    expect(block).toContain("use_weighted_scoring?: boolean");
    expect(block).toContain("confirming_indicators?: ConfirmingIndicator[]");
  });

  it("entryQualityBlock.use_weighted_scoring is stamped from wave25Defaults.useWeightedScoring", () => {
    expect(GRADUATOR_SRC).toContain("entryQualityBlock.use_weighted_scoring = wave25Defaults.useWeightedScoring");
  });

  it("entryQualityBlock.confirming_indicators is stamped from the genuine confirmingIndicators variable (not v11MergedConfirmingIndicators)", () => {
    expect(GRADUATOR_SRC).toContain("entryQualityBlock.confirming_indicators = confirmingIndicators");
    // Guard against regressing to the broken bare-string array — the mutation
    // line itself must not reference v11MergedConfirmingIndicators.
    const mutationIdx = GRADUATOR_SRC.indexOf("entryQualityBlock.confirming_indicators = confirmingIndicators");
    const line = GRADUATOR_SRC.slice(mutationIdx, mutationIdx + 80);
    expect(line).not.toContain("v11MergedConfirmingIndicators");
  });

  it("the mutation happens for BOTH the leader INSERT and the fan-out variant INSERT (same object reference)", () => {
    const mutationIdx = GRADUATOR_SRC.indexOf("entryQualityBlock.use_weighted_scoring = wave25Defaults.useWeightedScoring");
    const leaderInsertIdx = GRADUATOR_SRC.indexOf("entry_quality: entryQualityBlock,");
    const variantInsertIdx = GRADUATOR_SRC.lastIndexOf("entry_quality: entryQualityBlock,");
    expect(mutationIdx).toBeGreaterThan(0);
    expect(leaderInsertIdx).toBeGreaterThan(mutationIdx);
    expect(variantInsertIdx).toBeGreaterThan(leaderInsertIdx);
  });

  it("paper-signal-service.ts reader still declares both fields inside the entry_quality read-path type (unchanged contract)", () => {
    // Deep-scan #22 Z6 (2026-07-09): the inline entryQuality read + type
    // annotation was extracted into a pure, importable leaf
    // (src/server/lib/confluence-path-resolver.ts::resolveConfluenceDispatch)
    // so a pglite test (deepscan22-y6-path-c-db-roundtrip.test.ts) can drive
    // the REAL decision logic instead of a hand-copied mirror. The contract
    // this test protects — both fields reachable from paper-signal-service.ts's
    // dispatch — now spans two files: paper-signal-service.ts must call the
    // resolver, and the resolver's EntryQualityForDispatch type must declare
    // both fields.
    expect(PAPER_SIGNAL_SRC).toContain(
      'import { resolveConfluenceDispatch } from "../lib/confluence-path-resolver.js"',
    );
    expect(PAPER_SIGNAL_SRC).toContain("resolveConfluenceDispatch(rawConfig)");

    const RESOLVER_SRC = fs.readFileSync(
      path.resolve(__dirname, "../lib/confluence-path-resolver.ts"),
      "utf8",
    );
    const readerIdx = RESOLVER_SRC.indexOf("export interface EntryQualityForDispatch");
    expect(readerIdx).toBeGreaterThan(0);
    const block = RESOLVER_SRC.slice(readerIdx, readerIdx + 1100);
    expect(block).toContain("confirming_indicators?: ConfirmingIndicator[]");
    expect(block).toContain("use_weighted_scoring?: boolean");
    expect(RESOLVER_SRC).toContain("rawConfig.entry_quality");
  });
});
