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
 *   THE RESOLUTION (merge of two deep-scan sessions, 2026-06-29; operator-ratified
 *   BLOCK direction 2026-07-17 — see gate-contract-restoration-2026-07-17 ratify packet):
 *     walk_forward.py emits wf_metadata.pbo_degenerate_reason="cpcv_is_sharpe_unavailable"
 *     when mode="cpcv". evaluatePboGate() reads pbo_degenerate_reason and returns a
 *     DISTINCT result — BLOCK (ok:false) with reason "lifecycle.pbo_cpcv_is_unavailable"
 *     and cpcv_exempt:true in the audit payload, NOT the generic legacy grandfather.
 *
 *   WHY BLOCK, NOT PROCEED: a PBO overfit gate that is structurally unable to measure
 *   overfitting in CPCV mode (the default WF_MODE) must not silently authorize
 *   promotion — ship gates strict, then loosen with data, not fear (CLAUDE.md §13).
 *   The operator ratified this on 2026-07-17 after a prior session flagged the
 *   PROCEED/BLOCK disagreement as an open decision (commit 707810b7). The real fix
 *   remains Wave 30 per-path IS Sharpe tracking, which removes the exemption entirely.
 *
 *   CRITICAL DISTINCTION the gate must preserve:
 *     - Legacy null (pre-Wave-29, no reason) → BLOCK via pbo_unavailable_legacy
 *       (hardened 2026-07-18 — matches BIF/WFE/parameter-drift's real 85e1500b
 *       contract; a 2026-07-17 fix briefly flipped this to PROCEED on a false
 *       premise about those siblings, corrected same-day it was found)
 *     - CPCV degenerate (reason set)         → BLOCK via pbo_cpcv_is_unavailable (DISTINCT)
 *     - Both are pbo_overall===null and now BOTH block, but route to different,
 *       traceable audit actions/reasons.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { evaluatePboGate } from "../lib/pbo-gate.js";

vi.mock("../lib/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const CPCV_REASON = "cpcv_is_sharpe_unavailable";

describe("evaluatePboGate — FINDING-1: CPCV degenerate path is EXEMPT (blocks, distinct audit)", () => {
  afterEach(() => {
    delete process.env["PBO_OVERFIT_THRESHOLD_PCT"];
  });

  it("BLOCKS with the distinct cpcv-exempt audit when pbo_degenerate_reason is set and pbo_overall is null", () => {
    const r = evaluatePboGate({ pbo_overall: null, pbo_p_value: null, pbo_degenerate_reason: CPCV_REASON });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("lifecycle.pbo_cpcv_is_unavailable");
    expect(r.legacyNull).toBe(false);
    expect(r.auditPayload.cpcv_exempt).toBe(true);
    expect(r.auditPayload.blocked).toBe(true);
  });

  it("is DISTINCT from the legacy-null grandfather path (different audit action, legacyNull flag)", () => {
    const exempt = evaluatePboGate({ pbo_overall: null, pbo_degenerate_reason: CPCV_REASON });
    const legacy = evaluatePboGate({ pbo_overall: null });
    expect(exempt.reason).toBe("lifecycle.pbo_cpcv_is_unavailable");
    expect(exempt.legacyNull).toBe(false);
    expect(legacy.reason).toBe("lifecycle.pbo_unavailable_legacy");
    expect(legacy.legacyNull).toBe(true);
    // One blocks (CPCV-exempt), one proceeds (legacy grandfather) — they must be
    // queryably different (the honesty guarantee).
    expect(exempt.reason).not.toBe(legacy.reason);
  });

  it("carries pbo_p_value through the cpcv-exempt audit payload", () => {
    const r = evaluatePboGate({ pbo_overall: null, pbo_p_value: 0.07, pbo_degenerate_reason: CPCV_REASON });
    expect(r.auditPayload.pbo_p_value).toBe(0.07);
    expect(r.auditPayload.cpcv_exempt).toBe(true);
  });
});

describe("evaluatePboGate — FINDING-1: legacy-null BLOCKS (hardened 2026-07-18)", () => {
  it("BLOCKs (pbo_unavailable_legacy) when pbo_overall=null and no degenerate reason", () => {
    const r = evaluatePboGate({ pbo_overall: null });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("lifecycle.pbo_unavailable_legacy");
    expect(r.legacyNull).toBe(true);
  });

  it("BLOCKs when pbo_overall is undefined (empty object)", () => {
    const r = evaluatePboGate({});
    expect(r.ok).toBe(false);
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
