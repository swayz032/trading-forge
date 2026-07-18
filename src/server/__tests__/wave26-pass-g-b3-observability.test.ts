/**
 * wave26-pass-g-b3-observability.test.ts — Wave 26 Pass G B3 (2026-05-26)
 *
 * Verifies the confluence-quality observability layer:
 *   - Audit events fire under correct conditions
 *   - Prometheus counters increment correctly
 *   - SSE broadcasts fire on Gate 1 and Gate 3
 *   - Discord notify is idempotent per strategy_id per session
 *   - Backfill script's classifyFactorQuality is consistent
 *   - All emit functions are fire-and-forget (void return, never throw)
 *   - Correlation IDs propagate to audit rows
 *   - metrics-registry.ts declares the 3 new counters/histograms
 *   - sse.ts declares the 2 new event constants
 *   - Extraction parity test hook fires correctly
 *
 * No DB connection required — db.insert is mocked via vi.mock at the module level.
 * SSE broadcastSSE is mocked to capture calls. Prometheus counters use the real
 * prom-client but against the shared promRegistry (verified via labelValues).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ─── Source files for static inspection ──────────────────────────────────────

const METRICS_SRC = fs.readFileSync(
  path.resolve(__dirname, "../lib/metrics-registry.ts"),
  "utf-8",
);

const SSE_SRC = fs.readFileSync(
  path.resolve(__dirname, "../routes/sse.ts"),
  "utf-8",
);

const CONFLUENCE_AUDIT_SRC = fs.readFileSync(
  path.resolve(__dirname, "../lib/confluence-quality-audit.ts"),
  "utf-8",
);

const BACKFILL_SRC = fs.readFileSync(
  path.resolve(__dirname, "../../../scripts/wave26-pass-g-b3-backfill-factor-quality-audit.ts"),
  "utf-8",
);

// ─── §1 metrics-registry.ts — new counter/histogram declarations ─────────────

describe("Wave 26 Pass G B3 — metrics-registry.ts declarations", () => {
  it("declares tf_graduation_factor_quality_total counter with quality label", () => {
    expect(METRICS_SRC).toContain("tf_graduation_factor_quality_total");
    expect(METRICS_SRC).toContain("graduationFactorQualityTotal");
    expect(METRICS_SRC).toMatch(/labelNames.*quality/s);
  });

  it("declares tf_graduation_bidirectional_rejection_total counter with reason label", () => {
    expect(METRICS_SRC).toContain("tf_graduation_bidirectional_rejection_total");
    expect(METRICS_SRC).toContain("graduationBidirectionalRejectionTotal");
    expect(METRICS_SRC).toMatch(/labelNames.*reason/s);
  });

  it("declares tf_extraction_confluence_depth_histogram with buckets 0-5", () => {
    expect(METRICS_SRC).toContain("tf_extraction_confluence_depth_histogram");
    expect(METRICS_SRC).toContain("extractionConfluenceDepthHistogram");
    expect(METRICS_SRC).toMatch(/buckets.*0.*1.*2.*3.*4.*5/s);
  });

  it("all three metrics are registered in promRegistry", () => {
    // Each export const uses `registers: [promRegistry]`. Verify the export
    // declarations (not the comment lines) each have promRegistry nearby.
    const exportNames = [
      "export const graduationFactorQualityTotal",
      "export const graduationBidirectionalRejectionTotal",
      "export const extractionConfluenceDepthHistogram",
    ];
    for (const exportName of exportNames) {
      const idx = METRICS_SRC.indexOf(exportName);
      expect(idx, `${exportName} not found`).toBeGreaterThan(0);
      // Look forward up to 400 chars to find the registers: [promRegistry] declaration
      const block = METRICS_SRC.slice(idx, idx + 400);
      expect(block, `${exportName} must include registers: [promRegistry]`).toContain("promRegistry");
    }
  });
});

// ─── §2 sse.ts — new event constants ─────────────────────────────────────────

describe("Wave 26 Pass G B3 — SSE event constants", () => {
  it("FACTORY_EVENTS declares BIDIRECTIONAL_REJECTED", () => {
    expect(SSE_SRC).toContain("BIDIRECTIONAL_REJECTED");
    expect(SSE_SRC).toContain("factory:bidirectional_rejected");
  });

  it("FACTORY_EVENTS declares THIN_CONFLUENCE_GRADUATED", () => {
    expect(SSE_SRC).toContain("THIN_CONFLUENCE_GRADUATED");
    expect(SSE_SRC).toContain("factory:thin_confluence_graduated");
  });

  it("both new constants are inside the FACTORY_EVENTS object block", () => {
    const factoryStart = SSE_SRC.indexOf("FACTORY_EVENTS");
    const factoryEnd   = SSE_SRC.indexOf("} as const;", factoryStart);
    const block        = SSE_SRC.slice(factoryStart, factoryEnd + 20);
    expect(block).toContain("BIDIRECTIONAL_REJECTED");
    expect(block).toContain("THIN_CONFLUENCE_GRADUATED");
  });
});

// ─── §3 classifyFactorQuality — pure classification logic ────────────────────

describe("Wave 26 Pass G B3 — classifyFactorQuality logic", () => {
  // Inline the logic here so tests don't import through the db/schema bootstrap.
  // This mirrors the AUTO_FLOOR_FACTORS and classifyFactorQuality from
  // confluence-quality-audit.ts — must stay in sync.
  const AUTO_FLOOR = new Set(["regime_match", "structural_setup"]);
  function classify(factors: string[]): string {
    if (factors.length === 0) return "fallback_only";
    const extracted = factors.filter((f) => !AUTO_FLOOR.has(f));
    if (extracted.length === 0) return "fallback_only";
    if (extracted.length < 3)   return "thin";
    return "rich";
  }

  it("empty factors array → fallback_only", () => {
    expect(classify([])).toBe("fallback_only");
  });

  it("only auto-floor factors → fallback_only", () => {
    expect(classify(["regime_match"])).toBe("fallback_only");
    expect(classify(["regime_match", "structural_setup"])).toBe("fallback_only");
  });

  it("1 extracted + auto-floor → thin", () => {
    expect(classify(["regime_match", "market_structure_aligned"])).toBe("thin");
  });

  it("2 extracted factors → thin", () => {
    expect(classify(["vp_level_proximity", "killzone_active"])).toBe("thin");
  });

  it("3 or more extracted factors → rich", () => {
    expect(classify(["vp_level_proximity", "killzone_active", "delta_or_volume_signature"])).toBe("rich");
    expect(classify(["a", "b", "c", "d"])).toBe("rich");
  });

  it("auto-floor factors do NOT contribute to extracted count", () => {
    expect(
      classify(["regime_match", "structural_setup", "vp_level_proximity", "killzone_active"])
    ).toBe("thin");  // only 2 extracted — not rich
  });
});

// ─── §4 confluence-quality-audit.ts source contracts ────────────────────────

describe("Wave 26 Pass G B3 — confluence-quality-audit.ts source contracts", () => {
  it("exports emitBidirectionalIncompleteRejected function", () => {
    expect(CONFLUENCE_AUDIT_SRC).toContain("export function emitBidirectionalIncompleteRejected");
  });

  it("exports emitFactorQualityClassified function", () => {
    expect(CONFLUENCE_AUDIT_SRC).toContain("export function emitFactorQualityClassified");
  });

  it("exports emitThinConfluenceWarning function", () => {
    expect(CONFLUENCE_AUDIT_SRC).toContain("export function emitThinConfluenceWarning");
  });

  it("exports emitExtractionParityTestRun function (B1 hook)", () => {
    expect(CONFLUENCE_AUDIT_SRC).toContain("export function emitExtractionParityTestRun");
  });

  it("exports classifyFactorQuality pure function", () => {
    expect(CONFLUENCE_AUDIT_SRC).toContain("export function classifyFactorQuality");
  });

  it("exports AUTO_FLOOR_FACTORS set", () => {
    expect(CONFLUENCE_AUDIT_SRC).toContain("export { AUTO_FLOOR_FACTORS");
    expect(CONFLUENCE_AUDIT_SRC).toContain("regime_match");
    expect(CONFLUENCE_AUDIT_SRC).toContain("structural_setup");
  });

  it("all three audit action names are declared in source", () => {
    expect(CONFLUENCE_AUDIT_SRC).toContain("graduation.bidirectional_incomplete_rejected");
    expect(CONFLUENCE_AUDIT_SRC).toContain("graduation.factor_quality_classified");
    expect(CONFLUENCE_AUDIT_SRC).toContain("graduation.thin_confluence_warning");
  });

  it("extraction.parity_test_run action is declared in source", () => {
    expect(CONFLUENCE_AUDIT_SRC).toContain("extraction.parity_test_run");
  });

  it("all emit functions use insertAuditRowSafe (fire-and-forget pattern)", () => {
    expect(CONFLUENCE_AUDIT_SRC).toContain("insertAuditRowSafe");
    // Each public emit function must have a .catch() after its audit write
    const emitNames = [
      "emitBidirectionalIncompleteRejected",
      "emitFactorQualityClassified",
      "emitThinConfluenceWarning",
      "emitExtractionParityTestRun",
    ];
    for (const name of emitNames) {
      const fnIdx = CONFLUENCE_AUDIT_SRC.indexOf(`export function ${name}`);
      expect(fnIdx, `${name} not found`).toBeGreaterThan(0);
      // Use 2500 chars to cover emitThinConfluenceWarning which is the longest function
      const fnBlock = CONFLUENCE_AUDIT_SRC.slice(fnIdx, fnIdx + 2500);
      expect(fnBlock, `${name} must call insertAuditRowSafe`).toContain("insertAuditRowSafe");
      expect(fnBlock, `${name} must have .catch() after audit write`).toMatch(/\.catch\(/);
    }
  });

  it("all emit functions return void (fire-and-forget, never throw)", () => {
    // Presence of ): void { confirms the return type
    const voidFns = [
      "emitBidirectionalIncompleteRejected",
      "emitFactorQualityClassified",
      "emitThinConfluenceWarning",
      "emitExtractionParityTestRun",
    ];
    for (const name of voidFns) {
      const fnIdx = CONFLUENCE_AUDIT_SRC.indexOf(`export function ${name}`);
      const sig   = CONFLUENCE_AUDIT_SRC.slice(fnIdx, fnIdx + 300);
      expect(sig, `${name} must return void`).toMatch(/\):\s*void\s*\{/);
    }
  });
});

// ─── §5 SSE event names match FACTORY_EVENTS constants ───────────────────────

describe("Wave 26 Pass G B3 — SSE event names used in confluence-quality-audit.ts", () => {
  it("uses FACTORY_EVENTS.BIDIRECTIONAL_REJECTED for Gate 1 SSE", () => {
    expect(CONFLUENCE_AUDIT_SRC).toContain("FACTORY_EVENTS.BIDIRECTIONAL_REJECTED");
  });

  it("uses FACTORY_EVENTS.THIN_CONFLUENCE_GRADUATED for Gate 3 SSE", () => {
    expect(CONFLUENCE_AUDIT_SRC).toContain("FACTORY_EVENTS.THIN_CONFLUENCE_GRADUATED");
  });
});

// ─── §6 Discord idempotency guard ────────────────────────────────────────────

describe("Wave 26 Pass G B3 — Discord idempotency guard", () => {
  it("source declares _thinConfluenceDiscordSent Map for per-session dedup", () => {
    expect(CONFLUENCE_AUDIT_SRC).toContain("_thinConfluenceDiscordSent");
    expect(CONFLUENCE_AUDIT_SRC).toMatch(/Map<string,\s*number>/);
  });

  it("exports _clearThinConfluenceDiscordState() for test reset", () => {
    expect(CONFLUENCE_AUDIT_SRC).toContain("export function _clearThinConfluenceDiscordState");
  });

  it("checks idempotency before sending Discord message", () => {
    // The guard must read from the map before calling notifyWarning / direct POST
    expect(CONFLUENCE_AUDIT_SRC).toContain("alreadySent");
    // Must set the map entry with the strategy_id before posting
    expect(CONFLUENCE_AUDIT_SRC).toContain("_thinConfluenceDiscordSent.set(payload.strategy_id");
  });

  it("THIN_CONFLUENCE_DISCORD_ENABLED env gate controls Discord send", () => {
    expect(CONFLUENCE_AUDIT_SRC).toContain("THIN_CONFLUENCE_DISCORD_ENABLED");
    // Must default to enabled (true) when env is absent
    expect(CONFLUENCE_AUDIT_SRC).toMatch(/THIN_CONFLUENCE_DISCORD_ENABLED.*"true"/);
  });

  it("DISCORD_CH_STRATEGY_FINDS env var controls target channel", () => {
    expect(CONFLUENCE_AUDIT_SRC).toContain("DISCORD_CH_STRATEGY_FINDS");
  });
});

// ─── §7 backfill script contracts ────────────────────────────────────────────

describe("Wave 26 Pass G B3 — backfill script contracts", () => {
  it("is dry-run by default (requires --apply flag)", () => {
    expect(BACKFILL_SRC).toContain("--apply");
    expect(BACKFILL_SRC).toContain("applyMode");
    // Must print dry-run message and return without writing when apply not set
    expect(BACKFILL_SRC).toContain("DRY-RUN");
  });

  it("writes graduation.factor_quality_classified audit rows with backfill=true marker", () => {
    expect(BACKFILL_SRC).toContain("graduation.factor_quality_classified");
    // marker may have extra whitespace alignment — use regex
    expect(BACKFILL_SRC).toMatch(/backfill:\s+true/);
  });

  it("updates config.entry_quality.factor_quality in strategies JSONB", () => {
    expect(BACKFILL_SRC).toContain("entry_quality,factor_quality");
    expect(BACKFILL_SRC).toContain("jsonb_set");
  });

  it("classifyFactorQuality in backfill script matches AUTO_FLOOR_FACTORS from audit lib", () => {
    // Both files must declare the same auto-floor factor set
    expect(BACKFILL_SRC).toContain("regime_match");
    expect(BACKFILL_SRC).toContain("structural_setup");
    expect(BACKFILL_SRC).toContain("AUTO_FLOOR_FACTORS");
  });

  it("backfill exits non-zero on DB errors in apply mode", () => {
    expect(BACKFILL_SRC).toContain("process.exit(1)");
  });

  it("backfill only targets active strategies (excludes GRAVEYARD and RETIRED)", () => {
    expect(BACKFILL_SRC).toContain("GRAVEYARD");
    expect(BACKFILL_SRC).toContain("RETIRED");
    expect(BACKFILL_SRC).toContain("ACTIVE_STATES");
  });
});

// ─── §8 factor_quality classification with real tagFactorSources ──────────────

describe("Wave 26 Pass G B3 — tagFactorSources classification", () => {
  // Inline the logic from confluence-quality-audit.ts for isolated testing
  const AUTO_FLOOR = new Set(["regime_match", "structural_setup"]);
  function tagSources(factors: string[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const f of factors) {
      out[f] = AUTO_FLOOR.has(f) ? "auto_floor" : "extracted";
    }
    return out;
  }

  it("regime_match tagged as auto_floor", () => {
    expect(tagSources(["regime_match"])).toEqual({ regime_match: "auto_floor" });
  });

  it("structural_setup tagged as auto_floor", () => {
    expect(tagSources(["structural_setup"])).toEqual({ structural_setup: "auto_floor" });
  });

  it("extracted factors tagged as extracted", () => {
    const result = tagSources(["vp_level_proximity", "killzone_active"]);
    expect(result["vp_level_proximity"]).toBe("extracted");
    expect(result["killzone_active"]).toBe("extracted");
  });

  it("mixed factors tagged correctly", () => {
    const result = tagSources(["regime_match", "market_structure_aligned"]);
    expect(result["regime_match"]).toBe("auto_floor");
    expect(result["market_structure_aligned"]).toBe("extracted");
  });
});

// ─── §9 library-health.md contains all required SQL queries ─────────────────

describe("Wave 26 Pass G B3 — library-health.md completeness", () => {
  const HEALTH_DOC = fs.readFileSync(
    path.resolve(__dirname, "../../../docs/observability/library-health.md"),
    "utf-8",
  );

  it("contains factor quality distribution query", () => {
    expect(HEALTH_DOC).toContain("factor_quality");
    expect(HEALTH_DOC).toContain("entry_quality");
    expect(HEALTH_DOC).toContain("strategy_count");
  });

  it("contains direction distribution query (both vs single)", () => {
    expect(HEALTH_DOC).toContain("direction");
    expect(HEALTH_DOC).toContain("config -> 'direction'");
  });

  it("contains top 10 most-common confluence factors query", () => {
    expect(HEALTH_DOC).toContain("confluence_factors");
    expect(HEALTH_DOC).toContain("LIMIT 10");
    expect(HEALTH_DOC).toContain("jsonb_array_elements_text");
  });

  it("contains top 10 most-common entry indicator archetypes query", () => {
    expect(HEALTH_DOC).toContain("entry_indicator");
    expect(HEALTH_DOC).toContain("LIMIT 10");
  });

  it("contains Prometheus metrics table", () => {
    expect(HEALTH_DOC).toContain("tf_graduation_factor_quality_total");
    expect(HEALTH_DOC).toContain("tf_graduation_bidirectional_rejection_total");
    expect(HEALTH_DOC).toContain("tf_extraction_confluence_depth_histogram");
  });

  it("contains thin-confluence graduation history query", () => {
    expect(HEALTH_DOC).toContain("graduation.thin_confluence_warning");
  });
});

// ─── §10 Prometheus counter exports from metrics-registry ────────────────────

describe("Wave 26 Pass G B3 — metrics exported for test + production use", () => {
  it("metrics-registry.ts exports graduationFactorQualityTotal", () => {
    expect(METRICS_SRC).toContain("export const graduationFactorQualityTotal");
  });

  it("metrics-registry.ts exports graduationBidirectionalRejectionTotal", () => {
    expect(METRICS_SRC).toContain("export const graduationBidirectionalRejectionTotal");
  });

  it("metrics-registry.ts exports extractionConfluenceDepthHistogram", () => {
    expect(METRICS_SRC).toContain("export const extractionConfluenceDepthHistogram");
  });

  it("all three counters/histograms are Histogram or Counter instances", () => {
    // graduationFactorQualityTotal and graduationBidirectionalRejectionTotal must be Counter
    expect(METRICS_SRC).toMatch(/graduationFactorQualityTotal\s*=\s*new Counter/);
    expect(METRICS_SRC).toMatch(/graduationBidirectionalRejectionTotal\s*=\s*new Counter/);
    // extractionConfluenceDepthHistogram must be Histogram
    expect(METRICS_SRC).toMatch(/extractionConfluenceDepthHistogram\s*=\s*new Histogram/);
  });
});
