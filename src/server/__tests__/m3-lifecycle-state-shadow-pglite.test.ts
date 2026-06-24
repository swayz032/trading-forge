/**
 * m3-lifecycle-state-shadow-pglite.test.ts — 2026-06-23 hardening/phase-0
 *
 * M3 verification — UPDATE strategies SET lifecycle_state='SHADOW' must succeed
 * against a real Postgres instance with all production DDL applied.
 *
 * BACKGROUND
 * ----------
 * Wave 29 Pass A added SHADOW to lifecycle-service.ts VALID_STATES + created
 * lifecycle_shadow_signals table via migration 0160. The deep-scan finding M3
 * flagged it as unverified whether strategies.lifecycle_state had a pre-existing
 * CHECK constraint that would reject the new value at the DB layer.
 *
 * VERDICT (docs/m3-lifecycle-state-shadow-verification.md)
 * --------------------------------------------------------
 * Free TEXT column — no CHECK, no enum. The application VALID_STATES array in
 * lifecycle-service.ts is the single source of truth. Migration 0077 explicitly
 * documented this design intent (lines 17-25).
 *
 * THIS TEST
 * ---------
 * Belt-and-suspenders verification: spins up a fresh in-memory PGlite instance
 * with the production DDL (mirrors what live migrations create), inserts a
 * CANDIDATE-state strategy, then runs the full TESTING -> SHADOW -> PAPER
 * shadow-ladder UPDATE sequence and asserts every transition lands without
 * a constraint violation.
 *
 * If a future agent adds a CHECK constraint to strategies.lifecycle_state
 * that omits any of the VALID_STATES values, THIS TEST is the gate that catches
 * the regression at PR time (not at production-rollout time).
 *
 * Pattern mirrors src/server/__tests__/integration/paper-execution-style-c-pglite.test.ts.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./helpers/pglite-db.js";
import type { TestDb } from "./helpers/pglite-db.js";
import { strategies } from "../db/schema.js";

// ─── Test constants ────────────────────────────────────────────────────────────

const STRATEGY_UUID = "bbbb0003-0000-0000-0000-000000003003";

// VALID_STATES mirror from lifecycle-service.ts (Wave 29 Pass A baseline).
// If you add a new state to VALID_STATES, add it here too — the matrix loop
// below will catch CHECK-constraint regressions for the full set.
const VALID_LIFECYCLE_STATES = [
  "CANDIDATE",
  "TESTING",
  "SHADOW",          // <- Wave 29 Pass A addition, the M3 finding's focus
  "PAPER",
  "DEPLOY_READY",
  "PILOT",
  "DEPLOYED",
  "DECLINING",
  "RETIRED",
  "GRAVEYARD",
  "NEEDS_ARCHETYPE",
  "NEEDS_REVISION",
] as const;

// ─── Test lifecycle ────────────────────────────────────────────────────────────

let ctx: TestDb;

// PGlite WASM cold-start on the tower can take 10-30s on a cold cache;
// default 10s hook timeout is too tight. 60s mirrors what the other
// pglite suites need under cold-cache conditions.
beforeAll(async () => {
  ctx = await createTestDb();

  // Seed a single test strategy in CANDIDATE state. The strategies table DDL in
  // pglite-db.ts mirrors schema.ts column-for-column — see lines 70-105.
  await ctx.db.insert(strategies).values({
    id: STRATEGY_UUID,
    name: "m3-lifecycle-shadow-verification-fixture",
    symbol: "MES",
    symbols: ["MES"],
    timeframe: "5m",
    config: {},
    lifecycleState: "CANDIDATE",
    generation: 0,
  });
}, 60_000);

afterAll(async () => {
  if (ctx) await ctx.close();
}, 30_000);

// ─── M3 core — SHADOW UPDATE must not violate any constraint ──────────────────

describe("M3 — strategies.lifecycle_state accepts SHADOW value", () => {
  it("seeded fixture exists in CANDIDATE state", async () => {
    const row = await ctx.db
      .select({ id: strategies.id, lifecycleState: strategies.lifecycleState })
      .from(strategies)
      .where(eq(strategies.id, STRATEGY_UUID))
      .limit(1);

    expect(row).toHaveLength(1);
    expect(row[0].lifecycleState).toBe("CANDIDATE");
  });

  it("UPDATE lifecycle_state='SHADOW' succeeds without constraint violation (M3 core)", async () => {
    // This is the precise UPDATE the lifecycle-service.ts shadow promotion
    // path issues. If a CHECK constraint or enum without SHADOW existed, the
    // raw pg client would throw a 23514 check_violation here and the assertion
    // below would never run.
    await expect(
      ctx.db
        .update(strategies)
        .set({ lifecycleState: "SHADOW" })
        .where(eq(strategies.id, STRATEGY_UUID)),
    ).resolves.not.toThrow();

    // Round-trip read confirms the value persisted (not silently dropped/coerced).
    const row = await ctx.db
      .select({ lifecycleState: strategies.lifecycleState })
      .from(strategies)
      .where(eq(strategies.id, STRATEGY_UUID))
      .limit(1);

    expect(row[0].lifecycleState).toBe("SHADOW");
  });

  it("full TESTING -> SHADOW -> PAPER shadow-ladder round-trips without violation", async () => {
    for (const state of ["TESTING", "SHADOW", "PAPER"] as const) {
      await ctx.db
        .update(strategies)
        .set({ lifecycleState: state })
        .where(eq(strategies.id, STRATEGY_UUID));

      const row = await ctx.db
        .select({ lifecycleState: strategies.lifecycleState })
        .from(strategies)
        .where(eq(strategies.id, STRATEGY_UUID))
        .limit(1);

      expect(row[0].lifecycleState).toBe(state);
    }
  });

  // Matrix sweep — guarantees that ANY future CHECK constraint added later
  // must enumerate all VALID_STATES values, or this test fails at PR time.
  it.each(VALID_LIFECYCLE_STATES)(
    "every VALID_STATES value round-trips through UPDATE (state=%s)",
    async (state) => {
      await ctx.db
        .update(strategies)
        .set({ lifecycleState: state })
        .where(eq(strategies.id, STRATEGY_UUID));

      const row = await ctx.db
        .select({ lifecycleState: strategies.lifecycleState })
        .from(strategies)
        .where(eq(strategies.id, STRATEGY_UUID))
        .limit(1);

      expect(row[0].lifecycleState).toBe(state);
    },
  );
});
