/**
 * pine-export-shadow-guard.test.ts — Pass 3 Track C (2026-06-22)
 *
 * Unit tests for assertNotShadow() + PineExportShadowError.
 *
 * Covers:
 *   C4.1 passes for lifecycleState='PAPER', shadowModeEnabled=false
 *   C4.2 throws PineExportShadowError for lifecycleState='SHADOW'
 *   C4.3 throws for shadowModeEnabled=true regardless of lifecycleState
 *   C4.4 throws for missing strategy (fail-CLOSED)
 *   C4.5 error message contains strategyId
 *   C4.6 throws for SHADOW state even when shadowModeEnabled=false
 *   C4.7 passes for PAPER state with shadowModeEnabled=false
 *   C4.8 throws for TESTING state with shadowModeEnabled=true
 *   C4.9 DB lookup failure fails CLOSED
 *   C4.10 error is an instance of PineExportShadowError (class check)
 */

import { describe, it, expect, vi } from "vitest";
import {
  assertNotShadow,
  PineExportShadowError,
} from "../pine-export-shadow-guard.js";

// ─── Mock DB factory ──────────────────────────────────────────────────────────

interface StrategyRow {
  lifecycleState: string;
  shadowModeEnabled: boolean;
}

/**
 * Build a minimal Drizzle-shaped mock that returns the given rows for any
 * .select().from().where() chain call.
 */
function mockDbReturning(rows: StrategyRow[]): unknown {
  const selectChain = {
    from: () => ({
      where: () => Promise.resolve(rows),
    }),
  };
  return {
    select: () => selectChain,
  };
}

