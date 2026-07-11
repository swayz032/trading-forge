/**
 * Confirmation-event compiler tests (2026-06-24 Fidelity Phase 1).
 * The load-bearing invariant: a PASSIVE touch must NEVER compile (it over-fires); an ACTIVE
 * close-through/structure-shift MUST compile. Fail-closed on missing evidence.
 */
import { describe, it, expect } from "vitest";
import { compileConfirmation } from "../confirmation-compiler.js";

describe("compileConfirmation — active confirmation compiles", () => {
  it("CLOSE-THROUGH the opening range → close_through + opening_range_edge", () => {
    const r = compileConfirmation({ transcript: "We wait for a full body candle to close outside of the opening range, then enter." });
    expect(r.compiled?.kind).toBe("close_through");
    expect(r.compiled?.level_ref).toBe("opening_range_edge");
    expect(r.quarantine_reason).toBeNull();
  });

  it("structure shift (CHoCH / MSS) → structure_shift", () => {
    const r = compileConfirmation({ transcript: "We need a change of character: a market structure shift breaking above the prior swing high." });
    expect(r.compiled?.kind).toBe("structure_shift");
    expect(r.quarantine_reason).toBeNull();
  });

  it("retest + rejection candle + FVG confluence → retest_reject", () => {
    const r = compileConfirmation({
      transcript: "Wait for a retest of the opening range low and a bullish rejection candle there.",
      confluences: ["fair_value_gap", "order_block"],
    });
    expect(r.compiled?.kind).toBe("retest_reject");
    expect(r.compiled?.confluence).toBe("fair_value_gap");
  });

  it("★ Phase 2A: SPECIFICITY beats kind-rank — named-level close_through wins over generic structure_shift", () => {
    // Old behavior picked structure_shift by fixed kind-rank (the SELECTION bug). New: the specific
    // named-level trigger wins. close_through@range_edge (named) > structure_shift@prior_swing (generic).
    const r = compileConfirmation({ transcript: "Price closes above the range. Then we get a change of character confirming the shift." });
    expect(r.compiled?.kind).toBe("close_through");
    expect(r.compiled?.level_ref).toBe("range_edge");
  });

  it("kind-rank still tie-breaks at EQUAL specificity", () => {
    // Both windows reference the same generic prior_swing (equal specificity) → kind-rank picks structure_shift.
    const r = compileConfirmation({ transcript: "A candle closes below the prior swing low. Then a change of character at the prior swing low." });
    expect(r.compiled?.kind).toBe("structure_shift");
  });

  it("directional_rule encodes long=break-above / short=break-below SEPARATELY (the 2u9 fix)", () => {
    const r = compileConfirmation({
      transcript: "We need a change of character: a market structure shift breaking the prior swing.",
      direction_class: "BIDIRECTIONAL_EXPLICIT",
    });
    expect(r.compiled?.directional_rule?.long).toMatch(/above/i);
    expect(r.compiled?.directional_rule?.short).toMatch(/below/i);
  });

  it("LONG_ONLY → only the long break rule (no spurious short side)", () => {
    const r = compileConfirmation({
      transcript: "Change of character: market structure shift breaking the prior swing high.",
      direction_class: "LONG_ONLY",
    });
    expect(r.compiled?.directional_rule?.long).toBeTruthy();
    expect(r.compiled?.directional_rule?.short).toBeUndefined();
  });
});

describe("compileConfirmation — FAIL-CLOSED (the over-fire guard)", () => {
  it("★ PASSIVE touch only → confirmation_would_overfire (never compiles a touch)", () => {
    const r = compileConfirmation({ transcript: "When price taps into the order block, we enter the trade." });
    expect(r.compiled).toBeNull();
    expect(r.quarantine_reason).toBe("confirmation_would_overfire");
  });

  it("'price reaches the level and we buy' (passive) → would_overfire", () => {
    const r = compileConfirmation({ transcript: "Once price reaches our zone and returns to the level, we buy." });
    expect(r.compiled).toBeNull();
    expect(r.quarantine_reason).toBe("confirmation_would_overfire");
  });

  it("no confirmation language at all → no_confirmation_event", () => {
    const r = compileConfirmation({ transcript: "Buy a micro contract, wait for it to go up, then sell for a profit." });
    expect(r.compiled).toBeNull();
    expect(r.quarantine_reason).toBe("no_confirmation_event");
  });

  it("close-through with NO identifiable level → confirmation_no_level", () => {
    const r = compileConfirmation({ transcript: "We wait for a candle to close through and then we enter." });
    expect(r.compiled).toBeNull();
    expect(r.quarantine_reason).toBe("confirmation_no_level");
  });

  it("empty input → no_confirmation_event", () => {
    expect(compileConfirmation({ transcript: "" }).quarantine_reason).toBe("no_confirmation_event");
  });
});

