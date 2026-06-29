/**
 * finding1-pbo-cpcv-degenerate.test.ts — FINDING-1 regression
 *
 * Verifies the CPCV degenerate path in evaluatePboGate():
 *
 *   BEFORE FIX:
 *     pbo_degenerate=true was not propagated from walk_forward.py to pbo-gate.ts.
 *     The gate saw pbo_overall=null and silently PROCEEDED via pbo_unavailable_legacy
 *     (grandfather-pass). Every CPCV degenerate run cleared the PBO gate.
 *
 *   AFTER FIX (pbo-gate.ts + walk_forward.py):
 *     walk_forward.py now emits pbo_degenerate=true in the result dict when
 *     pbo_gate.py fires the degenerate guard (IS==OOS for all paths).
 *     evaluatePboGate() checks pbo_degenerate BEFORE the legacy-null path:
 *       pbo_degenerate===true → BLOCK (pbo_cpcv_degenerate_block)
 *       pbo_degenerate===false/undefined + pbo_overall===null → PROCEED (pbo_unavailable_legacy)
 *
 *   CRITICAL DISTINCTION:
 *     - Legacy null (pre-Wave-29, no pbo field) → PROCEED is correct
 *     - CPCV degenerate (IS==OOS for all paths) → BLOCK is correct
 *     - Both result in pbo_overall===null, so without the discriminator flag,
 *       degenerate would silently grandfather-pass (the bug FINDING-1 fixes)
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { evaluatePboGate } from "../lib/pbo-gate.js";

vi.mock("../lib/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

afterEach(() => {
  delete process.env.PBO_OVERFIT_THRESHOLD_PCT;
});

// ── FINDING-1: pbo_degenerate=true must BLOCK ─────────────────────────────────

describe("evaluatePboGate — FINDING-1: CPCV degenerate path BLOCKS", () => {
  it("BLOCKs when pbo_degenerate=true and pbo_overall is null (CPCV mode)", () => {
    // This is the core FINDING-1 case: CPCV run where IS==OOS for all paths.
    // pbo_overall is null because the degenerate guard fired; pbo_degenerate=true
    // is the discriminator that separates this from the legacy-null path.
    const result = evaluatePboGate({ pbo_overall: null, pbo_degenerate: true });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("lifecycle.pbo_cpcv_degenerate_block");
    expect(result.pbo).toBeNull();
    expect(result.legacyNull).toBe(false);
    expect(result.auditPayload.blocked).toBe(true);
    expect(result.auditPayload.legacy_null).toBe(false);
    expect(result.auditPayload.cpcv_degenerate).toBe(true);
  });

  it("BLOCKs when pbo_degenerate=true even when pbo_overall has a value", () => {
    // Defensive: if walk_forward.py emits both pbo_degenerate=true AND a pbo value,
    // the degenerate flag takes priority (fail-CLOSED ordering).
    const result = evaluatePboGate({ pbo_overall: 0.05, pbo_degenerate: true });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("lifecycle.pbo_cpcv_degenerate_block");
    expect(result.pbo).toBeNull();
    expect(result.auditPayload.cpcv_degenerate).toBe(true);
  });

  it("degenerate BLOCK carries pbo_p_value through audit payload", () => {
    const result = evaluatePboGate({
      pbo_overall: null,
      pbo_p_value: 0.42,
      pbo_degenerate: true,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("lifecycle.pbo_cpcv_degenerate_block");
    expect(result.auditPayload.pbo_p_value).toBe(0.42);
  });

  it("degenerate BLOCK reflects env-overridden threshold in auditPayload", () => {
    const result = evaluatePboGate(
      { pbo_overall: null, pbo_degenerate: true },
      { threshold: 0.10 },
    );

    expect(result.ok).toBe(false);
    expect(result.threshold).toBe(0.10);
    expect(result.auditPayload.threshold).toBe(0.10);
  });
});

// ── Legacy-null path PRESERVED: pbo_degenerate=false/undefined/null → PROCEED ─

describe("evaluatePboGate — FINDING-1: legacy-null grandfather PRESERVED", () => {
  it("PROCEEDs (pbo_unavailable_legacy) when pbo_overall=null and pbo_degenerate=false", () => {
    // Pre-Wave-29 or plain-WF run with no CPCV degenerate condition.
    const result = evaluatePboGate({ pbo_overall: null, pbo_degenerate: false });

    expect(result.ok).toBe(true);
    expect(result.reason).toBe("lifecycle.pbo_unavailable_legacy");
    expect(result.legacyNull).toBe(true);
    expect(result.auditPayload.blocked).toBe(false);
    expect(result.auditPayload.legacy_null).toBe(true);
    expect(result.auditPayload.cpcv_degenerate).toBeUndefined();
  });

  it("PROCEEDs (pbo_unavailable_legacy) when pbo_degenerate is undefined", () => {
    // Typical pre-Wave-29 backtest: no pbo_degenerate field at all.
    const result = evaluatePboGate({ pbo_overall: null });

    expect(result.ok).toBe(true);
    expect(result.reason).toBe("lifecycle.pbo_unavailable_legacy");
    expect(result.legacyNull).toBe(true);
  });

  it("PROCEEDs (pbo_unavailable_legacy) when pbo_degenerate is null", () => {
    // null is treated as absent (not true) — must NOT trigger degenerate block.
    const result = evaluatePboGate({ pbo_overall: null, pbo_degenerate: null });

    expect(result.ok).toBe(true);
    expect(result.reason).toBe("lifecycle.pbo_unavailable_legacy");
    expect(result.legacyNull).toBe(true);
  });

  it("PROCEEDs (pbo_unavailable_legacy) when pbo_overall is undefined (empty object)", () => {
    const result = evaluatePboGate({});

    expect(result.ok).toBe(true);
    expect(result.reason).toBe("lifecycle.pbo_unavailable_legacy");
    expect(result.legacyNull).toBe(true);
  });
});

// ── Gate ordering: degenerate check fires BEFORE legacy-null ──────────────────

describe("evaluatePboGate — FINDING-1: gate evaluation ordering", () => {
  it("degenerate check is evaluated BEFORE legacy-null check", () => {
    // Both pbo_overall=null AND pbo_degenerate=true → degenerate wins (not grandfather).
    // If legacy-null check ran first, it would return pbo_unavailable_legacy (WRONG).
    const result = evaluatePboGate({ pbo_overall: null, pbo_degenerate: true });

    expect(result.reason).toBe("lifecycle.pbo_cpcv_degenerate_block");
    expect(result.ok).toBe(false);
    // Explicitly NOT the legacy grandfather path:
    expect(result.reason).not.toBe("lifecycle.pbo_unavailable_legacy");
    expect(result.legacyNull).toBe(false);
  });

  it("degenerate check fires BEFORE non-finite check (pbo_overall=NaN + pbo_degenerate=true)", () => {
    // Hypothetical edge: both degenerate flag and NaN pbo. Degenerate wins.
    const result = evaluatePboGate({ pbo_overall: NaN, pbo_degenerate: true });

    expect(result.reason).toBe("lifecycle.pbo_cpcv_degenerate_block");
    expect(result.auditPayload.cpcv_degenerate).toBe(true);
    // NOT sample-size-guard:
    expect(result.reason).not.toBe("lifecycle.pbo_sample_size_guard");
  });
});

// ── Standard paths unaffected by FINDING-1 ────────────────────────────────────

describe("evaluatePboGate — FINDING-1: standard block/pass paths unaffected", () => {
  it("still BLOCKs when pbo_overall > threshold (no degenerate flag)", () => {
    const result = evaluatePboGate({ pbo_overall: 0.20, pbo_degenerate: false });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("lifecycle.pbo_overfit_block");
    expect(result.pbo).toBe(0.20);
    expect(result.auditPayload.cpcv_degenerate).toBeUndefined();
  });

  it("still PASSes when pbo_overall < threshold (no degenerate flag)", () => {
    const result = evaluatePboGate({ pbo_overall: 0.05, pbo_degenerate: false });

    expect(result.ok).toBe(true);
    expect(result.reason).toBe("lifecycle.pbo_within_threshold");
    expect(result.pbo).toBe(0.05);
    expect(result.auditPayload.cpcv_degenerate).toBeUndefined();
  });

  it("still BLOCKs for NaN pbo_overall without degenerate flag", () => {
    const result = evaluatePboGate({ pbo_overall: NaN });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("lifecycle.pbo_sample_size_guard");
    expect(result.auditPayload.cpcv_degenerate).toBeUndefined();
  });
});
