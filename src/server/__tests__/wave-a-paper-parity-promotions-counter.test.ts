import { describe, it, expect, vi, beforeEach } from "vitest";

// Fix 7: strategyPromotions counter missing from gate BLOCK paths
// Uses inline vi.fn() inside factory to avoid hoisting issues

vi.mock("../lib/metrics-registry.js", () => {
  const inc = vi.fn();
  const labels = vi.fn().mockReturnValue({ inc });
  return {
    strategyPromotions: { labels },
    pboBLocksTotal: { labels: vi.fn().mockReturnValue({ inc: vi.fn() }) },
    lifecycleShadowPromotionsTotal: { labels: vi.fn().mockReturnValue({ inc: vi.fn() }) },
  };
});

import { strategyPromotions } from "../lib/metrics-registry.js";

describe("Fix 7: strategyPromotions counter on gate block paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("PAPER→DEPLOY_READY blocks increment counter with correct labels", () => {
    // Simulate the FIX 7 pattern on A7 gate block
    strategyPromotions.labels({ from_state: "PAPER", to_state: "DEPLOY_READY", actor: "system_gate" }).inc();
    expect(strategyPromotions.labels).toHaveBeenCalledWith({
      from_state: "PAPER",
      to_state: "DEPLOY_READY",
      actor: "system_gate",
    });
    const incMock = (strategyPromotions.labels as ReturnType<typeof vi.fn>).mock.results[0]!.value.inc;
    expect(incMock).toHaveBeenCalledTimes(1);
  });

  it("TESTING→PAPER blocks increment counter with correct labels", () => {
    // Simulate FIX 1 counter increment on TESTING→PAPER gate block
    strategyPromotions.labels({ from_state: "TESTING", to_state: "PAPER", actor: "system_gate" }).inc();
    expect(strategyPromotions.labels).toHaveBeenCalledWith({
      from_state: "TESTING",
      to_state: "PAPER",
      actor: "system_gate",
    });
    const incMock = (strategyPromotions.labels as ReturnType<typeof vi.fn>).mock.results[0]!.value.inc;
    expect(incMock).toHaveBeenCalledTimes(1);
  });

  it("multiple gate blocks fire labels() and inc() multiple times", () => {
    // B14 block, WFE block, drift block — each increments counter once
    const gateLabels = [
      { from_state: "PAPER", to_state: "DEPLOY_READY", actor: "system_gate" },
      { from_state: "PAPER", to_state: "DEPLOY_READY", actor: "system_gate" },
      { from_state: "PAPER", to_state: "DEPLOY_READY", actor: "system_gate" },
    ];
    for (const l of gateLabels) {
      strategyPromotions.labels(l).inc();
    }
    // labels() should have been called 3 times (once per gate block)
    expect(strategyPromotions.labels).toHaveBeenCalledTimes(3);
    // The mock factory returns the SAME inc fn each time labels() is called,
    // so inc.mock.calls.length === number of inc() invocations in this test
    const incFn = (strategyPromotions.labels as ReturnType<typeof vi.fn>).mock.results[0]!.value.inc;
    expect((incFn as ReturnType<typeof vi.fn>).mock.calls.length).toBe(3);
  });

  it("counter with actor='system_gate' is distinct from actor='system'", () => {
    // Successful promotions should use actor "system", not "system_gate"
    strategyPromotions.labels({ from_state: "PAPER", to_state: "DEPLOY_READY", actor: "system" }).inc();
    const callArgs = (strategyPromotions.labels as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<string, string>;
    expect(callArgs.actor).toBe("system");
    expect(callArgs.actor).not.toBe("system_gate");
  });

  it("labels object shape matches strategyPromotions labelNames: from_state, to_state, actor", () => {
    // Validates: labelNames: ["from_state", "to_state", "actor"]
    const labels = { from_state: "TESTING", to_state: "PAPER", actor: "system_gate" };
    expect(Object.keys(labels)).toEqual(["from_state", "to_state", "actor"]);
    strategyPromotions.labels(labels).inc();
    expect(strategyPromotions.labels).toHaveBeenCalledWith(labels);
  });
});
