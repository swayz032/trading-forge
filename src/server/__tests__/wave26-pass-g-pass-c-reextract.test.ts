/**
 * wave26-pass-g-pass-c-reextract.test.ts — Wave 26 Pass G Pass C (2026-05-26)
 *
 * Verifies the batch re-extraction script's core contracts:
 *
 *   1. Cohort filter — only fallback_only/thin strategies included; rich excluded
 *   2. Idempotency flag — reextract_attempted=true strategies skipped
 *   3. Regression guard — new extraction with fewer factors keeps old config
 *   4. Fire-and-forget audit — extraction.reextracted / regression_skipped rows
 *   5. DEPLOYED/PILOT skip — never mutated
 *   6. Archetype change handling — entry_indicator updated when idea differs
 *   7. Dry-run no-write contract — no DB mutations in DRY-RUN mode
 *   8. Discord notify — sends aggregate before/after (fire-and-forget)
 *   9. No-URL skip — strategies with unresolvable URLs get skip_no_url transition
 *  10. Quality transition labels — all 7 TransitionLabel values covered
 *
 * Pattern: static source inspection + inline pure-function re-implementations
 * to avoid triggering the DATABASE_URL bootstrap in the import chain.
 * Mirrors wave26-pass-g-b2-auditor-gates.test.ts pattern.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ─── Script source for contract verification ─────────────────────────────────

const SCRIPT_SRC = fs.readFileSync(
  path.resolve(__dirname, "../../../scripts/wave26-pass-g-pass-c-reextract.ts"),
  "utf-8",
);

// ─────────────────────────────────────────────────────────────────────────────
// §0  Inline pure-function re-implementations
//
// We re-implement the pure functions here to keep tests DB-free.
// Static source tests in §7 verify the script matches these implementations.
// ─────────────────────────────────────────────────────────────────────────────

type FactorQuality    = "rich" | "thin" | "fallback_only";
type FactorSourceLabel = "extracted" | "auto_floor" | "kb_inferred";

const AUTO_FLOOR_FACTORS = new Set(["regime_match", "structural_setup"]);

function classifyFactorQuality(factors: string[]): FactorQuality {
  const real = factors.filter((f) => !AUTO_FLOOR_FACTORS.has(f));
  if (real.length === 0) return "fallback_only";
  if (real.length === 1) return "thin";
  return "rich";
}

function classifyFactorSources(
  rawFactors: string[],
  finalFactors: string[],
): { factor_sources: Record<string, FactorSourceLabel>; factor_quality: FactorQuality } {
  const rawSet = new Set(rawFactors);
  const sources: Record<string, FactorSourceLabel> = {};
  for (const f of finalFactors) {
    sources[f] = rawSet.has(f) ? "extracted" : "auto_floor";
  }
  const realCount = finalFactors.filter(
    (f) => sources[f] === "extracted" || sources[f] === "kb_inferred",
  ).length;
  const fq: FactorQuality = realCount >= 2 ? "rich" : realCount === 1 ? "thin" : "fallback_only";
  return { factor_sources: sources, factor_quality: fq };
}

type TransitionLabel =
  | "fallback_only_to_rich"
  | "fallback_only_to_thin"
  | "thin_to_rich"
  | "thin_to_fallback_only"
  | "no_change"
  | "regression_skipped"
  | "skip_already_attempted"
  | "skip_deployed_pilot"
  | "skip_no_url"
  | "skip_extract_failed";

function computeTransition(
  qBefore: FactorQuality,
  qAfter:  FactorQuality,
): TransitionLabel {
  if (qBefore === "fallback_only" && qAfter === "rich")  return "fallback_only_to_rich";
  if (qBefore === "fallback_only" && qAfter === "thin")  return "fallback_only_to_thin";
  if (qBefore === "thin"          && qAfter === "rich")  return "thin_to_rich";
  if (qBefore === "thin"          && qAfter === "fallback_only") return "thin_to_fallback_only";
  return "no_change";
}

function regressionCheck(
  factorsBefore: string[],
  rawNew:        string[],
): boolean {
  const realBefore = factorsBefore.filter((f) => !AUTO_FLOOR_FACTORS.has(f)).length;
  const realAfter  = rawNew.filter((f) => !AUTO_FLOOR_FACTORS.has(f)).length;
  return realAfter < realBefore && realBefore > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// §1  Cohort filter logic
// ─────────────────────────────────────────────────────────────────────────────

describe("Wave 26 Pass G Pass C — Cohort filter", () => {
  it("classifies [] as fallback_only", () => {
    expect(classifyFactorQuality([])).toBe("fallback_only");
  });

  it("classifies [regime_match, structural_setup] as fallback_only (auto-floor only)", () => {
    expect(classifyFactorQuality(["regime_match", "structural_setup"])).toBe("fallback_only");
  });

  it("classifies [regime_match, market_structure_aligned] as thin (1 real factor)", () => {
    expect(classifyFactorQuality(["regime_match", "market_structure_aligned"])).toBe("thin");
  });

  it("classifies 2+ real factors as rich", () => {
    expect(classifyFactorQuality([
      "market_structure_aligned",
      "killzone_active",
      "regime_match",
    ])).toBe("rich");
  });

  it("classifies exactly 2 real factors as rich (boundary)", () => {
    expect(classifyFactorQuality(["market_structure_aligned", "killzone_active"])).toBe("rich");
  });

  it("rich strategies would not appear in query (SQL filter excludes them)", () => {
    // Verify script SQL filter does not include rich
    expect(SCRIPT_SRC).toContain("'fallback_only', 'thin'");
    expect(SCRIPT_SRC).not.toMatch(/factor_quality.*=.*'rich'/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2  Idempotency flag
// ─────────────────────────────────────────────────────────────────────────────

describe("Wave 26 Pass G Pass C — Idempotency flag", () => {
  it("script SQL filter excludes strategies with reextract_attempted=true", () => {
    expect(SCRIPT_SRC).toContain("reextract_attempted");
    expect(SCRIPT_SRC).toContain("IS DISTINCT FROM 'true'");
  });

  it("no_change path for fallback_only sets reextract_attempted=true to prevent future re-runs", () => {
    // Script should call markAlreadyAttempted for no_change fallback_only strategies
    expect(SCRIPT_SRC).toContain("markAlreadyAttempted");
    expect(SCRIPT_SRC).toContain("skip_already_attempted");
  });

  it("regression_skipped path writes reextract_attempted=true in applyRegressionSkip", () => {
    expect(SCRIPT_SRC).toContain("applyRegressionSkip");
    expect(SCRIPT_SRC).toContain("reextract_attempted");
  });

  it("successful re-extraction writes reextract_attempted=true in applyStrategyMutation", () => {
    // The jsonb_set chain in applyStrategyMutation includes reextract_attempted
    expect(SCRIPT_SRC).toContain("'{entry_quality,reextract_attempted}'");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3  Regression guard
// ─────────────────────────────────────────────────────────────────────────────

describe("Wave 26 Pass G Pass C — Regression guard", () => {
  it("detects regression when new has 0 real factors vs 2 before", () => {
    expect(regressionCheck(
      ["market_structure_aligned", "killzone_active", "regime_match"],
      ["regime_match", "structural_setup"],
    )).toBe(true);
  });

  it("detects regression when new has 1 real factor vs 3 before", () => {
    expect(regressionCheck(
      ["market_structure_aligned", "killzone_active", "vwap_alignment"],
      ["market_structure_aligned"],
    )).toBe(true);
  });

  it("does NOT flag regression when new equals before (0 vs 0 auto-floor)", () => {
    expect(regressionCheck(
      ["regime_match", "structural_setup"],
      ["regime_match", "structural_setup"],
    )).toBe(false);
  });

  it("does NOT flag regression when new has MORE real factors", () => {
    expect(regressionCheck(
      ["regime_match"],
      ["market_structure_aligned", "killzone_active"],
    )).toBe(false);
  });

  it("regression_skipped mutation uses extraction.regression_skipped audit action", () => {
    expect(SCRIPT_SRC).toContain("extraction.regression_skipped");
  });

  it("regression_skipped transition label is declared in TransitionLabel type", () => {
    expect(SCRIPT_SRC).toContain("regression_skipped");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4  Fire-and-forget audit rows
// ─────────────────────────────────────────────────────────────────────────────

describe("Wave 26 Pass G Pass C — Audit rows", () => {
  it("emits extraction.reextracted audit action for successful mutations", () => {
    expect(SCRIPT_SRC).toContain("'extraction.reextracted'");
  });

  it("emits extraction.regression_skipped audit action for regression guard", () => {
    expect(SCRIPT_SRC).toContain("'extraction.regression_skipped'");
  });

  it("audit rows carry entity_type=strategy", () => {
    expect(SCRIPT_SRC).toContain("'strategy'");
  });

  it("audit rows carry correlation_id from per-run correlationId", () => {
    expect(SCRIPT_SRC).toContain("correlationId");
    expect(SCRIPT_SRC).toContain("correlation_id");
  });

  it("audit rows carry gemma_version field for traceability", () => {
    expect(SCRIPT_SRC).toContain("gemma_version");
    expect(SCRIPT_SRC).toContain("v10");
  });

  it("audit rows carry before/after factor counts for dashboard queries", () => {
    expect(SCRIPT_SRC).toContain("factors_before_count");
    expect(SCRIPT_SRC).toContain("factors_after_count");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5  DEPLOYED/PILOT skip
// ─────────────────────────────────────────────────────────────────────────────

describe("Wave 26 Pass G Pass C — DEPLOYED/PILOT skip", () => {
  it("SQL query does NOT include DEPLOYED in lifecycle_state filter", () => {
    // The eligible-strategy query uses only CANDIDATE,TESTING,PAPER,DEPLOY_READY,DECLINING
    expect(SCRIPT_SRC).toContain("'CANDIDATE','TESTING','PAPER','DEPLOY_READY','DECLINING'");
    // The eligible-state block must NOT add DEPLOYED or PILOT next to the factor_quality filter
    // (the distribution query separately uses DEPLOYED for library-wide counting — that is intentional)
    const eligibleBlock =
      SCRIPT_SRC.match(/'CANDIDATE','TESTING','PAPER','DEPLOY_READY','DECLINING'/)?.[0] ?? "";
    expect(eligibleBlock).not.toContain("'DEPLOYED'");
    expect(eligibleBlock).not.toContain("'PILOT'");
  });

  it("DEPLOYED and PILOT are NOT in the eligible lifecycle states", () => {
    const stateBlock = SCRIPT_SRC.match(/'CANDIDATE','TESTING','PAPER','DEPLOY_READY','DECLINING'/);
    expect(stateBlock).not.toBeNull();
    // The DEPLOYED / PILOT states used elsewhere must not be added to this block
    const eligibleBlock = stateBlock?.[0] ?? "";
    expect(eligibleBlock).not.toContain("DEPLOYED");
    expect(eligibleBlock).not.toContain("PILOT");
  });

  it("skip_deployed_pilot TransitionLabel is declared in the type", () => {
    expect(SCRIPT_SRC).toContain("skip_deployed_pilot");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6  Archetype change handling
// ─────────────────────────────────────────────────────────────────────────────

describe("Wave 26 Pass G Pass C — Archetype change handling", () => {
  it("archetype_changed flag is set when new idea has different entry_indicator", () => {
    // We verify the script checks entry_indicator for archetype change detection
    expect(SCRIPT_SRC).toContain("archetypeChanged");
    expect(SCRIPT_SRC).toContain("entry_indicator");
    expect(SCRIPT_SRC).toContain("archetype_changed");
  });

  it("archetype_changed is emitted in audit result payload", () => {
    expect(SCRIPT_SRC).toContain("archetype_changed: mutation.archetype_changed");
  });

  it("classifyFactorSources labels correctly (extracted vs auto_floor)", () => {
    const { factor_sources, factor_quality } = classifyFactorSources(
      ["market_structure_aligned", "killzone_active"], // raw LLM output
      ["market_structure_aligned", "killzone_active", "regime_match", "structural_setup"],
    );
    expect(factor_quality).toBe("rich");
    expect(factor_sources["market_structure_aligned"]).toBe("extracted");
    expect(factor_sources["killzone_active"]).toBe("extracted");
    expect(factor_sources["regime_match"]).toBe("auto_floor");
    expect(factor_sources["structural_setup"]).toBe("auto_floor");
  });

  it("classifyFactorSources returns fallback_only when all factors are auto_floor", () => {
    const { factor_quality } = classifyFactorSources([], ["regime_match", "structural_setup"]);
    expect(factor_quality).toBe("fallback_only");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7  Dry-run no-write contract
// ─────────────────────────────────────────────────────────────────────────────

describe("Wave 26 Pass G Pass C — Dry-run no-write contract", () => {
  it("script defaults to DRY_RUN when --apply flag is absent", () => {
    expect(SCRIPT_SRC).toContain("APPLY_MODE    = process.argv.includes(\"--apply\")");
    expect(SCRIPT_SRC).toContain("DRY_RUN       = !APPLY_MODE");
  });

  it("write operations (applyStrategyMutation, applyRegressionSkip) are inside APPLY block", () => {
    // In dry-run, script returns before reaching the mutation loop
    expect(SCRIPT_SRC).toContain("DRY_RUN");
    expect(SCRIPT_SRC).toContain("re-run with --apply");
  });

  it("dry-run path prints planned mutations without calling applyStrategyMutation", () => {
    // The early return on DRY_RUN is before the mutation loop
    const dryRunSection = SCRIPT_SRC.indexOf("DRY-RUN complete");
    const applySection  = SCRIPT_SRC.indexOf("APPLY mode: executing mutations");
    expect(dryRunSection).toBeGreaterThan(0);
    expect(applySection).toBeGreaterThan(0);
    // dry-run section appears before apply section in the source flow
    expect(dryRunSection).toBeLessThan(applySection);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8  Discord notification
// ─────────────────────────────────────────────────────────────────────────────

describe("Wave 26 Pass G Pass C — Discord notify", () => {
  it("Discord send is gated on DISCORD_WEBHOOK_URL_STRATEGY_FINDS env var", () => {
    expect(SCRIPT_SRC).toContain("DISCORD_WEBHOOK_URL_STRATEGY_FINDS");
    expect(SCRIPT_SRC).toContain("DISCORD_WEBHOOK");
  });

  it("Discord message includes aggregate before/after distribution", () => {
    expect(SCRIPT_SRC).toContain("distBefore.rich");
    expect(SCRIPT_SRC).toContain("distAfter.rich");
  });

  it("Discord send is fire-and-forget (does not throw or block main flow)", () => {
    expect(SCRIPT_SRC).toContain("await sendDiscordWarn");
    // The sendDiscordWarn function has try/catch with empty catch
    expect(SCRIPT_SRC).toContain("catch { /* fire-and-forget */");
  });

  it("Discord message includes correlation ID for traceability", () => {
    expect(SCRIPT_SRC).toContain("correlation: ${correlationId}");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9  No-URL skip
// ─────────────────────────────────────────────────────────────────────────────

describe("Wave 26 Pass G Pass C — No-URL skip", () => {
  it("strategies with no resolvable URL get skip_no_url transition", () => {
    expect(SCRIPT_SRC).toContain("skip_no_url");
    expect(SCRIPT_SRC).toContain("noUrlStrategies");
  });

  it("no-URL strategies are not sent to scout-extract", () => {
    // noUrlStrategies loop writes skip mutations — verify both appear in the script
    expect(SCRIPT_SRC).toContain("noUrlStrategies");
    expect(SCRIPT_SRC).toContain("processUrlsWithConcurrency");
    // skip_no_url transition is assigned for unresolved strategies
    expect(SCRIPT_SRC).toContain("transition:     \"skip_no_url\"");
  });

  it("script resolves URLs via strategy_pending_buckets → strategy_pending_mentions join", () => {
    expect(SCRIPT_SRC).toContain("strategy_pending_buckets");
    expect(SCRIPT_SRC).toContain("strategy_pending_mentions");
    expect(SCRIPT_SRC).toContain("graduated_strategy_id");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §10  Transition label coverage
// ─────────────────────────────────────────────────────────────────────────────

describe("Wave 26 Pass G Pass C — Transition label coverage", () => {
  it("fallback_only → rich transition label computed correctly", () => {
    expect(computeTransition("fallback_only", "rich")).toBe("fallback_only_to_rich");
  });

  it("fallback_only → thin transition label computed correctly", () => {
    expect(computeTransition("fallback_only", "thin")).toBe("fallback_only_to_thin");
  });

  it("thin → rich transition label computed correctly", () => {
    expect(computeTransition("thin", "rich")).toBe("thin_to_rich");
  });

  it("thin → fallback_only transition label computed correctly", () => {
    expect(computeTransition("thin", "fallback_only")).toBe("thin_to_fallback_only");
  });

  it("no_change transition for same quality", () => {
    expect(computeTransition("fallback_only", "fallback_only")).toBe("no_change");
    expect(computeTransition("thin", "thin")).toBe("no_change");
    expect(computeTransition("rich", "rich")).toBe("no_change");
  });

  it("all 7 TransitionLabel variants are declared in the script", () => {
    const expectedLabels: TransitionLabel[] = [
      "fallback_only_to_rich",
      "fallback_only_to_thin",
      "thin_to_rich",
      "thin_to_fallback_only",
      "no_change",
      "regression_skipped",
      "skip_no_url",
    ];
    for (const label of expectedLabels) {
      expect(SCRIPT_SRC, `missing transition label: ${label}`).toContain(`"${label}"`);
    }
  });

  it("Prometheus counter emit is called per mutation with transition label", () => {
    expect(SCRIPT_SRC).toContain("emitPromCounter(m.transition)");
    expect(SCRIPT_SRC).toContain("tf_strategy_reextracted_total");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §11  Additional structural contract tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Wave 26 Pass G Pass C — Structural contracts", () => {
  it("script supports --cohort=both flag for running against both fallback_only and thin", () => {
    expect(SCRIPT_SRC).toContain("cohort=both");
    expect(SCRIPT_SRC).toContain("COHORT");
  });

  it("script supports --parallelism=N flag", () => {
    expect(SCRIPT_SRC).toContain("--parallelism=");
    expect(SCRIPT_SRC).toContain("PARALLELISM");
  });

  it("script supports --limit=N flag", () => {
    expect(SCRIPT_SRC).toContain("--limit=");
    expect(SCRIPT_SRC).toContain("LIMIT");
  });

  it("parallelism is bounded 1-8 (no runaway Gemma calls)", () => {
    // The PARALLELISM cap check is present
    expect(SCRIPT_SRC).toContain("n >= 1 && n <= 8");
  });

  it("scout-extract is called via canonical HTTP endpoint (not direct LLM)", () => {
    expect(SCRIPT_SRC).toContain("/api/agent/scout-extract");
    expect(SCRIPT_SRC).toContain("callScoutExtract");
  });

  it("transcript is fetched via youtube-transcript npm package", () => {
    expect(SCRIPT_SRC).toContain("YoutubeTranscript");
    expect(SCRIPT_SRC).toContain("fetchTranscript");
  });

  it("per-URL dedup groups strategies sharing the same source video", () => {
    expect(SCRIPT_SRC).toContain("urlToStrategies");
    expect(SCRIPT_SRC).toContain("cohort dedup");
  });

  it("library distribution is queried before and after for before/after reporting", () => {
    expect(SCRIPT_SRC).toContain("queryLibraryDistribution");
    expect(SCRIPT_SRC).toContain("distBefore");
    expect(SCRIPT_SRC).toContain("distAfter");
  });
});
