/**
 * Compound (multi-leg) confirmation tests — Fidelity Phase 2B.
 * The compiler must REPRESENT conjoined triggers (A AND B AND C), preserve order + operator, and
 * surface contradictions when a leg collapses — no ranking function can do this (representation problem).
 */
import { describe, it, expect } from "vitest";
import { compileConfirmationCompound } from "../confirmation-compiler.js";

const seq = (...actions: string[]) => actions.map((action, i) => ({ step: i + 1, action }));

describe("compileConfirmationCompound — multi-leg representation", () => {
  it("★ 3-leg ordered sequence is preserved (sweep/displacement → MSS → retest), not collapsed to one", () => {
    const r = compileConfirmationCompound({
      entry_sequence: seq(
        "wait for a sweep of the asia low then a displacement candle",
        "then look for a market structure shift breaking the prior swing high",
        "then enter on the retest of the order block",
      ),
      direction_class: "both",
    });
    expect(r.compound?.predicate_type).toBe("sequence");
    expect(r.compound?.operator).toBe("SEQUENCE");
    expect(r.compound?.legs.length).toBeGreaterThanOrEqual(3);
    expect(r.compound?.legs.map((l) => l.order)).toEqual([1, 2, 3]);
    expect(r.contradictions).toEqual([]);
  });

  it("parallel confluence (no ordering words) → operator AND", () => {
    const r = compileConfirmationCompound({
      entry_sequence: seq(
        "enter when a candle closes through the opening range edge",
        "combined with a displacement leg for confluence",
      ),
    });
    expect(r.compound?.operator).toBe("AND");
    expect(r.compound?.predicate_type).toBe("and");
    expect(r.compound?.legs.length).toBe(2);
  });

  it("★ MISSING_LEG fires when a SPECIFIC (named-level) confirmation step can't compile (Invariant 1)", () => {
    const r = compileConfirmationCompound({
      entry_sequence: seq(
        "a market structure shift at the prior swing",       // compiles (structure defaults level)
        "then a candle closing through the fair value gap",  // names FVG (no LevelRef slot) → specific miss
      ),
    });
    expect(r.leg_count).toBe(1);
    expect(r.expected_legs).toBe(2);
    expect(r.contradictions.some((c) => c.type === "MISSING_LEG")).toBe(true);
  });

  it("collapses repeated narration of the SAME leg (no double-count)", () => {
    const r = compileConfirmationCompound({
      entry_sequence: seq(
        "close through the opening range edge",
        "we want that candle to close through the opening range edge", // same leg restated
      ),
    });
    expect(r.compound?.legs.length).toBe(1);
    expect(r.compound?.predicate_type).toBe("single");
  });

  it("single confirmation step → predicate_type single", () => {
    const r = compileConfirmationCompound({ entry_sequence: seq("enter on a full body close through the opening range edge") });
    expect(r.compound?.predicate_type).toBe("single");
    expect(r.compound?.legs.length).toBe(1);
    expect(r.compound?.legs[0].kind).toBe("close_through");
  });

  it("no entry_sequence → falls back to single corpus scan (Phase 2A behavior preserved)", () => {
    const r = compileConfirmationCompound({ transcript: "we enter on a candle closing through the opening range edge" });
    expect(r.compound?.predicate_type).toBe("single");
    expect(r.compound?.legs[0].kind).toBe("close_through");
    expect(r.compound?.legs[0].level_ref).toBe("opening_range_edge");
  });

  it("LEVEL_LOSS contradiction when a step names a level the LevelRef enum can't represent", () => {
    // The step anchors the shift at the fair value gap — a named level with no LevelRef slot, so the leg
    // compiles to the generic prior_swing default → LEVEL_LOSS surfaced (a real representational gap).
    const r = compileConfirmationCompound({
      entry_sequence: seq("market structure shift confirming at the fair value gap"),
    });
    expect(r.contradictions.some((c) => c.type === "LEVEL_LOSS")).toBe(true);
  });
});
