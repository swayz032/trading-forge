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

  it("structure_shift outranks a co-present close_through (priority)", () => {
    const r = compileConfirmation({ transcript: "Price closes above the range. Then we get a change of character confirming the shift." });
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

describe("INVARIANT: touch never compiles, close-through always does (same level)", () => {
  it("touch of opening range → quarantine; close-through of opening range → compile", () => {
    const touch = compileConfirmation({ transcript: "When price taps the opening range low we go long." });
    const close = compileConfirmation({ transcript: "When a candle closes below the opening range low we go short." });
    expect(touch.compiled).toBeNull(); // would over-fire
    expect(close.compiled?.kind).toBe("close_through"); // strict, correct
  });
});