/** Mock DB that throws on .select() */
function mockDbThrowing(err: Error): unknown {
  return {
    select: () => {
      throw err;
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("assertNotShadow", () => {
  const TEST_STRATEGY_ID = "00000000-0000-0000-0000-000000000001";

  // C4.1: Clean PAPER strategy → no error
  it("C4.1: passes for lifecycleState=PAPER, shadowModeEnabled=false", async () => {
    const db = mockDbReturning([
      { lifecycleState: "PAPER", shadowModeEnabled: false },
    ]);
    await expect(assertNotShadow(TEST_STRATEGY_ID, db)).resolves.toBeUndefined();
  });

  // C4.2: SHADOW lifecycle state → throws
  it("C4.2: throws PineExportShadowError for lifecycleState=SHADOW", async () => {
    const db = mockDbReturning([
      { lifecycleState: "SHADOW", shadowModeEnabled: false },
    ]);
    await expect(assertNotShadow(TEST_STRATEGY_ID, db)).rejects.toThrow(
      PineExportShadowError,
    );
  });

  // C4.3: shadowModeEnabled=true with any lifecycleState → throws
  it("C4.3: throws for shadowModeEnabled=true on PAPER strategy", async () => {
    const db = mockDbReturning([
      { lifecycleState: "PAPER", shadowModeEnabled: true },
    ]);
    await expect(assertNotShadow(TEST_STRATEGY_ID, db)).rejects.toThrow(
      PineExportShadowError,
    );
  });

  it("C4.3b: throws for shadowModeEnabled=true on TESTING strategy", async () => {
    const db = mockDbReturning([
      { lifecycleState: "TESTING", shadowModeEnabled: true },
    ]);
    await expect(assertNotShadow(TEST_STRATEGY_ID, db)).rejects.toThrow(
      PineExportShadowError,
    );
  });

  // C4.4: Missing strategy → fail-CLOSED
  it("C4.4: throws for missing strategy (fail-CLOSED)", async () => {
    const db = mockDbReturning([]); // empty rows = strategy not found
    await expect(assertNotShadow(TEST_STRATEGY_ID, db)).rejects.toThrow(
      PineExportShadowError,
    );
  });

  // C4.5: Error message contains strategyId
  it("C4.5: error message contains the strategy id for SHADOW state", async () => {
    const db = mockDbReturning([
      { lifecycleState: "SHADOW", shadowModeEnabled: false },
    ]);
    try {
      await assertNotShadow(TEST_STRATEGY_ID, db);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(PineExportShadowError);
      expect((err as PineExportShadowError).message).toContain(TEST_STRATEGY_ID);
    }
  });

  it("C4.5b: error message contains the strategy id for missing strategy", async () => {
    const db = mockDbReturning([]);
    try {
      await assertNotShadow(TEST_STRATEGY_ID, db);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(PineExportShadowError);
      expect((err as PineExportShadowError).message).toContain(TEST_STRATEGY_ID);
    }
  });

  // C4.6: SHADOW state even when shadowModeEnabled=false
  it("C4.6: throws for SHADOW state regardless of shadowModeEnabled", async () => {
    const db = mockDbReturning([
      { lifecycleState: "SHADOW", shadowModeEnabled: false },
    ]);
    const err = await assertNotShadow(TEST_STRATEGY_ID, db).catch((e) => e);
    expect(err).toBeInstanceOf(PineExportShadowError);
    expect((err as PineExportShadowError).lifecycleState).toBe("SHADOW");
  });

  // C4.7: Clean PAPER strategy → resolves
  it("C4.7: resolves cleanly for PAPER lifecycle with shadowModeEnabled=false", async () => {
    const db = mockDbReturning([
      { lifecycleState: "PAPER", shadowModeEnabled: false },
    ]);
    await expect(assertNotShadow(TEST_STRATEGY_ID, db)).resolves.not.toThrow();
  });

  // C4.8: TESTING + shadowModeEnabled=true → throws
  it("C4.8: throws for TESTING state with shadowModeEnabled=true", async () => {
    const db = mockDbReturning([
      { lifecycleState: "TESTING", shadowModeEnabled: true },
    ]);
    const err = await assertNotShadow(TEST_STRATEGY_ID, db).catch((e) => e);
    expect(err).toBeInstanceOf(PineExportShadowError);
    expect((err as PineExportShadowError).shadowModeEnabled).toBe(true);
  });

  // C4.9: DB lookup failure → fail-CLOSED
  it("C4.9: DB lookup failure fails CLOSED", async () => {
    const db = mockDbThrowing(new Error("DB connection error"));
    const err = await assertNotShadow(TEST_STRATEGY_ID, db).catch((e) => e);
    expect(err).toBeInstanceOf(PineExportShadowError);
    expect((err as PineExportShadowError).message).toContain(TEST_STRATEGY_ID);
  });

  // C4.10: error is an instance of PineExportShadowError (class check)
  it("C4.10: thrown error is instance of PineExportShadowError", async () => {
    const db = mockDbReturning([
      { lifecycleState: "SHADOW", shadowModeEnabled: false },
    ]);
    const err = await assertNotShadow(TEST_STRATEGY_ID, db).catch((e) => e);
    expect(err instanceof PineExportShadowError).toBe(true);
    expect(err.name).toBe("PineExportShadowError");
  });

  // DEPLOY_READY, PILOT, DEPLOYED: all should PASS
  it("passes for DEPLOY_READY with shadowModeEnabled=false", async () => {
    const db = mockDbReturning([
      { lifecycleState: "DEPLOY_READY", shadowModeEnabled: false },
    ]);
    await expect(assertNotShadow(TEST_STRATEGY_ID, db)).resolves.toBeUndefined();
  });

  it("passes for DEPLOYED with shadowModeEnabled=false", async () => {
    const db = mockDbReturning([
      { lifecycleState: "DEPLOYED", shadowModeEnabled: false },
    ]);
    await expect(assertNotShadow(TEST_STRATEGY_ID, db)).resolves.toBeUndefined();
  });
});

// ─── PineExportShadowError class ──────────────────────────────────────────────

describe("PineExportShadowError", () => {
  it("is instanceof Error and PineExportShadowError", () => {
    const err = new PineExportShadowError(
      "test-id",
      "SHADOW",
      false,
      "shadow_state",
    );
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(PineExportShadowError);
  });

  it("exposes strategyId, lifecycleState, shadowModeEnabled", () => {
    const err = new PineExportShadowError(
      "test-id",
      "SHADOW",
      true,
      "shadow_state",
    );
    expect(err.strategyId).toBe("test-id");
    expect(err.lifecycleState).toBe("SHADOW");
    expect(err.shadowModeEnabled).toBe(true);
  });

  it("message includes strategyId for missing strategy", () => {
    const err = new PineExportShadowError(
      "missing-id",
      null,
      false,
      "strategy_not_found",
    );
    expect(err.message).toContain("missing-id");
    expect(err.message).toContain("not found");
  });
});
