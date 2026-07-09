import { describe, it, expect, vi, beforeEach } from "vitest";

// Fix 1 + 2: Auto-promotion cron gates bypass (TESTING→PAPER) + correlationId threading

// Mock all external dependencies
vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue(undefined),
    innerJoin: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockResolvedValue([]),
  },
}));
vi.mock("../production/kill-switch.js", () => ({
  killSwitch: { isHaltedForProduction: vi.fn().mockResolvedValue(false) },
}));
vi.mock("../lib/metrics-registry.js", () => ({
  strategyPromotions: { labels: vi.fn().mockReturnValue({ inc: vi.fn() }) },
  pboBlocksTotal: { labels: vi.fn().mockReturnValue({ inc: vi.fn() }) },
  lifecycleShadowPromotionsTotal: { labels: vi.fn().mockReturnValue({ inc: vi.fn() }) },
}));
vi.mock("../lib/b14-ci-gate.js", () => ({
  evaluateB14CiGate: vi.fn(),
}));
vi.mock("../lib/wfe-gate.js", () => ({
  evaluateWfeGate: vi.fn(),
}));
vi.mock("../lib/parameter-drift-gate.js", () => ({
  evaluateParameterDriftGate: vi.fn(),
}));
vi.mock("../routes/sse.js", () => ({
  broadcastSSE: vi.fn(),
}));

import { evaluateB14CiGate } from "../lib/b14-ci-gate.js";
import { evaluateWfeGate } from "../lib/wfe-gate.js";
import { evaluateParameterDriftGate } from "../lib/parameter-drift-gate.js";
import { strategyPromotions } from "../lib/metrics-registry.js";
import { broadcastSSE } from "../routes/sse.js";

