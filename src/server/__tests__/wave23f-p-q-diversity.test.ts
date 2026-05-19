/**
 * W23F.P + W23F.Q — Diversity expansion + SMC/Wyckoff prettifier mappings.
 *
 * Pins:
 *   - W23F.P: 44 concept-targeted queries added to ALL_CONCEPT_QUERIES + included
 *             in every symbol group via getQueryTemplatesForGroup.
 *   - W23F.Q: prettifyConcept matches Wyckoff/SMC/order-flow variants → archetype
 *             names that exist in ARCHETYPE_REGISTRY.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SCOUT_RUNNER = readFileSync(
  resolve(__dirname, "../services/autonomous-scout-runner.ts"),
  "utf8",
);
const GRADUATOR = readFileSync(
  resolve(__dirname, "../services/direct-bucket-graduator.ts"),
  "utf8",
);

describe("W23F.V operator-curated query set (replaces W23F.P concept groups)", () => {
  it("exports OPERATOR_QUERY_TEMPLATES with all 8 operator-curated keywords", () => {
    expect(SCOUT_RUNNER).toMatch(/OPERATOR_QUERY_TEMPLATES/);
    const required = [
      "futures trading strategies rules",
      "futures 4 hr strategy",
      "futures 15min strategy",
      "futures 5min strategy",
      "futures 1hr strategy",
      "futures indicators",
      "futures trading A+ setups",
      "futures trend trading strategy",
    ];
    for (const q of required) {
      // String literal escape-safe match
      expect(SCOUT_RUNNER).toContain(`"${q}"`);
    }
  });

  it("ALL_CONCEPT_QUERIES is the operator set only (no W23F.P sub-groups remain)", () => {
    expect(SCOUT_RUNNER).toMatch(/ALL_CONCEPT_QUERIES.*=\s*\[\.\.\.OPERATOR_QUERY_TEMPLATES\]/);
    // Defunct sub-group identifiers must NOT appear
    expect(SCOUT_RUNNER).not.toMatch(/const\s+SMC_ICT_QUERY_TEMPLATES/);
    expect(SCOUT_RUNNER).not.toMatch(/const\s+WYCKOFF_QUERY_TEMPLATES/);
    expect(SCOUT_RUNNER).not.toMatch(/const\s+VOLUME_PROFILE_QUERY_TEMPLATES/);
  });

  it("getQueryTemplatesForGroup still spreads operator queries into every symbol group", () => {
    expect(SCOUT_RUNNER).toMatch(/return \[\.\.\.base, \.\.\.ALL_CONCEPT_QUERIES\]/);
  });

  it("operator set has exactly 8 queries (no scope creep)", () => {
    // Match the array initializer that follows the equals sign
    const block = SCOUT_RUNNER.match(/OPERATOR_QUERY_TEMPLATES[^=]*=\s*\[([\s\S]*?)\];/)?.[1] ?? "";
    const lines = block.split("\n").filter(l => /^\s*"/.test(l));
    expect(lines.length).toBe(8);
  });
});

describe("W23F.Q SMC/Wyckoff prettifier → archetype routing", () => {
  it("prettifier matches Wyckoff variants", () => {
    expect(GRADUATOR).toMatch(/wyckoff\.spring/);
    expect(GRADUATOR).toMatch(/wyckoff\.upthrust/);
    expect(GRADUATOR).toMatch(/wyckoff\.accumulation/);
    expect(GRADUATOR).toMatch(/wyckoff\.distribution/);
  });

  it("prettifier matches liquidity_sweep_breakout (the W23F.O blocker)", () => {
    expect(GRADUATOR).toMatch(/liquidity_sweep_breakout/);
  });

  it("prettifier matches SMC umbrella + order flow", () => {
    expect(GRADUATOR).toMatch(/smart\.money\.concept/);
    expect(GRADUATOR).toMatch(/order\.flow/);
    expect(GRADUATOR).toMatch(/footprint\.chart/);
  });

  it("archetype registry has the targets the new prettifier rules return", () => {
    const archetypeNames = ["wyckoff_spring", "wyckoff_upthrust", "wyckoff_accumulation", "wyckoff_distribution", "liquidity_sweep", "order_block"];
    for (const name of archetypeNames) {
      // Each name must appear as a key in ARCHETYPE_REGISTRY
      const re = new RegExp(`\\s${name.replace(/[$()*+.?[\\\\\\]^|]/g, "\\\\$&")}:\\s*\\{`);
      expect(GRADUATOR).toMatch(re);
    }
  });

  it("SMC umbrella routes to liquidity_sweep (most common SMC entry pattern)", () => {
    expect(GRADUATOR).toMatch(/smart\.money\.concept[\s\S]{0,80}return "liquidity_sweep"/);
  });

  it("Order flow routes to cumulative_delta", () => {
    expect(GRADUATOR).toMatch(/order\.flow[\s\S]{0,200}return "cumulative_delta"/);
  });
});

describe("W23F.P+Q regression — existing routing not broken", () => {
  it("liquidity_sweep regex still matches the original (^|_)bsl(_|$) etc.", () => {
    expect(GRADUATOR).toMatch(/\(\^\|_\)bsl\(_\|\$\)/);
    expect(GRADUATOR).toMatch(/\(\^\|_\)ssl\(_\|\$\)/);
  });

  it("symbol-specific MES/MNQ/MCL templates still defined", () => {
    expect(SCOUT_RUNNER).toMatch(/MES_QUERY_TEMPLATES.*=.*\[/);
    expect(SCOUT_RUNNER).toMatch(/MNQ_QUERY_TEMPLATES.*=.*\[/);
    expect(SCOUT_RUNNER).toMatch(/MCL_QUERY_TEMPLATES.*=.*\[/);
  });

  it("rotation function still picks MES/MNQ/MCL cycle 0/1/2", () => {
    expect(SCOUT_RUNNER).toMatch(/SYMBOL_GROUP_ROTATION:\s*SymbolGroup\[\]\s*=\s*\["MES",\s*"MNQ",\s*"MCL"\]/);
  });
});
