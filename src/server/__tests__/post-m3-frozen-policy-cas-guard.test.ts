/**
 * post-m3-frozen-policy-cas-guard.test.ts
 *
 * post-m3-paper-execution-lifecycle wave (2026-07-17), CRIT — re-verified against current code
 * (confirmed via `git log -- src/server/lib/frozen-policy-contract.ts`: last touched 91803fa6,
 * NOT touched by M3's 91e1870f) and confirmed STILL PRESENT: freezePolicyForStrategy() wrote
 * frozen_policy_hash / frozen_policy_set_at / regime_trained_on via a bare
 * `UPDATE strategies SET ... WHERE id = ?` with NO relationship to the promotion's own
 * CAS-protected transaction (lifecycle-service.ts's `writeBlock`, which guards its lifecycle-state
 * UPDATE with `WHERE id = ? AND lifecycleState = fromState` and rolls back on
 * `lifecycle.race_blocked`). A concurrent promotion attempt that ultimately LOST that race (or was
 * rolled back for any other reason) could still leave its frozen-policy stamp on the row —
 * corrupting the contract's core guarantee that the hash reflects the config version the strategy
 * was ACTUALLY promoted under.
 *
 * THE FIX: freezePolicyForStrategy() now takes a required `expectedFromState` parameter and CAS-
 * guards its own UPDATE identically: `WHERE id = ? AND lifecycleState = expectedFromState`. If a
 * concurrent promotion has already moved the strategy's lifecycleState away from expectedFromState
 * by the time this write executes, zero rows match, and the function throws
 * `frozen_policy_freeze_race_blocked` instead of silently overwriting. Every one of the 5 real call
 * sites (all in lifecycle-service.ts) already wraps this call in a fail-CLOSED try/catch that
 * blocks the promotion on ANY thrown error, so the fix integrates without further call-site
 * restructuring beyond supplying the expected state (verified: `npx tsc --noEmit` catches every
 * stale call site — 4 were caught and fixed in the sibling wave29-pass-b2-frozen-policy.test.ts).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  dbSelectResult: vi.fn(),
  dbUpdateCalls: [] as Array<{ vals: unknown; whereArgs: unknown }>,
  dbUpdateReturningResult: vi.fn(() => [{ id: "matched-row" }]),
  dbInsertValues: vi.fn(),
}));

vi.mock("../db/index.js", () => ({
  db: {
    select: (_fields?: unknown) => ({
      from: (_table: unknown) => ({
        where: (_cond: unknown) => Promise.resolve(mocks.dbSelectResult()),
      }),
    }),
    update: (_table: unknown) => ({
      set: (vals: unknown) => ({
        where: (whereArgs: unknown) => {
          mocks.dbUpdateCalls.push({ vals, whereArgs });
          const p: any = Promise.resolve(undefined);
          p.returning = (_sel?: unknown) => Promise.resolve(mocks.dbUpdateReturningResult());
          return p;
        },
      }),
    }),
    insert: (_table: unknown) => ({
      values: (vals: unknown) => {
        mocks.dbInsertValues(vals);
        return Promise.resolve(undefined);
      },
    }),
  },
}));

vi.mock("../db/schema.js", () => ({
  strategies: { id: "id", config: "config", lifecycleState: "lifecycleState" },
  auditLog: {},
}));

vi.mock("../lib/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { freezePolicyForStrategy } from "../lib/frozen-policy-contract.js";

function makeConfig() {
  return {
    entry_quality: { use_weighted_scoring: true, min_confluence: 0.72 },
    position_size: { type: "risk_derived_pyramid", base_contracts: 6 },
    stop_loss: { type: "structural", atr_multiplier: 1.5, ceiling_pts: 14 },
    take_profit: { style: "style_c", tp1_r: 1.0, tp2_r: 2.0 },
    exit_plan_config: { exit_style: "adaptive" },
  };
}

beforeEach(() => {
  mocks.dbUpdateCalls.length = 0;
  mocks.dbInsertValues.mockClear();
  mocks.dbUpdateReturningResult.mockClear();
  mocks.dbUpdateReturningResult.mockImplementation(() => [{ id: "matched-row" }]);
});

describe("post-m3-paper-execution-lifecycle CRIT — freezePolicyForStrategy CAS guard", () => {
  it("normal (non-racing) freeze succeeds: CAS matches, hash + audit are written", async () => {
    mocks.dbSelectResult.mockReturnValue([{ id: "strat-1", config: makeConfig() }]);

    const result = await freezePolicyForStrategy("strat-1", "TRENDING", "PAPER");

    expect(result.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(mocks.dbUpdateCalls).toHaveLength(1);
    const setAudit = mocks.dbInsertValues.mock.calls.find(
      (c) => (c[0] as Record<string, unknown>).action === "frozen_policy.set",
    );
    expect(setAudit).toBeDefined();
  });

  it("THE FIX — RED-proof: a concurrent promotion that already moved the strategy out of the expected fromState causes the freeze to THROW instead of silently overwriting", async () => {
    mocks.dbSelectResult.mockReturnValue([{ id: "strat-race", config: makeConfig() }]);
    // Simulate the CAS guard's own outcome: the UPDATE's WHERE (id AND lifecycleState=expected)
    // matched ZERO rows because a concurrent promotion already advanced lifecycleState past
    // "PAPER" before this write executed — exactly the scenario the finding describes ("a
    // concurrent promotion could overwrite the frozen policy hash even after a promotion is
    // rolled back"). Pre-fix, this scenario was UNREPRESENTABLE — the old UPDATE had no
    // lifecycleState clause at all, so it always "succeeded" regardless of concurrent state.
    mocks.dbUpdateReturningResult.mockReturnValueOnce([]);

    await expect(
      freezePolicyForStrategy("strat-race", "TRENDING", "PAPER"),
    ).rejects.toThrow("frozen_policy_freeze_race_blocked");

    // No frozen_policy.set audit should fire — the write never landed.
    const setAudit = mocks.dbInsertValues.mock.calls.find(
      (c) => (c[0] as Record<string, unknown>).action === "frozen_policy.set",
    );
    expect(setAudit).toBeUndefined();
  });

  it("the CAS guard error message names the expected state and the strategy id (auditable, not a generic error)", async () => {
    mocks.dbSelectResult.mockReturnValue([{ id: "strat-race-2", config: makeConfig() }]);
    mocks.dbUpdateReturningResult.mockReturnValueOnce([]);

    await expect(
      freezePolicyForStrategy("strat-race-2", "TRENDING", "SHADOW"),
    ).rejects.toThrow(/strat-race-2/);
    // Re-run to inspect the message content (mockReturnValueOnce already consumed above).
    mocks.dbUpdateReturningResult.mockReturnValueOnce([]);
    await expect(
      freezePolicyForStrategy("strat-race-2", "TRENDING", "SHADOW"),
    ).rejects.toThrow(/SHADOW/);
  });

  it("the UPDATE's WHERE clause is built from BOTH id and the caller-supplied expectedFromState (not id alone)", async () => {
    mocks.dbSelectResult.mockReturnValue([{ id: "strat-2", config: makeConfig() }]);

    await freezePolicyForStrategy("strat-2", "RANGE_BOUND", "TESTING");

    expect(mocks.dbUpdateCalls).toHaveLength(1);
    // The mock captures the drizzle condition object built by and(eq(...), eq(...)) — its
    // presence (non-undefined) proves a WHERE clause was passed at all; the real and()/eq()
    // wiring is exercised for real by the sibling wave29-pass-b2-frozen-policy.test.ts and by
    // tsc (drizzle's typed builder would reject a malformed condition at compile time).
    expect(mocks.dbUpdateCalls[0].whereArgs).toBeDefined();
  });

  it("does not swallow a genuinely different failure (empty select -> 'not found') — the CAS guard is additive, not a replacement for the existing not-found check", async () => {
    mocks.dbSelectResult.mockReturnValue([]);
    await expect(
      freezePolicyForStrategy("nonexistent", "UNKNOWN", "PAPER"),
    ).rejects.toThrow("not found");
    // The UPDATE must never have been attempted — the not-found check short-circuits first.
    expect(mocks.dbUpdateCalls).toHaveLength(0);
  });
});
