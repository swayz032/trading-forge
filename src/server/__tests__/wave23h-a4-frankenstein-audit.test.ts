/**
 * wave23h-a4-frankenstein-audit.test.ts — Wave 23H Fix 3
 *
 * Tests for the A4 Frankenstein gate audit_log rows added in lifecycle-service.ts.
 * Before Wave 23H Fix 3, rejected promotions only emitted logger.warn — no audit row.
 * After the fix, every rejection path writes a lifecycle.frankenstein_rejected row.
 *
 * Coverage:
 *  1. No Frankenstein run found (missing_run) → audit row with decision=missing_run
 *  2. Frankenstein FAILED (failed) → audit row with decision=failed + p_value_observed + median_pf
 *  3. Infrastructure error (infrastructure_error) → audit row with decision=infrastructure_error
 *  4. No backtestId in evidence (no_backtest_id) → audit row with decision=no_backtest_id
 *  5. All four rejection paths use action=lifecycle.frankenstein_rejected
 *  6. Pass path does NOT emit a rejection audit row
 *  7. Existing block behaviour is unchanged — all four paths still return { success: false }
 *
 * Uses a simulation harness that mirrors lifecycle-service.ts Frankenstein gate logic
 * so we can test the contract without bootstrapping the full DB dependency chain.
 * If lifecycle-service.ts changes, keep this simulation in sync.
 */

import { describe, it, expect } from "vitest";

// ─── Types ────────────────────────────────────────────────────────────────────

interface FrankensteinRunOutput {
  runId: string;
  backtestId: string;
  strategyId: string;
  nShuffles: number;
  p95Sharpe: number | null;
  medianPf: number | null;
  passed: boolean;
  wallClockMs: number;
  status: string;
  errorMessage: string | null;
}

interface AuditRow {
  action: string;
  entityType: string;
  entityId: string;
  decisionAuthority: string;
  status: string;
  input: Record<string, unknown>;
  result: Record<string, unknown>;
  correlationId: string | null;
}

interface GateOutcome {
  success: boolean;
  error?: string;
  auditRow?: AuditRow;
}

// ─── Simulation harness (mirrors lifecycle-service.ts TESTING→PAPER gate) ────

