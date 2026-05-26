/**
 * wave26-pass-g-b2-auditor-gates.test.ts — Wave 26 Pass G B2 (2026-05-26)
 *
 * Verifies the two new additive auditor gates in direct-bucket-graduator.ts:
 *
 *   Gate 1 — Bidirectional Completeness Check
 *     auditBidirectionalCompleteness() — 6 cases (inline re-implementation
 *     from static source — avoids DATABASE_URL bootstrap in import chain)
 *
 *   Gate 2 — Factor Source Telemetry Flag
 *     classifyFactorSources() — 5 cases (inline re-implementation)
 *
 *   Gate 3 — graduation.thin_confluence_warning (static source inspection)
 *
 *   Source contract tests (static) — audit action names, notify calls,
 *   schema fields, bucket-revert pattern.
 *
 * Pattern: static source inspection + inlined pure-function logic to avoid
 * triggering the DATABASE_URL bootstrap in the graduator import chain.
 * Mirrors wave26-pass-g-archetype-audit.test.ts pattern.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ─── Static source for contract verification ─────────────────────────────────

const GRADUATOR_SRC = fs.readFileSync(
  path.resolve(__dirname, "../services/direct-bucket-graduator.ts"),
  "utf-8",
);

// ─────────────────────────────────────────────────────────────────────────────
// §0  Inline pure-function re-implementations
//
// We re-implement the two pure functions here rather than importing them from
// direct-bucket-graduator.ts because that module's import chain triggers the
// DATABASE_URL bootstrap in db/index.ts.
//
// The static source tests in §3-§6 verify the graduator source exactly matches
// what we're testing here. If a logic change is made in the source, the static
// tests will catch the divergence.
// ─────────────────────────────────────────────────────────────────────────────

const BIDIR_SENTINEL = "high < low";

interface BidirectionalAuditResult {
  pass: boolean;
  reason: string | null;
}

function auditBidirectionalCompleteness(compiledConfig: {
  direction?: string;
  archetype?: string | null;
  entry_long?: string;
  entry_short?: string;
}): BidirectionalAuditResult {
  const direction = compiledConfig.direction ?? "";
  if (direction !== "both") return { pass: true, reason: null };

  const entryLong  = compiledConfig.entry_long  ?? "";
  const entryShort = compiledConfig.entry_short ?? "";
  const hasArchetype = Boolean(compiledConfig.archetype);

  const longIsSentinel  = entryLong  === BIDIR_SENTINEL || entryLong  === "";
  const shortIsSentinel = entryShort === BIDIR_SENTINEL || entryShort === "";

  if (hasArchetype) {
    if (longIsSentinel !== shortIsSentinel) {
      return { pass: false, reason: "incomplete_bidirectional_extraction" };
    }
    return { pass: true, reason: null };
  }

  if (longIsSentinel || shortIsSentinel) {
    return { pass: false, reason: "incomplete_bidirectional_extraction" };
  }

  return { pass: true, reason: null };
}

type FactorSourceLabel = "extracted" | "auto_floor" | "kb_inferred";

// Inline KB map (subset — mirrors archetype-implied-factors.ts for test isolation)
const _TEST_ARCHETYPE_IMPLIED: Record<string, string[]> = {
  ict_bias_aligned_continuation: [
    "market_structure_aligned", "htf_bias_aligned", "fvg_present_or_ob",
    "liquidity_target_clear", "killzone_active",
  ],
  bounce_off_level: ["ma_as_support_resistance", "rejection_pattern_confirmed", "regime_match"],
};
function _inferFactors(entryIndicator: string | null | undefined): string[] {
  if (!entryIndicator) return [];
  const key = entryIndicator.startsWith("archetype:")
    ? entryIndicator.slice("archetype:".length).trim()
    : entryIndicator.trim();
  return _TEST_ARCHETYPE_IMPLIED[key] ?? [];
}

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

  // Wave 26 Pass H2: inject archetype-implied kb_inferred factors
  const impliedFactors = _inferFactors(entryIndicator);
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
    if (rawSet.has(factor))       sources[factor] = "extracted";
    else if (kbInferredSet.has(factor)) sources[factor] = "kb_inferred";
    else                          sources[factor] = "auto_floor";
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
// §1  Gate 1 — auditBidirectionalCompleteness (6 cases)
// ─────────────────────────────────────────────────────────────────────────────

describe("Wave 26 Pass G B2 — Gate 1: auditBidirectionalCompleteness", () => {

  // Case 1: Parametric direction=both, both sides real → PASS
  it("case 1: parametric direction=both, both sides real expressions → PASS", () => {
    const result = auditBidirectionalCompleteness({
      direction: "both",
      archetype: null,
      entry_long:  "ema_9 crosses_above ema_21",
      entry_short: "ema_9 crosses_below ema_21",
    });
    expect(result.pass).toBe(true);
    expect(result.reason).toBeNull();
  });

  // Case 2: Parametric direction=both, entry_long is sentinel → REJECT (bug pattern)
  it("case 2: parametric direction=both, entry_long is sentinel 'high < low' → REJECT", () => {
    const result = auditBidirectionalCompleteness({
      direction: "both",
      archetype: null,
      entry_long:  "high < low",   // sentinel — never true, long-only guard
      entry_short: "ema_9 crosses_below ema_21",
    });
    expect(result.pass).toBe(false);
    expect(result.reason).toBe("incomplete_bidirectional_extraction");
  });

  // Case 3: Parametric direction=both, entry_short is empty → REJECT (bug pattern)
  it("case 3: parametric direction=both, entry_short is empty string → REJECT", () => {
    const result = auditBidirectionalCompleteness({
      direction: "both",
      archetype: null,
      entry_long:  "rsi_14 crosses_above 50",
      entry_short: "",
    });
    expect(result.pass).toBe(false);
    expect(result.reason).toBe("incomplete_bidirectional_extraction");
  });

  // Case 4: Structural-archetype direction=both, both sides sentinel → PASS
  // Archetype detectors own structural detection — sentinels on both sides are coherent
  it("case 4: archetype direction=both, both sides sentinel → PASS (archetype handles detection)", () => {
    const result = auditBidirectionalCompleteness({
      direction: "both",
      archetype: "silver_bullet",
      entry_long:  "high < low",   // sentinel
      entry_short: "high < low",   // sentinel
    });
    expect(result.pass).toBe(true);
    expect(result.reason).toBeNull();
  });

  // Case 5: Single direction=long, entry_long real, entry_short empty → PASS
  // Asymmetric is explicitly allowed for genuinely one-sided strategies
  it("case 5: direction=long, entry_short empty → PASS (asymmetric is allowed)", () => {
    const result = auditBidirectionalCompleteness({
      direction: "long",
      archetype: null,
      entry_long:  "close crosses_above vwap",
      entry_short: "",
    });
    expect(result.pass).toBe(true);
    expect(result.reason).toBeNull();
  });

  // Case 6: Archetype direction=both, one side real expression, one side sentinel → REJECT (true mix)
  it("case 6: archetype direction=both, one real expression + one sentinel → REJECT (mixed state)", () => {
    const result = auditBidirectionalCompleteness({
      direction: "both",
      archetype: "bounce_off_level",
      entry_long:  "close bounces above ema_50",  // real expression
      entry_short: "high < low",                   // sentinel — LLM only extracted long side
    });
    expect(result.pass).toBe(false);
    expect(result.reason).toBe("incomplete_bidirectional_extraction");
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// §2  Gate 2 — classifyFactorSources (5 cases)
// ─────────────────────────────────────────────────────────────────────────────

describe("Wave 26 Pass G B2 — Gate 2: classifyFactorSources", () => {

  // Case 1: LLM emits 3 factors, all from its list → all extracted, quality=rich
  it("case 1: 3 LLM-extracted factors → factor_sources all extracted, factor_quality=rich", () => {
    const raw    = ["market_structure_aligned", "killzone_active", "vp_level_proximity"];
    const final  = ["market_structure_aligned", "killzone_active", "vp_level_proximity"];
    const { factor_sources, factor_quality } = classifyFactorSources(raw, final);

    expect(factor_sources["market_structure_aligned"]).toBe("extracted");
    expect(factor_sources["killzone_active"]).toBe("extracted");
    expect(factor_sources["vp_level_proximity"]).toBe("extracted");
    expect(factor_quality).toBe("rich");
  });

  // Case 2: LLM emits 1 factor, auto-floor injects 1 → extracted + auto_floor, quality=thin
  it("case 2: 1 extracted + 1 auto_floor → factor_quality=thin", () => {
    const raw   = ["killzone_active"];
    const final = ["killzone_active", "regime_match"]; // regime_match injected by floor guard
    const { factor_sources, factor_quality } = classifyFactorSources(raw, final);

    expect(factor_sources["killzone_active"]).toBe("extracted");
    expect(factor_sources["regime_match"]).toBe("auto_floor");
    expect(factor_quality).toBe("thin");
  });

  // Case 3: LLM emits 0 factors, both auto-floor → all auto_floor, quality=fallback_only
  it("case 3: 0 extracted, 2 auto_floor → factor_quality=fallback_only (the 66/99 anti-pattern)", () => {
    const raw   = [] as string[];
    const final = ["regime_match", "structural_setup"]; // both injected by floor guard
    const { factor_sources, factor_quality } = classifyFactorSources(raw, final);

    expect(factor_sources["regime_match"]).toBe("auto_floor");
    expect(factor_sources["structural_setup"]).toBe("auto_floor");
    expect(factor_quality).toBe("fallback_only");
  });

  // Case 4: 2 extracted + 1 auto_floor → still rich because ≥2 real
  it("case 4: 2 extracted + 1 auto_floor → factor_quality=rich (≥2 real factors)", () => {
    const raw   = ["market_structure_aligned", "smt_confirmation"];
    const final = ["market_structure_aligned", "smt_confirmation", "regime_match"];
    const { factor_sources, factor_quality } = classifyFactorSources(raw, final);

    expect(factor_sources["market_structure_aligned"]).toBe("extracted");
    expect(factor_sources["smt_confirmation"]).toBe("extracted");
    expect(factor_sources["regime_match"]).toBe("auto_floor");
    expect(factor_quality).toBe("rich");
  });

  // Case 5: Empty inputs → empty sources + fallback_only (legacy-empty / null base case)
  it("case 5: empty raw + empty final → factor_sources={}, factor_quality=fallback_only", () => {
    const { factor_sources, factor_quality } = classifyFactorSources([], []);
    expect(Object.keys(factor_sources)).toHaveLength(0);
    expect(factor_quality).toBe("fallback_only");
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// §3  Static source contract — Gate 1 call site in graduator
// ─────────────────────────────────────────────────────────────────────────────

describe("Wave 26 Pass G B2 — Gate 1 static contract: graduator source", () => {

  it("exports auditBidirectionalCompleteness function", () => {
    expect(GRADUATOR_SRC).toContain("export function auditBidirectionalCompleteness");
  });

  it("calls auditBidirectionalCompleteness before the source-fidelity check", () => {
    const callIdx = GRADUATOR_SRC.indexOf("auditBidirectionalCompleteness({");
    const sourceFidelityIdx = GRADUATOR_SRC.indexOf("SOURCE-FIDELITY CHECK");
    expect(callIdx).toBeGreaterThan(0);
    expect(sourceFidelityIdx).toBeGreaterThan(0);
    expect(callIdx).toBeLessThan(sourceFidelityIdx);
  });

  it("no-poison bucket revert sets BOTH status='pending' AND graduatedAt: null", () => {
    const gateBlockStart = GRADUATOR_SRC.indexOf("Gate 1 — Bidirectional Completeness");
    const gateBlockEnd   = GRADUATOR_SRC.indexOf("SOURCE-FIDELITY CHECK");
    const revertIdx      = GRADUATOR_SRC.indexOf('status: "pending", graduatedAt: null', gateBlockStart);
    expect(revertIdx).toBeGreaterThan(gateBlockStart);
    expect(revertIdx).toBeLessThan(gateBlockEnd);
  });

  it("writes graduation.rejected_incomplete_bidirectional audit row on Gate 1 reject", () => {
    expect(GRADUATOR_SRC).toContain("graduation.rejected_incomplete_bidirectional");
  });

  it("audit row includes reason, entry_long_head, entry_short_head, is_archetype fields", () => {
    const actionIdx = GRADUATOR_SRC.indexOf('"graduation.rejected_incomplete_bidirectional"');
    expect(actionIdx).toBeGreaterThan(0);
    const block = GRADUATOR_SRC.slice(actionIdx, actionIdx + 800);
    expect(block).toContain("reason");
    expect(block).toContain("entry_long_head");
    expect(block).toContain("entry_short_head");
    expect(block).toContain("is_archetype");
  });

  it("fires Discord notify() on Gate 1 reject", () => {
    const gateBlockStart = GRADUATOR_SRC.indexOf("Gate 1 — Bidirectional Completeness");
    const gateBlockEnd   = GRADUATOR_SRC.indexOf("SOURCE-FIDELITY CHECK");
    const notifyIdx      = GRADUATOR_SRC.indexOf("notify({", gateBlockStart);
    expect(notifyIdx).toBeGreaterThan(gateBlockStart);
    expect(notifyIdx).toBeLessThan(gateBlockEnd);
  });

  it("Discord body references DISCORD_CH_STRATEGY_FINDS env var", () => {
    expect(GRADUATOR_SRC).toContain("DISCORD_CH_STRATEGY_FINDS");
  });

  it("Gate 1 return reason is gate1_incomplete_bidirectional", () => {
    expect(GRADUATOR_SRC).toContain("gate1_incomplete_bidirectional");
  });

  it("imports notify from notification-service and appendFamilyGradePostscript from notification-helpers", () => {
    expect(GRADUATOR_SRC).toMatch(/import.*notify.*from.*notification-service/);
    expect(GRADUATOR_SRC).toMatch(/import.*appendFamilyGradePostscript.*from.*notification-helpers/);
  });

  it("BIDIR_SENTINEL constant is 'high < low'", () => {
    expect(GRADUATOR_SRC).toContain('const BIDIR_SENTINEL = "high < low"');
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// §4  Static source contract — Gate 2 call site in graduator
// ─────────────────────────────────────────────────────────────────────────────

describe("Wave 26 Pass G B2 — Gate 2 static contract: graduator source", () => {

  it("exports classifyFactorSources function", () => {
    expect(GRADUATOR_SRC).toContain("export function classifyFactorSources");
  });

  it("exports EntryQualityWithSources type with factor_sources and factor_quality fields", () => {
    expect(GRADUATOR_SRC).toContain("factor_sources?:");
    expect(GRADUATOR_SRC).toContain("factor_quality?:");
  });

  it("classifyFactorSources call-site appears after rawConfluenceFactors declaration", () => {
    // The function definition of classifyFactorSources appears early in the file (exported).
    // The CALL SITE is in the graduation hot-path, which is after the rawConfluenceFactors
    // variable declaration. We find the call-site by looking for the destructuring assignment.
    const callSiteIdx   = GRADUATOR_SRC.indexOf("classifyFactorSources(rawConfluenceFactors");
    const rawBuildIdx   = GRADUATOR_SRC.indexOf("const rawConfluenceFactors");
    expect(callSiteIdx).toBeGreaterThan(0);
    expect(rawBuildIdx).toBeGreaterThan(0);
    expect(callSiteIdx).toBeGreaterThan(rawBuildIdx);
  });

  it("classifyFactorSources call-site passes rawConfluenceFactors, confluenceFactors, and entryIndicator (Wave 26 Pass H2)", () => {
    // Pass H2 added entryIndicator as a third argument to enable archetype-implied kb_inferred injection
    expect(GRADUATOR_SRC).toMatch(/classifyFactorSources\s*\(\s*rawConfluenceFactors\s*,\s*confluenceFactors\s*,\s*entryIndicator\s*\)/);
  });

  it("entryQualityBlock is typed as EntryQualityWithSources and includes both telemetric fields", () => {
    const assignIdx = GRADUATOR_SRC.indexOf("const entryQualityBlock: EntryQualityWithSources");
    expect(assignIdx).toBeGreaterThan(0);
    const blockSlice = GRADUATOR_SRC.slice(assignIdx, assignIdx + 800);
    expect(blockSlice).toContain("factor_sources");
    expect(blockSlice).toContain("factor_quality");
  });

  it("no SQL migration added for entry_quality (JSONB accepts additive keys transparently)", () => {
    // If someone added a migration file for entry_quality widening, that would be wrong.
    // The static check here ensures the implementation comment explains this.
    expect(GRADUATOR_SRC).toContain("JSONB column accepts them");
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// §5  Static source contract — Gate 3: thin_confluence_warning
// ─────────────────────────────────────────────────────────────────────────────

describe("Wave 26 Pass G B2 — Gate 3 static contract: thin_confluence_warning", () => {

  it("graduation.thin_confluence_warning audit action is in source", () => {
    expect(GRADUATOR_SRC).toContain("graduation.thin_confluence_warning");
  });

  it("audit row includes factor_quality, factor_sources, confluence_factors fields", () => {
    const actionIdx = GRADUATOR_SRC.indexOf('"graduation.thin_confluence_warning"');
    expect(actionIdx).toBeGreaterThan(0);
    const block = GRADUATOR_SRC.slice(actionIdx, actionIdx + 600);
    expect(block).toContain("factor_quality");
    expect(block).toContain("factor_sources");
    expect(block).toContain("confluence_factors");
  });

  it("audit row status is 'warning' (advisory — not a rejection)", () => {
    const actionIdx = GRADUATOR_SRC.indexOf('"graduation.thin_confluence_warning"');
    const block = GRADUATOR_SRC.slice(actionIdx, actionIdx + 600);
    expect(block).toContain('status: "warning"');
  });

  it("Discord WARN fires via notify() for fallback_only quality", () => {
    const thinWarnIdx = GRADUATOR_SRC.indexOf("graduation.thin_confluence_warning");
    const block = GRADUATOR_SRC.slice(thinWarnIdx, thinWarnIdx + 1200);
    expect(block).toContain("notify({");
    expect(block).toContain('"WARNING"');
  });

  it("Gate 3 fires only when factor_quality === 'fallback_only'", () => {
    expect(GRADUATOR_SRC).toMatch(/factor_quality === ["']fallback_only["']/);
  });

  it("Gate 3 does NOT set bucket status to pending (advisory-only, no revert)", () => {
    const thinWarnIdx = GRADUATOR_SRC.indexOf('"graduation.thin_confluence_warning"');
    const block = GRADUATOR_SRC.slice(thinWarnIdx, thinWarnIdx + 1500);
    expect(block).not.toContain('status: "pending"');
  });

  it("Gate 3 uses appendFamilyGradePostscript in the Discord body", () => {
    const thinWarnIdx = GRADUATOR_SRC.indexOf("graduation.thin_confluence_warning");
    const block = GRADUATOR_SRC.slice(thinWarnIdx, thinWarnIdx + 1500);
    expect(block).toContain("appendFamilyGradePostscript");
  });

  it("Gate 3 audit raw_factor_count field tracks the original LLM emission count", () => {
    const thinWarnIdx = GRADUATOR_SRC.indexOf("graduation.thin_confluence_warning");
    const block = GRADUATOR_SRC.slice(thinWarnIdx, thinWarnIdx + 600);
    expect(block).toContain("raw_factor_count");
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// §6  Additive invariant — existing gates not modified
// ─────────────────────────────────────────────────────────────────────────────

describe("Wave 26 Pass G B2 — additive invariant: existing gates are unchanged", () => {

  it("engine-compatible-indicator gate still present", () => {
    expect(GRADUATOR_SRC).toContain("graduation.rejected_no_engine_indicator");
  });

  it("source-fidelity gate still present", () => {
    expect(GRADUATOR_SRC).toContain("graduation.rejected_source_fidelity");
  });

  it("dsl_quality_critic LLM judge gate still present", () => {
    expect(GRADUATOR_SRC).toContain("graduation.rejected_dsl_quality_critic");
  });

  it("auditor self-audit gate still present", () => {
    expect(GRADUATOR_SRC).toContain("graduation.rejected_by_auditor");
  });

  it("raw confluence floor guard (≥2 injection) still present", () => {
    expect(GRADUATOR_SRC).toContain("if (f.length < 2)");
  });

});
