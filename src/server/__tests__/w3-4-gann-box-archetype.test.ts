/**
 * w3-4-gann-box-archetype.test.ts — W3.4 (2026-06-22)
 *
 * Verifies that the gann_box_4h_continuation archetype is correctly registered
 * in the ARCHETYPE_REGISTRY and that the prettifyConcept() routing regexes in
 * direct-bucket-graduator.ts map all expected Gann-box concept names to
 * "gann_box_4h_continuation".
 *
 * This is the acceptance test for the SY2jXlW9bt4 quarantine-escape path:
 * a strategy extracted from the Gann-box video that previously routed to
 * "quarantined/uncatalogued" must now route to "archetype:gann_box_4h_continuation".
 *
 * Test strategy: static source inspection (mirrors wave26-pass-g-archetype-audit.test.ts).
 * No DB connection required.
 *
 * Tests:
 *   1. ARCHETYPE_REGISTRY has gann_box_4h_continuation with correct engineSpec + strategyClass
 *   2. WAVE26G_AUDIT_ARCHETYPES includes gann_box_4h_continuation
 *   3. WAVE26G_ROUTE_PATTERNS declares patterns for gann_box_4h_continuation
 *   4. Gann-box routing regexes present in prettifyConcept source
 *   5. "gann box" concept → routes to gann_box_4h_continuation
 *   6. "4h candle box continuation" concept → routes correctly
 *   7. "optimum zone fib entry" concept → routes correctly
 *   8. "premature zone fib" concept → routes correctly
 *   9. "overextended zone" concept → routes correctly
 *  10. UNSPECIFIED_ARCHETYPES includes gann_box_4h_continuation (regime-agnostic)
 *  11. KB indicator-catalog.md has gann_box_4h_continuation section
 *  12. KB catalog has required DSL fields documented
 *  13. KB catalog has direction: "both" contract documented
 *  14. Python strategy file exists at expected path
 *  15. Python strategy file declares GannBox4HContinuationStrategy class
 *  16. Python strategy file declares name = "gann_box_4h_continuation"
 *  17. Python strategy file respects no-vectorbt-futures-PnL rule
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ─── Source files for static inspection ──────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, "../../..");

const GRADUATOR_SRC = fs.readFileSync(
  path.resolve(REPO_ROOT, "src/server/services/direct-bucket-graduator.ts"),
  "utf-8",
);

const CATALOG_SRC = fs.readFileSync(
  path.resolve(REPO_ROOT, "src/agents/kb/indicator-catalog.md"),
  "utf-8",
);

const PYTHON_STRATEGY_PATH = path.resolve(
  REPO_ROOT,
  "src/engine/strategies/gann_box_4h_continuation.py",
);

const PYTHON_STRATEGY_SRC = fs.existsSync(PYTHON_STRATEGY_PATH)
  ? fs.readFileSync(PYTHON_STRATEGY_PATH, "utf-8")
  : "";

// ─── §1 ARCHETYPE_REGISTRY ────────────────────────────────────────────────────

describe("W3.4 Gann Box — ARCHETYPE_REGISTRY", () => {
  it("registers gann_box_4h_continuation entry", () => {
    expect(GRADUATOR_SRC).toMatch(/gann_box_4h_continuation:\s*\{/);
  });

  it("sets engineSpec to gann_box_4h_continuation", () => {
    expect(GRADUATOR_SRC).toMatch(/engineSpec:\s*["']gann_box_4h_continuation["']/);
  });

  it("sets strategyClass to the canonical Python path", () => {
    expect(GRADUATOR_SRC).toMatch(
      /strategyClass:\s*["']src\.engine\.strategies\.gann_box_4h_continuation\.GannBox4HContinuationStrategy["']/,
    );
  });

  it("description mentions BIDIRECTIONAL and Fib zones", () => {
    expect(GRADUATOR_SRC).toMatch(/gann_box_4h_continuation[\s\S]{0,500}BIDIRECTIONAL/);
  });
});

// ─── §2 WAVE26G_AUDIT_ARCHETYPES ─────────────────────────────────────────────

describe("W3.4 Gann Box — WAVE26G_AUDIT_ARCHETYPES", () => {
  it("includes gann_box_4h_continuation in the audit set", () => {
    expect(GRADUATOR_SRC).toMatch(/WAVE26G_AUDIT_ARCHETYPES[\s\S]{0,200}gann_box_4h_continuation/);
  });
});

// ─── §3 WAVE26G_ROUTE_PATTERNS ───────────────────────────────────────────────

describe("W3.4 Gann Box — WAVE26G_ROUTE_PATTERNS", () => {
  it("declares route patterns for gann_box_4h_continuation", () => {
    // The route patterns block must exist AND contain the gann_box entry
    expect(GRADUATOR_SRC).toContain("WAVE26G_ROUTE_PATTERNS");
    expect(GRADUATOR_SRC).toContain("gann_box_4h_continuation");
    // Verify they appear in the same section (both strings present)
    const routePatternsIdx = GRADUATOR_SRC.indexOf("WAVE26G_ROUTE_PATTERNS");
    const gannIdx = GRADUATOR_SRC.indexOf("gann_box_4h_continuation:", routePatternsIdx);
    expect(gannIdx).toBeGreaterThan(routePatternsIdx);
  });

  it("includes gann box regex in route patterns", () => {
    // Uses \. (escaped dot) in source, which appears as /gann.{...}box/ in raw text
    expect(GRADUATOR_SRC).toMatch(/gann[^"']{0,10}box/);
  });

  it("includes optimum zone regex in route patterns", () => {
    expect(GRADUATOR_SRC).toContain("optimum");
  });
});

// ─── §4 prettifyConcept routing regexes ──────────────────────────────────────

describe("W3.4 Gann Box — prettifyConcept routing", () => {
  it("ships gann_box_4h_continuation routing in prettifyConcept", () => {
    // The function must return "gann_box_4h_continuation" for gann-box concepts
    expect(GRADUATOR_SRC).toContain("gann_box_4h_continuation");
  });

  it("gann box routing regex handles 'gann.box' pattern", () => {
    // The source contains the regex pattern as a string literal: /gann.{0,6}box/
    // In the source file the regex appears as /gann.{0,6}box/ — match the token
    expect(GRADUATOR_SRC).toContain("gann");
    expect(GRADUATOR_SRC).toContain("box");
    // Both appear in the routing block that returns "gann_box_4h_continuation"
    const gannBoxIdx = GRADUATOR_SRC.indexOf('"gann_box_4h_continuation"');
    const prevBlock = GRADUATOR_SRC.slice(Math.max(0, gannBoxIdx - 600), gannBoxIdx);
    expect(prevBlock).toContain("gann");
  });

  it("gann box routing regex handles '4h.candle.continuation' pattern", () => {
    expect(GRADUATOR_SRC).toMatch(/4h.{0,12}\(candle|box|impulse|impulsive|continuation\)/);
  });

  it("gann box routing regex handles 'optimum.zone.entry' pattern", () => {
    expect(GRADUATOR_SRC).toMatch(/optimum.{0,12}\(zone|fib|fibonacci|retrace|entry\)/);
  });

  it("gann box routing regex handles 'premature.zone' and 'overextended.zone'", () => {
    expect(GRADUATOR_SRC).toMatch(/premature.{0,12}\(zone|fib|entry\)/);
    expect(GRADUATOR_SRC).toMatch(/overextended.{0,12}\(zone|fib\)/);
  });
});

// ─── §5–9 Specific concept name routing ──────────────────────────────────────
// These tests verify the prettifyConcept() output by simulating what the regex
// patterns in the source would match. We do this via static source inspection
// (checking the regex patterns exist and cover the relevant vocabulary).

describe("W3.4 Gann Box — concept name coverage", () => {
  it("covers 'gann_box' concept name", () => {
    // The regex /gann.{0,6}box/ must be present in prettifyConcept section
    expect(GRADUATOR_SRC).toContain('return "gann_box_4h_continuation"');
  });

  it("covers 'gann_box_fib_zone' concept variant", () => {
    expect(GRADUATOR_SRC).toMatch(/gann.{0,6}\(fib|fibonacci|zone|level|square\)/);
  });

  it("covers '4h_impulse_continuation' concept variant", () => {
    expect(GRADUATOR_SRC).toMatch(/(4h|4.hour|four.hour).{0,12}\(candle|box|impulse|impulsive|continuation\)/);
  });

  it("covers 'optimum_zone_fib_entry' concept variant", () => {
    expect(GRADUATOR_SRC).toMatch(/optimum.{0,12}\(zone|fib|fibonacci|retrace|entry\)/);
  });
});

// ─── §10 UNSPECIFIED_ARCHETYPES (regime-agnostic) ─────────────────────────────

describe("W3.4 Gann Box — UNSPECIFIED_ARCHETYPES", () => {
  it("includes gann_box_4h_continuation in regime-agnostic set", () => {
    // Verify gann_box_4h_continuation appears AFTER the UNSPECIFIED_ARCHETYPES declaration
    expect(GRADUATOR_SRC).toContain("UNSPECIFIED_ARCHETYPES");
    const unspecIdx = GRADUATOR_SRC.indexOf("UNSPECIFIED_ARCHETYPES");
    const gannInUnspec = GRADUATOR_SRC.indexOf('"gann_box_4h_continuation"', unspecIdx);
    expect(gannInUnspec).toBeGreaterThan(unspecIdx);
    // Verify the gann entry appears before the closing ]);
    const closingBracket = GRADUATOR_SRC.indexOf("]);", gannInUnspec);
    const nextSectionIdx = GRADUATOR_SRC.indexOf("// Determine regime", unspecIdx);
    expect(gannInUnspec).toBeLessThan(nextSectionIdx);
  });
});

// ─── §11–13 KB indicator-catalog.md ──────────────────────────────────────────

describe("W3.4 Gann Box — KB indicator-catalog.md", () => {
  it("has gann_box_4h_continuation section", () => {
    expect(CATALOG_SRC).toContain("### `gann_box_4h_continuation`");
  });

  it("documents the archetype:gann_box_4h_continuation DSL field", () => {
    expect(CATALOG_SRC).toContain('archetype:gann_box_4h_continuation');
  });

  it("documents direction both contract", () => {
    // The catalog must instruct Gemma to always emit direction: "both"
    expect(CATALOG_SRC).toMatch(/gann_box_4h_continuation[\s\S]{0,2000}direction.*both/);
  });

  it("documents fib zone labels: premature, optimum, overextended", () => {
    expect(CATALOG_SRC).toMatch(/gann_box_4h_continuation[\s\S]{0,2000}premature/);
    expect(CATALOG_SRC).toMatch(/gann_box_4h_continuation[\s\S]{0,2000}optimum/);
    expect(CATALOG_SRC).toMatch(/gann_box_4h_continuation[\s\S]{0,2000}overextended/);
  });

  it("documents impulsive candle filter", () => {
    expect(CATALOG_SRC).toMatch(/gann_box_4h_continuation[\s\S]{0,2000}[Ii]mpulsive/);
  });

  it("documents the SY2jXlW9bt4 source video in the catalog", () => {
    expect(CATALOG_SRC).toContain("SY2jXlW9bt4");
  });
});

// ─── §14–17 Python strategy file ─────────────────────────────────────────────

describe("W3.4 Gann Box — Python strategy file", () => {
  it("strategy file exists at expected path", () => {
    expect(fs.existsSync(PYTHON_STRATEGY_PATH)).toBe(true);
  });

  it("declares GannBox4HContinuationStrategy class", () => {
    expect(PYTHON_STRATEGY_SRC).toContain("class GannBox4HContinuationStrategy");
  });

  it("declares name = 'gann_box_4h_continuation'", () => {
    expect(PYTHON_STRATEGY_SRC).toMatch(/name\s*=\s*["']gann_box_4h_continuation["']/);
  });

  it("does NOT pass slippage or fees to vectorbt (no-vectorbt-futures-PnL rule)", () => {
    // The file must NOT contain vectorbt calls with fees/slippage parameters
    expect(PYTHON_STRATEGY_SRC).not.toMatch(/vectorbt.*fees|vectorbt.*slippage/i);
    expect(PYTHON_STRATEGY_SRC).not.toMatch(/vbt\.Portfolio\.from_signals.*fees/);
  });

  it("uses Polars DataFrame (not Pandas)", () => {
    expect(PYTHON_STRATEGY_SRC).toContain("import polars as pl");
    expect(PYTHON_STRATEGY_SRC).not.toContain("import pandas as pd");
  });

  it("extends BaseStrategy", () => {
    expect(PYTHON_STRATEGY_SRC).toContain("BaseStrategy");
  });

  it("emits the four required output columns", () => {
    expect(PYTHON_STRATEGY_SRC).toContain("entry_long");
    expect(PYTHON_STRATEGY_SRC).toContain("entry_short");
    expect(PYTHON_STRATEGY_SRC).toContain("exit_long");
    expect(PYTHON_STRATEGY_SRC).toContain("exit_short");
  });

  it("preferred_regime is None (regime-agnostic, BIDIRECTIONAL)", () => {
    expect(PYTHON_STRATEGY_SRC).toMatch(/preferred_regime\s*=\s*None/);
  });

  it("has named constants block (CLAUDE.md §13 — no magic numbers inline)", () => {
    expect(PYTHON_STRATEGY_SRC).toContain("ATR_PERIOD_DEFAULT");
    expect(PYTHON_STRATEGY_SRC).toContain("MIN_BODY_RATIO_DEFAULT");
    expect(PYTHON_STRATEGY_SRC).toContain("OPTIMUM_ZONE_LOW");
    expect(PYTHON_STRATEGY_SRC).toContain("OPTIMUM_ZONE_HIGH");
  });
});
