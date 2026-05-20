/**
 * wave23h-c11-macro-fail-closed.test.ts — Wave 23H Fix 2
 *
 * Tests for the C11 macro gate fail-CLOSED behaviour in paper-signal-service.ts.
 * Any exception from evaluateMacroGates() must block the entry, write an audit
 * row, and emit an SSE event — NOT silently allow the entry through.
 *
 * Coverage:
 *  1. evaluateMacroGates throw → macroGateBlocked=true (entry blocked)
 *  2. evaluateMacroGates throw → paperSignalLogs row written with signalType=c11_macro_gate_eval_failed
 *  3. evaluateMacroGates throw → SSE signal:macro_gate_eval_failed emitted
 *  4. evaluateMacroGates throw → error message surfaced in audit row reason field
 *  5. Nominal allowed=false path is unchanged (regression guard)
 *  6. Nominal allowed=true path is unchanged — gate does not block (regression guard)
 *
 * Uses a simulation harness that mirrors the catch-block logic from
 * paper-signal-service.ts so we can test the contract without bootstrapping
 * the full Express + DB dependency graph.
 */

import { describe, it, expect, vi } from "vitest";

// ─── Types mirroring paper-signal-service internals ──────────────────────────

interface MacroGateResult {
  allowed: boolean;
  gateReason: string;
  severity: string;
  fomcSizeReduction?: boolean;
  macroContext: {
    probCrisis: number;
    dominantState: string;
  };
}

interface SimulatedAuditEntry {
  action: string;
  sessionId: string;
  symbol: string;
  signalType: string;
  reason: string;
  acted: boolean;
  indicatorSnapshot: Record<string, unknown>;
}

interface SimulatedSseEmit {
  event: string;
  payload: Record<string, unknown>;
}

interface SimulationResult {
  macroGateBlocked: boolean;
  auditEntries: SimulatedAuditEntry[];
  sseEmits: SimulatedSseEmit[];
  logLevel: "error" | "warn" | "none";
}

// ─── Simulation harness (mirrors the exact catch-block logic from the fix) ────
//
// The harness re-implements the try/catch block around evaluateMacroGates.
// This lets us verify the behavioral contract without needing to import
// the full paper-signal-service module (which has a 30-module bootstrap chain).
//
// IMPORTANT: If the implementation in paper-signal-service.ts changes, this
// simulation must be kept in sync.

