import { describe, it, expect } from "vitest";
import { matchArchetype, KNOWN_ARCHETYPE_KEYS, type SpecEntryConditionLike } from "../spec-archetype-matcher.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("spec-archetype-matcher — matchArchetype", () => {
  it("matches order_block from 'order block entry trigger' (KXWRtV2LOVc sample shape)", () => {
    const conds: SpecEntryConditionLike[] = [
      { object: "order block entry trigger", role: "trigger" },
      { object: "session vwap reset time", role: "spine" },
    ];
    const result = matchArchetype(conds);
    expect(result.matched).toBe(true);
    expect(result.archetypeKey).toBe("order_block");
  });

  it("matches fvg from 'put limit order right fvg' (Qxlu8v_6G3Y sample shape)", () => {
    const conds: SpecEntryConditionLike[] = [
      { object: "put limit order right fvg", role: "trigger" },
    ];
    const result = matchArchetype(conds);
    expect(result.matched).toBe(true);
    expect(result.archetypeKey).toBe("fvg");
  });

  it("does NOT match generic VWAP/EMA vocabulary — routes honestly to unmapped", () => {
    // Mirrors the 1HFoStW_wsc.spec.json sample shape (VWAP mean-reversion, no ICT vocabulary).
    const conds: SpecEntryConditionLike[] = [
      { object: "daily vwap", role: "confluence" },
      { object: "weekly vwap", role: "confluence" },
      { object: "vwap slope", role: "spine" },
      { object: "mean reversion", role: "trigger" },
      { object: "trend continuation", role: "trigger" },
    ];
    const result = matchArchetype(conds);
    expect(result.matched).toBe(false);
    expect(result.archetypeKey).toBeNull();
  });

  it("returns unmatched (not a guess) on an ambiguous tie between two archetypes", () => {
    // "breaker" and "order block" both hit with score 1 each — no clear leader.
    const conds: SpecEntryConditionLike[] = [
      { object: "breaker block setup", role: "spine" },
      { object: "order block retest", role: "spine" },
    ];
    const result = matchArchetype(conds);
    expect(result.matched).toBe(false);
    expect(result.candidateScores.length).toBeGreaterThanOrEqual(2);
  });

  it("never throws on empty entry_conditions", () => {
    expect(() => matchArchetype([])).not.toThrow();
    expect(matchArchetype([]).matched).toBe(false);
  });

  it("never throws on conditions missing an object field", () => {
    const conds: SpecEntryConditionLike[] = [{ role: "trigger" }, { object: null, role: "spine" }];
    expect(() => matchArchetype(conds)).not.toThrow();
  });

  it("every KNOWN_ARCHETYPE_KEYS entry exists verbatim in direct-bucket-graduator.ts's ARCHETYPE_REGISTRY", () => {
    // Drift guard: KNOWN_ARCHETYPE_KEYS is a hand-verified copy (ARCHETYPE_REGISTRY is not
    // exported, per direct-bucket-graduator.ts's own module-scope `const`). This test fails
    // loudly if a key here no longer appears as a registry key in the source text, catching
    // silent drift between the two lists without needing a runtime import of the DB-coupled
    // graduator module.
    const graduatorPath = resolve(process.cwd(), "src/server/services/direct-bucket-graduator.ts");
    const source = readFileSync(graduatorPath, "utf-8");
    const registryMatch = source.match(/const ARCHETYPE_REGISTRY:[\s\S]*?=\s*\{([\s\S]*?)\n\};/);
    expect(registryMatch, "ARCHETYPE_REGISTRY object literal not found in direct-bucket-graduator.ts").toBeTruthy();
    const registryBody = registryMatch![1];
    for (const key of KNOWN_ARCHETYPE_KEYS) {
      const keyPattern = new RegExp(`(^|\\s)${key}:\\s*\\{`, "m");
      expect(keyPattern.test(registryBody), `KNOWN_ARCHETYPE_KEYS entry "${key}" not found as a registry key`).toBe(
        true,
      );
    }
  });
});
