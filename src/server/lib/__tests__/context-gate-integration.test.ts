/**
 * Phase 3A→engine integration harness — proves WHERE gates actually CHANGE signal firing (not just
 * static analysis). Same compiled gate + different market state → different fire decision. This is the
 * Option-B de-risk: "a strategy can grade perfectly in static analysis and still misfire in replay."
 */
import { describe, it, expect } from "vitest";
import { scanContextGates, evaluateContextGates } from "../context-gate.js";

describe("evaluateContextGates — WHERE gate changes signal firing", () => {
  it("★ iU8 optimum zone: price INSIDE 25-50% fires, OUTSIDE is blocked", () => {
    const gates = scanContextGates("only enter when price retraces into the 25 to 50% optimum zone of the 4h box").gates;
    expect(evaluateContextGates(gates, { range_position: 0.40 }).allowed).toBe(true);  // in zone → fire
    expect(evaluateContextGates(gates, { range_position: 0.70 }).allowed).toBe(false); // overextended → blocked
  });

  it("★ O9cz POI: within 1 ATR of asia_low fires, beyond is blocked", () => {
    const gates = scanContextGates("we only buy below the asia session low at our point of interest").gates;
    expect(evaluateContextGates(gates, { level_distance_atr: { asia_low: 0.5 } }).allowed).toBe(true);
    expect(evaluateContextGates(gates, { level_distance_atr: { asia_low: 2.5 } }).allowed).toBe(false);
  });

  it("execution session gates entry; current session must match", () => {
    const gates = scanContextGates("only trade this during the new york session").gates;
    expect(evaluateContextGates(gates, { session_region: "NY" }).allowed).toBe(true);
    expect(evaluateContextGates(gates, { session_region: "LONDON" }).allowed).toBe(false);
  });

  it("★ 2D-B payoff: a FORMATION session does NOT gate entry (O9cz Asia-formation ≠ entry-session check)", () => {
    const gates = scanContextGates("the asia session range is liquid; we only trade during the london session").gates;
    // entry happens in LONDON; the ASIA formation gate must NOT block just because current session ≠ ASIA
    const r = evaluateContextGates(gates, { session_region: "LONDON" });
    expect(r.allowed).toBe(true);
    expect(r.failed.some((g) => g.name === "ASIA")).toBe(false);
  });

  it("★ fail-closed: a REQUIRED gate with no market-state input BLOCKS (missing zone check over-fires)", () => {
    const gates = scanContextGates("only enter inside the 25 to 50% zone of the 4h box").gates;
    const r = evaluateContextGates(gates, {}); // engine provided no range_position
    expect(r.allowed).toBe(false);
    expect(r.unevaluable.length).toBeGreaterThan(0);
  });

  it("target/stop levels never gate entry", () => {
    const gates = scanContextGates("our target is the asia high; place your stop below the order block").gates;
    // both are non-validity roles → no entry gates → trivially allowed
    expect(evaluateContextGates(gates, {}).allowed).toBe(true);
  });

  it("combined WHERE: full gate set passes only when ALL required entry gates pass", () => {
    const gates = scanContextGates("only buy below the asia low, only in the 25 to 50% zone, only during the london session").gates;
    expect(evaluateContextGates(gates, { range_position: 0.4, level_distance_atr: { asia_low: 0.5 }, session_region: "LONDON" }).allowed).toBe(true);
    expect(evaluateContextGates(gates, { range_position: 0.4, level_distance_atr: { asia_low: 0.5 }, session_region: "NY" }).allowed).toBe(false); // wrong session
  });
});
