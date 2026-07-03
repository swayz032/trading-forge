import { describe, it, expect } from "vitest";
import { resolveGateJourney, GATE_DEFS } from "../../lib/slumhouse/gate-journey.js";

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
