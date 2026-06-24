/**
 * pbo-gate-nan-bypass-fix.test.ts — Regression: BLOCKER B4
 *
 * Covers the NaN sample-size-guard bypass bug in evaluatePboGate():
 *
 *   BEFORE FIX:
 *     Python pbo_gate.py returns float('nan') when n_paths < PBO_MIN_PATHS=4.
 *     The TS gate compared `pbo > 0.15` but NaN > 0.15 === false in JS, so
 *     NaN silently fell through to the PASS path (ok: true). A walk-forward
 *     with <4 CPCV paths CLEARED the 0.15 hard gate at TESTING→SHADOW/PAPER.
 *
 *   AFTER FIX (pbo-gate.ts):
 *     `if (!Number.isFinite(pbo)) return { ok: false, reason: "lifecycle.pbo_sample_size_guard" }`
 *     inserted BEFORE the `pbo > threshold` comparison.
 *     Non-finite → fail-CLOSED. Legacy null (pre-Wave-29, no pbo_overall field) →
 *     still PROCEED (documented grandfather window, unchanged).
 *
 * Branch: hardening/phase-0
 * Commit tag: pbo-gate-b4
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { evaluatePboGate } from "../lib/pbo-gate.js";

vi.mock("../lib/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

afterEach(() => {
  delete process.env.PBO_OVERFIT_THRESHOLD_PCT;
});

// ── B4 FIX: NaN must BLOCK ────────────────────────────────────────────────────

describe("evaluatePboGate — NaN bypass fix (BLOCKER B4)", () => {
  it("blocks promotion when pbo_overall is NaN", () => {
    // This was the bug: NaN > 0.15 === false in JS, gate returned ok:true
    const result = evaluatePboGate({ pbo_overall: NaN });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("lifecycle.pbo_sample_size_guard");
    expect(result.pbo).toBeNull();
    expect(result.legacyNull).toBe(false);
    expect(result.auditPayload.blocked).toBe(true);
    expect(result.auditPayload.legacy_null).toBe(false);
    expect(result.auditPayload.pbo).toBeNull();
    expect(result.auditPayload.threshold).toBe(0.15);
  });

  it("blocks promotion when pbo_overall is +Infinity (degenerate rank tie)", () => {
    const result = evaluatePboGate({ pbo_overall: Infinity });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("lifecycle.pbo_sample_size_guard");
    expect(result.pbo).toBeNull();
    expect(result.auditPayload.blocked).toBe(true);
  });

  it("blocks promotion when pbo_overall is -Infinity", () => {
    const result = evaluatePboGate({ pbo_overall: -Infinity });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("lifecycle.pbo_sample_size_guard");
    expect(result.pbo).toBeNull();
    expect(result.auditPayload.blocked).toBe(true);
  });

  it("sample-size-guard result carries p_value through in auditPayload", () => {
    // pbo_p_value may accompany the result even on degenerate samples —
    // it should be preserved in the audit payload.
    const result = evaluatePboGate({ pbo_overall: NaN, pbo_p_value: 0.03 });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("lifecycle.pbo_sample_size_guard");
    expect(result.auditPayload.pbo_p_value).toBe(0.03);
  });

  it("sample-size-guard respects threshold override in opts", () => {
    // The threshold value in the result must reflect the override even when
    // we block for non-finiteness (not used in the comparison, but reported).
    const result = evaluatePboGate({ pbo_overall: NaN }, { threshold: 0.10 });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("lifecycle.pbo_sample_size_guard");
    expect(result.threshold).toBe(0.10);
    expect(result.auditPayload.threshold).toBe(0.10);
  });
});

// ── PRESERVED: legacy-null grandfather MUST still PROCEED ────────────────────

describe("evaluatePboGate — legacy null grandfather (unchanged behavior)", () => {
  it("PROCEEDs with legacyNull=true when pbo_overall is null (no pbo_overall field pre-Wave-29)", () => {
    const result = evaluatePboGate({ pbo_overall: null });

    expect(result.ok).toBe(true);
    expect(result.reason).toBe("lifecycle.pbo_unavailable_legacy");
    expect(result.pbo).toBeNull();
    expect(result.legacyNull).toBe(true);
    expect(result.auditPayload.legacy_null).toBe(true);
    expect(result.auditPayload.blocked).toBe(false);
  });

  it("PROCEEDs with legacyNull=true when pbo_overall is undefined (backtest has no walk-forward)", () => {
    const result = evaluatePboGate({});

    expect(result.ok).toBe(true);
    expect(result.reason).toBe("lifecycle.pbo_unavailable_legacy");
    expect(result.legacyNull).toBe(true);
  });
});

// ── REGRESSION: standard BLOCK/PASS paths still work ────────────────────────

describe("evaluatePboGate — standard paths unaffected by B4 fix", () => {
  it("still BLOCKs when pbo_overall (0.20) > threshold (0.15)", () => {
    const result = evaluatePboGate({ pbo_overall: 0.20 });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("lifecycle.pbo_overfit_block");
    expect(result.pbo).toBe(0.20);
    expect(result.auditPayload.blocked).toBe(true);
    expect(result.auditPayload.pbo).toBe(0.20);
  });

  it("still PASSes when pbo_overall (0.10) < threshold (0.15)", () => {
    const result = evaluatePboGate({ pbo_overall: 0.10 });

    expect(result.ok).toBe(true);
    expect(result.reason).toBe("lifecycle.pbo_within_threshold");
    expect(result.pbo).toBe(0.10);
    expect(result.auditPayload.blocked).toBe(false);
  });

  it("still PASSes when pbo_overall === threshold exactly (strict < convention)", () => {
    const result = evaluatePboGate({ pbo_overall: 0.15 });

    expect(result.ok).toBe(true);
    expect(result.reason).toBe("lifecycle.pbo_within_threshold");
    expect(result.pbo).toBe(0.15);
  });

  it("still BLOCKs with env-override threshold", () => {
    process.env.PBO_OVERFIT_THRESHOLD_PCT = "0.10";
    const result = evaluatePboGate({ pbo_overall: 0.12 });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("lifecycle.pbo_overfit_block");
    expect(result.threshold).toBe(0.10);
  });
});