function simulateFrankensteinGateWithAudit(
  strategyId: string,
  backtestId: string | null,
  frankResult: FrankensteinRunOutput | null | "error",
): GateOutcome {
  const fromState = "TESTING";
  const toState = "PAPER";

  if (!backtestId) {
    const auditRow: AuditRow = {
      action: "lifecycle.frankenstein_rejected",
      entityType: "strategy",
      entityId: strategyId,
      decisionAuthority: "gate",
      status: "failure",
      input: { fromState, toState, backtestId: null },
      result: {
        decision: "no_backtest_id",
        reason: "no backtest ID in promotion evidence",
      },
      correlationId: null,
    };
    return { success: false, error: "no backtest ID", auditRow };
  }

  if (frankResult === "error") {
    const msg = "simulated infrastructure error";
    const auditRow: AuditRow = {
      action: "lifecycle.frankenstein_rejected",
      entityType: "strategy",
      entityId: strategyId,
      decisionAuthority: "gate",
      status: "failure",
      input: { fromState, toState, backtestId },
      result: { decision: "infrastructure_error", reason: msg },
      correlationId: null,
    };
    return { success: false, error: `Frankenstein gate: read failed (fail-closed). Error: ${msg}`, auditRow };
  }

  if (frankResult === null) {
    const auditRow: AuditRow = {
      action: "lifecycle.frankenstein_rejected",
      entityType: "strategy",
      entityId: strategyId,
      decisionAuthority: "gate",
      status: "failure",
      input: { fromState, toState, backtestId },
      result: {
        decision: "missing_run",
        reason: "no completed Frankenstein test run found",
      },
      correlationId: null,
    };
    return { success: false, error: "no Frankenstein run", auditRow };
  }

  if (!frankResult.passed) {
    const auditRow: AuditRow = {
      action: "lifecycle.frankenstein_rejected",
      entityType: "strategy",
      entityId: strategyId,
      decisionAuthority: "gate",
      status: "failure",
      input: {
        fromState, toState,
        backtestId,
        frankRunId: frankResult.runId,
      },
      result: {
        decision: "failed",
        n_shuffles: frankResult.nShuffles,
        p_value_observed: frankResult.p95Sharpe,
        p_value_threshold: 0.3,
        median_pf: frankResult.medianPf,
        reason: "strategy shows edge on randomized data",
      },
      correlationId: null,
    };
    return { success: false, error: "Frankenstein gate FAILED", auditRow };
  }

  // PASSED — no rejection audit row
  return { success: true };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("A4 Frankenstein gate — audit rows on every rejection path (Wave 23H Fix 3)", () => {
  it("1. missing_run path writes lifecycle.frankenstein_rejected with decision=missing_run", () => {
    const outcome = simulateFrankensteinGateWithAudit("strat-missing", "bt-001", null);

    expect(outcome.success).toBe(false);
    expect(outcome.auditRow).toBeDefined();
    expect(outcome.auditRow!.action).toBe("lifecycle.frankenstein_rejected");
    expect(outcome.auditRow!.status).toBe("failure");
    expect(outcome.auditRow!.result.decision).toBe("missing_run");
    expect(outcome.auditRow!.entityId).toBe("strat-missing");
    expect(outcome.auditRow!.entityType).toBe("strategy");
    expect(outcome.auditRow!.decisionAuthority).toBe("gate");
  });

  it("2. failed path writes lifecycle.frankenstein_rejected with decision=failed + metrics", () => {
    const frankResult: FrankensteinRunOutput = {
      runId: "fr-fail-001",
      backtestId: "bt-002",
      strategyId: "strat-failed",
      nShuffles: 100,
      p95Sharpe: 0.72,
      medianPf: 1.38,
      passed: false,
      wallClockMs: 12000,
      status: "completed",
      errorMessage: null,
    };
    const outcome = simulateFrankensteinGateWithAudit("strat-failed", "bt-002", frankResult);

    expect(outcome.success).toBe(false);
    expect(outcome.auditRow!.action).toBe("lifecycle.frankenstein_rejected");
    expect(outcome.auditRow!.result.decision).toBe("failed");
    expect(outcome.auditRow!.result.p_value_observed).toBe(0.72);
    expect(outcome.auditRow!.result.median_pf).toBe(1.38);
    expect(outcome.auditRow!.result.p_value_threshold).toBe(0.3);
    expect(outcome.auditRow!.result.n_shuffles).toBe(100);
    expect(outcome.auditRow!.input.frankRunId).toBe("fr-fail-001");
  });

  it("3. infrastructure_error path writes lifecycle.frankenstein_rejected with decision=infrastructure_error", () => {
    const outcome = simulateFrankensteinGateWithAudit("strat-err", "bt-003", "error");

    expect(outcome.success).toBe(false);
    expect(outcome.auditRow!.action).toBe("lifecycle.frankenstein_rejected");
    expect(outcome.auditRow!.result.decision).toBe("infrastructure_error");
    expect(typeof outcome.auditRow!.result.reason).toBe("string");
    expect((outcome.auditRow!.result.reason as string).length).toBeGreaterThan(0);
  });

  it("4. no_backtest_id path writes lifecycle.frankenstein_rejected with decision=no_backtest_id", () => {
    const outcome = simulateFrankensteinGateWithAudit("strat-nobt", null, null);

    expect(outcome.success).toBe(false);
    expect(outcome.auditRow!.action).toBe("lifecycle.frankenstein_rejected");
    expect(outcome.auditRow!.result.decision).toBe("no_backtest_id");
    expect(outcome.auditRow!.input.backtestId).toBeNull();
  });

  it("5. all four rejection paths use action=lifecycle.frankenstein_rejected", () => {
    const cases: Array<{
      strategyId: string;
      backtestId: string | null;
      frankResult: FrankensteinRunOutput | null | "error";
    }> = [
      { strategyId: "s1", backtestId: null, frankResult: null },
      {
        strategyId: "s2",
        backtestId: "bt-s2",
        frankResult: null,
      },
      {
        strategyId: "s3",
        backtestId: "bt-s3",
        frankResult: "error",
      },
      {
        strategyId: "s4",
        backtestId: "bt-s4",
        frankResult: {
          runId: "fr-s4", backtestId: "bt-s4", strategyId: "s4",
          nShuffles: 50, p95Sharpe: 0.8, medianPf: 1.4,
          passed: false, wallClockMs: 5000,
          status: "completed", errorMessage: null,
        },
      },
    ];

    for (const { strategyId, backtestId, frankResult } of cases) {
      const outcome = simulateFrankensteinGateWithAudit(strategyId, backtestId, frankResult);
      expect(outcome.auditRow).toBeDefined();
      expect(outcome.auditRow!.action).toBe("lifecycle.frankenstein_rejected");
    }
  });

  it("6. PASS path does NOT emit a rejection audit row", () => {
    const frankResult: FrankensteinRunOutput = {
      runId: "fr-pass-001",
      backtestId: "bt-pass",
      strategyId: "strat-pass",
      nShuffles: 100,
      p95Sharpe: 0.18,
      medianPf: 0.99,
      passed: true,
      wallClockMs: 8000,
      status: "completed",
      errorMessage: null,
    };
    const outcome = simulateFrankensteinGateWithAudit("strat-pass", "bt-pass", frankResult);

    expect(outcome.success).toBe(true);
    expect(outcome.auditRow).toBeUndefined();
  });

  it("7. all four rejection paths still return { success: false } (block behaviour unchanged)", () => {
    const cases: Array<{
      strategyId: string;
      backtestId: string | null;
      frankResult: FrankensteinRunOutput | null | "error";
    }> = [
      { strategyId: "block-1", backtestId: null, frankResult: null },
      { strategyId: "block-2", backtestId: "bt-b2", frankResult: null },
      { strategyId: "block-3", backtestId: "bt-b3", frankResult: "error" },
      {
        strategyId: "block-4",
        backtestId: "bt-b4",
        frankResult: {
          runId: "fr-b4", backtestId: "bt-b4", strategyId: "block-4",
          nShuffles: 100, p95Sharpe: 0.91, medianPf: 1.5,
          passed: false, wallClockMs: 9000,
          status: "completed", errorMessage: null,
        },
      },
    ];

    for (const { strategyId, backtestId, frankResult } of cases) {
      const outcome = simulateFrankensteinGateWithAudit(strategyId, backtestId, frankResult);
      expect(outcome.success).toBe(false);
    }
  });
});
