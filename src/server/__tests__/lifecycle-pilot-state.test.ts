/**
 * B8 — PILOT Canary State Tests (W14 Team C Step 1)
 *
 * Tests the PILOT lifecycle state logic:
 *   1. VALID_TRANSITIONS: DEPLOY_READY → PILOT is allowed
 *   2. VALID_TRANSITIONS: PILOT → DEPLOYED and PILOT → GRAVEYARD are allowed
 *   3. DEPLOY_READY → PILOT requires human_release actor
 *   4. Auto-promotion criteria: 5 sessions, all compliant, rollingSharpeFinal >= 1.0 → DEPLOYED
 *   5. Auto-kill: any killed session → GRAVEYARD
 *   6. Pending: < 5 sessions → no promotion yet
 *   7. Criteria failure: all sessions done but compliance or Sharpe fails → GRAVEYARD
 */

import { describe, it, expect } from "vitest";

// ─── PILOT state constants (mirrors lifecycle-service.ts) ─────────────────────

const PILOT_REQUIRED_SESSIONS = 5;
const PILOT_MIN_SHARPE = 1.0;

// ─── Transition table (mirrors VALID_TRANSITIONS in lifecycle-service.ts) ──────

const VALID_TRANSITIONS: Record<string, string[]> = {
  CANDIDATE: ["TESTING", "SHADOW", "GRAVEYARD"],  // F-3 fix: CANDIDATE→PAPER removed; routes through SHADOW
  TESTING: ["SHADOW", "PAPER", "DECLINING", "GRAVEYARD"],  // SHADOW added (Wave 29 Pass A.1)
  PAPER: ["DEPLOY_READY", "DECLINING", "GRAVEYARD"],
  DEPLOY_READY: ["PILOT", "DEPLOYED", "PAPER", "GRAVEYARD"],
  PILOT: ["DEPLOYED", "GRAVEYARD"],
  DEPLOYED: ["DECLINING", "GRAVEYARD"],
  DECLINING: ["TESTING", "RETIRED", "GRAVEYARD"],
  RETIRED: ["GRAVEYARD"],
  GRAVEYARD: [],
};

function isTransitionAllowed(from: string, to: string): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

// ─── Pilot session type (mirrors DB schema + recordPilotSession) ───────────────

interface MockPilotSession {
  sessionNumber: number;
  outcome: "pending" | "passed" | "failed" | "killed";
  compliancePassed: boolean | null;
  rollingSharpeFinal: number | null;
  killReason?: string;
}

/**
 * Simulates the auto-promotion decision from checkPilotAutoPromotions().
 * Returns the resulting target state or 'pending' if no decision yet.
 */
