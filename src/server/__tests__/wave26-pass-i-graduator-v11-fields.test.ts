/**
 * Wave 26 Pass I — Graduator v11 field stamping tests (2026-05-26)
 *
 * Verifies that direct-bucket-graduator.ts correctly:
 *   1. Extracts v11 Gemma fields (entry_sequence / stop_loss / targets /
 *      filters / timeframes / indicators_used / extraction_gap_reason)
 *   2. Stamps them on leader + variant rows (Pass H1 parity rule)
 *   3. Routes NEEDS_REVISION lifecycle when extraction_gap_reason present
 *   4. Maps timeframes.bias[] to 5-TF hierarchy columns
 *   5. Overrides exit_plan_config → adaptive + target_sequence when v11 emits
 *      explicit stop + targets
 *   6. Writes target_sequence into exit_plan_config
 *   7. Unions entry_sequence[].indicators_needed into confirming_indicators
 *   8. Promotes factor_quality to "rich" when entry_sequence.length ≥ 3 or
 *      targets.length ≥ 3
 *   9. Legacy v10 (no v11 fields) graduates unchanged (no regression)
 *  10. Null-safety on all new optional reads
 *
 * Pattern: static source inspection + pure-function logic inlined from the
 * graduator. No DATABASE_URL bootstrap required — mirrors wave26-pass-h-graduator-fixes.test.ts.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ─── Static source for contract verification ─────────────────────────────────

const GRADUATOR_SRC = fs.readFileSync(
  path.resolve(__dirname, "../services/direct-bucket-graduator.ts"),
  "utf8",
);

// ─── Inlined pure helpers (mirrors direct-bucket-graduator.ts logic) ──────────

// Inline extractV11Fields — mirrors what graduateBucketDirectly does with extractedIdea
function extractV11Fields(extractedIdea: Record<string, unknown>) {
  const v11EntrySequence: Array<{ step: number; name: string; rule: string; indicators_needed?: string[] }> =
    Array.isArray(extractedIdea?.entry_sequence) ? (extractedIdea.entry_sequence as any) : [];

  const v11StopLoss: { anchor?: string; buffer_atr?: number; rationale?: string } | null =
    extractedIdea?.stop_loss && typeof extractedIdea.stop_loss === "object"
      ? (extractedIdea.stop_loss as any)
      : null;

  const v11Targets: Array<{ priority: number; type: string; rationale?: string }> =
    Array.isArray(extractedIdea?.targets) ? (extractedIdea.targets as any) : [];

  const v11Filters: Array<{ type: string; condition?: string; value?: unknown; rationale?: string }> =
    Array.isArray(extractedIdea?.filters) ? (extractedIdea.filters as any) : [];

  const v11Timeframes: { bias?: string[]; entry?: string[]; trigger?: string[] } | null =
    extractedIdea?.timeframes && typeof extractedIdea.timeframes === "object"
      ? (extractedIdea.timeframes as any)
      : null;

  const v11IndicatorsUsed: Array<{ name: string; purpose?: string }> =
    Array.isArray(extractedIdea?.indicators_used) ? (extractedIdea.indicators_used as any) : [];

  const v11ExtractionGapReason: string | null =
    typeof extractedIdea?.extraction_gap_reason === "string"
      ? (extractedIdea.extraction_gap_reason as string)
      : null;

  const v11BiasTf: string | null = v11Timeframes?.bias?.[0] ?? null;
  const v11EntryTf: string | null = v11Timeframes?.entry?.[0] ?? null;
  const v11TriggerTf: string | null = v11Timeframes?.trigger?.[0] ?? null;

  const v11DailyTf: string | null =
    v11Timeframes?.bias && v11Timeframes.bias.length >= 1 ? v11Timeframes.bias[0] : null;
  const v11HtfTf: string | null =
    v11Timeframes?.bias && v11Timeframes.bias.length >= 2 ? v11Timeframes.bias[1] : null;
  const v11ItfTf: string | null =
    v11Timeframes?.bias && v11Timeframes.bias.length >= 3
      ? v11Timeframes.bias[2]
      : (v11EntryTf ?? null);

  const v11SeqIndicators: string[] = v11EntrySequence.flatMap(
    (step) => Array.isArray(step.indicators_needed) ? step.indicators_needed : []
  );

  const v11HasExplicitStop = v11StopLoss !== null && typeof v11StopLoss.anchor === "string";
  const v11HasTargets = v11Targets.length > 0;

  return {
    v11EntrySequence,
    v11StopLoss,
    v11Targets,
    v11Filters,
    v11IndicatorsUsed,
    v11ExtractionGapReason,
    v11BiasTf,
    v11EntryTf,
    v11TriggerTf,
    v11DailyTf,
    v11HtfTf,
    v11ItfTf,
    v11SeqIndicators,
    v11HasExplicitStop,
    v11HasTargets,
  };
}

// Inline factor_quality promotion rule
//
// FIX A3 (deep-scan #22 fix-wave-2, 2026-07-07): the pre-fix version promoted
// to "rich" whenever entrySequenceLen>=3 OR targetsLen>=3 REGARDLESS of
// realFactorCount — a 3-step entry_sequence with ZERO real (extracted OR
// kb_inferred) confluence factors still got stamped "rich", suppressing Gate
// 3's thin_confluence_warning and corrupting tf_graduation_factor_quality_total.
// classifyFactorSources()'s OWN contract is realCount>=2 -> rich; the v11
// promotion must never manufacture "rich" out of fewer than 2 real factors.
function applyV11FactorQualityPromotion(
  rawQuality: "rich" | "thin" | "fallback_only",
  entrySequenceLen: number,
  targetsLen: number,
  realFactorCount: number,
): "rich" | "thin" | "fallback_only" {
  const v11Rich = (entrySequenceLen >= 3 || targetsLen >= 3) && realFactorCount >= 2;
  return v11Rich ? "rich" : rawQuality;
}

// Inline confirming_indicators union
function buildMergedConfirmingIndicators(
  wave25BaseIndicators: string[],
  v11SeqIndicators: string[],
): string[] {
  return Array.from(new Set([...wave25BaseIndicators, ...v11SeqIndicators]))
    .filter((s) => typeof s === "string" && s.length > 0);
}

// Inline exit_plan_config override logic
function buildExitPlanConfig(
  v11StopLoss: { anchor?: string; buffer_atr?: number } | null,
  v11Targets: Array<{ priority: number; type: string }>,
  wave25Default: Record<string, unknown>,
): Record<string, unknown> {
  const hasExplicitStop = v11StopLoss !== null && typeof v11StopLoss?.anchor === "string";
  const hasTargets = v11Targets.length > 0;
  if (hasExplicitStop && hasTargets) {
    return {
      exit_style: "adaptive",
      ...(v11StopLoss?.anchor ? { stop_anchor: v11StopLoss.anchor } : {}),
      ...(typeof v11StopLoss?.buffer_atr === "number" ? { stop_buffer_atr: v11StopLoss.buffer_atr } : {}),
      target_sequence: v11Targets,
    };
  }
  return wave25Default;
}

// Inline buildV11ConfigAdditions
function buildV11ConfigAdditions(
  v11: ReturnType<typeof extractV11Fields>,
  wave25BiasTf: string,
) {
  return {
    ...(v11.v11EntrySequence.length > 0 ? { entry_sequence: v11.v11EntrySequence } : {}),
    ...(v11.v11StopLoss !== null ? { stop_loss: v11.v11StopLoss } : {}),
    ...(v11.v11Targets.length > 0 ? { targets: v11.v11Targets } : {}),
    ...(v11.v11Filters.length > 0 ? { filters: v11.v11Filters } : {}),
    ...(v11.v11IndicatorsUsed.length > 0 ? { indicators_used: v11.v11IndicatorsUsed } : {}),
    bias_timeframe: v11.v11BiasTf ?? wave25BiasTf,
    ...(v11.v11EntryTf ? { entry_timeframe: v11.v11EntryTf } : {}),
    ...(v11.v11TriggerTf ? { trigger_timeframe: v11.v11TriggerTf } : {}),
    ...(v11.v11DailyTf ? { daily_tf: v11.v11DailyTf } : {}),
    ...(v11.v11HtfTf ? { htf_tf: v11.v11HtfTf } : {}),
    ...(v11.v11ItfTf ? { itf_tf: v11.v11ItfTf } : {}),
    ...(v11.v11ExtractionGapReason ? { lifecycle_metadata: { extraction_gap_reason: v11.v11ExtractionGapReason } } : {}),
  };
}

// ─── Synthetic v11 Gemma output ───────────────────────────────────────────────

const FULL_V11_GEMMA_OUTPUT = {
  idea_name: "ICT Silver Bullet NY AM",
  entry_indicator: "archetype:ict_silver_bullet_ny_am",
  direction: "both",
  confluence_factors: ["market_structure_aligned", "killzone_active", "fvg_retrace"],
  confirming_indicators: [
    { indicator: "market_structure_shift", weight: 0.9 },
    { indicator: "fvg_present", weight: 0.8 },
  ],
  // v11 new fields
  entry_sequence: [
    {
      step: 1,
      name: "htf_bias_confirmed",
      rule: "4H candle closes above VWAP with bullish CHoCH",
      indicators_needed: ["htf_bias", "vwap", "choch"],
    },
    {
      step: 2,
      name: "liquidity_raid_sfp",
      rule: "15m price sweeps equal high then immediately reverses with high-volume rejection wick",
      indicators_needed: ["equal_highs", "volume_spike"],
    },
    {
      step: 3,
      name: "displacement_with_fvg_entry",
      rule: "5m displacement candle leaves open FVG; entry on 50% fill of FVG body",
      indicators_needed: ["fair_value_gap", "displacement"],
    },
  ],
  stop_loss: {
    anchor: "swing_low_below_entry",
    buffer_atr: 0.5,
    rationale: "Below the swing low formed at the SFP rejection point",
  },
  targets: [
    { priority: 1, type: "equal_highs_lows", rationale: "Clear liquidity pool overhead" },
    { priority: 2, type: "previous_daily_high", rationale: "PDH is next major draw on liquidity" },
    { priority: 3, type: "weekly_high", rationale: "Ultimate target if momentum extends" },
  ],
  filters: [
    { type: "avoid_when", condition: "neutral_or_ranging_market", rationale: "No directional bias = no trade" },
    { type: "avoid_when", condition: "equal_liquidity_both_sides" },
    { type: "min_rr", value: 2.0, rationale: "Minimum 2R to justify the kill-zone entry risk" },
  ],
  timeframes: {
    bias: ["1w", "1d", "4h"],
    entry: ["15m", "1h"],
    trigger: ["5m"],
  },
  indicators_used: [
    { name: "market_structure", purpose: "Identify BOS/CHoCH for trend direction" },
    { name: "fair_value_gap", purpose: "Entry trigger on 50% retrace" },
    { name: "vwap", purpose: "Dynamic bias filter" },
  ],
};

const EMPTY_ENTRY_SEQ_GAP_V11 = {
  idea_name: "Incomplete ICT Setup",
  entry_indicator: "archetype:ict_ote",
  direction: "both",
  confluence_factors: ["structural_setup"],
  entry_sequence: [],
  extraction_gap_reason: "transcript_too_short_for_full_entry_sequence",
  targets: [],
  filters: [],
  timeframes: { bias: ["4h"], entry: ["15m"], trigger: ["5m"] },
  indicators_used: [],
  stop_loss: null,
};

const LEGACY_V10_ONLY = {
  idea_name: "EMA 9/21 Pullback",
  entry_indicator: "ema_crossover",
  direction: "both",
  confluence_factors: ["market_structure_aligned", "killzone_active"],
  confirming_indicators: [],
  // No v11 fields
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Wave 26 Pass I — graduator v11 field extraction", () => {
  it("extracts all v11 fields from full v11 Gemma output", () => {
    const v11 = extractV11Fields(FULL_V11_GEMMA_OUTPUT as Record<string, unknown>);
    expect(v11.v11EntrySequence).toHaveLength(3);
    expect(v11.v11EntrySequence[0].name).toBe("htf_bias_confirmed");
    expect(v11.v11EntrySequence[2].name).toBe("displacement_with_fvg_entry");
    expect(v11.v11StopLoss?.anchor).toBe("swing_low_below_entry");
    expect(v11.v11StopLoss?.buffer_atr).toBe(0.5);
    expect(v11.v11Targets).toHaveLength(3);
    expect(v11.v11Filters).toHaveLength(3);
    expect(v11.v11IndicatorsUsed).toHaveLength(3);
    expect(v11.v11ExtractionGapReason).toBeNull();
  });

  it("timeframes.bias maps to 5-TF hierarchy correctly", () => {
    const v11 = extractV11Fields(FULL_V11_GEMMA_OUTPUT as Record<string, unknown>);
    // bias: ["1w", "1d", "4h"]
    expect(v11.v11DailyTf).toBe("1w");   // bias[0] = highest bias TF
    expect(v11.v11HtfTf).toBe("1d");     // bias[1]
    expect(v11.v11ItfTf).toBe("4h");     // bias[2]
    expect(v11.v11BiasTf).toBe("1w");    // bias[0]
    expect(v11.v11EntryTf).toBe("15m");  // entry[0]
    expect(v11.v11TriggerTf).toBe("5m"); // trigger[0]
  });

  it("flattens entry_sequence[].indicators_needed into v11SeqIndicators", () => {
    const v11 = extractV11Fields(FULL_V11_GEMMA_OUTPUT as Record<string, unknown>);
    // step 1: ["htf_bias", "vwap", "choch"]
    // step 2: ["equal_highs", "volume_spike"]
    // step 3: ["fair_value_gap", "displacement"]
    expect(v11.v11SeqIndicators).toContain("htf_bias");
    expect(v11.v11SeqIndicators).toContain("vwap");
    expect(v11.v11SeqIndicators).toContain("choch");
    expect(v11.v11SeqIndicators).toContain("equal_highs");
    expect(v11.v11SeqIndicators).toContain("fair_value_gap");
    expect(v11.v11SeqIndicators).toHaveLength(7);
  });

  it("extracts extraction_gap_reason when present", () => {
    const v11 = extractV11Fields(EMPTY_ENTRY_SEQ_GAP_V11 as Record<string, unknown>);
    expect(v11.v11ExtractionGapReason).toBe("transcript_too_short_for_full_entry_sequence");
    expect(v11.v11EntrySequence).toHaveLength(0);
  });

  it("returns null/empty defaults for all v11 fields on v10-only extraction", () => {
    const v11 = extractV11Fields(LEGACY_V10_ONLY as Record<string, unknown>);
    expect(v11.v11EntrySequence).toHaveLength(0);
    expect(v11.v11StopLoss).toBeNull();
    expect(v11.v11Targets).toHaveLength(0);
    expect(v11.v11Filters).toHaveLength(0);
    expect(v11.v11IndicatorsUsed).toHaveLength(0);
    expect(v11.v11ExtractionGapReason).toBeNull();
    expect(v11.v11BiasTf).toBeNull();
    expect(v11.v11EntryTf).toBeNull();
    expect(v11.v11TriggerTf).toBeNull();
    expect(v11.v11DailyTf).toBeNull();
    expect(v11.v11HtfTf).toBeNull();
    expect(v11.v11SeqIndicators).toHaveLength(0);
  });
});

describe("Wave 26 Pass I — factor_quality promotion", () => {
  it("promotes thin → rich when entry_sequence.length >= 3 AND realFactorCount >= 2", () => {
    const promoted = applyV11FactorQualityPromotion("thin", 3, 0, 2);
    expect(promoted).toBe("rich");
  });

  it("promotes thin → rich when targets.length >= 3 AND realFactorCount >= 2", () => {
    const promoted = applyV11FactorQualityPromotion("thin", 0, 3, 2);
    expect(promoted).toBe("rich");
  });

  it("promotes thin → rich when entry_sequence.length >= 3 with 2 real factors", () => {
    const promoted = applyV11FactorQualityPromotion("thin", 3, 1, 2);
    expect(promoted).toBe("rich");
  });

  it("does NOT promote when both entry_sequence < 3 AND targets < 3 (regardless of realFactorCount)", () => {
    expect(applyV11FactorQualityPromotion("fallback_only", 2, 2, 3)).toBe("fallback_only");
    expect(applyV11FactorQualityPromotion("thin", 1, 2, 3)).toBe("thin");
    expect(applyV11FactorQualityPromotion("rich", 0, 0, 0)).toBe("rich");
  });

  it("promotes when entry_sequence == 3 exactly (boundary case) with sufficient real factors", () => {
    expect(applyV11FactorQualityPromotion("thin", 3, 0, 2)).toBe("rich");
  });

  it("does NOT promote when entry_sequence == 2 (boundary below threshold)", () => {
    expect(applyV11FactorQualityPromotion("fallback_only", 2, 0, 5)).toBe("fallback_only");
  });

  // ─── FIX A3 (deep-scan #22 fix-wave-2, 2026-07-07) — the actual bug fix ────
  it("FIX A3: does NOT promote fallback_only → rich when realFactorCount === 0, even with a 3-step entry_sequence", () => {
    // This is the exact bug scenario: a richly-STRUCTURED extraction (3-step
    // entry_sequence) with ZERO real confluence evidence must stay fallback_only
    // so Gate 3's thin_confluence_warning still fires and the telemetry stays honest.
    expect(applyV11FactorQualityPromotion("fallback_only", 3, 0, 0)).toBe("fallback_only");
    expect(applyV11FactorQualityPromotion("fallback_only", 0, 3, 0)).toBe("fallback_only");
  });

  it("FIX A3: does NOT promote fallback_only → rich when realFactorCount === 1 (thin territory, not rich)", () => {
    expect(applyV11FactorQualityPromotion("thin", 3, 0, 1)).toBe("thin");
  });
});

describe("Wave 26 Pass I — confirming_indicators union", () => {
  it("unions wave25 base indicators with v11 entry_sequence indicators_needed", () => {
    const base = ["market_structure_aligned", "killzone_active"];
    const v11Seq = ["htf_bias", "vwap", "choch", "fair_value_gap"];
    const merged = buildMergedConfirmingIndicators(base, v11Seq);
    expect(merged).toContain("market_structure_aligned");
    expect(merged).toContain("killzone_active");
    expect(merged).toContain("htf_bias");
    expect(merged).toContain("vwap");
    expect(merged).toContain("fair_value_gap");
    expect(merged).toHaveLength(6);
  });

  it("deduplicates indicators present in both base and v11 seq", () => {
    const base = ["market_structure_aligned", "fair_value_gap"];
    const v11Seq = ["fair_value_gap", "displacement"];
    const merged = buildMergedConfirmingIndicators(base, v11Seq);
    expect(merged).toHaveLength(3);
    expect(merged.filter((x) => x === "fair_value_gap")).toHaveLength(1);
  });

  it("returns base unchanged when v11SeqIndicators is empty (v10 path)", () => {
    const base = ["market_structure_aligned", "killzone_active"];
    const merged = buildMergedConfirmingIndicators(base, []);
    expect(merged).toEqual(base);
  });
});

describe("Wave 26 Pass I — exit_plan_config adaptive override", () => {
  const wave25Default = { exit_style: "adaptive" };

  it("overrides to adaptive + target_sequence + stop_anchor when v11 emits stop + targets", () => {
    const exitPlan = buildExitPlanConfig(
      { anchor: "swing_low_below_entry", buffer_atr: 0.5 },
      [{ priority: 1, type: "equal_highs_lows" }, { priority: 2, type: "previous_daily_high" }],
      wave25Default,
    );
    expect(exitPlan.exit_style).toBe("adaptive");
    expect(exitPlan.stop_anchor).toBe("swing_low_below_entry");
    expect(exitPlan.stop_buffer_atr).toBe(0.5);
    expect(Array.isArray(exitPlan.target_sequence)).toBe(true);
    expect((exitPlan.target_sequence as unknown[]).length).toBe(2);
  });

  it("writes target_sequence into exit_plan_config", () => {
    const targets = [
      { priority: 1, type: "equal_highs_lows", rationale: "liquidity" },
      { priority: 2, type: "previous_daily_high" },
      { priority: 3, type: "weekly_high" },
    ];
    const exitPlan = buildExitPlanConfig(
      { anchor: "fvg_low" },
      targets,
      wave25Default,
    );
    expect(exitPlan.target_sequence).toEqual(targets);
  });

  it("returns wave25 default when v11 has NO explicit stop (even if targets present)", () => {
    const exitPlan = buildExitPlanConfig(
      null,
      [{ priority: 1, type: "equal_highs_lows" }],
      wave25Default,
    );
    expect(exitPlan).toEqual(wave25Default);
  });

  it("returns wave25 default when v11 has NO targets (even if stop present)", () => {
    const exitPlan = buildExitPlanConfig(
      { anchor: "swing_low_below_entry" },
      [],
      wave25Default,
    );
    expect(exitPlan).toEqual(wave25Default);
  });

  it("returns wave25 default for legacy v10 (null stop, empty targets)", () => {
    const exitPlan = buildExitPlanConfig(null, [], wave25Default);
    expect(exitPlan).toEqual(wave25Default);
  });
});

describe("Wave 26 Pass I — buildV11ConfigAdditions stamping", () => {
  it("stamps all v11 fields on config for full v11 output", () => {
    const v11 = extractV11Fields(FULL_V11_GEMMA_OUTPUT as Record<string, unknown>);
    const additions = buildV11ConfigAdditions(v11, "4h");

    expect(additions.entry_sequence).toHaveLength(3);
    expect((additions.entry_sequence as any)[0].name).toBe("htf_bias_confirmed");
    expect(additions.stop_loss).toEqual(FULL_V11_GEMMA_OUTPUT.stop_loss);
    expect(additions.targets).toHaveLength(3);
    expect(additions.filters).toHaveLength(3);
    expect(additions.indicators_used).toHaveLength(3);
    // bias_timeframe = v11.bias[0] = "1w"
    expect(additions.bias_timeframe).toBe("1w");
    expect(additions.entry_timeframe).toBe("15m");
    expect(additions.trigger_timeframe).toBe("5m");
    expect(additions.daily_tf).toBe("1w");
    expect(additions.htf_tf).toBe("1d");
    expect(additions.itf_tf).toBe("4h");
    expect(additions.lifecycle_metadata).toBeUndefined();
  });

  it("stamps lifecycle_metadata.extraction_gap_reason when v11 emits it", () => {
    const v11 = extractV11Fields(EMPTY_ENTRY_SEQ_GAP_V11 as Record<string, unknown>);
    const additions = buildV11ConfigAdditions(v11, "1h");
    expect(additions.lifecycle_metadata).toEqual({
      extraction_gap_reason: "transcript_too_short_for_full_entry_sequence",
    });
  });

  it("produces minimal additions for v10-only extraction (backward-compat)", () => {
    const v11 = extractV11Fields(LEGACY_V10_ONLY as Record<string, unknown>);
    const additions = buildV11ConfigAdditions(v11, "4h");
    // entry_sequence, stop_loss, targets, filters, indicators_used absent
    expect(additions.entry_sequence).toBeUndefined();
    expect(additions.stop_loss).toBeUndefined();
    expect(additions.targets).toBeUndefined();
    expect(additions.filters).toBeUndefined();
    expect(additions.indicators_used).toBeUndefined();
    // bias_timeframe falls back to wave25 default
    expect(additions.bias_timeframe).toBe("4h");
    // no TF overrides
    expect(additions.daily_tf).toBeUndefined();
    expect(additions.htf_tf).toBeUndefined();
    expect(additions.lifecycle_metadata).toBeUndefined();
  });

  it("v10 additions do NOT introduce any extra keys beyond bias_timeframe", () => {
    const v11 = extractV11Fields(LEGACY_V10_ONLY as Record<string, unknown>);
    const additions = buildV11ConfigAdditions(v11, "4h");
    // @ts-ignore — buildV11ConfigAdditions return type lacks a string index signature; key-filtered Object.keys access requires type suppression (W0.3 2026-06-22)
    const additionKeys = Object.keys(additions).filter((k) => additions[k] !== undefined);
    // Only bias_timeframe (always written)
    expect(additionKeys).toEqual(["bias_timeframe"]);
  });
});

describe("Wave 26 Pass I — 5-TF hierarchy from bias array", () => {
  it("maps timeframes.bias = ['1w','1d','4h'] correctly", () => {
    const v11 = extractV11Fields({ timeframes: { bias: ["1w", "1d", "4h"], entry: ["15m"], trigger: ["5m"] } });
    expect(v11.v11DailyTf).toBe("1w");
    expect(v11.v11HtfTf).toBe("1d");
    expect(v11.v11ItfTf).toBe("4h");
    expect(v11.v11EntryTf).toBe("15m");
    expect(v11.v11TriggerTf).toBe("5m");
  });

  it("maps timeframes.bias = ['4h','1h'] (2 elements) correctly", () => {
    const v11 = extractV11Fields({ timeframes: { bias: ["4h", "1h"], entry: ["15m"], trigger: ["5m"] } });
    expect(v11.v11DailyTf).toBe("4h");
    expect(v11.v11HtfTf).toBe("1h");
    // itf_tf falls back to entry[0] when bias has only 2 elements
    expect(v11.v11ItfTf).toBe("15m");
  });

  it("maps timeframes.bias = ['1d'] (1 element) correctly", () => {
    const v11 = extractV11Fields({ timeframes: { bias: ["1d"], entry: ["5m"], trigger: ["1m"] } });
    expect(v11.v11DailyTf).toBe("1d");
    expect(v11.v11HtfTf).toBeNull();
    expect(v11.v11ItfTf).toBe("5m"); // falls back to entry[0]
  });
});

describe("Wave 26 Pass I — NEEDS_REVISION lifecycle path", () => {
  it("extraction_gap_reason triggers lifecycle_metadata stamp", () => {
    const v11 = extractV11Fields({
      extraction_gap_reason: "low_confidence_extraction",
      entry_sequence: [],
      targets: [],
    });
    expect(v11.v11ExtractionGapReason).toBe("low_confidence_extraction");
    const additions = buildV11ConfigAdditions(v11, "4h");
    expect(additions.lifecycle_metadata).toMatchObject({
      extraction_gap_reason: "low_confidence_extraction",
    });
  });

  it("no extraction_gap_reason → no lifecycle_metadata → no NEEDS_REVISION", () => {
    const v11 = extractV11Fields(FULL_V11_GEMMA_OUTPUT as Record<string, unknown>);
    expect(v11.v11ExtractionGapReason).toBeNull();
    const additions = buildV11ConfigAdditions(v11, "4h");
    expect(additions.lifecycle_metadata).toBeUndefined();
  });
});

// ─── Source contract tests (static inspection of graduator.ts) ───────────────

describe("Wave 26 Pass I — source contract verification", () => {
  it("graduator reads v11 entry_sequence from extractedIdea", () => {
    expect(GRADUATOR_SRC).toContain("v11EntrySequence");
    expect(GRADUATOR_SRC).toContain("entry_sequence");
  });

  it("graduator reads v11 stop_loss from extractedIdea", () => {
    expect(GRADUATOR_SRC).toContain("v11StopLoss");
  });

  it("graduator reads v11 targets from extractedIdea", () => {
    expect(GRADUATOR_SRC).toContain("v11Targets");
  });

  it("graduator reads v11 filters from extractedIdea", () => {
    expect(GRADUATOR_SRC).toContain("v11Filters");
  });

  it("graduator reads v11 timeframes from extractedIdea", () => {
    expect(GRADUATOR_SRC).toContain("v11Timeframes");
  });

  it("graduator reads v11 indicators_used from extractedIdea", () => {
    expect(GRADUATOR_SRC).toContain("v11IndicatorsUsed");
  });

  it("graduator reads v11 extraction_gap_reason", () => {
    expect(GRADUATOR_SRC).toContain("v11ExtractionGapReason");
  });

  it("graduator implements factor_quality promotion rule", () => {
    expect(GRADUATOR_SRC).toContain("v11RichExtraction");
    expect(GRADUATOR_SRC).toContain("v11EntrySequence.length >= 3");
    expect(GRADUATOR_SRC).toContain("v11Targets.length >= 3");
  });

  // ─── FIX A3 (deep-scan #22 fix-wave-2, 2026-07-07) ─────────────────────────
  it("graduator gates v11RichExtraction on realFactorCount >= 2 (does not manufacture rich from zero real evidence)", () => {
    expect(GRADUATOR_SRC).toContain("realFactorCount >= 2");
    // The promotion expression must AND the sequence/targets check with the
    // realFactorCount floor — not OR, and not compute factor_quality without it.
    const richExtractionIdx = GRADUATOR_SRC.indexOf("const v11RichExtraction =");
    expect(richExtractionIdx).toBeGreaterThan(0);
    const block = GRADUATOR_SRC.slice(richExtractionIdx, richExtractionIdx + 200);
    expect(block).toContain("realFactorCount >= 2");
  });

  it("graduator computes realFactorCount from factor_sources (extracted OR kb_inferred), mirroring classifyFactorSources' own contract", () => {
    const realCountIdx = GRADUATOR_SRC.indexOf("const realFactorCount =");
    expect(realCountIdx).toBeGreaterThan(0);
    const block = GRADUATOR_SRC.slice(realCountIdx, realCountIdx + 200);
    expect(block).toContain("factor_sources");
    expect(block).toContain('"extracted"');
    expect(block).toContain('"kb_inferred"');
  });

  it("graduator builds v11MergedConfirmingIndicators", () => {
    expect(GRADUATOR_SRC).toContain("v11MergedConfirmingIndicators");
    expect(GRADUATOR_SRC).toContain("v11SeqIndicators");
  });

  it("graduator builds v11ExitPlanConfigOverride", () => {
    expect(GRADUATOR_SRC).toContain("v11ExitPlanConfigOverride");
    expect(GRADUATOR_SRC).toContain("target_sequence: v11Targets");
  });

  it("graduator uses finalExitPlanConfig on leader INSERT", () => {
    expect(GRADUATOR_SRC).toContain("finalExitPlanConfig");
  });

  it("graduator stamps v11 fields via buildV11ConfigAdditions on leader", () => {
    expect(GRADUATOR_SRC).toContain("buildV11ConfigAdditions()");
  });

  it("graduator stamps v11 fields on variants too (Pass H1 parity rule)", () => {
    // Both leader and variant calls to buildV11ConfigAdditions
    const occurrences = (GRADUATOR_SRC.match(/buildV11ConfigAdditions\(\)/g) ?? []).length;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it("graduator handles NEEDS_REVISION lifecycle path with audit row", () => {
    expect(GRADUATOR_SRC).toContain("lifecycle.needs_revision_set");
    expect(GRADUATOR_SRC).toContain("NEEDS_REVISION");
    expect(GRADUATOR_SRC).toContain("v11ExtractionGapReason");
  });

  it("graduator 5-TF SQL uses v11 TF overrides for leader", () => {
    // v11DailyTf ?? wave25Defaults.dailyTf pattern
    expect(GRADUATOR_SRC).toContain("v11DailyTf ?? wave25Defaults.dailyTf");
    expect(GRADUATOR_SRC).toContain("v11HtfTf   ?? wave25Defaults.htfTf");
  });

  it("graduator 5-TF SQL uses v11 TF overrides for variants too", () => {
    expect(GRADUATOR_SRC).toContain("v11DailyTf   ?? wave25Defaults.dailyTf");
  });

  it("v11 fields are null-safe reads (no direct property access without ??)", () => {
    // All v11 array reads use Array.isArray guard
    expect(GRADUATOR_SRC).toContain("Array.isArray((extractedIdea as any)?.entry_sequence)");
    expect(GRADUATOR_SRC).toContain("Array.isArray((extractedIdea as any)?.targets)");
    expect(GRADUATOR_SRC).toContain("Array.isArray((extractedIdea as any)?.filters)");
    expect(GRADUATOR_SRC).toContain("Array.isArray((extractedIdea as any)?.indicators_used)");
  });

  it("bias_timeframe on leader INSERT uses v11BiasTimeframe not raw wave25 value", () => {
    // Leader INSERT config block must reference v11BiasTimeframe
    expect(GRADUATOR_SRC).toContain("bias_timeframe: v11BiasTimeframe");
  });

  it("confirming_indicators on leader INSERT uses v11MergedConfirmingIndicators", () => {
    expect(GRADUATOR_SRC).toContain("confirming_indicators: v11MergedConfirmingIndicators");
  });
});
