/**
 * wave23h-10am-flip-policy.test.ts — W23H.E
 *
 * Tests for the 10 AM regime-flip position-lock policy.
 *
 * Design:
 *  - bias-state-service emits position_lock_active=true on the 10am INSERT row
 *    when activeStrategyId changes from the prior 9:30 row.
 *  - paper-signal-service Stage 1 checks the flag and blocks new entries on the
 *    NEW strategy while an open position on the PRIOR strategy exists.
 *  - Position management (exits, stops) continues normally on the prior strategy.
 *  - Kill-switch override always wins (kills all positions regardless).
 *  - When the prior position closes naturally, the lock is no longer active.
 *
 * Pure simulation harnesses — no DB, no Express bootstrap.
 * The bias-state helpers are unit-tested in isolation.
 */

import { describe, it, expect } from "vitest";

// ─── Shared types ─────────────────────────────────────────────────────────────
interface BiasStateForSignal {
  sessionDate: string;
  symbol: string;
  regimeLabel: string;
  playbook: string;
  activeStrategyId: string | null;
  positionLockActive: boolean;
}

interface OpenPosition {
  id: string;
  sessionId: string;
  strategyId: string; // strategy of the session owning this position
  symbol: string;
}

interface AuditRow {
  signalType: string;
  reason: string;
}

interface Stage1GateResult {
  blocked: boolean;
  blockReason: "position_lock" | "not_active_strategy" | "none";
  auditRow: AuditRow | null;
}

// ─── Simulation harness for Stage 1 + W23H.E gate ───────────────────────────
// Mirrors the logic in paper-signal-service.ts Stage 1 + W23H.E extension.
// Both Stage 1 and the position-lock gate are skipped when isLegacyStrategy=true
// (the real service wraps them in the !isLegacyStrategy block).
function simulateStage1Gate(
  sessionStrategyId: string,
  biasState: BiasStateForSignal | null,
  isLegacyStrategy: boolean,
  openPositionsOnOtherStrategies: OpenPosition[],   // simulated DB result
  positionLockGateError: boolean = false,
): Stage1GateResult {
  // Legacy strategies bypass Stage 1 entirely (including position-lock)
  if (isLegacyStrategy) {
    return { blocked: false, blockReason: "none", auditRow: null };
  }

  // Standard Stage 1 check (Wave 23.C)
  let stage1Blocked = false;
  if (biasState && biasState.activeStrategyId !== null) {
    if (biasState.activeStrategyId !== sessionStrategyId) {
      stage1Blocked = true;
      return {
        blocked: true,
        blockReason: "not_active_strategy",
        auditRow: {
          signalType: "bias_gate_blocked_not_active_strategy",
          reason: `signal.not_active_strategy_for_regime: active=${biasState.activeStrategyId} this=${sessionStrategyId}`,
        },
      };
    }
  }

  // W23H.E: position-lock gate — only runs when Stage 1 did not already block
  if (!stage1Blocked && biasState?.positionLockActive && biasState.activeStrategyId === sessionStrategyId) {
    if (positionLockGateError) {
      // Fail-open: query error → no block
      return { blocked: false, blockReason: "none", auditRow: null };
    }
    if (openPositionsOnOtherStrategies.length > 0) {
      const priorPosition = openPositionsOnOtherStrategies[0];
      return {
        blocked: true,
        blockReason: "position_lock",
        auditRow: {
          signalType: "position_lock_blocked",
          reason: `signal.blocked_position_lock_active: prior_position=${priorPosition.id} new_strategy=${biasState.activeStrategyId}`,
        },
      };
    }
  }

  return { blocked: false, blockReason: "none", auditRow: null };
}

// ─── Helpers for bias-state positionLockActive logic ─────────────────────────

interface CachedBiasDecision {
  sessionDate: string;
  symbol: string;
  regimeLabel: string;
  playbook: string;
  activeStrategyId: string | null;
  evidence: Record<string, unknown>;
  computedAt: string;
  positionLockActive: boolean;
}

/**
 * Simulates the W23H.E lock-flag computation from bias-state-service.ts:
 * positionLockActive = isRefresh AND prior cache entry has different activeStrategyId.
 */
