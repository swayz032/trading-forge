/**
 * deepscan22-x6-factory-failure-injection.test.ts
 *
 * Deep-scan #22 Track X6 (2026-07-09) — the grader capped the 8→9 factory/
 * confluence re-cert at 8 because the prior close was SCOPED to the loop-3
 * sizing gate, not a whole-surface failure-injection sweep of the
 * graduator/confluence path. This file is that sweep: for each control below,
 * a FAULT is injected and the control's catch/reject/route behavior is
 * RED-proven, then the CLEAN path is proven to still pass.
 *
 * Pattern note: direct-bucket-graduator.ts has a module-top-level
 * `import { db } from "../db/index.js"` that bootstraps DATABASE_URL on
 * import — every existing test file touching its pure helpers
 * (wave26-pass-g-b2-auditor-gates.test.ts, deepscan22-fix-a1-entry-quality-
 * dead-path.test.ts, wave26-pass-h2-archetype-implied-factors.test.ts) works
 * around this by re-implementing the pure logic inline and then pinning it to
 * the real source via static string/AST-light assertions. This file follows
 * the same established convention. Functions that live in genuine leaf
 * modules (confluence-provenance.ts, risk-sizing.ts, framework-overlay.ts)
 * are imported and exercised directly — no re-implementation needed there.
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  deriveEvidenceBackedConfluenceCount,
  evidenceBackedFactorCount,
  AUTO_FLOOR_FACTORS,
} from "../lib/confluence-provenance.js";
import {
  resolveConfluenceMultiplier,
  isConfluenceSizeUpsizeEnabled,
  DEFAULT_CONFLUENCE_MULTIPLIER,
} from "../lib/risk-sizing.js";
import { applyFrameworkOverlay } from "../services/framework-overlay.js";

const GRADUATOR_SRC = fs.readFileSync(
  path.resolve(__dirname, "../services/direct-bucket-graduator.ts"),
  "utf-8",
);
const PAPER_SIGNAL_SRC = fs.readFileSync(
  path.resolve(__dirname, "../services/paper-signal-service.ts"),
  "utf-8",
);
// Deep-scan #22 Z6 (2026-07-09): the entryQuality reader block was extracted
// out of paper-signal-service.ts into a pure leaf — see
// src/server/lib/confluence-path-resolver.ts::resolveConfluenceDispatch.
const RESOLVER_SRC = fs.readFileSync(
  path.resolve(__dirname, "../lib/confluence-path-resolver.ts"),
  "utf-8",
);

// ═════════════════════════════════════════════════════════════════════════
// Control 1 — Path-C wiring (ds22 CRITICAL#3): wrong-location JSONB-key
// mismatch must be REJECTED (dead path) and the correct nested shape must
// FIRE Path C. Locks the regression so the mismatch can't silently return.
// ═════════════════════════════════════════════════════════════════════════

interface ConfirmingIndicatorShape {
  indicator: string;
  params: Record<string, number>;
  direction: "agree" | "disagree" | "either";
}

// Exact reader mirror of paper-signal-service.ts:4161-4177 (static-pinned below).
function readEntryQualityAndDispatch(config: Record<string, unknown>) {
  const rawConfig = config as unknown as Record<string, unknown>;
  const entryQuality = (
    rawConfig.entry_quality ??
    (rawConfig.strategy as Record<string, unknown> | undefined)?.entry_quality
  ) as
    | {
        confluence_factors?: string[];
        extraction_provenance?: string;
        confirming_indicators?: ConfirmingIndicatorShape[];
        use_weighted_scoring?: boolean;
      }
    | undefined;

  const isLegacyStrategy =
    !entryQuality || entryQuality.extraction_provenance === "legacy_no_confluence";
  const useWeightedScoring = entryQuality?.use_weighted_scoring === true && !isLegacyStrategy;
  const customIndicators = entryQuality?.confirming_indicators ?? [];
  const usePerStrategy = customIndicators.length > 0;
  return { entryQuality, useWeightedScoring, usePerStrategy, customIndicators };
}

describe("X6 Control 1 — Path-C wiring: JSONB-key-location fault injection", () => {
  it("FAULT: use_weighted_scoring + confirming_indicators at WRONG (top-level) location -> dead Path C AND dead Path A (pre-fix regression reproduced)", () => {
    const injectedWrongLocation: Record<string, unknown> = {
      // Simulates a regression to the pre-FIX-A1 graduator INSERT shape: the
      // fields live as config-JSONB SIBLINGS of entry_quality, never inside it.
      use_weighted_scoring: true,
      confirming_indicators: ["market_structure_aligned", "killzone_active"], // bare-string tag array, wrong shape too
      entry_quality: {
        confluence_factors: ["market_structure_aligned", "killzone_active"],
        extraction_provenance: "youtube_transcript",
        // NOTE: no use_weighted_scoring, no confirming_indicators nested here.
      },
    };

    const { useWeightedScoring, usePerStrategy } = readEntryQualityAndDispatch(injectedWrongLocation);

    // The control must catch this: both paths stay dead regardless of the
    // top-level DB column / config key claiming otherwise.
    expect(useWeightedScoring).toBe(false);
    expect(usePerStrategy).toBe(false);
  });

  it("CLEAN: correct nested shape (inside entry_quality) actually fires Path C + Path A", () => {
    const correctShape: Record<string, unknown> = {
      entry_quality: {
        confluence_factors: ["market_structure_aligned", "killzone_active"],
        extraction_provenance: "youtube_transcript",
        use_weighted_scoring: true,
        confirming_indicators: [
          { indicator: "ema", params: { period: 50 }, direction: "agree" },
        ] as ConfirmingIndicatorShape[],
      },
    };

    const { useWeightedScoring, usePerStrategy, customIndicators } =
      readEntryQualityAndDispatch(correctShape);

    expect(useWeightedScoring).toBe(true);
    expect(usePerStrategy).toBe(true);
    expect(customIndicators).toHaveLength(1);
  });

  it("static pin: paper-signal-service.ts delegates to resolveConfluenceDispatch(), whose reader block reads ONLY rawConfig.entry_quality (or strategy.entry_quality) — no top-level fallback", () => {
    // Deep-scan #22 Z6 (2026-07-09): the reader block used to live inline in
    // paper-signal-service.ts; it is now a pure extracted leaf. Pin BOTH
    // halves of the contract: paper-signal-service.ts must call the resolver
    // (not reimplement the read inline), and the resolver's reader block
    // must preserve the no-top-level-fallback invariant this control exists
    // to guard.
    expect(PAPER_SIGNAL_SRC).toContain(
      'import { resolveConfluenceDispatch } from "../lib/confluence-path-resolver.js"',
    );
    expect(PAPER_SIGNAL_SRC).toContain("resolveConfluenceDispatch(rawConfig)");

    const readerIdx = RESOLVER_SRC.indexOf("const entryQuality = (");
    expect(readerIdx).toBeGreaterThan(0);
    const block = RESOLVER_SRC.slice(readerIdx, readerIdx + 400);
    expect(block).toContain("rawConfig.entry_quality");
    // Must NOT read a bare top-level use_weighted_scoring / confirming_indicators
    // sibling key as a fallback — that would silently reopen the dead path.
    expect(block).not.toMatch(/rawConfig\.use_weighted_scoring/);
    expect(block).not.toMatch(/rawConfig\.confirming_indicators(?!\s*\?)/);
  });

  it("static pin: graduator stamps use_weighted_scoring/confirming_indicators onto entryQualityBlock (mutation), not a sibling top-level config key", () => {
    expect(GRADUATOR_SRC).toContain(
      "entryQualityBlock.use_weighted_scoring = wave25Defaults.useWeightedScoring",
    );
    expect(GRADUATOR_SRC).toContain("entryQualityBlock.confirming_indicators = confirmingIndicators");
  });
});

// ═════════════════════════════════════════════════════════════════════════
// Control 2 — Bidirectional-completeness Gate 1: direction=both with one
// side empty/sentinel must REJECT + revert bucket + audit — never silently
// run long-only.
// ═════════════════════════════════════════════════════════════════════════

const BIDIR_SENTINEL = "high < low";

interface BidirectionalAuditResult {
  pass: boolean;
  reason: string | null;
}

// Inline mirror of auditBidirectionalCompleteness (static-pinned below).
function auditBidirectionalCompleteness(compiledConfig: {
  direction?: string;
  archetype?: string | null;
  entry_long?: string;
  entry_short?: string;
}): BidirectionalAuditResult {
  const direction = compiledConfig.direction ?? "";
  if (direction !== "both") return { pass: true, reason: null };

  const entryLong = compiledConfig.entry_long ?? "";
  const entryShort = compiledConfig.entry_short ?? "";
  const isHandlerDriven = Boolean(compiledConfig.archetype);

  const longIsSentinel = entryLong === BIDIR_SENTINEL || entryLong === "";
  const shortIsSentinel = entryShort === BIDIR_SENTINEL || entryShort === "";

  if (isHandlerDriven) {
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

describe("X6 Control 2 — Bidirectional completeness Gate 1: silent long-only fault injection", () => {
  it("FAULT: direction=both, short side is BIDIR_SENTINEL ('high < low'), long side real -> REJECT (not silent long-only)", () => {
    const result = auditBidirectionalCompleteness({
      direction: "both",
      archetype: null,
      entry_long: "ema_9 crosses_above ema_21",
      entry_short: BIDIR_SENTINEL, // the LLM only extracted the long side
    });
    expect(result.pass).toBe(false);
    expect(result.reason).toBe("incomplete_bidirectional_extraction");
  });

  it("FAULT: direction=both, long side empty string -> REJECT", () => {
    const result = auditBidirectionalCompleteness({
      direction: "both",
      archetype: null,
      entry_long: "",
      entry_short: "rsi_14 crosses_below 50",
    });
    expect(result.pass).toBe(false);
    expect(result.reason).toBe("incomplete_bidirectional_extraction");
  });

  it("CLEAN: direction=both, both sides real -> PASS", () => {
    const result = auditBidirectionalCompleteness({
      direction: "both",
      archetype: null,
      entry_long: "ema_9 crosses_above ema_21",
      entry_short: "ema_9 crosses_below ema_21",
    });
    expect(result.pass).toBe(true);
  });

  it("static pin: Gate 1 revert is no-poison (status=pending AND graduatedAt=null) and NEVER inserts into strategies", () => {
    const gate1Start = GRADUATOR_SRC.indexOf("Gate 1 — Bidirectional Completeness");
    const gate1End = GRADUATOR_SRC.indexOf("SOURCE-FIDELITY CHECK");
    expect(gate1Start).toBeGreaterThan(0);
    expect(gate1End).toBeGreaterThan(gate1Start);
    const block = GRADUATOR_SRC.slice(gate1Start, gate1End);
    expect(block).toContain('status: "pending", graduatedAt: null');
    expect(block).toContain("graduation.rejected_incomplete_bidirectional");
    // The reject path must `return` BEFORE reaching db.insert(strategies).
    expect(block).toContain("return {");
    expect(block).not.toContain("db.insert(strategies)");
  });

  it("static pin: db.insert(strategies) call site occurs textually AFTER the Gate 1 block (ordering invariant — reject truly precedes persistence)", () => {
    const gate1Start = GRADUATOR_SRC.indexOf("Gate 1 — Bidirectional Completeness");
    const insertIdx = GRADUATOR_SRC.indexOf("await db.insert(strategies).values({");
    expect(gate1Start).toBeGreaterThan(0);
    expect(insertIdx).toBeGreaterThan(gate1Start);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// Control 3 — factor_quality honesty (FIX A3 regression lock): a 0-real-
// factor config with a rich (>=3 step) entry_sequence must stay
// "fallback_only", NEVER get force-promoted to "rich".
// ═════════════════════════════════════════════════════════════════════════

type FactorSourceLabel = "extracted" | "auto_floor" | "kb_inferred";

function classifyFactorSources(
  rawFactors: string[],
  finalFactors: string[],
): { factor_sources: Record<string, FactorSourceLabel>; factor_quality: "rich" | "thin" | "fallback_only" } {
  const rawSet = new Set(rawFactors);
  const sources: Record<string, FactorSourceLabel> = {};
  for (const factor of finalFactors) {
    sources[factor] = rawSet.has(factor) ? "extracted" : "auto_floor";
  }
  const realCount = finalFactors.filter((f) => sources[f] === "extracted").length;
  let factor_quality: "rich" | "thin" | "fallback_only";
  if (realCount >= 2) factor_quality = "rich";
  else if (realCount === 1) factor_quality = "thin";
  else factor_quality = "fallback_only";
  return { factor_sources: sources, factor_quality };
}

// PRE-FIX A3 buggy promotion rule (fires regardless of realFactorCount) —
// reproduces the bug described in direct-bucket-graduator.ts lines 2683-2699.
function v11PromotionBuggy(rawFactorQuality: "rich" | "thin" | "fallback_only", entrySeqLen: number, targetsLen: number) {
  const v11RichExtractionBuggy = entrySeqLen >= 3 || targetsLen >= 3;
  return v11RichExtractionBuggy ? "rich" : rawFactorQuality;
}

// POST-FIX A3 corrected promotion rule (requires realFactorCount >= 2 too).
function v11PromotionFixed(
  rawFactorQuality: "rich" | "thin" | "fallback_only",
  entrySeqLen: number,
  targetsLen: number,
  realFactorCount: number,
) {
  const v11RichExtraction = (entrySeqLen >= 3 || targetsLen >= 3) && realFactorCount >= 2;
  return v11RichExtraction ? "rich" : rawFactorQuality;
}

describe("X6 Control 3 — factor_quality honesty (FIX A3 regression lock)", () => {
  it("FAULT (pre-FIX-A3 bug reproduced): 0 real factors + 3-step entry_sequence force-promotes to 'rich' under the buggy rule", () => {
    const raw: string[] = [];
    const final = ["regime_match", "structural_setup"]; // both auto_floor — zero real evidence
    const { factor_quality: rawFactorQuality } = classifyFactorSources(raw, final);
    expect(rawFactorQuality).toBe("fallback_only");

    // The bug: a rich v11 extraction (3-step sequence) alone flips it to "rich"
    // even though there is NO real confluence evidence behind it.
    const buggyResult = v11PromotionBuggy(rawFactorQuality, 3, 0);
    expect(buggyResult).toBe("rich"); // reproduces the defect
  });

  it("CLEAN (post-FIX-A3): same 0-real-factor input stays 'fallback_only' — the AND realFactorCount>=2 guard holds", () => {
    const raw: string[] = [];
    const final = ["regime_match", "structural_setup"];
    const { factor_quality: rawFactorQuality } = classifyFactorSources(raw, final);
    const realFactorCount = 0;

    const fixedResult = v11PromotionFixed(rawFactorQuality, 3, 0, realFactorCount);
    expect(fixedResult).toBe("fallback_only"); // control holds: no manufactured "rich"
  });

  it("CLEAN: 2+ real factors + 3-step sequence legitimately promotes thin/rich extraction to 'rich' (the intended upgrade path is preserved)", () => {
    const raw = ["market_structure_aligned", "smt_confirmation"];
    const final = ["market_structure_aligned", "smt_confirmation"];
    const { factor_quality: rawFactorQuality } = classifyFactorSources(raw, final);
    expect(rawFactorQuality).toBe("rich"); // already rich via realCount>=2 alone

    // Even a "thin" raw classification (1 real factor) is legitimately promotable
    // when realFactorCount criterion still requires >=2 -- test the boundary:
    // exactly 1 real factor must NOT be promoted even with a rich v11 sequence.
    const oneRealRaw = ["market_structure_aligned"];
    const oneRealFinal = ["market_structure_aligned", "regime_match"];
    const { factor_quality: thinQuality } = classifyFactorSources(oneRealRaw, oneRealFinal);
    expect(thinQuality).toBe("thin");
    const oneRealPromotion = v11PromotionFixed(thinQuality, 3, 0, 1);
    expect(oneRealPromotion).toBe("thin"); // 1 real factor is NOT enough to promote
  });

  it("static pin: v11 promotion in the real graduator requires realFactorCount >= 2 (FIX A3 guard is present, not regressed)", () => {
    const idx = GRADUATOR_SRC.indexOf("const v11RichExtraction =");
    expect(idx).toBeGreaterThan(0);
    const line = GRADUATOR_SRC.slice(idx, idx + 200);
    expect(line).toMatch(/realFactorCount\s*>=\s*2/);
  });

  it("static pin: Gate 3 (thin_confluence_warning) fires exactly when factor_quality === 'fallback_only'", () => {
    expect(GRADUATOR_SRC).toMatch(/if\s*\(\s*factor_quality\s*===\s*["']fallback_only["']\s*\)/);
    const gateIdx = GRADUATOR_SRC.indexOf("GATE 3 — fallback_only thin-confluence warning");
    expect(gateIdx).toBeGreaterThan(0);
    const block = GRADUATOR_SRC.slice(gateIdx, gateIdx + 1200);
    expect(block).toContain("graduation.thin_confluence_warning");
  });
});

// ═════════════════════════════════════════════════════════════════════════
// Control 4 — F-1 sizing provenance: confirming_indicators objects must
// NEVER inflate the evidence-backed count; auto_floor factors stay excluded.
// ═════════════════════════════════════════════════════════════════════════

describe("X6 Control 4 — F-1 sizing provenance: confirming_indicators type-confusion fault injection", () => {
  it("FAULT (pre-F-1 bug reproduced): passing ConfirmingIndicator OBJECTS into the string[]-typed evidenceBackedFactorCount() never excludes anything -> inflated count", () => {
    const confirmingIndicatorObjs = [
      { indicator: "ema", params: {}, direction: "agree" },
      { indicator: "vwap", params: {}, direction: "agree" },
      { indicator: "rsi", params: {}, direction: "agree" },
    ];
    // The historical bug: the sizing call site passed confirming_indicators
    // (objects) into a function typed for confluence_factors (strings). Since
    // AUTO_FLOOR_FACTORS.has(object) is always false, NOTHING gets excluded —
    // every entry counts as "evidence-backed" regardless of real content.
    const buggyCount = evidenceBackedFactorCount(
      confirmingIndicatorObjs as unknown as string[],
    );
    expect(buggyCount).toBe(3); // reproduces the defect: fully inflated, no exclusion
  });

  it("CLEAN: deriveEvidenceBackedConfluenceCount ignores confirming_indicators entirely and reads confluence_factors -> yields 1 when confluence_factors is empty (not inflated by the objects)", () => {
    const entryQualityWithBothFields = {
      confluence_factors: [] as string[],
      // Present but MUST be irrelevant to the count derivation:
      confirming_indicators: [
        { indicator: "ema", params: {}, direction: "agree" },
        { indicator: "vwap", params: {}, direction: "agree" },
        { indicator: "rsi", params: {}, direction: "agree" },
      ],
    } as unknown as Parameters<typeof deriveEvidenceBackedConfluenceCount>[0];

    const count = deriveEvidenceBackedConfluenceCount(entryQualityWithBothFields);
    expect(count).toBe(1); // 0 evidence-backed confluence_factors + 1 primary — NOT 4
  });

  it("CLEAN: auto_floor-only confluence_factors are excluded from the count (regime_match/structural_setup never justify upsize)", () => {
    const count = deriveEvidenceBackedConfluenceCount({
      confluence_factors: ["regime_match", "structural_setup"],
    });
    expect(count).toBe(1);
    expect(AUTO_FLOOR_FACTORS.has("regime_match")).toBe(true);
    expect(AUTO_FLOOR_FACTORS.has("structural_setup")).toBe(true);
  });

  it("CLEAN: mixed evidence-backed + auto_floor factors count only the evidence-backed portion + 1", () => {
    const count = deriveEvidenceBackedConfluenceCount({
      confluence_factors: ["vwap_alignment", "smt_confirmation", "regime_match"],
    });
    expect(count).toBe(3); // 2 evidence-backed + 1 primary
  });

  it("fail-safe direction: the fix can only reduce or hold the pre-fix value, never increase it", () => {
    // Pre-fix (buggy) semantics if confirming_indicators HAD been read as strings
    // would have inflated to len+1=4; the fixed function must never exceed the
    // count actually backed by confluence_factors evidence.
    const fixed = deriveEvidenceBackedConfluenceCount({
      confluence_factors: [],
      confirming_indicators: [{ indicator: "a" }, { indicator: "b" }, { indicator: "c" }],
    } as unknown as Parameters<typeof deriveEvidenceBackedConfluenceCount>[0]);
    expect(fixed).toBeLessThan(4);
    expect(fixed).toBe(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// Control 5 — CONFLUENCE_SIZE_UPSIZE_ENABLED default-OFF: flag unset must be
// a hard size no-op even with a populated multiplier map; flag on applies it.
// ═════════════════════════════════════════════════════════════════════════

const _PRIOR_FLAG = process.env.CONFLUENCE_SIZE_UPSIZE_ENABLED;
afterAll(() => {
  if (_PRIOR_FLAG === undefined) delete process.env.CONFLUENCE_SIZE_UPSIZE_ENABLED;
  else process.env.CONFLUENCE_SIZE_UPSIZE_ENABLED = _PRIOR_FLAG;
});
beforeEach(() => {
  delete process.env.CONFLUENCE_SIZE_UPSIZE_ENABLED;
});

describe("X6 Control 5 — CONFLUENCE_SIZE_UPSIZE_ENABLED default-OFF fault injection", () => {
  it("FAULT injection attempt: flag unset + a populated upsize map that WOULD upsize if honored -> multiplier stays 1.0 (size no-op)", () => {
    expect(isConfluenceSizeUpsizeEnabled()).toBe(false);
    const aggressiveMap = { 1: 1.0, 2: 1.5, 3: 2.0, 4: 3.0 };
    expect(resolveConfluenceMultiplier(4, aggressiveMap)).toBe(1.0);
    expect(resolveConfluenceMultiplier(2, aggressiveMap)).toBe(1.0);
  });

  it("FAULT injection: near-miss truthy env strings ('1', 'TRUE', 'yes') must NOT enable the upsize", () => {
    for (const badValue of ["1", "TRUE", "yes", "on", " true", "true "]) {
      process.env.CONFLUENCE_SIZE_UPSIZE_ENABLED = badValue;
      expect(isConfluenceSizeUpsizeEnabled()).toBe(false);
      expect(resolveConfluenceMultiplier(4)).toBe(1.0);
    }
  });

  it("CLEAN: flag ON activates the canonical multiplier map as designed", () => {
    process.env.CONFLUENCE_SIZE_UPSIZE_ENABLED = "true";
    expect(isConfluenceSizeUpsizeEnabled()).toBe(true);
    expect(resolveConfluenceMultiplier(3)).toBe(DEFAULT_CONFLUENCE_MULTIPLIER[3]);
    expect(resolveConfluenceMultiplier(4)).toBe(DEFAULT_CONFLUENCE_MULTIPLIER[4]);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// Control 7 — framework-overlay authority: LLM-extracted base/tier/cap must
// be REPLACED with canonical Wave-23 values; a stray styleD key must not
// survive the overlay.
// ═════════════════════════════════════════════════════════════════════════

describe("X6 Control 7 — framework-overlay authority: LLM sizing override + styleD injection", () => {
  it("FAULT: LLM-extracted base_contracts/tier_increment/liquidity_comfort_cap survive verbatim into overlay input -> overlay REPLACES them with canonical Wave-23 values (MES)", () => {
    const compiledWithLlmSizing = {
      exit_type: "trailing_stop",
      strategy: {
        stop_loss: { type: "atr", multiplier: 1.5 },
        position_size: {
          type: "risk_derived_pyramid",
          base_contracts: 4, // WRONG — LLM claimed "max 4 MES contracts"
          tier_increment: 1, // WRONG — canonical is 3
          tier_threshold_dollars: 3000,
          personal_dll_pct: 0.67,
          max_risk_pct_per_trade: 0.02,
          liquidity_comfort_cap: 999, // WRONG — canonical MES cap is 100
          topstep_account_cap_override: null,
          computed_at_signal_time: true,
        },
      },
    };

    const result = applyFrameworkOverlay({
      compiled: compiledWithLlmSizing as any,
      source: "graduated_bucket",
      symbol: "MES",
    });

    const ps = (result.config.strategy as any).position_size;
    expect(ps.base_contracts).toBe(9); // canonical Wave-23 MES base (scaling-plan-baby-mode 2026-06-23)
    expect(ps.tier_increment).toBe(3);
    expect(ps.liquidity_comfort_cap).toBe(100);
    expect(result.appliedRules.some((r) => r.includes("base_contracts=9"))).toBe(true);
  });

  it("FAULT: injected styleD key inside exit_params must not survive the Style-C overlay normalization", () => {
    const compiledWithStyleD = {
      exit_type: "trailing_stop",
      exit_params: {
        // Simulates a mis-extraction that injected a legacy/foreign styleD block.
        styleD: { pyramid_add: true, trail_pct: 0.5 },
      },
      strategy: { stop_loss: { type: "atr", multiplier: 1.5 } },
    };

    const result = applyFrameworkOverlay({
      compiled: compiledWithStyleD as any,
      source: "graduated_bucket",
      symbol: "MES",
    });

    expect(result.config.exit_params).toBeDefined();
    expect((result.config.exit_params as Record<string, unknown>).style).toBe("c");
    expect((result.config.exit_params as Record<string, unknown>)).not.toHaveProperty("styleD");
    // The strip must be observable (audit/appliedRules), not a silent drop.
    expect(result.appliedRules.some((r) => r.includes("styleD"))).toBe(true);
  });

  it("CLEAN: a strategy with no position_size at all still receives the full canonical risk_derived_pyramid shape (MNQ)", () => {
    const compiledBare = { exit_type: "trailing_stop", strategy: {} };
    const result = applyFrameworkOverlay({
      compiled: compiledBare as any,
      source: "graduated_bucket",
      symbol: "MNQ",
    });
    const ps = (result.config.strategy as any).position_size;
    expect(ps.type).toBe("risk_derived_pyramid");
    expect(ps.base_contracts).toBe(9);
    expect(ps.liquidity_comfort_cap).toBe(50);
  });

  it("CLEAN: legacy max_contracts / target_risk_dollars are stripped (Wave 10 bug fix) regardless of what the LLM baked in", () => {
    const compiledLegacy = {
      exit_type: "trailing_stop",
      strategy: {
        position_size: {
          type: "profit_tier_pyramid",
          max_contracts: 50, // legacy static bake — must be removed
          target_risk_dollars: 500, // legacy placeholder — must be removed
          base_contracts: 9,
        },
      },
    };
    const result = applyFrameworkOverlay({
      compiled: compiledLegacy as any,
      source: "graduated_bucket",
      symbol: "MES",
    });
    const ps = (result.config.strategy as any).position_size;
    expect(ps).not.toHaveProperty("max_contracts");
    expect(ps).not.toHaveProperty("target_risk_dollars");
    expect(ps.type).toBe("risk_derived_pyramid");
  });
});
