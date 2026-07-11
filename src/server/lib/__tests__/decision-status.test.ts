/**
 * Decision status — UNKNOWN as first-class (≠ null) + binary execution (no confidence) + the no-guess rule.
 */
import { describe, it, expect } from "vitest";
import { epistemicFromOrigin, isFaithfullyExecutable, unresolvableRequired, decisionCoverage } from "../decision-status.js";

describe("epistemicFromOrigin — UNKNOWN ≠ null ≠ implied", () => {
  it("explicit + present → KNOWN", () => expect(epistemicFromOrigin("explicit", { present: true, decisionExpected: true })).toBe("KNOWN"));
  it("derived + present → IMPLIED (runnable, not taught)", () => expect(epistemicFromOrigin("derived", { present: true, decisionExpected: true })).toBe("IMPLIED"));
  it("★ absent BUT a decision was expected → UNKNOWN (educator had it, never verbalized)", () =>
    expect(epistemicFromOrigin("compiler_generated", { present: false, decisionExpected: true })).toBe("UNKNOWN"));
  it("★ absent and no decision expected → IMPLIED (no-decision default), NOT UNKNOWN", () =>
    expect(epistemicFromOrigin("compiler_generated", { present: false, decisionExpected: false })).toBe("IMPLIED"));
  it("framework-owned → FRAMEWORK regardless of presence", () =>
    expect(epistemicFromOrigin(undefined, { present: false, decisionExpected: true, frameworkOwned: true })).toBe("FRAMEWORK"));
});

describe("isFaithfullyExecutable — the no-guess rule", () => {
  it("all required TRUE/FALSE → executable", () => expect(isFaithfullyExecutable(["TRUE", "FALSE", "TRUE"])).toBe(true));
  it("★ any required UNKNOWN → NOT executable (engine must not invent)", () => expect(isFaithfullyExecutable(["TRUE", "UNKNOWN"])).toBe(false));
  it("★ any required UNOBSERVABLE → NOT executable", () => expect(isFaithfullyExecutable(["TRUE", "UNOBSERVABLE"])).toBe(false));
  it("empty required set → not executable (nothing to run)", () => expect(isFaithfullyExecutable([])).toBe(false));
  it("names the unresolvable required conditions", () =>
    expect(unresolvableRequired([{ name: "trigger", resolution: "UNKNOWN" }, { name: "session", resolution: "TRUE" }])).toEqual(["trigger"]));
});

describe("decisionCoverage — executable / expected, not field coverage", () => {
  it("★ 19/20 decisions executable → 0.95 (one rule wrong is very different from 20% extracted)", () =>
    expect(decisionCoverage({ executable: 19, expected: 20 }).coverage).toBeCloseTo(0.95));
  it("★ 4/20 → 0.20 (severe extraction gap, not a single wrong rule)", () =>
    expect(decisionCoverage({ executable: 4, expected: 20 }).coverage).toBeCloseTo(0.2));
  it("no expected decisions → coverage 1 (vacuous)", () => expect(decisionCoverage({ executable: 0, expected: 0 }).coverage).toBe(1));
});
