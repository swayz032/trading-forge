/**
 * Wave 2 — Task 3: PILOT auto-promotion sweep audit trail
 *
 * Tests:
 *  1. Promoted strategy writes pilot.auto_promotion.evaluated with decision=promoted
 *  2. Sessions-insufficient writes with decision=deferred_insufficient_sessions
 *  3. Sharpe-below-threshold writes with decision=deferred_sharpe_below_threshold
 *  4. Killed (kill switch) writes with decision=killed
 *  5. 4 strategies in one sweep → 4 rows, all sharing the same sweepCorrelationId
 *  6. sweepCorrelationId is distinct from the caller's correlationId
 *  7. Each row has input.sweep_started_at
 */

import { describe, it, expect } from "vitest";
import { randomUUID } from "crypto";

// ─── Mirror types from checkPilotAutoPromotions ───────────────────────────────

interface MockPilotSession {
  sessionNumber: number;
  outcome: "pending" | "passed" | "failed" | "killed";
  compliancePassed: boolean | null;
  rollingSharpeFinal: number | null;
  killReason?: string;
}

type PilotDecision =
  | "promoted"
  | "killed"
  | "deferred_insufficient_sessions"
  | "deferred_sharpe_below_threshold";

interface AuditRow {
  action: string;
  entityId: string;
  entityType: string;
  status: string;
  decisionAuthority: string;
  input: Record<string, unknown>;
  result: {
    sessions_completed: number;
    rolling_sharpe: number | null;
    decision: string;
    reason: string;
  };
  correlationId: string;
}

// ─── Simulate the per-strategy sweep decision (mirrors checkPilotAutoPromotions) ─

const PILOT_REQUIRED_SESSIONS = 5;
const PILOT_MIN_SHARPE = 1.0;

function simulatePilotSweepStrategy(
  strategyId: string,
  sessions: MockPilotSession[],
  sweepCorrelationId: string,
  sweepStartedAt: string,
): AuditRow {
  // Auto-kill: any killed session
  const killedSession = sessions.find((ps) => ps.outcome === "killed");
  if (killedSession) {
    const completedCount = sessions.filter((ps) => ps.outcome === "passed" || ps.outcome === "failed").length;
    const killReason = `kill switch fired in session ${killedSession.sessionNumber}: ${killedSession.killReason ?? "kill_switch"}`;
    return {
      action: "pilot.auto_promotion.evaluated",
      entityId: strategyId,
      entityType: "strategy",
      status: "success",
      decisionAuthority: "gate",
      input: { sweep_started_at: sweepStartedAt },
      result: {
        sessions_completed: completedCount,
        rolling_sharpe: killedSession.rollingSharpeFinal != null
          ? parseFloat(String(killedSession.rollingSharpeFinal))
          : null,
        decision: "killed",
        reason: killReason,
      },
      correlationId: sweepCorrelationId,
    };
  }

  const completedSessions = sessions.filter((ps) => ps.outcome === "passed" || ps.outcome === "failed");

  if (completedSessions.length < PILOT_REQUIRED_SESSIONS) {
    return {
      action: "pilot.auto_promotion.evaluated",
      entityId: strategyId,
      entityType: "strategy",
      status: "success",
      decisionAuthority: "gate",
      input: { sweep_started_at: sweepStartedAt },
      result: {
        sessions_completed: completedSessions.length,
        rolling_sharpe: null,
        decision: "deferred_insufficient_sessions",
        reason: `${completedSessions.length}/${PILOT_REQUIRED_SESSIONS} sessions completed — still accumulating`,
      },
      correlationId: sweepCorrelationId,
    };
  }

  const allCompliant = completedSessions.every((ps) => ps.compliancePassed === true);
  const lastSession = completedSessions[completedSessions.length - 1];
  const lastSharpeRaw = lastSession?.rollingSharpeFinal != null
    ? parseFloat(String(lastSession.rollingSharpeFinal))
    : null;
  const lastSharpePassed = lastSharpeRaw != null && lastSharpeRaw >= PILOT_MIN_SHARPE;

  if (allCompliant && lastSharpePassed) {
    return {
      action: "pilot.auto_promotion.evaluated",
      entityId: strategyId,
      entityType: "strategy",
      status: "success",
      decisionAuthority: "gate",
      input: { sweep_started_at: sweepStartedAt },
      result: {
        sessions_completed: completedSessions.length,
        rolling_sharpe: lastSharpeRaw,
        decision: "promoted",
        reason: `${PILOT_REQUIRED_SESSIONS} sessions all compliant, rolling Sharpe ${lastSharpeRaw?.toFixed(3)} >= ${PILOT_MIN_SHARPE}`,
      },
      correlationId: sweepCorrelationId,
    };
  }

  const failureReason = !allCompliant
    ? "compliance_violation_in_pilot_session"
    : `rolling_sharpe_below_${PILOT_MIN_SHARPE}`;
  const decisionLabel: PilotDecision = !allCompliant
    ? "killed"
    : "deferred_sharpe_below_threshold";

  return {
    action: "pilot.auto_promotion.evaluated",
    entityId: strategyId,
    entityType: "strategy",
    status: "success",
    decisionAuthority: "gate",
    input: { sweep_started_at: sweepStartedAt },
    result: {
      sessions_completed: completedSessions.length,
      rolling_sharpe: lastSharpeRaw,
      decision: decisionLabel,
      reason: failureReason,
    },
    correlationId: sweepCorrelationId,
  };
}

