/**
 * Wave 2 — Task 1: A7 gate PASS audit row + rampUpMode flag
 *
 * Tests:
 *  1. checkSignalCorrelationGate return type includes rampUpMode field
 *  2. rampUpMode is false on normal PASS (deployed strategies have vectors)
 *  3. rampUpMode is true on ramp-up PASS (deployed strategies exist but have no vectors)
 *  4. rampUpMode is false on BLOCK
 *  5. rampUpMode is false on pipeline-paused bypass
 *  6. Simulated PASS writes lifecycle.promotion_allowed_signal_correlation audit row
 *  7. Audit row result.ramp_up_mode=true on ramp-up path
 */

import { describe, it, expect } from "vitest";

// ─── Mirror the gate return type (must match signal-correlation-service.ts) ────

interface GateResult {
  allowed: boolean;
  reason: string;
  maxSimilarity: number | null;
  blockingStrategyId: string | null;
  rampUpMode: boolean;
}

type VectorStore = Map<string, number[]>;

function cosine(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Simulate checkSignalCorrelationGate including rampUpMode field.
 * Mirrors the updated logic in signal-correlation-service.ts.
 */
function simulateGateWithRampUp(
  candidateId: string,
  deployedIds: string[],
  vectorStore: VectorStore,
  pipelineActive: boolean = true,
): GateResult {
  const THRESHOLD = 0.85;

  if (!pipelineActive) {
    return { allowed: true, reason: "pipeline_paused", maxSimilarity: null, blockingStrategyId: null, rampUpMode: false };
  }

  const candidateVec = vectorStore.get(candidateId);
  if (!candidateVec) {
    return { allowed: false, reason: "no signal vector found", maxSimilarity: null, blockingStrategyId: null, rampUpMode: false };
  }

  if (deployedIds.length === 0) {
    return { allowed: true, reason: "no DEPLOYED strategies", maxSimilarity: null, blockingStrategyId: null, rampUpMode: false };
  }

  const deployedWithVectors = deployedIds.filter((id) => vectorStore.has(id));
  if (deployedWithVectors.length === 0) {
    // rampUpMode=true: deployed strategies exist but none have vectors
    return {
      allowed: true,
      reason: "PASSED (ramp-up) — deployed strategies have no signal vectors yet",
      maxSimilarity: null,
      blockingStrategyId: null,
      rampUpMode: true,
    };
  }

  let maxSim = -Infinity;
  let blockingId: string | null = null;
  for (const depId of deployedWithVectors) {
    const depVec = vectorStore.get(depId)!;
    const sim = cosine(candidateVec, depVec);
    if (sim > maxSim) {
      maxSim = sim;
      if (sim > THRESHOLD) blockingId = depId;
    }
  }

  if (blockingId !== null) {
    return {
      allowed: false,
      reason: `BLOCKED — similarity ${maxSim.toFixed(3)} with ${blockingId}`,
      maxSimilarity: maxSim,
      blockingStrategyId: blockingId,
      rampUpMode: false,
    };
  }

  return {
    allowed: true,
    reason: `PASSED — max similarity ${maxSim.toFixed(3)}`,
    maxSimilarity: maxSim,
    blockingStrategyId: null,
    rampUpMode: false,
  };
}

function makeSignals(n: number, seed: number, interval: number): number[] {
  const v = new Array(n).fill(0);
  for (let i = seed; i < n; i += interval) v[i] = 1;
  return v;
}

// ─── Audit row simulation (mirrors the lifecycle-service.ts pattern) ───────────

interface AuditRow {
  action: string;
  entityId: string;
  entityType: string;
  status: string;
  decisionAuthority: string;
  input: Record<string, unknown>;
  result: Record<string, unknown>;
  correlationId: string | null;
}

function simulateA7PassAuditRow(
  strategyId: string,
  gateResult: GateResult,
  correlationId: string | null,
): AuditRow | null {
  if (!gateResult.allowed) return null;
  return {
    action: "lifecycle.promotion_allowed_signal_correlation",
    entityId: strategyId,
    entityType: "strategy",
    status: "success",
    decisionAuthority: "gate",
    input: { fromState: "PAPER", toState: "DEPLOY_READY" },
    result: {
      reason: gateResult.reason,
      max_similarity: gateResult.maxSimilarity,
      threshold: 0.85,
      ramp_up_mode: gateResult.rampUpMode ?? false,
    },
    correlationId,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Wave 2 — A7 gate: rampUpMode field + PASS audit row", () => {
  const N = 5_000;

  it("rampUpMode is false on normal PASS (deployed strategies have vectors)", () => {
    const store: VectorStore = new Map([
      ["candidate-1", makeSignals(N, 0, 13)],
      ["deployed-1", makeSignals(N, 5, 17)],
    ]);
    const result = simulateGateWithRampUp("candidate-1", ["deployed-1"], store);
    expect(result.allowed).toBe(true);
    expect(result.rampUpMode).toBe(false);
  });

  it("rampUpMode is true on ramp-up PASS (deployed exist but have no vectors)", () => {
    const store: VectorStore = new Map([
      ["candidate-1", makeSignals(N, 0, 13)],
      // deployed-1 and deployed-2 exist in lifecycle but have no vectors (pre-A7)
    ]);
    const result = simulateGateWithRampUp("candidate-1", ["deployed-1", "deployed-2"], store);
    expect(result.allowed).toBe(true);
    expect(result.rampUpMode).toBe(true);
    expect(result.reason).toContain("ramp-up");
  });

  it("rampUpMode is false on BLOCK (high correlation)", () => {
    const signals = makeSignals(N, 0, 13);
    const store: VectorStore = new Map([
      ["candidate-1", signals],
      ["deployed-1", signals],
    ]);
    const result = simulateGateWithRampUp("candidate-1", ["deployed-1"], store);
    expect(result.allowed).toBe(false);
    expect(result.rampUpMode).toBe(false);
  });

  it("rampUpMode is false on pipeline-paused bypass", () => {
    const store: VectorStore = new Map([["candidate-1", makeSignals(N, 0, 13)]]);
    const result = simulateGateWithRampUp("candidate-1", ["deployed-1"], store, false);
    expect(result.allowed).toBe(true);
    expect(result.rampUpMode).toBe(false);
  });

  it("rampUpMode is false when candidate has no vector (fail-closed block)", () => {
    const store: VectorStore = new Map();
    const result = simulateGateWithRampUp("candidate-1", ["deployed-1"], store);
    expect(result.allowed).toBe(false);
    expect(result.rampUpMode).toBe(false);
  });

  it("rampUpMode is false when no deployed strategies exist (trivial PASS)", () => {
    const store: VectorStore = new Map([["candidate-1", makeSignals(N, 0, 13)]]);
    const result = simulateGateWithRampUp("candidate-1", [], store);
    expect(result.allowed).toBe(true);
    expect(result.rampUpMode).toBe(false);
  });

  it("PASS writes lifecycle.promotion_allowed_signal_correlation audit row", () => {
    const store: VectorStore = new Map([
      ["candidate-1", makeSignals(N, 0, 13)],
      ["deployed-1", makeSignals(N, 5, 17)],
    ]);
    const gateResult = simulateGateWithRampUp("candidate-1", ["deployed-1"], store);
    const auditRow = simulateA7PassAuditRow("candidate-1", gateResult, "test-correlation-id");

    expect(auditRow).not.toBeNull();
    expect(auditRow!.action).toBe("lifecycle.promotion_allowed_signal_correlation");
    expect(auditRow!.status).toBe("success");
    expect(auditRow!.decisionAuthority).toBe("gate");
    expect(auditRow!.result.ramp_up_mode).toBe(false);
    expect(auditRow!.result.threshold).toBe(0.85);
    expect(auditRow!.correlationId).toBe("test-correlation-id");
  });

  it("ramp-up PASS audit row has ramp_up_mode=true", () => {
    // Simulate ramp-up: deployed strategies exist but no vectors
    const store: VectorStore = new Map([["candidate-1", makeSignals(N, 0, 13)]]);
    const gateResult = simulateGateWithRampUp("candidate-1", ["deployed-1", "deployed-2"], store);
    expect(gateResult.rampUpMode).toBe(true);

    const auditRow = simulateA7PassAuditRow("candidate-1", gateResult, "ramp-up-correlation");
    expect(auditRow).not.toBeNull();
    expect(auditRow!.action).toBe("lifecycle.promotion_allowed_signal_correlation");
    expect(auditRow!.result.ramp_up_mode).toBe(true);
    expect(auditRow!.correlationId).toBe("ramp-up-correlation");
  });

  it("BLOCK does NOT write a PASS audit row", () => {
    const signals = makeSignals(N, 0, 13);
    const store: VectorStore = new Map([
      ["candidate-1", signals],
      ["deployed-1", signals],
    ]);
    const gateResult = simulateGateWithRampUp("candidate-1", ["deployed-1"], store);
    const auditRow = simulateA7PassAuditRow("candidate-1", gateResult, null);
    expect(auditRow).toBeNull();
  });
});