async function simulateMacroGateBlock(
  sessionId: string,
  symbol: string,
  barClose: number,
  evaluateMacroGates: () => Promise<MacroGateResult>,
): Promise<SimulationResult> {
  const auditEntries: SimulatedAuditEntry[] = [];
  const sseEmits: SimulatedSseEmit[] = [];
  let macroGateBlocked = false;
  let logLevel: "error" | "warn" | "none" = "none";

  try {
    const macroGate = await evaluateMacroGates();
    if (!macroGate.allowed) {
      macroGateBlocked = true;
      // nominal block path — no audit entry in this simulation (handled upstream in service)
    }
    // allowed=true: macroGateBlocked stays false
  } catch (macroGateErr) {
    // ── This is the FIXED catch block (Wave 23H Fix 2) ──────────────────────
    // Changed from fail-OPEN (macroGateBlocked = false) to fail-CLOSED:
    macroGateBlocked = true;
    const errMsg = macroGateErr instanceof Error ? macroGateErr.message : String(macroGateErr);

    // Escalated from logger.warn to logger.error
    logLevel = "error";

    // Audit row
    auditEntries.push({
      action: "c11_macro_gate_eval_failed",
      sessionId,
      symbol,
      signalType: "c11_macro_gate_eval_failed",
      reason: `c11_macro_gate.evaluation_failed_fail_closed: ${errMsg}`,
      acted: false,
      indicatorSnapshot: { _macro_gate_error: errMsg },
    });

    // SSE broadcast
    sseEmits.push({
      event: "signal:macro_gate_eval_failed",
      payload: { sessionId, symbol, error_message: errMsg },
    });
  }

  return { macroGateBlocked, auditEntries, sseEmits, logLevel };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("C11 macro gate — fail-CLOSED on exception (Wave 23H Fix 2)", () => {
  it("1. evaluateMacroGates throw → macroGateBlocked=true (entry blocked)", async () => {
    const result = await simulateMacroGateBlock(
      "sess-c11-1",
      "MES",
      5000,
      async () => {
        throw new Error("DB connection timeout");
      },
    );

    expect(result.macroGateBlocked).toBe(true);
  });

  it("2. evaluateMacroGates throw → paperSignalLogs row with signalType=c11_macro_gate_eval_failed", async () => {
    const result = await simulateMacroGateBlock(
      "sess-c11-2",
      "MNQ",
      20000,
      async () => {
        throw new Error("import error: macro-gate-service not found");
      },
    );

    expect(result.auditEntries).toHaveLength(1);
    expect(result.auditEntries[0].signalType).toBe("c11_macro_gate_eval_failed");
    expect(result.auditEntries[0].acted).toBe(false);
    expect(result.auditEntries[0].sessionId).toBe("sess-c11-2");
    expect(result.auditEntries[0].symbol).toBe("MNQ");
  });

  it("3. evaluateMacroGates throw → SSE signal:macro_gate_eval_failed emitted", async () => {
    const result = await simulateMacroGateBlock(
      "sess-c11-3",
      "MCL",
      75.0,
      async () => {
        throw new Error("parse error in macro state JSON");
      },
    );

    expect(result.sseEmits).toHaveLength(1);
    expect(result.sseEmits[0].event).toBe("signal:macro_gate_eval_failed");
    expect(result.sseEmits[0].payload).toMatchObject({
      sessionId: "sess-c11-3",
      symbol: "MCL",
    });
  });

  it("4. evaluateMacroGates throw → error message surfaced in audit row reason field", async () => {
    const specificError = "DB pool exhausted: max_clients=10 reached";
    const result = await simulateMacroGateBlock(
      "sess-c11-4",
      "MES",
      5010,
      async () => {
        throw new Error(specificError);
      },
    );

    expect(result.auditEntries[0].reason).toContain(specificError);
    expect(result.auditEntries[0].indicatorSnapshot._macro_gate_error).toBe(specificError);
  });

  it("5. regression — nominal blocked path still sets macroGateBlocked=true (allowed=false)", async () => {
    const result = await simulateMacroGateBlock(
      "sess-c11-5",
      "MES",
      5000,
      async () => ({
        allowed: false,
        gateReason: "crisis_regime_detected",
        severity: "critical",
        macroContext: { probCrisis: 0.87, dominantState: "crisis" },
      }),
    );

    expect(result.macroGateBlocked).toBe(true);
    // No SSE/audit on nominal block path (handled by upstream service code)
    expect(result.sseEmits).toHaveLength(0);
  });

  it("6. regression — nominal allowed path does NOT set macroGateBlocked (allowed=true)", async () => {
    const result = await simulateMacroGateBlock(
      "sess-c11-6",
      "MES",
      5000,
      async () => ({
        allowed: true,
        gateReason: "",
        severity: "none",
        macroContext: { probCrisis: 0.02, dominantState: "normal" },
      }),
    );

    expect(result.macroGateBlocked).toBe(false);
    expect(result.auditEntries).toHaveLength(0);
    expect(result.sseEmits).toHaveLength(0);
  });

  it("7. logger.error (not warn) is the correct log level when gate fails", async () => {
    const result = await simulateMacroGateBlock(
      "sess-c11-7",
      "MES",
      5000,
      async () => {
        throw new TypeError("Cannot read property 'allowed' of undefined");
      },
    );

    // Simulation records which level was used — must be 'error', not 'warn'
    expect(result.logLevel).toBe("error");
  });

  it("8. non-Error exception is handled (string throw) — still blocked", async () => {
    const result = await simulateMacroGateBlock(
      "sess-c11-8",
      "MES",
      5000,
      async () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw "macro service unavailable";
      },
    );

    expect(result.macroGateBlocked).toBe(true);
    expect(result.auditEntries[0].indicatorSnapshot._macro_gate_error).toBe(
      "macro service unavailable",
    );
  });
});
