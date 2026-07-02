/**
 * finding1-pbo-cpcv-degenerate.test.ts — FINDING-1 regression (merged policy 2026-06-29)
 *
 * Verifies the CPCV degenerate path in evaluatePboGate().
 *
 *   THE BUG (pre-fix): CPCV PBO is structurally degenerate (IS==OOS for all paths —
 *   per-path IS Sharpe is unavailable in CPCV mode), so pbo_overall=null. The gate
 *   could not distinguish this from a genuine pre-Wave-29 legacy null, so it silently
 *   PROCEEDED via pbo_unavailable_legacy — indistinguishable, untraceable.
 *
 *   THE RESOLUTION (merge of two deep-scan sessions, 2026-06-29):
 *     walk_forward.py emits wf_metadata.pbo_degenerate_reason="cpcv_is_sharpe_unavailable"
 *     when mode="cpcv". evaluatePboGate() reads pbo_degenerate_reason and returns a
 *     DISTINCT result — PROCEED (ok:true) with reason "lifecycle.pbo_cpcv_is_unavailable"
 *     and cpcv_exempt:true in the audit payload, NOT the generic legacy grandfather.
 *
 *   WHY PROCEED, NOT BLOCK: CPCV is the default WF_MODE, so a BLOCK-on-degenerate
 *   would strangle the ENTIRE pipeline (no strategy could ever clear PBO). The honest
 *   "explicit exempt + proceed" stopgap preserves the audit-trail honesty without
 *   killing the pipeline; the real fix is Wave 30 per-path IS Sharpe tracking.
 *
 *   CRITICAL DISTINCTION the gate must preserve:
 *     - Legacy null (pre-Wave-29, no reason) → PROCEED via pbo_unavailable_legacy
 *     - CPCV degenerate (reason set)         → PROCEED via pbo_cpcv_is_unavailable (DISTINCT)
 *     - Both are pbo_overall===null but route to different, traceable audit actions.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { evaluatePboGate } from "../lib/pbo-gate.js";

vi.mock("../lib/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const CPCV_REASON = "cpcv_is_sharpe_unavailable";

describe("evaluatePboGate — FINDING-1: CPCV degenerate path is EXEMPT (proceed, distinct audit)", () => {
  afterEach(() => {
    delete process.env["PBO_OVERFIT_THRESHOLD_PCT"];
  });

  it("PROCEEDS with the distinct cpcv-exempt audit when pbo_degenerate_reason is set and pbo_overall is null", () => {
    const r = evaluatePboGate({ pbo_overall: null, pbo_p_value: null, pbo_degenerate_reason: CPCV_REASON });
    expect(r.ok).toBe(true);
    expect(r.reason).toBe("lifecycle.pbo_cpcv_is_unavailable");
    expect(r.legacyNull).toBe(false);
    expect(r.auditPayload.cpcv_exempt).toBe(true);
    expect(r.auditPayload.blocked).toBe(false);
  });

  it("is DISTINCT from the legacy-null grandfather path (different audit action, legacyNull flag)", () => {
    const exempt = evaluatePboGate({ pbo_overall: null, pbo_degenerate_reason: CPCV_REASON });
    const legacy = evaluatePboGate({ pbo_overall: null });
    expect(exempt.reason).toBe("lifecycle.pbo_cpcv_is_unavailable");
    expect(exempt.legacyNull).toBe(false);
    expect(legacy.reason).toBe("lifecycle.pbo_unavailable_legacy");
    expect(legacy.legacyNull).toBe(true);
    // Both proceed, but they must be queryably different (the honesty guarantee).
    expect(exempt.reason).not.toBe(legacy.reason);
  });

  it("carries pbo_p_value through the cpcv-exempt audit payload", () => {
    const r = evaluatePboGate({ pbo_overall: null, pbo_p_value: 0.07, pbo_degenerate_reason: CPCV_REASON });
    expect(r.auditPayload.pbo_p_value).toBe(0.07);
    expect(r.auditPayload.cpcv_exempt).toBe(true);
  });
});

describe("evaluatePboGate — FINDING-1: legacy-null grandfather PRESERVED", () => {
  it("PROCEEDs (pbo_unavailable_legacy) when pbo_overall=null and no degenerate reason", () => {
    const r = evaluatePboGate({ pbo_overall: null });
    expect(r.ok).toBe(true);
    expect(r.reason).toBe("lifecycle.pbo_unavailable_legacy");
    expect(r.legacyNull).toBe(true);
  });

  it("PROCEEDs when pbo_overall is undefined (empty object)", () => {
    const r = evaluatePboGate({});
    expect(r.ok).toBe(true);
    expect(r.legacyNull).toBe(true);
  });
});

describe("evaluatePboGate — FINDING-1: standard block/pass paths unaffected", () => {
  it("still BLOCKs when pbo_overall > threshold (no degenerate reason)", () => {
    const r = evaluatePboGate({ pbo_overall: 0.9 }, { threshold: 0.15 });
    expect(r.ok).toBe(false);
  });

  it("still PASSes when pbo_overall < threshold (no degenerate reason)", () => {
    const r = evaluatePboGate({ pbo_overall: 0.05 }, { threshold: 0.15 });
    expect(r.ok).toBe(true);
  });
});
