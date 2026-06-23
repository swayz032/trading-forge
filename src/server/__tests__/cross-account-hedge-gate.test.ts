import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExecute = vi.fn();
vi.mock("../db/index.js", () => ({ db: { execute: mockExecute } }));
vi.mock("../lib/logger.js", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const { checkCrossAccountHedge, symbolToUnderlying } = await import("../lib/cross-account-hedge-gate.js");

describe("cross-account-hedge-gate (Topstep Prohibited Conduct)", () => {
  beforeEach(() => mockExecute.mockReset());

  describe("symbolToUnderlying", () => {
    it("collapses micro+mini to the same underlying", () => {
      expect(symbolToUnderlying("MES")).toBe("ES");
      expect(symbolToUnderlying("ES")).toBe("ES");
      expect(symbolToUnderlying("MNQ")).toBe("NQ");
      expect(symbolToUnderlying("MCL")).toBe("CL");
      expect(symbolToUnderlying("CL")).toBe("CL");
    });
  });

  describe("checkCrossAccountHedge", () => {
    it("BLOCKS opening long when another account holds short on the same underlying", async () => {
      mockExecute.mockResolvedValue([
        { side: "short", symbol: "MES", session_id: "other-acct" },
      ] as unknown as never);
      const r = await checkCrossAccountHedge("topstep", "MES", "long", "this-session");
      expect(r.blocked).toBe(true);
      expect(r.conflictUnderlying).toBe("ES");
      expect(r.conflictSide).toBe("short");
      expect(r.conflictSessionId).toBe("other-acct");
    });

    it("BLOCKS micro vs mini opposite (MES long vs ES short) — same underlying", async () => {
      mockExecute.mockResolvedValue([{ side: "short", symbol: "ES", session_id: "a2" }] as unknown as never);
      const r = await checkCrossAccountHedge("topstep", "MES", "long", "s1");
      expect(r.blocked).toBe(true);
    });

    it("ALLOWS same-side across accounts (not a hedge)", async () => {
      mockExecute.mockResolvedValue([{ side: "long", symbol: "MES", session_id: "a2" }] as unknown as never);
      const r = await checkCrossAccountHedge("topstep", "MES", "long", "s1");
      expect(r.blocked).toBe(false);
    });

    it("ALLOWS opposite on a DIFFERENT underlying (MES long + MNQ short)", async () => {
      mockExecute.mockResolvedValue([{ side: "short", symbol: "MNQ", session_id: "a2" }] as unknown as never);
      const r = await checkCrossAccountHedge("topstep", "MES", "long", "s1");
      expect(r.blocked).toBe(false);
    });

    it("no firm → not blocked", async () => {
      const r = await checkCrossAccountHedge(null, "MES", "long", "s1");
      expect(r.blocked).toBe(false);
    });

    it("FAIL-OPEN on DB read error (firm risk desk is the backstop)", async () => {
      // A malformed (non-iterable) DB result makes the gate's for-loop throw INSIDE the try,
      // exercising the catch block (same fail-open path as a real DB error) without leaving a
      // rejected promise for the test runner's unhandled-rejection tracker.
      mockExecute.mockResolvedValue(null as unknown as never);
      const r = await checkCrossAccountHedge("topstep", "MES", "long", "s1");
      expect(r.blocked).toBe(false);
    });
  });
});
