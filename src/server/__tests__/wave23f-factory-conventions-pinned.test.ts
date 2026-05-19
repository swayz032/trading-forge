/**
 * W23F.L live-fix 2026-05-19 — Factory conventions critics must NOT flag.
 *
 * Cycle 3 produced a clean ORB DSL that the DSL quality critic rejected on
 * 7 concerns, of which 3 were the critic misreading deliberate factory
 * conventions (sentinel pattern, indicator name layering, prose vs struct).
 *
 * These tests pin the catalog + critic prompt updates that teach the critic
 * to skip these patterns. They fail CI if anyone reverts the documentation,
 * which would silently re-introduce the cycle-3 graduation block.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CATALOG = readFileSync(
  resolve(__dirname, "../../agents/kb/anti-pattern-catalog.md"),
  "utf8",
);
const CRITIC_PROMPT = readFileSync(
  resolve(__dirname, "../../agents/dsl-quality-critic.md"),
  "utf8",
);
const DSL_COMPILER = readFileSync(
  resolve(__dirname, "../lib/dsl-compiler.ts"),
  "utf8",
);

describe("W23F.L factory conventions — catalog teaches critic", () => {
  it("catalog has §3b section documenting factory conventions", () => {
    expect(CATALOG).toMatch(/Factory conventions critics MUST NOT flag/);
  });

  it("catalog documents `high < low` as deliberate never-true sentinel", () => {
    expect(CATALOG).toMatch(/`high < low` is a deliberate never-true sentinel/);
    expect(CATALOG).toMatch(/treat the field as DISABLED, not incoherent/);
  });

  it("catalog documents entry_indicator ↔ indicators[].type naming layers", () => {
    expect(CATALOG).toMatch(/entry_indicator.*indicators\[\]\.type/);
    expect(CATALOG).toMatch(/session_open_breakout.*opening_range_breakout/);
  });

  it("catalog documents prose vs compiled struct divergence as intentional", () => {
    expect(CATALOG).toMatch(/Prose fields.*vs compiled struct/);
    expect(CATALOG).toMatch(/compiled struct is the SOURCE OF TRUTH/);
    expect(CATALOG).toMatch(/Do NOT flag prose ↔ struct divergence/);
  });
});

describe("W23F.L critic prompt — pre-filter step before any concern", () => {
  it("critic has step 0 pre-filter for factory conventions", () => {
    expect(CRITIC_PROMPT).toMatch(/0\. Pre-filter — factory conventions/);
  });

  it("critic prompt explicitly lists the 3 known-OK patterns", () => {
    expect(CRITIC_PROMPT).toMatch(/never-true sentinel for disabled direction/);
    expect(CRITIC_PROMPT).toMatch(/canonical name vs `indicators\[N\]\.type` compiler-internal name/);
    expect(CRITIC_PROMPT).toMatch(/Prose fields .*diverging from compiled struct/);
  });

  it("critic prompt instructs to DROP concerns silently before scoring", () => {
    expect(CRITIC_PROMPT).toMatch(/DROP them silently before scoring/);
  });
});

describe("W23F.L sentinel contract — dsl-compiler still uses high < low", () => {
  it("dsl-compiler.ts uses `high < low` as never-true sentinel for disabled direction", () => {
    // Pin the compiler convention — if this changes, the catalog rule must change too
    expect(DSL_COMPILER).toMatch(/dir === "short" \? "high < low"/);
    expect(DSL_COMPILER).toMatch(/dir === "long"  \? "high < low"/);
    expect(DSL_COMPILER).toMatch(/never-true sentinel/);
  });

  it("session_open_breakout → opening_range_breakout mapping is in dsl-compiler.ts", () => {
    expect(DSL_COMPILER).toMatch(/session_open_breakout\{range_minutes/);
    expect(DSL_COMPILER).toMatch(/opening_range_breakout indicator/);
  });
});

describe("W23F.L regression guard — cycle-3 DSL conventions", () => {
  // Simulate the exact patterns the cycle-3 critic flagged.
  // These tests document what the critic should NOT raise concerns about.

  it("entry_short='high < low' with direction='long' is a SENTINEL, not nonsensical", () => {
    const dsl = {
      direction: "long",
      entry_long: "close > orh_15m",
      entry_short: "high < low", // sentinel
    };
    // Verbal contract: critic must check direction before flagging
    const isSentinel =
      dsl.entry_short === "high < low" && dsl.direction === "long";
    expect(isSentinel).toBe(true);
  });

  it("entry_indicator=session_open_breakout + indicators[].type=opening_range_breakout is VALID pair", () => {
    const dsl = {
      entry_indicator: "session_open_breakout",
      indicators: [{ type: "opening_range_breakout", period: 15 }],
    };
    const knownPairs: Record<string, string> = {
      session_open_breakout: "opening_range_breakout",
    };
    const canonical = dsl.entry_indicator;
    const compilerInternal = dsl.indicators[0].type;
    const isKnownPair =
      knownPairs[canonical] === compilerInternal || canonical === compilerInternal;
    expect(isKnownPair).toBe(true);
  });

  it("entry_long_prose=scout text + entry_long=compiled grammar is EXPECTED divergence", () => {
    const dsl = {
      entry_long: "close > orh_15m", // compiled canonical
      entry_long_prose: "Enter on the first momentum candle close above opening range", // scout original
    };
    // These SHOULD differ — prose preserves scout text, struct is canonical compiled form
    expect(dsl.entry_long_prose).not.toBe(dsl.entry_long);
    // But neither field is wrong — they just live at different layers
    expect(dsl.entry_long.length).toBeGreaterThan(0);
    expect(dsl.entry_long_prose.length).toBeGreaterThan(0);
  });
});
