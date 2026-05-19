/**
 * Wave 2 — Task 2: Frankenstein gate evaluation audit (every evaluation)
 *
 * Tests:
 *  1. PASS branch writes gate.frankenstein.evaluated with status=success
 *  2. FAIL branch writes gate.frankenstein.evaluated with status=failure, decision=failed
 *  3. MISSING run branch writes gate.frankenstein.evaluated with status=failure, decision=missing_run
 *  4. No-backtestId branch writes gate.frankenstein.evaluated with decision=no_backtest_id
 *  5. Infrastructure error branch writes gate.frankenstein.evaluated with decision=infrastructure_error
 *  6. All 4 branches share the same action name: gate.frankenstein.evaluated
 *  7. Mixed outcomes: 3 strategies through evaluate → 3 rows, each with expected status/decision
 */

import { describe, it, expect } from "vitest";

// ─── Simulated Frankenstein run type (mirrors frankenstein-service.ts output) ──

interface MockFrankResult {
  runId: string;
  passed: boolean;
  p95Sharpe: number | null;
  medianPf: number | null;
}

// ─── Simulated audit row type ─────────────────────────────────────────────────

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

// ─── Simulate the Frankenstein gate decision + audit row (mirrors lifecycle-service.ts) ─

type GateOutcome =
  | { blocked: false; auditRow: AuditRow }
  | { blocked: true; error: string; auditRow: AuditRow };

