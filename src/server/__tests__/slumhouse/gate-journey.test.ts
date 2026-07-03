import { describe, it, expect } from "vitest";
import { resolveGateJourney, coarseJourneyForStage, GATE_DEFS } from "../../lib/slumhouse/gate-journey.js";

describe("resolveGateJourney", () => {
  it("marks cleared gates pass, the frontier now, the rest wait", () => {
    const gates = resolveGateJourney({
      lifecycleState: "PAPER",
      signals: { backtested: true, wfe_pass: true, frankenstein_pass: true, blackswan_pass: true, paper_done: false, shadow_pass: false, compliance_pass: false },
    });
    const byKey = Object.fromEntries(gates.map((g) => [g.key, g.status]));
    expect(byKey.profitable).toBe("pass");
    expect(byKey.holds_up).toBe("pass");
    expect(byKey.real_edge).toBe("pass");
    expect(byKey.crash_proof).toBe("pass");
    expect(byKey.paper_trial).toBe("now");
    expect(byKey.live_match).toBe("wait");
    expect(byKey.live_money).toBe("wait");
    expect(gates.map((g) => g.label)).toEqual(GATE_DEFS.map((d) => d.label));
  });
  it("marks the first failing gate as fail for a graveyard strategy", () => {
    const gates = resolveGateJourney({
      lifecycleState: "GRAVEYARD",
      signals: { backtested: true, wfe_pass: true, frankenstein_pass: false, blackswan_pass: false, paper_done: false, shadow_pass: false, compliance_pass: false },
    });
    const byKey = Object.fromEntries(gates.map((g) => [g.key, g.status]));
    expect(byKey.real_edge).toBe("fail");
    expect(byKey.crash_proof).toBe("wait");
  });
  it("marks every gate pass for a DEPLOYED strategy", () => {
    const gates = resolveGateJourney({ lifecycleState: "DEPLOYED", signals: { backtested: true, wfe_pass: true, frankenstein_pass: true, blackswan_pass: true, paper_done: true, shadow_pass: true, compliance_pass: true } });
    expect(gates.every((g) => g.status === "pass")).toBe(true);
  });
});

describe("coarseJourneyForStage", () => {
  it("returns one gate per GATE_DEF, in order", () => {
    const gates = coarseJourneyForStage("PAPER");
    expect(gates).toHaveLength(GATE_DEFS.length);
    expect(gates.map((g) => g.key)).toEqual(GATE_DEFS.map((d) => d.key));
  });
  it("marks every gate pass for a DEPLOYED strategy", () => {
    const gates = coarseJourneyForStage("DEPLOYED");
    expect(gates.every((g) => g.status === "pass")).toBe(true);
  });
  it("marks paper_trial as now and profitable..crash_proof as pass for PAPER", () => {
    const byKey = Object.fromEntries(coarseJourneyForStage("PAPER").map((g) => [g.key, g.status]));
    expect(byKey.profitable).toBe("pass");
    expect(byKey.holds_up).toBe("pass");
    expect(byKey.real_edge).toBe("pass");
    expect(byKey.crash_proof).toBe("pass");
    expect(byKey.paper_trial).toBe("now");
    expect(byKey.live_match).toBe("wait");
    expect(byKey.live_money).toBe("wait");
  });
  it("marks exactly one gate fail for a GRAVEYARD strategy", () => {
    const gates = coarseJourneyForStage("GRAVEYARD");
    expect(gates.filter((g) => g.status === "fail")).toHaveLength(1);
  });
  it("is case-insensitive and defaults unknown stages to the first gate as now", () => {
    const byKey = Object.fromEntries(coarseJourneyForStage("paper").map((g) => [g.key, g.status]));
    expect(byKey.paper_trial).toBe("now");
    const unknown = coarseJourneyForStage("WAT");
    expect(unknown[0].status).toBe("now");
    expect(unknown.slice(1).every((g) => g.status === "wait")).toBe(true);
  });
});