describe("Phase 2A — specificity-ranked selection + SCL gate", () => {
  it("★ picks the SPECIFIC retest@OR-low+FVG over a co-present generic structure_shift (the yAMaiOI fix)", () => {
    const r = compileConfirmation({
      transcript:
        "We see a change of character breaking the prior swing. We enter on the retest of the opening range low combined with the fair value gap confluence.",
      confluences: ["fair_value_gap"],
    });
    expect(r.compiled?.kind).toBe("retest_reject");
    expect(r.compiled?.level_ref).toBe("opening_range_edge");
    expect(r.compiled?.confluence).toBe("fair_value_gap");
    expect(r.scl).toBe(0); // faithful — captured the specific trigger
  });

  it("★ candidate-scoped SCL does NOT false-quarantine a faithful generic CHoCH compile (anti-over-quarantine)", () => {
    // A legit pure-CHoCH strategy: the most specific AVAILABLE candidate IS the structure_shift.
    // Candidate-scoped SCL = 0 (no more-specific candidate existed) → compiles, not quarantined.
    // (Whole-transcript SCL would have wrongly quarantined this on explainer text — the bug we fixed.)
    const r = compileConfirmation({ transcript: "We wait for a clear change of character breaking the prior swing, then we enter." });
    expect(r.compiled?.kind).toBe("structure_shift");
    expect(r.quarantine_reason).toBeNull();
    expect(r.scl).toBe(0);
  });

  it("SCL gate fires only on selection regression (chosen less specific than an available candidate)", () => {
    // Two candidates; selection MUST pick the specific one → SCL 0. If it ever regressed to the generic,
    // SCL would exceed tolerance. This asserts selection picks the specific candidate (gate stays clean).
    const r = compileConfirmation({
      transcript: "We note a change of character. Then we enter on a candle closing through the opening range edge.",
    });
    expect(r.compiled?.kind).toBe("close_through");
    expect(r.compiled?.level_ref).toBe("opening_range_edge");
    expect(r.quarantine_reason).toBeNull();
    expect(r.scl).toBe(0);
  });

  it("SCL hard gate is OPT-IN: default-off never quarantines; enabled + tol=0 does", () => {
    const transcript = "We enter on a candle closing through the opening range edge. Also there is a displacement leg.";
    // default (gate off): compiles even with SCL > 0
    const off = compileConfirmation({ transcript });
    expect(off.compiled).not.toBeNull();
    expect((off.scl ?? 0)).toBeGreaterThan(0); // a rare displacement candidate the chosen predicate didn't capture
    // enabled + zero tolerance: the same lossy compile now quarantines
    const prevEnabled = process.env.SCL_GATE_ENABLED;
    const prevTol = process.env.SCL_MAX_TOLERANCE;
    process.env.SCL_GATE_ENABLED = "true";
    process.env.SCL_MAX_TOLERANCE = "0";
    try {
      const on = compileConfirmation({ transcript });
      expect(on.compiled).toBeNull();
      expect(on.quarantine_reason).toBe("semantic_compression_loss");
    } finally {
      if (prevEnabled === undefined) delete process.env.SCL_GATE_ENABLED; else process.env.SCL_GATE_ENABLED = prevEnabled;
      if (prevTol === undefined) delete process.env.SCL_MAX_TOLERANCE; else process.env.SCL_MAX_TOLERANCE = prevTol;
    }
  });

  it("faithful close_through compiles with low SCL + telemetry populated", () => {
    const r = compileConfirmation({ transcript: "We wait for a full body candle to close outside the opening range, then enter." });
    expect(r.compiled?.kind).toBe("close_through");
    expect(r.quarantine_reason).toBeNull();
    expect(r.scl).toBe(0);
    expect(r.edge_specificity).toBeGreaterThan(0);
  });
});

describe("INVARIANT: touch never compiles, close-through always does (same level)", () => {
  it("touch of opening range → quarantine; close-through of opening range → compile", () => {
    const touch = compileConfirmation({ transcript: "When price taps the opening range low we go long." });
    const close = compileConfirmation({ transcript: "When a candle closes below the opening range low we go short." });
    expect(touch.compiled).toBeNull(); // would over-fire
    expect(close.compiled?.kind).toBe("close_through"); // strict, correct
  });
});