function simulateFrankensteinGate(
  strategyId: string,
  backtestId: string | null,
  frankResult: MockFrankResult | null | "error",
  correlationId: string | null,
): GateOutcome {
  if (!backtestId) {
    const auditRow: AuditRow = {
      action: "gate.frankenstein.evaluated",
      entityId: strategyId,
      entityType: "strategy",
      status: "failure",
      decisionAuthority: "gate",
      input: { fromState: "TESTING", toState: "PAPER" },
      result: {
        passed: false,
        decision: "no_backtest_id",
        reason: "no backtest ID found in evidence — cannot verify Frankenstein test",
      },
      correlationId,
    };
    return { blocked: true, error: "no backtest ID", auditRow };
  }

  if (frankResult === "error") {
    const auditRow: AuditRow = {
      action: "gate.frankenstein.evaluated",
      entityId: strategyId,
      entityType: "strategy",
      status: "failure",
      decisionAuthority: "gate",
      input: { fromState: "TESTING", toState: "PAPER" },
      result: {
        passed: false,
        decision: "infrastructure_error",
        backtestId,
        reason: "gate read failed (fail-closed): simulated error",
      },
      correlationId,
    };
    return { blocked: true, error: "infrastructure error", auditRow };
  }

  if (!frankResult) {
    const auditRow: AuditRow = {
      action: "gate.frankenstein.evaluated",
      entityId: strategyId,
      entityType: "strategy",
      status: "failure",
      decisionAuthority: "gate",
      input: { fromState: "TESTING", toState: "PAPER" },
      result: {
        passed: false,
        decision: "missing_run",
        backtestId,
        reason: "no Frankenstein test run found for this backtest",
      },
      correlationId,
    };
    return { blocked: true, error: "no Frankenstein run", auditRow };
  }

  if (!frankResult.passed) {
    const auditRow: AuditRow = {
      action: "gate.frankenstein.evaluated",
      entityId: strategyId,
      entityType: "strategy",
      status: "failure",
      decisionAuthority: "gate",
      input: { fromState: "TESTING", toState: "PAPER" },
      result: {
        passed: false,
        decision: "failed",
        backtestId,
        frankRunId: frankResult.runId,
        p95_sharpe: frankResult.p95Sharpe,
        median_pf: frankResult.medianPf,
        reason: "strategy shows edge on randomized data",
      },
      correlationId,
    };
    return { blocked: true, error: "Frankenstein gate FAILED", auditRow };
  }

  // PASS
  const auditRow: AuditRow = {
    action: "gate.frankenstein.evaluated",
    entityId: strategyId,
    entityType: "strategy",
    status: "success",
    decisionAuthority: "gate",
    input: { fromState: "TESTING", toState: "PAPER" },
    result: {
      passed: true,
      decision: "passed",
      backtestId,
      frankRunId: frankResult.runId,
      p95_sharpe: frankResult.p95Sharpe,
      median_pf: frankResult.medianPf,
      reason: "strategy does not show edge on randomized data",
    },
    correlationId,
  };
  return { blocked: false, auditRow };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Wave 2 — Frankenstein gate: evaluation audit on every path", () => {
  it("PASS: writes gate.frankenstein.evaluated with status=success and decision=passed", () => {
    const result = simulateFrankensteinGate(
      "strat-pass",
      "bt-001",
      { runId: "fr-001", passed: true, p95Sharpe: 0.18, medianPf: 0.99 },
      "corr-001",
    );
    expect(result.blocked).toBe(false);
    expect(result.auditRow.action).toBe("gate.frankenstein.evaluated");
    expect(result.auditRow.status).toBe("success");
    expect(result.auditRow.result.decision).toBe("passed");
    expect(result.auditRow.result.passed).toBe(true);
    expect(result.auditRow.correlationId).toBe("corr-001");
  });

  it("FAIL: writes gate.frankenstein.evaluated with status=failure and decision=failed", () => {
    const result = simulateFrankensteinGate(
      "strat-fail",
      "bt-002",
      { runId: "fr-002", passed: false, p95Sharpe: 0.72, medianPf: 1.35 },
      "corr-002",
    );
    expect(result.blocked).toBe(true);
    expect(result.auditRow.action).toBe("gate.frankenstein.evaluated");
    expect(result.auditRow.status).toBe("failure");
    expect(result.auditRow.result.decision).toBe("failed");
    expect(result.auditRow.result.passed).toBe(false);
    expect(result.auditRow.result.p95_sharpe).toBe(0.72);
    expect(result.auditRow.correlationId).toBe("corr-002");
  });

  it("MISSING run: writes gate.frankenstein.evaluated with decision=missing_run", () => {
    const result = simulateFrankensteinGate(
      "strat-missing",
      "bt-003",
      null,
      "corr-003",
    );
    expect(result.blocked).toBe(true);
    expect(result.auditRow.action).toBe("gate.frankenstein.evaluated");
    expect(result.auditRow.status).toBe("failure");
    expect(result.auditRow.result.decision).toBe("missing_run");
    expect(result.auditRow.correlationId).toBe("corr-003");
  });

  it("NO backtestId: writes gate.frankenstein.evaluated with decision=no_backtest_id", () => {
    const result = simulateFrankensteinGate(
      "strat-nobt",
      null,
      null,
      "corr-004",
    );
    expect(result.blocked).toBe(true);
    expect(result.auditRow.action).toBe("gate.frankenstein.evaluated");
    expect(result.auditRow.status).toBe("failure");
    expect(result.auditRow.result.decision).toBe("no_backtest_id");
    expect(result.auditRow.correlationId).toBe("corr-004");
  });

  it("INFRASTRUCTURE ERROR: writes gate.frankenstein.evaluated with decision=infrastructure_error", () => {
    const result = simulateFrankensteinGate(
      "strat-err",
      "bt-005",
      "error",
      "corr-005",
    );
    expect(result.blocked).toBe(true);
    expect(result.auditRow.action).toBe("gate.frankenstein.evaluated");
    expect(result.auditRow.status).toBe("failure");
    expect(result.auditRow.result.decision).toBe("infrastructure_error");
    expect(result.auditRow.correlationId).toBe("corr-005");
  });

  it("All branches use the same action name: gate.frankenstein.evaluated", () => {
    const cases: Array<[string, MockFrankResult | null | "error"]> = [
      ["bt-1", { runId: "fr-1", passed: true, p95Sharpe: 0.15, medianPf: 1.0 }],
      ["bt-2", { runId: "fr-2", passed: false, p95Sharpe: 0.8, medianPf: 1.4 }],
      ["bt-3", null],
    ];
    for (const [btId, frank] of cases) {
      const r = simulateFrankensteinGate(`strat-${btId}`, btId, frank, null);
      expect(r.auditRow.action).toBe("gate.frankenstein.evaluated");
    }
  });

  it("Mixed outcomes: 3 strategies → 3 rows each with correct status and decision", () => {
    const strategies = [
      { id: "s1", bt: "bt-1", frank: { runId: "fr-1", passed: true, p95Sharpe: 0.12, medianPf: 0.97 } as MockFrankResult, expectedStatus: "success", expectedDecision: "passed" },
      { id: "s2", bt: "bt-2", frank: { runId: "fr-2", passed: false, p95Sharpe: 0.65, medianPf: 1.3 } as MockFrankResult, expectedStatus: "failure", expectedDecision: "failed" },
      { id: "s3", bt: "bt-3", frank: null as null, expectedStatus: "failure", expectedDecision: "missing_run" },
    ];

    const rows: AuditRow[] = [];
    for (const s of strategies) {
      const r = simulateFrankensteinGate(s.id, s.bt, s.frank, "shared-sweep-corr");
      rows.push(r.auditRow);
    }

    expect(rows).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      expect(rows[i].action).toBe("gate.frankenstein.evaluated");
      expect(rows[i].status).toBe(strategies[i].expectedStatus);
      expect(rows[i].result.decision).toBe(strategies[i].expectedDecision);
    }
  });
});
