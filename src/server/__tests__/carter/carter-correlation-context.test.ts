/**
 * carter-correlation-context.test.ts — deep-scan Carter F-1.
 *
 * Proves the ambient correlation context links the outer (req.id) and inner (action) Carter audit rows:
 * inside runWithCarterCorrelationId(reqId, …), getCarterCorrelationId() returns reqId, so
 * auditActionExecuted's `correlationId ?? getCarterCorrelationId() ?? randomUUID()` inherits req.id
 * instead of minting a fresh, unlinked UUID.
 */
import { describe, it, expect } from "vitest";
import {
  runWithCarterCorrelationId,
  getCarterCorrelationId,
} from "../../lib/carter/carter-correlation-context.js";

describe("carter correlation context (F-1: link route→action audit rows)", () => {
  it("getCarterCorrelationId() returns the ambient req.id inside the run scope", () => {
    const reqId = "req-abc-123";
    let seen: string | undefined;
    const ret = runWithCarterCorrelationId(reqId, () => {
      seen = getCarterCorrelationId();
      return "result";
    });
    expect(seen).toBe(reqId);
    expect(ret).toBe("result");
  });

  it("survives an await boundary (AsyncLocalStorage propagates through async handlers)", async () => {
    const reqId = "req-async-999";
    const seen = await runWithCarterCorrelationId(reqId, async () => {
      await Promise.resolve();
      return getCarterCorrelationId();
    });
    expect(seen).toBe(reqId);
  });

  it("returns undefined OUTSIDE any run scope (falls back to a fresh UUID, never throws)", () => {
    expect(getCarterCorrelationId()).toBeUndefined();
  });

  it("a null/undefined req.id runs the fn without a context (no throw, no ambient id)", () => {
    let seen: string | undefined = "sentinel";
    runWithCarterCorrelationId(null, () => { seen = getCarterCorrelationId(); });
    expect(seen).toBeUndefined();
  });

  it("the linking default prefers ambient id: correlationId ?? ambient ?? fresh", () => {
    // Mirrors auditActionExecuted's resolution order.
    const resolve = (passed: string | null | undefined) =>
      passed ?? getCarterCorrelationId() ?? "FRESH_UUID";
    runWithCarterCorrelationId("req-link-7", () => {
      expect(resolve(undefined)).toBe("req-link-7");     // no passed id → inherits req.id (the F-1 fix)
      expect(resolve("explicit")).toBe("explicit");       // an explicit id still wins
    });
    expect(resolve(undefined)).toBe("FRESH_UUID");        // outside scope → fresh
  });
});
