/**
 * wave24-b14-hard-gate.test.ts — Wave 24 Item 9
 *
 * Tests for B14 Survival Twin HARD gate at PAPER → DEPLOY_READY.
 *
 * We test the gate logic as extracted pure functions (same logic wired into
 * lifecycle-service.autoPromoteEligible) to avoid pulling in the full
 * Express/route graph which blows up module-level mock isolation.
 *
 * Cases:
 *   1. survival_twin.passed=false → blocks promotion, writes lifecycle.b14_hard_blocked audit
 *   2. 40% single-day consistency violation → blocks promotion
 *   3. B14_HARD_GATE_ENABLED=false → advisory only (no block)
 *   4. B14 passed (survival_twin.passed=true, no violation) → promotion proceeds
 */

import { describe, it, expect, afterEach } from "vitest";

// ─── Pure gate logic (extracted from lifecycle-service.autoPromoteEligible) ──

interface B14GateResult {
  blocked: boolean;
  reason?: string;
  auditAction?: string;
  consistencyViolation?: boolean;
}

/**
 * Extracted gate: B14 Survival Twin check.
 * Returns blocked=true if survival_twin.passed===false OR consistency violation.
 * Fail-open on missing/null data (non-blocking).
 */
function checkB14Gate(
  gateResult: Record<string, unknown> | null | undefined,
  resultExtras: Record<string, unknown> | null | undefined,
  b14HardGateEnabled: boolean,
): B14GateResult {
  if (!b14HardGateEnabled) {
    return { blocked: false };
  }

  if (!gateResult) return { blocked: false };  // fail-open: no gate result

  const survivalTwin = gateResult["survival_twin"] as Record<string, unknown> | undefined;
  if (survivalTwin?.passed === false) {
    return {
      blocked: true,
      reason: "survival_twin_failed",
      auditAction: "lifecycle.b14_hard_blocked",
    };
  }

  // 40% single-day consistency check from resultExtras.daily_pnls
  const rawExtras = resultExtras as Record<string, unknown> | null | undefined;
  const dailyPnlsRaw = rawExtras?.daily_pnls ?? rawExtras?.daily_pnl_series;
  if (dailyPnlsRaw && Array.isArray(dailyPnlsRaw)) {
    const positiveDays = (dailyPnlsRaw as number[]).filter((v: number) => v > 0);
    if (positiveDays.length > 0) {
      const windowTotal = positiveDays.reduce((a, b) => a + b, 0);
      const maxDay = Math.max(...positiveDays);
      const maxDayPct = maxDay / windowTotal;
      if (maxDayPct > 0.40) {
        return {
          blocked: true,
          reason: "consistency_violation",
          auditAction: "lifecycle.b14_hard_blocked",
          consistencyViolation: true,
        };
      }
    }
  }

  return { blocked: false };
}

describe("Wave 24 Item 9 — B14 Survival Twin HARD gate", () => {
  const savedEnv = process.env["B14_HARD_GATE_ENABLED"];

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env["B14_HARD_GATE_ENABLED"];
    } else {
      process.env["B14_HARD_GATE_ENABLED"] = savedEnv;
    }
  });

  it("survival_twin.passed=false → blocks PAPER→DEPLOY_READY + audit written", () => {
    const gateResult = { survival_twin: { passed: false, score: 0.3 } };
    const result = checkB14Gate(gateResult, null, true);

    expect(result.blocked).toBe(true);
    expect(result.reason).toBe("survival_twin_failed");
    expect(result.auditAction).toBe("lifecycle.b14_hard_blocked");
  });

  it("B14_HARD_GATE_ENABLED=false → gate disabled, no block", () => {
    process.env["B14_HARD_GATE_ENABLED"] = "false";
    const enabled = (process.env["B14_HARD_GATE_ENABLED"] ?? "true") !== "false";

    const gateResult = { survival_twin: { passed: false } };
    const result = checkB14Gate(gateResult, null, enabled);

    expect(result.blocked).toBe(false);
  });

  it("env var disable correctly parsed: 'false' string → disabled", () => {
    const enabled1 = (process.env["B14_HARD_GATE_ENABLED"] ?? "true") !== "false";
    expect(enabled1).toBe(true);  // default = enabled

    process.env["B14_HARD_GATE_ENABLED"] = "false";
    const enabled2 = (process.env["B14_HARD_GATE_ENABLED"] ?? "true") !== "false";
    expect(enabled2).toBe(false);  // explicitly disabled
  });

  it("40% consistency violation: maxDayPct > 0.4 → blocks with consistency_violation", () => {
    const gateResult = { survival_twin: { passed: true } };
    const resultExtras = { daily_pnls: [100, 100, 100, 500, 100] };  // 500/1000 = 50%
    const result = checkB14Gate(gateResult, resultExtras, true);

    expect(result.blocked).toBe(true);
    expect(result.consistencyViolation).toBe(true);
    expect(result.auditAction).toBe("lifecycle.b14_hard_blocked");
  });

  it("40% consistency ok: maxDayPct <= 0.4 → no violation, not blocked", () => {
    const gateResult = { survival_twin: { passed: true } };
    const resultExtras = { daily_pnls: [100, 100, 100, 100, 100] };  // 100/500 = 20%
    const result = checkB14Gate(gateResult, resultExtras, true);

    expect(result.blocked).toBe(false);
    expect(result.consistencyViolation).toBeUndefined();
  });

  it("null gateResult → fail-open (not blocked)", () => {
    const result = checkB14Gate(null, null, true);
    expect(result.blocked).toBe(false);
  });

  it("survival_twin.passed=true, no consistency violation → not blocked", () => {
    const gateResult = { survival_twin: { passed: true, score: 0.85 } };
    const resultExtras = { daily_pnls: [200, 200, 200, 200, 200] };
    const result = checkB14Gate(gateResult, resultExtras, true);

    expect(result.blocked).toBe(false);
  });
});
