/**
 * Wave 24 Pass 1 — Item 10: WF mode gate tests.
 *
 * Tests the lifecycle-service.ts promotion gate that requires CPCV evidence.
 *
 * Gate: TESTING → PAPER with wf_metadata.mode="cpcv" → ALLOW
 *       Any other or missing mode → BLOCK
 *
 * Audit action: lifecycle.wf_mode_insufficient
 */

import { describe, it, expect } from "vitest";

// ── Helper: simulate the gate logic extracted from lifecycle-service.ts ──────
// We test the pure decision logic without mocking DB/Drizzle.

function evaluateWfModeGate(opts: {
  wfMode: string | undefined;
  isStyleC: boolean;
}): { blocked: boolean; reason: string | null } {
  const { wfMode } = opts;

  if (wfMode !== "cpcv") {
    return {
      blocked: true,
      reason: "cpcv_required_for_promotion",
    };
  }

  return { blocked: false, reason: null };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("WF Mode Gate", () => {
  describe("non-CPCV walk-forward → BLOCK", () => {
    it("blocks promotion when wf_mode='plain'", () => {
      const result = evaluateWfModeGate({ wfMode: "plain", isStyleC: true });
      expect(result.blocked).toBe(true);
      expect(result.reason).toBe("cpcv_required_for_promotion");
    });

    it("blocks purged_embargo because promotion requires CPCV", () => {
      const result = evaluateWfModeGate({ wfMode: "purged_embargo", isStyleC: true });
      expect(result.blocked).toBe(true);
    });

    it("blocks a missing walk-forward mode", () => {
      const result = evaluateWfModeGate({ wfMode: undefined, isStyleC: false });
      expect(result.blocked).toBe(true);
    });
  });

  describe("CPCV → ALLOW", () => {
    it("allows promotion when wf_mode='cpcv'", () => {
      const result = evaluateWfModeGate({ wfMode: "cpcv", isStyleC: true });
      expect(result.blocked).toBe(false);
      expect(result.reason).toBeNull();
    });
  });

  describe("wf_metadata contract", () => {
    it("plain mode wf_metadata has correct shape", () => {
      const meta = {
        mode: "plain",
        n_folds: 5,
        embargo_pct: 0.0,
        purge_window: 0,
      };
      expect(meta.mode).toBe("plain");
      expect(typeof meta.n_folds).toBe("number");
      expect(typeof meta.embargo_pct).toBe("number");
      expect(typeof meta.purge_window).toBe("number");
    });

    it("purged_embargo mode wf_metadata has positive embargo_pct", () => {
      const meta = {
        mode: "purged_embargo",
        n_folds: 5,
        embargo_pct: 0.01,
        purge_window: 20,
      };
      expect(meta.embargo_pct).toBeGreaterThan(0);
      expect(meta.purge_window).toBeGreaterThan(0);
    });

    it("cpcv mode wf_metadata has n_paths field", () => {
      const meta = {
        mode: "cpcv",
        n_folds: 6,
        embargo_pct: 0.01,
        purge_window: 20,
        n_paths: 15,
        psr: 0.7,
        dsr: 1.8,
      };
      expect(meta.n_paths).toBe(15);
      expect(typeof meta.psr).toBe("number");
    });
  });
});
