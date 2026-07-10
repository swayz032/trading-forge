/**
 * archetype-registry-keys.test.ts — the drift-guard the module docstring has claimed
 * since 2026-06-24 but which never existed (deep-scan HIGH-2 2026-07-09, ratified).
 *
 * Locks the HIGH-1 fix: the 18 sub-layer vocabulary names Gemma emits (displacement,
 * htf_bias, trendline_bounce, …) have NO engine handler and MUST NOT be treated as
 * dispatchable archetypes — otherwise the graduator early-returns `archetype:<name>`,
 * the DSL compiler emits the never-true `high < low` sentinel, and the strategy graduates
 * as a silent zombie that never fires. They now live in SUBLAYER_VOCAB_NOT_DISPATCHABLE and
 * fall through to the alias table / uncatalogued quarantine instead.
 */

import { describe, it, expect } from "vitest";
import {
  RAW_ARCHETYPES_RESPECTED,
  SUBLAYER_VOCAB_NOT_DISPATCHABLE,
  RESOLVABLE_ARCHETYPES,
  entryIndicatorResolvesToArchetype,
} from "../archetype-registry-keys.js";

describe("archetype-registry-keys drift guard (HIGH-1/HIGH-2)", () => {
  it("the dispatchable-archetype set and the sub-layer-vocab set are DISJOINT", () => {
    const overlap = [...SUBLAYER_VOCAB_NOT_DISPATCHABLE].filter((n) => RAW_ARCHETYPES_RESPECTED.has(n));
    expect(overlap, `these names are in BOTH sets: ${overlap.join(", ")}`).toEqual([]);
  });

  it("NO sub-layer vocab name resolves to a dispatchable archetype (would graduate a zombie)", () => {
    for (const name of SUBLAYER_VOCAB_NOT_DISPATCHABLE) {
      expect(
        entryIndicatorResolvesToArchetype(name),
        `"${name}" must NOT resolve to an archetype — it has no engine handler and would ` +
        `graduate a never-firing strategy (route it via alias/uncatalogued quarantine instead)`,
      ).toBe(false);
      expect(entryIndicatorResolvesToArchetype(`archetype:${name}`)).toBe(false);
    }
  });

  it("RESOLVABLE_ARCHETYPES excludes every sub-layer vocab name", () => {
    for (const name of SUBLAYER_VOCAB_NOT_DISPATCHABLE) {
      expect(RESOLVABLE_ARCHETYPES.has(name)).toBe(false);
    }
  });

  it("real registered archetypes STILL resolve (regression guard for the split)", () => {
    for (const name of ["bounce_off_level", "ict_bias_aligned_continuation", "fvg_retrace", "order_block", "break_of_structure"]) {
      expect(entryIndicatorResolvesToArchetype(name), `"${name}" is a real archetype and must resolve`).toBe(true);
      expect(entryIndicatorResolvesToArchetype(`archetype:${name}`)).toBe(true);
    }
  });

  it("the specific shadowed-alias victim 'trendline_bounce' is sub-layer vocab (so it can reach its bounce_off_level alias)", () => {
    expect(SUBLAYER_VOCAB_NOT_DISPATCHABLE.has("trendline_bounce")).toBe(true);
    expect(entryIndicatorResolvesToArchetype("trendline_bounce")).toBe(false);
  });
});
