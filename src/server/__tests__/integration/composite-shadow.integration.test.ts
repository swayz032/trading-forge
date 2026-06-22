/**
 * composite-shadow.integration.test.ts — Wave hardening 2026-06-22, pglite real-DB test layer
 *
 * Integration test: evaluateCompositeShadow() reads from a REAL in-memory DB
 * (not a mock) using the actual Drizzle schema.
 *
 * TARGET BUG — G4 INTEGER-vs-UUID (2026-06-22):
 *   Before the fix, strategy_health_scores.strategy_id was declared as INTEGER
 *   in the schema.ts type, but the DB column stores UUID strings.  A Drizzle
 *   WHERE clause with a UUID string against an INTEGER column produces 0 rows
 *   on PostgreSQL (type coercion fails silently), leaving the gate permanently
 *   NO_OPINION even when a health score row exists.  This test would have been
 *   RED before the fix — it proves the fix holds.
 *
 * WHAT IS TESTED:
 *   1. Insert a strategy row with a known UUID into strategies table.
 *   2. Insert a strategy_health_scores row keyed by that same UUID.
 *   3. Call evaluateCompositeShadow(uuid) against the real PGlite DB.
 *   4. Assert the result is NOT NO_OPINION — the row was found and read.
 *   5. Assert composite_score and verdict match what was inserted.
 *
 * NOTE: evaluateCompositeShadow() imports db from "../db/index.js" in production.
 * We swap that import at test time by monkey-patching the module — this is the
 * standard pattern for PGlite integration tests in this layer.  The function
 * itself is otherwise called with no changes.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createTestDb } from "../helpers/pglite-db.js";
import type { TestDb } from "../helpers/pglite-db.js";

// ─── Test fixtures ─────────────────────────────────────────────────────────────

const STRATEGY_UUID = "11111111-1111-1111-1111-111111111111";
const WEIGHTS_VERSION_ID = "abc123def456abc123def456abc123def456abc123def456abc123def456abc123";

// ─── DB injection helper ──────────────────────────────────────────────────────
//
// evaluateCompositeShadow() imports `db` from "../../db/index.js" and calls
// db.select().from(strategyHealthScores).where(eq(strategyHealthScores.strategyId, id)).
//
// We test the query logic by calling it with our PGlite db swapped in via vi.mock.
// Since vi.mock is hoisted, we use a module-level variable to hold the injected db.

let injectedDb: TestDb["db"] | null = null;

// Mock the db module so the function under test uses our PGlite instance
vi.mock("../../db/index.js", () => ({
  get db() {
    return injectedDb;
  },
}));

// Import AFTER mock registration (vitest hoists vi.mock calls)
import { evaluateCompositeShadow } from "../../lib/composite-shadow-gate.js";
import { strategyHealthScores, strategies } from "../../db/schema.js";

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("composite-shadow.integration — G4 UUID key-path", () => {
  let ctx: TestDb;

  beforeAll(async () => {
    ctx = await createTestDb();
    injectedDb = ctx.db;

    // 1. Insert a strategy row (required by FK on strategy_health_scores)
    await ctx.db.insert(strategies).values({
      id: STRATEGY_UUID,
      name: "test-strategy",
      symbol: "MES",
      timeframe: "5m",
      config: {},
    });

    // 2. Insert a strategy_health_scores row keyed by UUID strategy_id.
    //    Before the G4 fix this would silently produce 0 SELECT rows because
    //    the schema declared strategy_id as INTEGER — a UUID string cannot be
    //    compared to INTEGER in PostgreSQL.
    await ctx.db.insert(strategyHealthScores).values({
      strategyId: STRATEGY_UUID,
      compositeScore: 0.82,
      verdict: "HEALTHY",
      subsystemScores: { trend: { score: 0.9, available: true } },
      computedFromNSubsystems: 5,
      weightsVersionId: WEIGHTS_VERSION_ID,
      stalenessAgeHours: 2.5,
    });
  });

  afterAll(async () => {
    injectedDb = null;
    await ctx.close();
  });

  it("finds the health score row by UUID strategy_id (not NO_OPINION)", async () => {
    const result = await evaluateCompositeShadow(STRATEGY_UUID);

    // The core regression: if G4 bug returns, this is NO_OPINION because
    // the WHERE clause finds 0 rows (UUID string vs INTEGER type mismatch).
    expect(result.shadow_decision).not.toBe("NO_OPINION");
    expect(result.availability).toBe("available");
  });

  it("returns the correct composite_score from the inserted row", async () => {
    const result = await evaluateCompositeShadow(STRATEGY_UUID);

    // Composite score should match exactly what we inserted
    expect(result.composite_score).toBeCloseTo(0.82, 4);
  });

  it("returns WOULD_PROMOTE for a HEALTHY strategy (score >= 0.75)", async () => {
    const result = await evaluateCompositeShadow(STRATEGY_UUID);

    // HEALTHY verdict → WOULD_PROMOTE per the shadow decision mapping
    expect(result.shadow_decision).toBe("WOULD_PROMOTE");
    expect(result.verdict).toBe("HEALTHY");
  });

  it("returns weights_version_id matching the inserted row", async () => {
    const result = await evaluateCompositeShadow(STRATEGY_UUID);

    expect(result.weights_version_id).toBe(WEIGHTS_VERSION_ID);
  });

  it("returns NO_OPINION for an unknown strategy UUID (no row)", async () => {
    const unknownUuid = "99999999-9999-9999-9999-999999999999";
    const result = await evaluateCompositeShadow(unknownUuid);

    expect(result.shadow_decision).toBe("NO_OPINION");
    expect(result.availability).toBe("missing");
  });
});
