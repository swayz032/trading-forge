/**
 * param-ranges.test.ts
 *
 * MED fix (critic-replay-lifecycle-misc, 2026-07-17): two bugs, proven here.
 *
 *   1. `ict_bias_aligned_continuation` was documented (CLAUDE.md §2b Wave 26
 *      Pass G B1 v10) and shipped (src/engine/strategies/
 *      ict_bias_aligned_continuation.py) alongside `bounce_off_level`, but only
 *      `bounce_off_level` ever made it into CANONICAL_PARAM_RANGES — the
 *      archetype was missing entirely.
 *
 *   2. Archetype strategies persist `entry_indicator` WITH an "archetype:"
 *      prefix (direct-bucket-graduator.ts:2253), matching the convention used
 *      throughout the codebase (archetype-registry-keys.ts,
 *      playbook-registration-backfill.ts, dsl-compiler.ts,
 *      fade-the-losers-service.ts all strip this prefix before lookup) — but
 *      every prior `CANONICAL_PARAM_RANGES[entryIndicator]` call site in
 *      critic-optimizer-service.ts indexed the map with the RAW (prefixed)
 *      value, which never matches this table's bare keys. So even the
 *      pre-existing `bounce_off_level` entry was unreachable via those call
 *      sites for any real archetype-routed strategy.
 *
 * `resolveCanonicalRangesForEntryIndicator()` fixes both: it strips the
 * optional "archetype:" prefix before indexing CANONICAL_PARAM_RANGES.
 */

import { describe, it, expect } from "vitest";
import {
  CANONICAL_PARAM_RANGES,
  resolveCanonicalRangesForEntryIndicator,
} from "../param-ranges.js";

describe("param-ranges: ict_bias_aligned_continuation entry", () => {
  it("CANONICAL_PARAM_RANGES has a bare entry for ict_bias_aligned_continuation", () => {
    expect(CANONICAL_PARAM_RANGES["ict_bias_aligned_continuation"]).toBeDefined();
  });

  it("covers all 6 real Python numeric knobs (ict_bias_aligned_continuation.py __init__)", () => {
    const ranges = CANONICAL_PARAM_RANGES["ict_bias_aligned_continuation"];
    for (const key of ["htf_swing_lookback", "bos_lookback", "bos_window", "fvg_lookback", "atr_period", "max_bars_held"]) {
      expect(ranges[key], `missing range for ${key}`).toBeDefined();
      expect(ranges[key][0]).toBeLessThan(ranges[key][1]);
    }
  });

  it("Python defaults fall within the registered bounds (htf_swing_lookback=20, bos_lookback=5, bos_window=15, fvg_lookback=8, atr_period=14, max_bars_held=30)", () => {
    const ranges = CANONICAL_PARAM_RANGES["ict_bias_aligned_continuation"];
    const defaults: Record<string, number> = {
      htf_swing_lookback: 20,
      bos_lookback: 5,
      bos_window: 15,
      fvg_lookback: 8,
      atr_period: 14,
      max_bars_held: 30,
    };
    for (const [key, val] of Object.entries(defaults)) {
      const [min, max] = ranges[key];
      expect(val, `default ${key}=${val} out of range [${min},${max}]`).toBeGreaterThanOrEqual(min);
      expect(val, `default ${key}=${val} out of range [${min},${max}]`).toBeLessThanOrEqual(max);
    }
  });
});

describe("resolveCanonicalRangesForEntryIndicator — archetype-prefix stripping", () => {
  it("resolves a bare (non-archetype) entry_indicator directly", () => {
    const ranges = resolveCanonicalRangesForEntryIndicator("rsi_reversal");
    expect(ranges).toEqual(CANONICAL_PARAM_RANGES["rsi_reversal"]);
  });

  it("HIGH regression: resolves 'archetype:bounce_off_level' — the prefixed form the graduator actually persists", () => {
    // Pre-fix: a raw CANONICAL_PARAM_RANGES["archetype:bounce_off_level"] index
    // returns undefined because the map's key is the bare "bounce_off_level" —
    // this is the exact lookup pattern critic-optimizer-service.ts used at all
    // 3 of its CANONICAL_PARAM_RANGES call sites before this fix.
    const raw = CANONICAL_PARAM_RANGES["archetype:bounce_off_level" as keyof typeof CANONICAL_PARAM_RANGES];
    expect(raw).toBeUndefined();

    const resolved = resolveCanonicalRangesForEntryIndicator("archetype:bounce_off_level");
    expect(resolved).toEqual(CANONICAL_PARAM_RANGES["bounce_off_level"]);
    expect(resolved).not.toBeNull();
  });

  it("HIGH regression: resolves 'archetype:ict_bias_aligned_continuation' (newly-added entry, prefixed form)", () => {
    const resolved = resolveCanonicalRangesForEntryIndicator("archetype:ict_bias_aligned_continuation");
    expect(resolved).toEqual(CANONICAL_PARAM_RANGES["ict_bias_aligned_continuation"]);
    expect(resolved).not.toBeNull();
  });

  it("returns null for an unknown archetype (no false-positive match)", () => {
    expect(resolveCanonicalRangesForEntryIndicator("archetype:totally_unregistered_archetype")).toBeNull();
  });

  it("returns null for undefined/null/empty entry_indicator", () => {
    expect(resolveCanonicalRangesForEntryIndicator(undefined)).toBeNull();
    expect(resolveCanonicalRangesForEntryIndicator(null)).toBeNull();
    expect(resolveCanonicalRangesForEntryIndicator("")).toBeNull();
    expect(resolveCanonicalRangesForEntryIndicator("   ")).toBeNull();
  });

  it("tolerates surrounding whitespace around the prefix and key", () => {
    expect(resolveCanonicalRangesForEntryIndicator("  archetype:bounce_off_level  ")).toEqual(
      CANONICAL_PARAM_RANGES["bounce_off_level"],
    );
  });
});
