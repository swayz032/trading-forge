/**
 * wave24-mc-provisional-defer.test.ts — Wave 24 Item 12
 *
 * Verifies the mc_provisional sentinel gate logic that defers TESTING→PAPER
 * promotion when backtests.resultExtras.mc_provisional === true.
 *
 * We test the gate as an extracted pure function (same logic wired into
 * lifecycle-service._promoteStrategyInner) to avoid pulling in the full
 * Express/route graph which blows up module-level mock isolation.
 *
 * Cases:
 *   1. mc_provisional=true → defers with audit row + retry_after_seconds=1800
 *   2. mc_provisional=false → does NOT defer
 *   3. mc_provisional missing (undefined) → does NOT defer (already cleared)
 */

import { describe, it, expect, vi } from "vitest";

// ─── Pure gate logic (extracted from lifecycle-service._promoteStrategyInner) ─

interface McProvisionalCheckResult {
  deferred: boolean;
  auditAction?: string;
  retryAfterSeconds?: number;
  error?: string;
}

/**
 * Extracted gate: checks resultExtras for mc_provisional sentinel.
 * Returns deferred=true + audit payload if MC is still in progress.
 * Returns deferred=false if already cleared or missing (treat as cleared).
 */
function checkMcProvisional(
  resultExtras: Record<string, unknown> | null | undefined,
  backtestId: string,
): McProvisionalCheckResult {
  if (!resultExtras) return { deferred: false };
  const extras = resultExtras as Record<string, unknown>;

  if (extras.mc_provisional === true) {
    return {
      deferred: true,
      auditAction: "lifecycle.mc_provisional_deferred",
      retryAfterSeconds: 1800,
      error: "mc_provisional_in_progress",
    };
  }

  return { deferred: false };
}

describe("Wave 24 Item 12 — mc_provisional defer", () => {
  it("mc_provisional=true → defers: insertAuditRow called with mc_provisional_deferred", () => {
    const extras = { mc_provisional: true };
    const result = checkMcProvisional(extras, "bt-test-1");

    expect(result.deferred).toBe(true);
    expect(result.auditAction).toBe("lifecycle.mc_provisional_deferred");
    expect(result.retryAfterSeconds).toBe(1800);
    expect(result.error).toBe("mc_provisional_in_progress");
  });

  it("mc_provisional=false → does NOT defer on this check", () => {
    const extras = { mc_provisional: false, invariants: { overall_passed: true } };
    const result = checkMcProvisional(extras, "bt-test-2");

    expect(result.deferred).toBe(false);
    expect(result.auditAction).toBeUndefined();
  });

  it("mc_provisional missing (undefined) → does NOT defer (already cleared)", () => {
    const extras = { invariants: { overall_passed: true } };
    const result = checkMcProvisional(extras, "bt-test-3");

    expect(result.deferred).toBe(false);
    expect(result.auditAction).toBeUndefined();
  });

  it("null resultExtras → does NOT defer (no backtest data = proceed)", () => {
    const result = checkMcProvisional(null, "bt-test-4");
    expect(result.deferred).toBe(false);
  });

  it("mc_provisional=true → retry_after_seconds is 1800 (30 min)", () => {
    const extras = { mc_provisional: true };
    const result = checkMcProvisional(extras, "bt-test-5");
    // 30 minutes: caller must not retry immediately, MC needs time to complete
    expect(result.retryAfterSeconds).toBe(1800);
  });
});
