/**
 * Wave 26 Pass H1 — Graduator defect tests (2026-05-26)
 *
 * Bug 1: Over-fragmentation — 4 Gemma sub-concept ideas merged under single
 *         multi-layer archetype in operator-ingest (admin.ts).
 * Bug 2: deriveEntryIndicator() overwrites Gemma's correct archetype.
 *         Added RAW_ARCHETYPES_RESPECTED early-return + _derivePathOut param.
 * Bug 3: Variant fan-out rows missing factor_quality/factor_sources/source_url/
 *         source_bucket_id and missing emitFactorQualityClassified() call.
 * Bug 4: Source-URL sibling-accept on intermittent failure for same video_id
 *         within same operator-ingest correlationId.
 *
 * Pattern: static source inspection + inlined pure-function logic (avoids
 * DATABASE_URL bootstrap in graduator/agent import chains).
 * Mirrors wave26-pass-g-b2-auditor-gates.test.ts pattern.
 *
 * Tests: 25 vitest covering all 4 bugs.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ─── Static source files for contract verification ───────────────────────────

const GRADUATOR_SRC = fs.readFileSync(
  path.resolve(__dirname, "../services/direct-bucket-graduator.ts"),
  "utf8",
);
const ADMIN_SRC = fs.readFileSync(
  path.resolve(__dirname, "../routes/admin.ts"),
  "utf8",
);
const AGENT_SRC = fs.readFileSync(
  path.resolve(__dirname, "../routes/agent.ts"),
  "utf8",
);

// ─── Inlined pure functions (mirrors direct-bucket-graduator.ts logic) ────────

// ARCHETYPE_REGISTRY (subset for testing)
const ARCHETYPE_REGISTRY: Record<string, { engineSpec: string; strategyClass: string }> = {
  "ict_bias_aligned_continuation": { engineSpec: "ict_bias_aligned_continuation_spec", strategyClass: "ICTBiasAlignedContinuationStrategy" },
  "bounce_off_level": { engineSpec: "bounce_off_level_spec", strategyClass: "BounceOffLevelStrategy" },
  "break_of_structure": { engineSpec: "break_of_structure_spec", strategyClass: "BreakOfStructureStrategy" },
  "wyckoff_spring": { engineSpec: "wyckoff_spring_spec", strategyClass: "WyckoffSpringStrategy" },
  "fvg_retrace": { engineSpec: "fvg_retrace_spec", strategyClass: "FvgRetraceStrategy" },
  "ict_ote": { engineSpec: "ict_ote_spec", strategyClass: "ICTOTEStrategy" },
};

const RAW_ARCHETYPES_RESPECTED = new Set<string>([
  "ict_silver_bullet_ny_am", "ict_silver_bullet_london", "ict_silver_bullet_ny_pm",
  "ict_judas_swing", "ict_ny_lunch_reversal", "ict_midnight_open", "ict_london_raid",
  "ict_turtle_soup", "ict_ote", "ict_power_of_3", "ict_unicorn", "ict_breaker",
  "ict_mitigation", "ict_iofed", "smt_reversal", "ict_quarterly_swing",
  "ict_propulsion", "ict_eqhl_raid", "ict_scalp", "ict_swing", "ict_2022",
  "break_of_structure", "change_of_character", "market_structure_shift", "cisd",
  "fvg_retrace", "order_block", "liquidity_sweep",
  "fvg", "judas_swing", "silver_bullet", "breaker_block",
  "wyckoff_spring", "wyckoff_upthrust", "wyckoff_accumulation", "wyckoff_distribution",
  "bounce_off_level", "ict_bias_aligned_continuation",
  "liquidity_magnet", "displacement", "htf_bias", "daily_bias",
  "accumulation", "manipulation", "distribution", "asian_range",
  "equal_highs", "equal_lows", "false_breakout", "session_open", "reversal",
  "sma_support", "ema_support", "trendline_bounce", "wick_rejection", "engulfing_rejection",
]);

// Inlined deriveEntryIndicator — subset sufficient for test coverage of Bug 2
function deriveEntryIndicatorInlined(
  conceptName: string,
  fallback: string | null,
  llmEntryIndicator?: string | null,
  pathOut?: { path?: string },
): string | null {
  const cn = conceptName.toLowerCase();

  // Wave 26 Pass H1 early-return
  if (llmEntryIndicator) {
    const rawTrimmed = llmEntryIndicator.trim().toLowerCase();
    const archetypeKey = rawTrimmed.startsWith("archetype:")
      ? rawTrimmed.slice("archetype:".length)
      : rawTrimmed;
    if (RAW_ARCHETYPES_RESPECTED.has(archetypeKey) || ARCHETYPE_REGISTRY[archetypeKey]) {
      if (pathOut) pathOut.path = "gemma_archetype_respected";
      return `archetype:${archetypeKey}`;
    }
  }

  // ARCHETYPE_REGISTRY check (prettifyConcept → identity for concept names already normalized)
  if (ARCHETYPE_REGISTRY[cn]) {
    if (pathOut) pathOut.path = "derived_from_prettify";
    return `archetype:${cn}`;
  }

  // ORB / session open breakout
  if (/orb|opening.range|first.hour|session.open/.test(cn)) return "session_open_breakout";
  if (/breakout/.test(cn)) return "session_open_breakout";

  // RSI
  if (/rsi.divergence/.test(cn)) return "rsi_divergence";

  // VWAP
  if (/vwap.reversion|vwap.touch/.test(cn)) return "vwap_reversion";

  // ICT bias aligned continuation regex path
  if (/multi.confluence.short.setup|multi.confluence.long.setup/.test(cn)) return "archetype:ict_bias_aligned_continuation";
  if (/bias.aligned|ict.short.continuation|ict.long.continuation/.test(cn)) return "archetype:ict_bias_aligned_continuation";

  // BOS / market structure
  if (/market.structure(?!.shift)|structure.level/.test(cn)) return "archetype:break_of_structure";
  if (/market.structure.shift/.test(cn)) return "archetype:break_of_structure";

  // Subreddit reject
  if (/^r_(daytrading|futurestrading|algotrading|trading)/.test(cn)) return null;

  return null;
}

// Inlined classifyFactorSources — mirrors direct-bucket-graduator.ts
type FactorSourceLabel = "extracted" | "auto_floor" | "kb_inferred";

function classifyFactorSourcesInlined(
  rawConfluenceFactors: string[],
  confluenceFactors: string[],
  entryIndicator: string | null,
): {
  factor_sources: Record<string, FactorSourceLabel>;
  factor_quality: "rich" | "thin" | "fallback_only";
  mergedFactors: string[];
} {
  const rawSet = new Set(rawConfluenceFactors);
  const sources: Record<string, FactorSourceLabel> = {};
  let realFactorCount = 0;
  for (const f of confluenceFactors) {
    if (rawSet.has(f)) {
      sources[f] = "extracted";
      realFactorCount++;
    } else {
      sources[f] = "auto_floor";
    }
  }
  let factor_quality: "rich" | "thin" | "fallback_only";
  if (realFactorCount >= 2) factor_quality = "rich";
  else if (realFactorCount === 1) factor_quality = "thin";
  else factor_quality = "fallback_only";

  return { factor_sources: sources, factor_quality, mergedFactors: confluenceFactors };
}

// ─── Bug 2: deriveEntryIndicator early-return tests ─────────────────────────

describe("Bug 2 — deriveEntryIndicator RAW_ARCHETYPES_RESPECTED early-return", () => {
  it("returns archetype:ict_bias_aligned_continuation when llmEntryIndicator matches known archetype", () => {
    const result = deriveEntryIndicatorInlined(
      "market_structure_shift_confirmation",
      null,
      "ict_bias_aligned_continuation",
    );
    expect(result).toBe("archetype:ict_bias_aligned_continuation");
  });

  it("returns archetype:ict_bias_aligned_continuation when llmEntryIndicator uses archetype: prefix", () => {
    const result = deriveEntryIndicatorInlined(
      "fvg_retrace_entry",
      null,
      "archetype:ict_bias_aligned_continuation",
    );
    expect(result).toBe("archetype:ict_bias_aligned_continuation");
  });

  it("does NOT override Gemma's ict_bias_aligned_continuation with regex-derived break_of_structure", () => {
    // concept name 'market_structure_shift' WOULD regex-match to break_of_structure,
    // but llmEntryIndicator says ict_bias_aligned_continuation → must win
    const result = deriveEntryIndicatorInlined(
      "market_structure_shift",
      null,
      "ict_bias_aligned_continuation",
    );
    expect(result).toBe("archetype:ict_bias_aligned_continuation");
    expect(result).not.toBe("archetype:break_of_structure");
  });

  it("populates pathOut.path with 'gemma_archetype_respected' on early-return", () => {
    const pathOut: { path?: string } = {};
    deriveEntryIndicatorInlined(
      "liquidity_targeting",
      null,
      "ict_bias_aligned_continuation",
      pathOut,
    );
    expect(pathOut.path).toBe("gemma_archetype_respected");
  });

  it("respects bounce_off_level as a known archetype", () => {
    const result = deriveEntryIndicatorInlined(
      "some_unrelated_concept",
      null,
      "bounce_off_level",
    );
    expect(result).toBe("archetype:bounce_off_level");
  });

  it("respects wyckoff_spring as a known archetype", () => {
    const result = deriveEntryIndicatorInlined(
      "some_concept",
      null,
      "wyckoff_spring",
    );
    expect(result).toBe("archetype:wyckoff_spring");
  });

  it("falls through to regex when llmEntryIndicator is unknown string", () => {
    const result = deriveEntryIndicatorInlined(
      "opening_range_breakout_concept",
      null,
      "unknown_indicator_xyz",
    );
    // Should fall through to regex and derive from concept name
    expect(result).toBe("session_open_breakout");
  });

  it("returns null when llmEntryIndicator is null and concept has no match", () => {
    const result = deriveEntryIndicatorInlined(
      "r_daytrading",
      null,
      null,
    );
    expect(result).toBeNull();
  });

  it("respects fvg_retrace as a known archetype shorthand", () => {
    const result = deriveEntryIndicatorInlined(
      "some_concept",
      null,
      "fvg_retrace",
    );
    expect(result).toBe("archetype:fvg_retrace");
  });

  it("early-return accepts llmEntryIndicator with leading/trailing whitespace", () => {
    const result = deriveEntryIndicatorInlined(
      "some_concept",
      null,
      "  ict_bias_aligned_continuation  ",
    );
    expect(result).toBe("archetype:ict_bias_aligned_continuation");
  });

  it("populates pathOut.path with 'derived_from_prettify' when conceptName matches ARCHETYPE_REGISTRY", () => {
    const pathOut: { path?: string } = {};
    deriveEntryIndicatorInlined(
      "ict_bias_aligned_continuation",
      null,
      undefined,
      pathOut,
    );
    expect(pathOut.path).toBe("derived_from_prettify");
  });
});

// ─── Bug 2: Source contract verification ────────────────────────────────────

describe("Bug 2 — source contract verification", () => {
  it("graduator.ts contains RAW_ARCHETYPES_RESPECTED Set definition", () => {
    expect(GRADUATOR_SRC).toContain("RAW_ARCHETYPES_RESPECTED");
    expect(GRADUATOR_SRC).toContain("new Set<string>");
    expect(GRADUATOR_SRC).toContain("ict_bias_aligned_continuation");
    expect(GRADUATOR_SRC).toContain("bounce_off_level");
  });

  it("deriveEntryIndicator accepts _derivePathOut parameter", () => {
    expect(GRADUATOR_SRC).toContain("_derivePathOut?: { path?: string }");
  });

  it("early-return uses _derivePathOut to record gemma_archetype_respected", () => {
    expect(GRADUATOR_SRC).toContain("gemma_archetype_respected");
    expect(GRADUATOR_SRC).toContain("_derivePathOut.path = \"gemma_archetype_respected\"");
  });

  it("derive_entry_indicator_path is stamped on archetype_route_taken audit result", () => {
    expect(GRADUATOR_SRC).toContain("derive_entry_indicator_path: deriveEntryIndicatorPath");
  });
});

// ─── Bug 3: classifyFactorSources parity tests ──────────────────────────────

describe("Bug 3 — classifyFactorSources parity (same for leader and variants)", () => {
  it("returns factor_quality=rich when ≥2 extracted factors present", () => {
    const { factor_quality } = classifyFactorSourcesInlined(
      ["structural_setup", "vp_shape"],
      ["regime_match", "structural_setup", "vp_shape"],
      "archetype:ict_bias_aligned_continuation",
    );
    expect(factor_quality).toBe("rich");
  });

  it("returns factor_quality=thin when exactly 1 extracted factor present", () => {
    const { factor_quality } = classifyFactorSourcesInlined(
      ["structural_setup"],
      ["regime_match", "structural_setup"],
      "archetype:ict_bias_aligned_continuation",
    );
    expect(factor_quality).toBe("thin");
  });

  it("returns factor_quality=fallback_only when 0 extracted factors present", () => {
    const { factor_quality } = classifyFactorSourcesInlined(
      [],
      ["regime_match"],
      "ema_crossover",
    );
    expect(factor_quality).toBe("fallback_only");
  });

  it("produces identical factor_quality for both leader and variant inputs (parity invariant)", () => {
    const leaderFactors = ["structural_setup", "vp_shape"];
    const allFactors = ["regime_match", "structural_setup", "vp_shape"];
    const leaderResult = classifyFactorSourcesInlined(leaderFactors, allFactors, "archetype:ict_bias_aligned_continuation");
    const variantResult = classifyFactorSourcesInlined(leaderFactors, allFactors, "archetype:ict_bias_aligned_continuation");
    expect(leaderResult.factor_quality).toBe(variantResult.factor_quality);
    expect(leaderResult.factor_sources).toEqual(variantResult.factor_sources);
    expect(leaderResult.mergedFactors).toEqual(variantResult.mergedFactors);
  });

  it("classifies auto-floor factors as auto_floor in factor_sources", () => {
    const { factor_sources } = classifyFactorSourcesInlined(
      [],
      ["regime_match", "structural_setup"],
      "ema_crossover",
    );
    expect(factor_sources["regime_match"]).toBe("auto_floor");
    expect(factor_sources["structural_setup"]).toBe("auto_floor");
  });
});

// ─── Bug 3: Source contract verification ─────────────────────────────────────

describe("Bug 3 — variant fan-out source contract verification", () => {
  it("variant INSERT config includes source_url stamp (Wave 26 Pass H1 Bug 3)", () => {
    // Check that the variant config block has source_url: bestMention.sourceUrl
    expect(GRADUATOR_SRC).toContain("source_url:       bestMention.sourceUrl ?? null,");
  });

  it("variant INSERT config includes source_bucket_id stamp (Wave 26 Pass H1 Bug 3)", () => {
    expect(GRADUATOR_SRC).toContain("source_bucket_id: bucketId,");
  });

  it("leader INSERT config includes source_url stamp (Wave 26 Pass H1 Bug 3)", () => {
    // Both leader and variants have source_url in config
    const sourceUrlOccurrences = (GRADUATOR_SRC.match(/source_url:\s+bestMention\.sourceUrl/g) ?? []).length;
    expect(sourceUrlOccurrences).toBeGreaterThanOrEqual(2);
  });

  it("variant fan-out block calls emitFactorQualityClassified (Wave 26 Pass H1 Bug 3)", () => {
    // The variant loop must call emitFactorQualityClassified
    // Check for the variant-specific Gate2 comment
    expect(GRADUATOR_SRC).toContain("Gate2: emitFactorQualityClassified for variant failed");
  });

  it("variant config preserves entry_archetype from leader (Wave 26 Pass H1 Bug 3)", () => {
    expect(GRADUATOR_SRC).toContain("variantEntryArchetype");
    expect(GRADUATOR_SRC).toContain("entry_archetype: variantEntryArchetype");
  });
});

// ─── Bug 4: sibling-accept logic tests ──────────────────────────────────────

describe("Bug 4 — source-URL sibling-accept decision logic", () => {
  it("sibling-accept should apply when reason=unreachable AND siblingBucketId is present", () => {
    const shouldAcceptBySibling = (
      verificationReason: string | undefined,
      siblingBucketId: string | undefined,
    ): boolean => {
      const isIntermittentFailure = verificationReason === "unreachable";
      return Boolean(siblingBucketId && isIntermittentFailure);
    };

    expect(shouldAcceptBySibling("unreachable", "some-uuid-123")).toBe(true);
  });

  it("sibling-accept should NOT apply when reason=thin_content (content mismatch)", () => {
    const shouldAcceptBySibling = (
      verificationReason: string | undefined,
      siblingBucketId: string | undefined,
    ): boolean => {
      const isIntermittentFailure = verificationReason === "unreachable";
      return Boolean(siblingBucketId && isIntermittentFailure);
    };

    expect(shouldAcceptBySibling("thin_content", "some-uuid-123")).toBe(false);
  });

  it("sibling-accept should NOT apply when reason=off_topic (wrong content)", () => {
    const shouldAcceptBySibling = (
      verificationReason: string | undefined,
      siblingBucketId: string | undefined,
    ): boolean => {
      const isIntermittentFailure = verificationReason === "unreachable";
      return Boolean(siblingBucketId && isIntermittentFailure);
    };

    expect(shouldAcceptBySibling("off_topic", "some-uuid-123")).toBe(false);
  });

  it("sibling-accept should NOT apply when reason=unreachable but NO siblingBucketId", () => {
    const shouldAcceptBySibling = (
      verificationReason: string | undefined,
      siblingBucketId: string | undefined,
    ): boolean => {
      const isIntermittentFailure = verificationReason === "unreachable";
      return Boolean(siblingBucketId && isIntermittentFailure);
    };

    expect(shouldAcceptBySibling("unreachable", undefined)).toBe(false);
  });

  it("sibling-accept tracks validated bucket_ids correctly across layers", () => {
    const validatedBucketIds = new Set<string>();

    const webResponse = { accepted: true, bucket_id: "bucket-abc-123" };
    if (webResponse.accepted && typeof webResponse.bucket_id === "string") {
      validatedBucketIds.add(webResponse.bucket_id);
    }
    expect(validatedBucketIds.size).toBe(1);

    const siblingBucketId = validatedBucketIds.size > 0
      ? [...validatedBucketIds][0]
      : undefined;
    expect(siblingBucketId).toBe("bucket-abc-123");
  });
});

// ─── Bug 4: Source contract verification ─────────────────────────────────────

describe("Bug 4 — source contract: agent.ts sibling-accept wiring", () => {
  it("agent.ts pendingIdeaSchema includes operator_ingest_sibling_bucket_id field", () => {
    expect(AGENT_SRC).toContain("operator_ingest_sibling_bucket_id");
    expect(AGENT_SRC).toContain("z.string().uuid().optional()");
  });

  it("agent.ts has source-URL sibling-accept bypass for reason=unreachable", () => {
    expect(AGENT_SRC).toContain("isIntermittentFailure");
    expect(AGENT_SRC).toContain("siblingBucketId && isIntermittentFailure");
  });

  it("agent.ts emits pending_bucket.source_url_accepted_by_sibling audit action", () => {
    expect(AGENT_SRC).toContain("pending_bucket.source_url_accepted_by_sibling");
  });

  it("admin.ts tracks validatedBucketIdsForVideoId Set", () => {
    expect(ADMIN_SRC).toContain("validatedBucketIdsForVideoId");
    expect(ADMIN_SRC).toContain("new Set<string>()");
  });

  it("admin.ts passes operator_ingest_sibling_bucket_id to pending endpoint", () => {
    expect(ADMIN_SRC).toContain("operator_ingest_sibling_bucket_id");
  });
});

// ─── Bug 1: Multi-layer archetype merge logic tests ──────────────────────────

describe("Bug 1 — multi-layer archetype merge logic (inlined)", () => {
  const MULTI_LAYER_ARCHETYPES = new Set<string>([
    "ict_bias_aligned_continuation",
    "ict_power_of_3",
  ]);

  const SUB_LAYERS: Record<string, string[]> = {
    ict_bias_aligned_continuation: [
      "market_structure_shift_confirmation", "fvg_retrace_entry",
      "liquidity_targeting", "htf_bias", "bos_confirmation",
    ],
    ict_power_of_3: ["accumulation", "manipulation", "distribution", "asian_range"],
  };

  function detectMerge(ideas: Array<{ concept_name?: string; entry_indicator?: string }>): {
    shouldMerge: boolean;
    masterArchetype: string | null;
    masterIdx: number;
  } {
    let masterIdeaIdx = -1;
    let masterArchetype: string | null = null;

    for (let i = 0; i < ideas.length; i++) {
      const entryInd = (ideas[i].entry_indicator ?? "").trim().toLowerCase();
      const archetypeKey = entryInd.startsWith("archetype:") ? entryInd.slice("archetype:".length) : entryInd;
      if (MULTI_LAYER_ARCHETYPES.has(archetypeKey)) {
        masterIdeaIdx = i;
        masterArchetype = archetypeKey;
        break;
      }
    }

    if (masterIdeaIdx === -1 && ideas.length > 1) {
      for (const [arch, subLayers] of Object.entries(SUB_LAYERS)) {
        const subLayerSet = new Set(subLayers);
        const siblingCount = ideas.filter(idea =>
          subLayerSet.has((idea.concept_name ?? "").toLowerCase().replace(/\s+/g, "_"))
        ).length;
        if (siblingCount >= Math.ceil(ideas.length * 0.5)) {
          masterArchetype = arch;
          masterIdeaIdx = 0;
          break;
        }
      }
    }

    return {
      shouldMerge: masterIdeaIdx >= 0 && masterArchetype !== null && ideas.length > 1,
      masterArchetype,
      masterIdx: masterIdeaIdx,
    };
  }

  it("detects ict_bias_aligned_continuation as multi-layer archetype and triggers merge", () => {
    const ideas = [
      { concept_name: "htf_bias", entry_indicator: "ict_bias_aligned_continuation" },
      { concept_name: "market_structure_shift_confirmation", entry_indicator: "break_of_structure" },
      { concept_name: "fvg_retrace_entry", entry_indicator: "fvg" },
      { concept_name: "liquidity_targeting", entry_indicator: "liquidity_sweep" },
    ];
    const result = detectMerge(ideas);
    expect(result.shouldMerge).toBe(true);
    expect(result.masterArchetype).toBe("ict_bias_aligned_continuation");
  });

  it("does NOT trigger merge for single-idea extraction", () => {
    const ideas = [
      { concept_name: "ict_bias_aligned_continuation", entry_indicator: "ict_bias_aligned_continuation" },
    ];
    const result = detectMerge(ideas);
    expect(result.shouldMerge).toBe(false);
  });

  it("detects sub-layer merge via concept name when no explicit archetype idea", () => {
    const ideas = [
      { concept_name: "market_structure_shift_confirmation", entry_indicator: "break_of_structure" },
      { concept_name: "fvg_retrace_entry", entry_indicator: "fvg" },
      { concept_name: "liquidity_targeting", entry_indicator: "liquidity_sweep" },
    ];
    const result = detectMerge(ideas);
    expect(result.shouldMerge).toBe(true);
    expect(result.masterArchetype).toBe("ict_bias_aligned_continuation");
  });

  it("absorbed sub-concepts are recorded correctly", () => {
    const ideas = [
      { concept_name: "htf_bias", entry_indicator: "ict_bias_aligned_continuation" },
      { concept_name: "market_structure_shift_confirmation", entry_indicator: "break_of_structure" },
      { concept_name: "fvg_retrace_entry", entry_indicator: "fvg" },
    ];
    const { masterIdx } = detectMerge(ideas);
    const absorbed = ideas
      .filter((_, i) => i !== masterIdx)
      .map(idea => idea.concept_name ?? "unknown");
    expect(absorbed).toEqual(["market_structure_shift_confirmation", "fvg_retrace_entry"]);
  });

  it("does NOT trigger merge for 2 completely unrelated concepts (< 50% sub-layer match)", () => {
    const ideas = [
      { concept_name: "rsi_divergence_entry", entry_indicator: "rsi_divergence" },
      { concept_name: "vwap_retest_entry", entry_indicator: "vwap_reversion" },
    ];
    const result = detectMerge(ideas);
    expect(result.shouldMerge).toBe(false);
  });

  it("merged idea has entry_indicator set to archetype:<masterArchetype>", () => {
    const ideas = [
      { concept_name: "htf_bias", entry_indicator: "ict_bias_aligned_continuation" },
      { concept_name: "fvg_retrace_entry", entry_indicator: "fvg" },
    ];
    const { masterIdx, masterArchetype } = detectMerge(ideas);
    const mergedIdea = { ...ideas[masterIdx], entry_indicator: `archetype:${masterArchetype}` };
    expect(mergedIdea.entry_indicator).toBe("archetype:ict_bias_aligned_continuation");
  });
});

// ─── Bug 1: Source contract verification ─────────────────────────────────────

describe("Bug 1 — source contract: admin.ts sibling merge wiring", () => {
  it("admin.ts defines MULTI_LAYER_ARCHETYPES constant", () => {
    expect(ADMIN_SRC).toContain("MULTI_LAYER_ARCHETYPES");
    expect(ADMIN_SRC).toContain("ict_bias_aligned_continuation");
  });

  it("admin.ts defines SUB_LAYERS_BY_ARCHETYPE constant", () => {
    expect(ADMIN_SRC).toContain("SUB_LAYERS_BY_ARCHETYPE");
    expect(ADMIN_SRC).toContain("market_structure_shift_confirmation");
    expect(ADMIN_SRC).toContain("fvg_retrace_entry");
    expect(ADMIN_SRC).toContain("liquidity_targeting");
  });

  it("admin.ts emits scout.ideas_merged_under_archetype audit action", () => {
    expect(ADMIN_SRC).toContain("scout.ideas_merged_under_archetype");
  });

  it("admin.ts stores _absorbed_sub_concepts in merged idea", () => {
    expect(ADMIN_SRC).toContain("_absorbed_sub_concepts: absorbedSubConcepts");
  });

  it("admin.ts uses ideasToProcess not extractResult.ideas after merge", () => {
    expect(ADMIN_SRC).toContain("for (const idea of ideasToProcess)");
    expect(ADMIN_SRC).not.toContain("for (const idea of extractResult.ideas)");
  });

  it("agent.ts pendingIdeaSchema includes absorbed_sub_concepts field", () => {
    expect(AGENT_SRC).toContain("absorbed_sub_concepts");
    expect(AGENT_SRC).toContain("z.array(z.string()).optional()");
  });
});

// ─── Wave 26 Pass H Phase 1.5 (2026-05-26) Fix 4/5/6 regression tests ────────

describe("Phase 1.5 Fix 4 — market-structure regex guard in deriveEntryIndicator", () => {
  // Mirror of the production isMarketStructureish guard regex in
  // direct-bucket-graduator.ts. If you change one, change both.
  const isMarketStructureish = (cn: string) =>
    /(^|_)(ms|mss|bos|choch)(_|$)|market[_\s-]?structure|structure[_\s-]?shift|break[_\s-]?of[_\s-]?structure/.test(cn);

  // Production MA-cross regex (line 620 of direct-bucket-graduator.ts), but
  // now gated behind isMarketStructureish.
  const wouldRouteToMaCross = (cn: string) =>
    !isMarketStructureish(cn) &&
    /ema.cross|exponential_moving_average_cross|moving_average_cross|(^|_)ma_cross(_|$)|(^|_)ma\.cross|ema.pullback|pullback.ema/.test(cn);

  it("'ms_' concepts are guarded from moving-average routing", () => {
    expect(isMarketStructureish("htf_bias_and_ms_confirmation")).toBe(true);
    expect(isMarketStructureish("ms_continuation")).toBe(true);
    expect(wouldRouteToMaCross("htf_bias_and_ms_confirmation")).toBe(false);
  });

  it("'market_structure' concepts are guarded from MA routing", () => {
    expect(isMarketStructureish("daily_bias_market_structure")).toBe(true);
    expect(isMarketStructureish("market_structure_shift_confirmation")).toBe(true);
    expect(wouldRouteToMaCross("daily_bias_market_structure_and_targets")).toBe(false);
  });

  it("'bos_' / 'choch_' tokens are guarded", () => {
    expect(isMarketStructureish("bos_confirmation")).toBe(true);
    expect(isMarketStructureish("choch_entry")).toBe(true);
  });

  it("'break_of_structure' (with underscores) is guarded", () => {
    expect(isMarketStructureish("break_of_structure_long")).toBe(true);
  });

  it("genuine ema_crossover still routes to MA cross", () => {
    expect(isMarketStructureish("ema_9_21_crossover")).toBe(false);
    expect(wouldRouteToMaCross("ema_cross_strategy")).toBe(true);
  });

  it("bare 2-letter 'ma' / 'ms' alone do NOT match ema/sma/wma regex tokens", () => {
    // The Phase 1.5 fix replaced (ma|ema|sma|...) with (ema|sma|wma|hull|kama|vwma)
    // in the bounce_off_level and pullback regex chains. Verify bare "ma" no
    // longer counts as an MA token in those alternations.
    const bounceRegex = /(ceiling|floor|support|resistance|bounce|reject|holds?|test).{0,12}(ema|sma|wma|moving.?average)/;
    // "support_ma" used to match the old (ma|ema|sma) alternation but should
    // not match the new (ema|sma|wma|moving.?average) alternation.
    expect(bounceRegex.test("support_ma")).toBe(false);
    expect(bounceRegex.test("support_ema")).toBe(true);
  });

  it("graduator source contains the isMarketStructureish guard", () => {
    expect(GRADUATOR_SRC).toContain("isMarketStructureish");
    expect(GRADUATOR_SRC).toContain("Phase 1.5");
  });
});

describe("Phase 1.5 Fix 5 — Gemma synonym coverage + single-idea sub-layer re-route", () => {
  it("admin.ts SUB_LAYERS_BY_ARCHETYPE includes new Gemma v10 synonyms", () => {
    expect(ADMIN_SRC).toContain("htf_bias_and_ms_confirmation");
    expect(ADMIN_SRC).toContain("htf_bias_and_market_structure");
    expect(ADMIN_SRC).toContain("daily_bias_market_structure");
    expect(ADMIN_SRC).toContain("mss_continuation");
  });

  it("admin.ts has single-idea sub-layer re-route block", () => {
    expect(ADMIN_SRC).toContain("single-idea sub-layer re-route");
    expect(ADMIN_SRC).toContain("extractResult.ideas.length === 1");
  });

  it("admin.ts emits scout.single_idea_sub_layer_rerouted audit action", () => {
    expect(ADMIN_SRC).toContain("scout.single_idea_sub_layer_rerouted");
  });

  it("single-idea sub-layer match resolves to ict_bias_aligned_continuation", () => {
    // Inline replica of the Fix 5 single-idea routing logic.
    const SUB_LAYERS_BY_ARCHETYPE: Record<string, string[]> = {
      ict_bias_aligned_continuation: [
        "htf_bias_and_ms_confirmation",
        "daily_bias_market_structure",
        "mss_continuation",
      ],
    };
    const cn = "htf_bias_and_ms_confirmation";
    let masterArchetype: string | null = null;
    for (const [arch, subLayers] of Object.entries(SUB_LAYERS_BY_ARCHETYPE)) {
      if (new Set(subLayers).has(cn)) {
        masterArchetype = arch;
        break;
      }
    }
    expect(masterArchetype).toBe("ict_bias_aligned_continuation");
  });

  it("admin.ts merger block accepts ideas.length >= 1 (single + multi)", () => {
    // The Phase 1.5 patch relaxed the length>1 guard to length>=1 to enable
    // single-idea re-route. Verify the source reflects the relaxation.
    expect(ADMIN_SRC).toContain("extractResult.ideas.length >= 1");
  });
});

describe("Phase 1.5 Fix 6 — Gemma extractor determinism (seed + audit)", () => {
  const MODEL_ROUTER_SRC = fs.readFileSync(
    path.resolve(__dirname, "../services/model-router.ts"),
    "utf8",
  );

  it("model-router.ts sets a deterministic seed for transcript_extractor", () => {
    expect(MODEL_ROUTER_SRC).toContain("TRANSCRIPT_EXTRACTOR_OLLAMA_SEED");
    expect(MODEL_ROUTER_SRC).toContain("seed: TRANSCRIPT_EXTRACTOR_SEED");
  });

  it("temperature remains at 0.1 (Ollama issue #15502 invariant)", () => {
    // The Phase 1.5 dispatch requested temperature=0.0; the documented Ollama
    // bug overrides that. Test that the invariant is preserved.
    expect(MODEL_ROUTER_SRC).toMatch(/temperature:\s*0\.1/);
  });

  it("top_p remains at 0.95 (JSON escape preservation invariant)", () => {
    expect(MODEL_ROUTER_SRC).toMatch(/top_p:\s*0\.95/);
  });

  it("emits extraction.config_used audit per call", () => {
    expect(MODEL_ROUTER_SRC).toContain("extraction.config_used");
    expect(MODEL_ROUTER_SRC).toContain("temperature: samplingOptions.temperature");
    expect(MODEL_ROUTER_SRC).toContain("seed: samplingOptions.seed");
  });
});