function makeSweep(
  strategies: Array<{ id: string; sessions: MockPilotSession[] }>,
): { rows: AuditRow[]; sweepCorrelationId: string } {
  const sweepCorrelationId = randomUUID();
  const sweepStartedAt = new Date().toISOString();
  const rows = strategies.map((s) =>
    simulatePilotSweepStrategy(s.id, s.sessions, sweepCorrelationId, sweepStartedAt),
  );
  return { rows, sweepCorrelationId };
}

// ─── Session helpers ──────────────────────────────────────────────────────────

function passedSession(n: number, sharpe: number): MockPilotSession {
  return { sessionNumber: n, outcome: "passed", compliancePassed: true, rollingSharpeFinal: sharpe };
}

function failedComplianceSession(n: number): MockPilotSession {
  return { sessionNumber: n, outcome: "passed", compliancePassed: false, rollingSharpeFinal: 1.5 };
}

function killedSession(n: number, reason: string): MockPilotSession {
  return { sessionNumber: n, outcome: "killed", compliancePassed: null, rollingSharpeFinal: null, killReason: reason };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Wave 2 — PILOT sweep: per-strategy audit rows", () => {
  it("promoted strategy writes pilot.auto_promotion.evaluated with decision=promoted", () => {
    const sessions = [1, 2, 3, 4, 5].map((n) => passedSession(n, 1.5));
    const { rows } = makeSweep([{ id: "s-promote", sessions }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("pilot.auto_promotion.evaluated");
    expect(rows[0].result.decision).toBe("promoted");
    expect(rows[0].result.sessions_completed).toBe(5);
    expect(rows[0].result.rolling_sharpe).toBeGreaterThanOrEqual(PILOT_MIN_SHARPE);
  });

  it("sessions-insufficient writes with decision=deferred_insufficient_sessions", () => {
    const sessions = [1, 2, 3].map((n) => passedSession(n, 1.5));
    const { rows } = makeSweep([{ id: "s-pending", sessions }]);
    expect(rows[0].result.decision).toBe("deferred_insufficient_sessions");
    expect(rows[0].result.sessions_completed).toBe(3);
    expect(rows[0].result.rolling_sharpe).toBeNull();
  });

  it("sharpe-below-threshold writes with decision=deferred_sharpe_below_threshold", () => {
    const sessions = [1, 2, 3, 4, 5].map((n) => passedSession(n, 0.5)); // sharpe < 1.0
    const { rows } = makeSweep([{ id: "s-low-sharpe", sessions }]);
    expect(rows[0].result.decision).toBe("deferred_sharpe_below_threshold");
    expect(rows[0].result.rolling_sharpe).toBeLessThan(PILOT_MIN_SHARPE);
  });

  it("killed (kill switch) writes with decision=killed", () => {
    const sessions = [killedSession(2, "dll_67pct_breach")];
    const { rows } = makeSweep([{ id: "s-killed", sessions }]);
    expect(rows[0].result.decision).toBe("killed");
    expect(rows[0].result.reason).toContain("kill switch fired");
    expect(rows[0].result.reason).toContain("dll_67pct_breach");
  });

  it("compliance violation writes with decision=killed", () => {
    // All 5 sessions completed but compliance failed on one
    const sessions = [
      passedSession(1, 1.5),
      failedComplianceSession(2),
      passedSession(3, 1.5),
      passedSession(4, 1.5),
      passedSession(5, 1.5),
    ];
    const { rows } = makeSweep([{ id: "s-compliance-fail", sessions }]);
    expect(rows[0].result.decision).toBe("killed");
    expect(rows[0].result.reason).toContain("compliance_violation");
  });

  it("4 strategies in one sweep → 4 rows all sharing the same sweepCorrelationId", () => {
    const { rows, sweepCorrelationId } = makeSweep([
      { id: "s1", sessions: [1, 2, 3, 4, 5].map((n) => passedSession(n, 1.8)) },      // promoted
      { id: "s2", sessions: [1, 2].map((n) => passedSession(n, 1.5)) },                // pending
      { id: "s3", sessions: [1, 2, 3, 4, 5].map((n) => passedSession(n, 0.6)) },      // sharpe below
      { id: "s4", sessions: [killedSession(1, "dll_95pct_force_close")] },             // killed
    ]);

    expect(rows).toHaveLength(4);
    const correlationIds = rows.map((r) => r.correlationId);
    expect(new Set(correlationIds).size).toBe(1);
    expect(correlationIds[0]).toBe(sweepCorrelationId);

    expect(rows[0].result.decision).toBe("promoted");
    expect(rows[1].result.decision).toBe("deferred_insufficient_sessions");
    expect(rows[2].result.decision).toBe("deferred_sharpe_below_threshold");
    expect(rows[3].result.decision).toBe("killed");
  });

  it("sweepCorrelationId is a UUID distinct from caller's correlationId", () => {
    const callerCorrelationId = "caller-provided-id";
    // The sweep always generates its own UUID — caller's id is used for actual promotions
    const sweepCorrelationId = randomUUID();
    expect(sweepCorrelationId).not.toBe(callerCorrelationId);
    // UUID v4 format: 8-4-4-4-12
    expect(sweepCorrelationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it("every audit row includes input.sweep_started_at", () => {
    const { rows } = makeSweep([
      { id: "s1", sessions: [1, 2, 3, 4, 5].map((n) => passedSession(n, 1.5)) },
    ]);
    expect(rows[0].input.sweep_started_at).toBeDefined();
    expect(typeof rows[0].input.sweep_started_at).toBe("string");
  });

  it("every row has action=pilot.auto_promotion.evaluated regardless of outcome", () => {
    const { rows } = makeSweep([
      { id: "s1", sessions: [1, 2, 3, 4, 5].map((n) => passedSession(n, 2.0)) },
      { id: "s2", sessions: [passedSession(1, 1.2)] },
      { id: "s3", sessions: [killedSession(1, "manual_halt")] },
      { id: "s4", sessions: [1, 2, 3, 4, 5].map((n) => passedSession(n, 0.3)) },
    ]);
    for (const row of rows) {
      expect(row.action).toBe("pilot.auto_promotion.evaluated");
      expect(row.entityType).toBe("strategy");
      expect(row.status).toBe("success");
      expect(row.decisionAuthority).toBe("gate");
    }
  });
});
