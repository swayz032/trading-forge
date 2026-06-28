/**
 * Zone / context-gate primitive tests — Fidelity Phase 3A.
 * Context gates answer WHERE entry is valid (orthogonal to confirmation's WHEN). Representability tiers
 * T1/T2/T3; a REQUIRED T3 gate quarantines (dropping it over-fires = inflated edge).
 */
import { describe, it, expect } from "vitest";
import { scanContextGates, evaluateContextGate } from "../context-gate.js";

describe("scanContextGates — extraction (the discarded WHERE semantics)", () => {
  it("★ explicit numeric zone (iU8 4h-box 25-50% optimum) → T1, computable bounds", () => {
    const r = scanContextGates("only enter when price retraces into the 25 to 50% optimum zone of the 4h box");
    const zone = r.gates.find((g) => g.type === "zone");
    expect(zone?.representability).toBe("T1");
    expect(zone?.params.bounds).toEqual({ min: 0.25, max: 0.5 });
    expect(zone?.required).toBe(true);
    expect(r.contradictions).toEqual([]); // T1 → no quarantine
  });

  it("★ named POI (O9cz Asia low) → T2 with a tolerance band", () => {
    const r = scanContextGates("we want a clear point of interest below the asia session low before we look for entries");
    const poi = r.gates.find((g) => g.type === "poi" && g.name === "asia_low");
    expect(poi?.representability).toBe("T2");
    expect(poi?.params.proximity_atr).toBe(1.0);
  });

  it("session + regime gates detected", () => {
    const r = scanContextGates("only trade this during the New York session and only in a trending market");
    expect(r.gates.find((g) => g.type === "session")?.params.region).toBe("NY");
    expect(r.gates.find((g) => g.type === "regime")?.params.value).toBe("trending");
  });

  it("★ required FUZZY zone (T3) → CONTEXT_GATE_UNREPRESENTED (fail-closed)", () => {
    const r = scanContextGates("you must enter in the premium inefficiency zone after smart money repricing");
    expect(r.contradictions.some((c) => c.type === "CONTEXT_GATE_UNREPRESENTED")).toBe(true);
    const zone = r.gates.find((g) => g.type === "zone");
    expect(zone?.representability).toBe("T3");
  });

  it("named quadrant (discount) → T2 computable bounds", () => {
    const r = scanContextGates("we only buy in the discount zone of the dealing range");
    const zone = r.gates.find((g) => g.type === "zone");
    expect(zone?.representability).toBe("T2");
    expect(zone?.params.bounds).toEqual({ min: 0.0, max: 0.5 });
  });

  it("no WHERE language → no gates", () => {
    expect(scanContextGates("enter on a close through the opening range").gates).toEqual([]);
  });

  it("gate specificity: explicit numeric zone ≫ fuzzy zone", () => {
    const strong = scanContextGates("within the 25 to 50% of the 4h box").gates.find((g) => g.type === "zone");
    const weak = scanContextGates("around the premium inefficiency").gates.find((g) => g.type === "zone");
    expect((strong?.specificity ?? 0)).toBeGreaterThan(weak?.specificity ?? 99);
  });
});

describe("evaluateContextGate — the WHERE evaluator (T1/T2)", () => {
  it("zone: price within bounds passes, outside fails", () => {
    const [zone] = scanContextGates("retrace into the 25 to 50% zone of the 4h box").gates;
    expect(evaluateContextGate(zone, { range_position: 0.4 })).toBe(true);
    expect(evaluateContextGate(zone, { range_position: 0.7 })).toBe(false);
    expect(evaluateContextGate(zone, {})).toBeNull(); // no input → caller decides
  });

  it("poi: within proximity_atr passes, beyond fails", () => {
    const poi = scanContextGates("point of interest at the asia low").gates.find((g) => g.type === "poi")!;
    expect(evaluateContextGate(poi, { level_distance_atr: { asia_low: 0.5 } })).toBe(true);
    expect(evaluateContextGate(poi, { level_distance_atr: { asia_low: 2.0 } })).toBe(false);
  });

  it("session + regime equality", () => {
    const s = scanContextGates("only during the london session").gates.find((g) => g.type === "session")!;
    expect(evaluateContextGate(s, { session_region: "LONDON" })).toBe(true);
    expect(evaluateContextGate(s, { session_region: "NY" })).toBe(false);
  });
});