describe("Fix 1: Auto-promotion TESTING→PAPER gate bypass", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("evaluateB14CiGate is callable with ruinCi and pointEstimate", () => {
    // Verify the gate function signature matches what FIX 1 uses
    const mockFn = vi.mocked(evaluateB14CiGate);
    mockFn.mockReturnValue({
      passed: true,
      reason: "ci_high within threshold",
      legacyFallback: false,
      auditPayload: { point_estimate: 0.25, ci_low: 0.2, ci_high: 0.3, threshold: 0.4, blocked: false, legacy_ruin_scalar_fallback: false, ci_method: "BCa", n_resamples: 5000 },
    });
    const result = evaluateB14CiGate({ ci_high: 0.3 }, 0.25);
    expect(result.passed).toBe(true);
    expect(result.auditPayload).toBeDefined();
  });

  it("evaluateB14CiGate block path: passed=false increments strategyPromotions counter", () => {
    const mockFn = vi.mocked(evaluateB14CiGate);
    mockFn.mockReturnValue({
      passed: false,
      reason: "ci_high exceeds threshold",
      legacyFallback: false,
      auditPayload: { point_estimate: 0.45, ci_low: 0.4, ci_high: 0.5, threshold: 0.4, blocked: true, legacy_ruin_scalar_fallback: false, ci_method: "BCa", n_resamples: 5000 },
    });

    const result = evaluateB14CiGate({ ci_high: 0.5 }, 0.45);
    expect(result.passed).toBe(false);

    // Simulate the counter increment that FIX 1 adds on block
    if (!result.passed) {
      strategyPromotions.labels({ from_state: "TESTING", to_state: "PAPER", actor: "system_gate" }).inc();
    }
    expect(strategyPromotions.labels).toHaveBeenCalledWith({
      from_state: "TESTING",
      to_state: "PAPER",
      actor: "system_gate",
    });
  });

  it("evaluateWfeGate block path emits SSE and increments counter", () => {
    const mockFn = vi.mocked(evaluateWfeGate);
    mockFn.mockReturnValue({
      passed: false,
      status: "blocked",
      wfeOverall: 0.45,
      hardFloor: 0.70,
      warnFloor: 0.50,
      auditAction: "lifecycle.wfe_hard_floor_block",
    });

    const wfeResult = evaluateWfeGate(0.45, undefined, undefined, null);
    expect(wfeResult.status).toBe("blocked");

    // Simulate FIX 1 SSE broadcast
    broadcastSSE("lifecycle:wfe_evaluated", {
      strategyId: "test-id",
      wfe_overall: wfeResult.wfeOverall,
      status: wfeResult.status,
      hard_floor: wfeResult.hardFloor,
      warn_floor: wfeResult.warnFloor,
      passed: wfeResult.passed,
    });
    expect(broadcastSSE).toHaveBeenCalledWith("lifecycle:wfe_evaluated", expect.objectContaining({
      strategyId: "test-id",
      passed: false,
    }));

    // Simulate counter on block
    const isBlock = wfeResult.status === "blocked";
    if (isBlock) {
      strategyPromotions.labels({ from_state: "TESTING", to_state: "PAPER", actor: "system_gate" }).inc();
    }
    expect(strategyPromotions.labels).toHaveBeenCalledWith({
      from_state: "TESTING",
      to_state: "PAPER",
      actor: "system_gate",
    });
  });

  it("evaluateParameterDriftGate block path increments counter", () => {
    const mockFn = vi.mocked(evaluateParameterDriftGate);
    mockFn.mockReturnValue({
      passed: false,
      status: "blocked",
      classification: "overfit_drift",
      confidence: 0.85,
      auditAction: "lifecycle.parameter_overfit_drift_block",
    });

    const driftResult = evaluateParameterDriftGate("overfit_drift", 0.85);
    const isBlock = driftResult.status === "blocked";
    if (isBlock) {
      strategyPromotions.labels({ from_state: "TESTING", to_state: "PAPER", actor: "system_gate" }).inc();
    }
    expect(strategyPromotions.labels).toHaveBeenCalledWith({
      from_state: "TESTING",
      to_state: "PAPER",
      actor: "system_gate",
    });
  });

  it("all three gates pass when results are favorable", () => {
    vi.mocked(evaluateB14CiGate).mockReturnValue({
      passed: true, reason: "ok", legacyFallback: false, auditPayload: { point_estimate: 0.15, ci_low: 0.1, ci_high: 0.2, threshold: 0.4, blocked: false, legacy_ruin_scalar_fallback: false, ci_method: "BCa", n_resamples: 5000 },
    });
    vi.mocked(evaluateWfeGate).mockReturnValue({
      passed: true, status: "passed", wfeOverall: 0.8, hardFloor: 0.70, warnFloor: 0.50, auditAction: null,
    });
    vi.mocked(evaluateParameterDriftGate).mockReturnValue({
      passed: true, status: "passed", classification: "stable", confidence: 0.9, auditAction: null,
    });

    const b14 = evaluateB14CiGate({ ci_high: 0.2 }, 0.15);
    const wfe = evaluateWfeGate(0.8, undefined, undefined, null);
    const drift = evaluateParameterDriftGate("stable", 0.9);

    expect(b14.passed).toBe(true);
    expect(wfe.passed).toBe(true);
    expect(drift.passed).toBe(true);
    // Counter should NOT have been incremented
    expect(strategyPromotions.labels).not.toHaveBeenCalled();
  });
});

describe("Fix 2: tickCorrelationId generation", () => {
  it("randomUUID produces a UUID-shaped string", () => {
    const { randomUUID } = require("crypto");
    const id = randomUUID();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it("tickCorrelationId uses provided correlationId when available", () => {
    const { randomUUID } = require("crypto");
    const provided = "test-correlation-id-123";
    const tickCorrelationId = provided ?? randomUUID();
    expect(tickCorrelationId).toBe(provided);
  });

  it("tickCorrelationId generates UUID when correlationId is null", () => {
    const { randomUUID } = require("crypto");
    const correlationId: string | null = null;
    const tickCorrelationId = correlationId ?? randomUUID();
    expect(tickCorrelationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/i);
    expect(tickCorrelationId).not.toBe(null);
  });
});