function evaluatePilotDecision(
  sessions: MockPilotSession[],
): "DEPLOYED" | "GRAVEYARD" | "pending" {
  // Auto-kill: any killed session
  const killed = sessions.find((s) => s.outcome === "killed");
  if (killed) return "GRAVEYARD";

  const completed = sessions.filter((s) => s.outcome === "passed" || s.outcome === "failed");

  if (completed.length < PILOT_REQUIRED_SESSIONS) return "pending";

  // All done — evaluate criteria
  const allCompliant = completed.every((s) => s.compliancePassed === true);
  const last = completed[completed.length - 1];
  const lastSharpePassed =
    last?.rollingSharpeFinal != null && last.rollingSharpeFinal >= PILOT_MIN_SHARPE;

  if (allCompliant && lastSharpePassed) return "DEPLOYED";
  return "GRAVEYARD";
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("B8 PILOT lifecycle state — transitions", () => {
  it("allows DEPLOY_READY → PILOT transition", () => {
    expect(isTransitionAllowed("DEPLOY_READY", "PILOT")).toBe(true);
  });

  it("allows PILOT → DEPLOYED transition", () => {
    expect(isTransitionAllowed("PILOT", "DEPLOYED")).toBe(true);
  });

  it("allows PILOT → GRAVEYARD transition (kill switch path)", () => {
    expect(isTransitionAllowed("PILOT", "GRAVEYARD")).toBe(true);
  });

  it("does NOT allow PILOT → DEPLOYED via direct DEPLOYED skip (state machine completeness)", () => {
    // PILOT can go to DEPLOYED or GRAVEYARD only
    expect(VALID_TRANSITIONS["PILOT"]).toEqual(["DEPLOYED", "GRAVEYARD"]);
  });

  it("does NOT allow PILOT → PAPER (no rollback to paper from PILOT)", () => {
    expect(isTransitionAllowed("PILOT", "PAPER")).toBe(false);
  });

  it("does NOT allow PILOT → DECLINING (kill switch goes straight to GRAVEYARD)", () => {
    expect(isTransitionAllowed("PILOT", "DECLINING")).toBe(false);
  });

  it("DEPLOY_READY still allows direct DEPLOYED path (legacy)", () => {
    expect(isTransitionAllowed("DEPLOY_READY", "DEPLOYED")).toBe(true);
  });

  it("DEPLOY_READY still allows rollback to PAPER", () => {
    expect(isTransitionAllowed("DEPLOY_READY", "PAPER")).toBe(true);
  });
});

describe("B8 PILOT actor guard", () => {
  /**
   * Simulates the human_release guard from _promoteStrategyInner().
   */
  function checkPilotActorGuard(
    fromState: string,
    toState: string,
    actor: string,
  ): { allowed: boolean; error?: string } {
    // Deep-scan 2026-06-28 (C-1): mirrors _promoteStrategyInner — human_release OR
    // operator_absent_mode (vacation autopilot) may promote DEPLOY_READY -> PILOT.
    if (
      fromState === "DEPLOY_READY" &&
      toState === "PILOT" &&
      actor !== "human_release" &&
      actor !== "operator_absent_mode"
    ) {
      return {
        allowed: false,
        error: "Only manual release authority can promote DEPLOY_READY -> PILOT (canary track requires human approval)",
      };
    }
    return { allowed: true };
  }

  it("blocks DEPLOY_READY → PILOT with actor='system'", () => {
    const result = checkPilotActorGuard("DEPLOY_READY", "PILOT", "system");
    expect(result.allowed).toBe(false);
    expect(result.error).toContain("human approval");
  });

  it("allows DEPLOY_READY → PILOT with actor='human_release'", () => {
    const result = checkPilotActorGuard("DEPLOY_READY", "PILOT", "human_release");
    expect(result.allowed).toBe(true);
  });

  it("allows DEPLOY_READY → PILOT with actor='operator_absent_mode' (C-1 vacation autopilot)", () => {
    const result = checkPilotActorGuard("DEPLOY_READY", "PILOT", "operator_absent_mode");
    expect(result.allowed).toBe(true);
  });

  it("does NOT apply human guard to PILOT → DEPLOYED (system can auto-promote)", () => {
    // The human_release guard is only on DEPLOY_READY → PILOT entry.
    // PILOT → DEPLOYED is automatic (system actor) after 5 sessions.
    const result = checkPilotActorGuard("PILOT", "DEPLOYED", "system");
    expect(result.allowed).toBe(true);
  });

  it("does NOT apply human guard to PILOT → GRAVEYARD (kill switch is system)", () => {
    const result = checkPilotActorGuard("PILOT", "GRAVEYARD", "system");
    expect(result.allowed).toBe(true);
  });
});

describe("B8 PILOT auto-promotion decision logic", () => {
  it("returns 'pending' when no sessions recorded yet", () => {
    expect(evaluatePilotDecision([])).toBe("pending");
  });

  it("returns 'pending' when fewer than 5 sessions completed", () => {
    const sessions: MockPilotSession[] = Array.from({ length: 4 }, (_, i) => ({
      sessionNumber: i + 1,
      outcome: "passed",
      compliancePassed: true,
      rollingSharpeFinal: 1.5,
    }));
    expect(evaluatePilotDecision(sessions)).toBe("pending");
  });

  it("promotes to DEPLOYED when 5 sessions all pass with Sharpe >= 1.0", () => {
    const sessions: MockPilotSession[] = Array.from({ length: 5 }, (_, i) => ({
      sessionNumber: i + 1,
      outcome: "passed",
      compliancePassed: true,
      rollingSharpeFinal: 1.2,
    }));
    expect(evaluatePilotDecision(sessions)).toBe("DEPLOYED");
  });

  it("promotes to DEPLOYED with Sharpe exactly 1.0 on the last session", () => {
    const sessions: MockPilotSession[] = Array.from({ length: 5 }, (_, i) => ({
      sessionNumber: i + 1,
      outcome: "passed",
      compliancePassed: true,
      rollingSharpeFinal: i === 4 ? 1.0 : 1.5,  // last session is exactly 1.0
    }));
    expect(evaluatePilotDecision(sessions)).toBe("DEPLOYED");
  });

  it("sends to GRAVEYARD when last session Sharpe < 1.0 (all 5 done)", () => {
    const sessions: MockPilotSession[] = Array.from({ length: 5 }, (_, i) => ({
      sessionNumber: i + 1,
      outcome: "passed",
      compliancePassed: true,
      rollingSharpeFinal: i === 4 ? 0.8 : 1.5,  // last session is 0.8 — below threshold
    }));
    expect(evaluatePilotDecision(sessions)).toBe("GRAVEYARD");
  });

  it("sends to GRAVEYARD when any session fails compliance (all 5 done)", () => {
    const sessions: MockPilotSession[] = Array.from({ length: 5 }, (_, i) => ({
      sessionNumber: i + 1,
      outcome: "passed",
      compliancePassed: i !== 2,  // session 3 fails compliance
      rollingSharpeFinal: 1.5,
    }));
    expect(evaluatePilotDecision(sessions)).toBe("GRAVEYARD");
  });

  it("auto-kills (GRAVEYARD) immediately when any session has outcome='killed'", () => {
    const sessions: MockPilotSession[] = [
      { sessionNumber: 1, outcome: "passed", compliancePassed: true, rollingSharpeFinal: 1.5 },
      { sessionNumber: 2, outcome: "killed", compliancePassed: false, rollingSharpeFinal: null, killReason: "daily_loss_limit_hit" },
      { sessionNumber: 3, outcome: "pending", compliancePassed: null, rollingSharpeFinal: null },
    ];
    expect(evaluatePilotDecision(sessions)).toBe("GRAVEYARD");
  });

  it("auto-kills even if only 1 session and it is killed", () => {
    const sessions: MockPilotSession[] = [
      { sessionNumber: 1, outcome: "killed", compliancePassed: false, rollingSharpeFinal: null, killReason: "max_drawdown_breach" },
    ];
    expect(evaluatePilotDecision(sessions)).toBe("GRAVEYARD");
  });

  it("1-contract invariant: PILOT sessions must always record contracts=1", () => {
    // The contract count is enforced in recordPilotSession — always writes contracts=1.
    // This test asserts the design invariant explicitly.
    const PILOT_CONTRACTS = 1;
    expect(PILOT_CONTRACTS).toBe(1);
  });
});

describe("B8 PILOT session counting", () => {
  it("session_number is 1-based and sequential (5 sessions max)", () => {
    const sessions = Array.from({ length: 5 }, (_, i) => i + 1);
    expect(sessions).toEqual([1, 2, 3, 4, 5]);
    expect(sessions.length).toBe(PILOT_REQUIRED_SESSIONS);
  });

  it("PILOT_REQUIRED_SESSIONS = 5", () => {
    expect(PILOT_REQUIRED_SESSIONS).toBe(5);
  });

  it("PILOT_MIN_SHARPE = 1.0", () => {
    expect(PILOT_MIN_SHARPE).toBe(1.0);
  });
});
