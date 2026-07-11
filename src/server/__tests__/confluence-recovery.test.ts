import { describe, it, expect } from "vitest";
import { recoverConfluences } from "../lib/confluence-recovery.js";

// Locks in the 2026-06-23 manual-transcript-audit findings as regression tests. The recovery layer
// AUGMENTS confluences from step text (representational fix), but must NOT (a) fabricate Fib from
// the bare word "retrace" [the gdd false positive a human read caught], nor (b) rescue genuinely
// thin extractions [N7uP only passed because chunking recovered REAL content, not because the bar
// moved]. These tests are the negative controls proving the gate still holds.

describe("confluence-recovery — manual-audit regression guards", () => {
  it("does NOT recover fib_zone from bare 'retrace' (gdd false-positive fix)", () => {
    const idea: Record<string, unknown> = {
      concept_name: "moving_average_trend_following_20_200",
      entry_sequence: [
        { step: 1, action: "Identify the trend using the 20 MA" },
        { step: 2, action: "Wait for price to retrace into the rising 20 MA" },
        { step: 3, action: "Enter long on the retracement to the 20 moving average" },
      ],
      confluences: [],
    };
    const rep = recoverConfluences(idea);
    const cats = rep.recovered.map((r) => r.category);
    expect(cats).not.toContain("fib_zone"); // "retrace" alone must NOT imply Fibonacci
    expect(cats).toContain("moving_average"); // the real confluence IS recovered
  });

  it("DOES recover fib_zone from real Fib markers / 25-50-75 zones (SY2 legit case)", () => {
    const idea: Record<string, unknown> = {
      concept_name: "impulse_range_sweep_4h_5m",
      entry_sequence: [
        { step: 1, action: "Draw the Gann box and project the 25%, 50%, 75% levels" },
        { step: 2, action: "Wait for price to manipulate into the 25-50% optimum zone" },
      ],
      confluences: [],
    };
    const rep = recoverConfluences(idea);
    expect(rep.recovered.map((r) => r.category)).toContain("fib_zone");
  });

  it("tags provenance: recovered = step_inferred with evidence_step; explicit preserved", () => {
    const idea: Record<string, unknown> = {
      concept_name: "x",
      entry_sequence: [{ step: 4, action: "enter on the VWAP retest" }],
      confluences: [{ name: "order_block" }],
    };
    recoverConfluences(idea);
    const confl = idea.confluences as Array<Record<string, unknown>>;
    const explicit = confl.find((c) => c.name === "order_block");
    const inferred = confl.find((c) => c.name === "vwap");
    expect(explicit?.source).toBe("explicit");
    expect(inferred?.source).toBe("step_inferred");
    expect(inferred?.evidence_step).toBe(4);
  });

  it("category-dedup: multiple Fib references collapse to ONE fib_zone family", () => {
    const idea: Record<string, unknown> = {
      concept_name: "x",
      entry_sequence: [
        { step: 1, action: "wait for the 50% fib" },
        { step: 2, action: "confirm at the golden pocket 0.618" },
        { step: 3, action: "enter at the 75% retracement zone" },
      ],
      confluences: [],
    };
    const rep = recoverConfluences(idea);
    expect(rep.recovered.filter((r) => r.category === "fib_zone")).toHaveLength(1);
  });

  it("NEGATIVE CONTROL: generic concept + NO indicator namers → name stays generic (no over-rescue)", () => {
    const idea: Record<string, unknown> = {
      concept_name: "extracted_strategy",
      entry_sequence: [
        { step: 1, action: "wait for the market to look good" },
        { step: 2, action: "enter when it feels right" },
      ],
      confluences: [],
    };
    recoverConfluences(idea);
    // No vwap/MA/macd/etc. in steps → derivation must NOT invent a name. Stays generic → the gate's
    // FIX-13 self-evident path (which requires a non-generic name) correctly fails it downstream.
    expect(idea.concept_name).toBe("extracted_strategy");
    expect(idea.entry_indicator == null || idea.entry_indicator === "").toBe(true);
  });

  it("derives a faithful name from indicator namers when generic (N7uP recovery)", () => {
    const idea: Record<string, unknown> = {
      concept_name: "extracted_strategy",
      entry_sequence: [
        { step: 1, action: "set up VWAP and the 8 EMA moving average" },
        { step: 2, action: "never take calls under VWAP" },
        { step: 3, action: "hold above the EMA as a trailing stop" },
      ],
      confluences: [],
    };
    recoverConfluences(idea);
    expect(idea.concept_name).not.toBe("extracted_strategy");
    expect(String(idea.concept_name)).toContain("vwap");
    expect(idea.entry_indicator).toBe(idea.concept_name);
  });
});