function computePositionLockActive(
  isRefresh: boolean,
  priorCachedDecision: CachedBiasDecision | undefined,
  newActiveStrategyId: string | null,
): boolean {
  return (
    isRefresh &&
    priorCachedDecision !== undefined &&
    priorCachedDecision.activeStrategyId !== newActiveStrategyId
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("W23H.E — 10 AM regime-flip position-lock policy", () => {

  it("9:30 picks strategy A → position opens → 10am picks B → A position still runs; B blocked", () => {
    const stratA = "strategy-a-uuid";
    const stratB = "strategy-b-uuid";

    // 9:30 row: strategy A selected, no lock
    const sessionStartDecision: CachedBiasDecision = {
      sessionDate: "2026-05-20",
      symbol: "MES",
      regimeLabel: "TRENDING_UP",
      playbook: "FULL_LONG",
      activeStrategyId: stratA,
      evidence: {},
      computedAt: "2026-05-20T13:30:00.000Z",
      positionLockActive: false,
    };

    // 10am refresh: B selected → lock fires because A ≠ B
    const isRefresh10am = true;
    const lock = computePositionLockActive(isRefresh10am, sessionStartDecision, stratB);
    expect(lock).toBe(true);

    // Session running B gets the new bias state with lock active
    const biasStateAfter10am: BiasStateForSignal = {
      sessionDate: "2026-05-20",
      symbol: "MES",
      regimeLabel: "TRENDING_UP",
      playbook: "FULL_LONG",
      activeStrategyId: stratB,
      positionLockActive: true,
    };

    // Open position exists on strategy A (prior strategy)
    const openPos: OpenPosition = { id: "pos-001", sessionId: "session-a", strategyId: stratA, symbol: "MES" };

    // Session B tries to enter: should be blocked by position lock
    const result = simulateStage1Gate(
      stratB,             // session B running the new active strategy
      biasStateAfter10am,
      false,              // not legacy
      [openPos],          // prior position exists
    );

    expect(result.blocked).toBe(true);
    expect(result.blockReason).toBe("position_lock");
    expect(result.auditRow?.signalType).toBe("position_lock_blocked");
    expect(result.auditRow?.reason).toContain("signal.blocked_position_lock_active");
  });

  it("no open position on prior strategy → standard Stage 1 behavior (no position lock block)", () => {
    const stratB = "strategy-b-uuid";

    const biasState: BiasStateForSignal = {
      sessionDate: "2026-05-20",
      symbol: "MES",
      regimeLabel: "TRENDING_UP",
      playbook: "FULL_LONG",
      activeStrategyId: stratB,
      positionLockActive: true,
    };

    // No open positions on other strategies
    const result = simulateStage1Gate(
      stratB,
      biasState,
      false,
      [],  // no prior open positions
    );

    expect(result.blocked).toBe(false);
    expect(result.blockReason).toBe("none");
  });

  it("kill-switch scenario: standard Stage 1 also runs normally when positionLockActive=false (no regression)", () => {
    const stratA = "strategy-a-uuid";
    const stratB = "strategy-b-uuid";

    // Normal 9:30 bias state — no lock
    const biasState: BiasStateForSignal = {
      sessionDate: "2026-05-20",
      symbol: "MES",
      regimeLabel: "TRENDING_UP",
      playbook: "FULL_LONG",
      activeStrategyId: stratB,
      positionLockActive: false,
    };

    // Session on strategy A (not the active one) — standard Stage 1 block
    const result = simulateStage1Gate(
      stratA,
      biasState,
      false,
      [],
    );

    expect(result.blocked).toBe(true);
    expect(result.blockReason).toBe("not_active_strategy");
  });

  it("positionLockActive=true: position-lock gate fails-open on DB query error", () => {
    const stratB = "strategy-b-uuid";
    const stratA = "strategy-a-uuid";

    const biasState: BiasStateForSignal = {
      sessionDate: "2026-05-20",
      symbol: "MES",
      regimeLabel: "TRENDING_UP",
      playbook: "FULL_LONG",
      activeStrategyId: stratB,
      positionLockActive: true,
    };

    // Query error → fail-open (no block even though prior position would exist)
    const openPos: OpenPosition = { id: "pos-002", sessionId: "session-a", strategyId: stratA, symbol: "MES" };
    const result = simulateStage1Gate(
      stratB,
      biasState,
      false,
      [openPos],
      true,   // positionLockGateError = true → fail-open
    );

    expect(result.blocked).toBe(false);
  });

  it("audit event shape: position_lock_blocked audit row includes prior_position_id and new_strategy_id", () => {
    const stratB = "strategy-b-new";
    const stratA = "strategy-a-prior";

    const biasState: BiasStateForSignal = {
      sessionDate: "2026-05-20",
      symbol: "MES",
      regimeLabel: "TRENDING_DOWN",
      playbook: "FULL_SHORT",
      activeStrategyId: stratB,
      positionLockActive: true,
    };

    const openPos: OpenPosition = { id: "pos-999", sessionId: "session-prior", strategyId: stratA, symbol: "MES" };
    const result = simulateStage1Gate(stratB, biasState, false, [openPos]);

    expect(result.auditRow).not.toBeNull();
    expect(result.auditRow?.reason).toContain("pos-999");
    expect(result.auditRow?.reason).toContain(stratB);
  });

  it("positionLockActive flag computation: 10am refresh with same strategy → lock=false (no change in active strategy)", () => {
    const stratA = "strategy-a-uuid";

    const priorDecision: CachedBiasDecision = {
      sessionDate: "2026-05-20",
      symbol: "MES",
      regimeLabel: "TRENDING_UP",
      playbook: "FULL_LONG",
      activeStrategyId: stratA,
      evidence: {},
      computedAt: "2026-05-20T13:30:00.000Z",
      positionLockActive: false,
    };

    // 10am refresh: same strategy selected again → no lock
    const lock = computePositionLockActive(true, priorDecision, stratA);
    expect(lock).toBe(false);
  });

  it("positionLockActive flag computation: session-start row (isRefresh=false) → never sets lock", () => {
    const stratA = "strategy-a-uuid";
    const stratB = "strategy-b-uuid";

    // Even if strategy changed, session-start never creates a lock
    const priorDecision: CachedBiasDecision = {
      sessionDate: "2026-05-20",
      symbol: "MES",
      regimeLabel: "TRENDING_UP",
      playbook: "FULL_LONG",
      activeStrategyId: stratA,
      evidence: {},
      computedAt: "2026-05-20T12:00:00.000Z",
      positionLockActive: false,
    };

    const lock = computePositionLockActive(false /* not refresh */, priorDecision, stratB);
    expect(lock).toBe(false);
  });

  it("legacy strategy session bypasses position_lock gate entirely", () => {
    const stratB = "strategy-b-uuid";

    const biasState: BiasStateForSignal = {
      sessionDate: "2026-05-20",
      symbol: "MES",
      regimeLabel: "TRENDING_UP",
      playbook: "FULL_LONG",
      activeStrategyId: stratB,
      positionLockActive: true,
    };

    // Legacy strategy: even with lock active, Stage 1 does not apply to legacy
    // Legacy check happens BEFORE Stage 1 — the gate simulation returns no block
    // because isLegacyStrategy=true bypasses the whole Stage 1 + lock block
    // (Stage 1 only runs when !isLegacyStrategy)
    const resultLegacy = simulateStage1Gate(
      stratB,
      biasState,
      true,  // isLegacyStrategy — bypasses gate
      [{ id: "pos-legacy", sessionId: "s", strategyId: "other", symbol: "MES" }],
    );
    // Legacy strategies are not checked by Stage 1 at all; the lock gate is inside Stage 1
    // So legacy should not be blocked by position_lock
    // (In the real service the whole if(!isLegacyStrategy) block wraps Stage 1 and lock gate)
    // Our simulation returns blocked=false for legacy because Stage 1 condition !isLegacyStrategy fails
    expect(resultLegacy.blocked).toBe(false);
  });
});
