/**
 * deepscan14 E7 — backtests.idempotency_key persistence integrity (PGlite).
 *
 * backtests previously had no idempotency key: a bare random-UUID insert meant
 * n8n retry / dual-fire could silently create a second row for the same logical
 * backtest, double-counting downstream MC/WFE/pattern-aggregator statistics.
 *
 * Migration 0188 adds `idempotency_key TEXT` + a PARTIAL unique index (only
 * enforced when a caller supplies a key). backtest-service.ts's runBacktest()
 * mirrors the fill-reconciliation-service.ts / n8n-execution-scraper-service.ts
 * pattern: INSERT ... ON CONFLICT (idempotency_key) DO NOTHING, then re-SELECT
 * the winner's row on conflict.
 *
 * These tests exercise the DB layer directly against a real PGlite instance
 * (not a mocked db module) so a producer/schema disconnect — e.g. CORE_DDL
 * missing the column, or the partial index predicate drifting from the
 * migration — is caught structurally, matching the gate-chain-integration.test.ts
 * convention documented in this repo (45% of the suite mocks the DB, which is
 * structurally incapable of catching this bug class).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createTestDb } from "./helpers/pglite-db.js";
import type { TestDb } from "./helpers/pglite-db.js";
import { backtests, strategies } from "../db/schema.js";

const STRAT_ID = "ee110001-0000-0000-0000-000000000001";

// Postgres requires the ON CONFLICT arbiter to restate a partial index's exact
// predicate to infer it — mirrors the `where` clause backtest-service.ts uses
// against migration 0188's `WHERE idempotency_key IS NOT NULL` unique index.
const IDEMPOTENCY_KEY_ARBITER = {
  target: backtests.idempotencyKey,
  where: sql`idempotency_key IS NOT NULL`,
} as const;

function baseBacktestRow(id: string, overrides: Partial<typeof backtests.$inferInsert> = {}) {
  return {
    id,
    strategyId: STRAT_ID,
    symbol: "MES",
    timeframe: "5m",
    startDate: new Date("2025-01-01"),
    endDate: new Date("2025-06-01"),
    status: "running",
    ...overrides,
  };
}

describe("deepscan14 E7 — backtests.idempotency_key (PGlite persistence integrity)", () => {
  let ctx: TestDb;

  beforeAll(async () => {
    ctx = await createTestDb();
    await ctx.db.insert(strategies).values({
      id: STRAT_ID,
      name: "idempotency-integration-test",
      symbol: "MES",
      timeframe: "5m",
      config: {},
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("a duplicate enqueue with the same idempotency_key does NOT create a second row", async () => {
    const key = "n8n-exec-12345-fold-1";
    const firstId = "ee110001-0000-0000-0000-0000000000a1";
    const secondId = "ee110001-0000-0000-0000-0000000000a2"; // different row id, same key

    // First "enqueue" — mirrors backtest-service.ts's INSERT ... ON CONFLICT DO NOTHING.
    const firstInsert = await ctx.db
      .insert(backtests)
      .values(baseBacktestRow(firstId, { idempotencyKey: key }))
      .onConflictDoNothing(IDEMPOTENCY_KEY_ARBITER)
      .returning();
    expect(firstInsert).toHaveLength(1);
    expect(firstInsert[0].id).toBe(firstId);

    // Second "enqueue" — a retry/dual-fire with a FRESH row id but the SAME
    // idempotency key. Must be a no-op at the DB layer.
    const secondInsert = await ctx.db
      .insert(backtests)
      .values(baseBacktestRow(secondId, { idempotencyKey: key }))
      .onConflictDoNothing(IDEMPOTENCY_KEY_ARBITER)
      .returning();
    expect(secondInsert).toHaveLength(0); // conflict — nothing inserted

    // The caller re-selects by idempotencyKey and converges on the original row.
    const rowsByKey = await ctx.db.select().from(backtests).where(eq(backtests.idempotencyKey, key));
    expect(rowsByKey).toHaveLength(1);
    expect(rowsByKey[0].id).toBe(firstId);

    // The second row id was never persisted at all.
    const bySecondId = await ctx.db.select().from(backtests).where(eq(backtests.id, secondId));
    expect(bySecondId).toHaveLength(0);
  });

  it("different idempotency keys create distinct rows (no over-broad dedup)", async () => {
    const idA = "ee110001-0000-0000-0000-0000000000b1";
    const idB = "ee110001-0000-0000-0000-0000000000b2";

    await ctx.db
      .insert(backtests)
      .values(baseBacktestRow(idA, { idempotencyKey: "key-b-1" }))
      .onConflictDoNothing(IDEMPOTENCY_KEY_ARBITER)
      .returning();
    await ctx.db
      .insert(backtests)
      .values(baseBacktestRow(idB, { idempotencyKey: "key-b-2" }))
      .onConflictDoNothing(IDEMPOTENCY_KEY_ARBITER)
      .returning();

    const rowA = await ctx.db.select().from(backtests).where(eq(backtests.id, idA));
    const rowB = await ctx.db.select().from(backtests).where(eq(backtests.id, idB));
    expect(rowA).toHaveLength(1);
    expect(rowB).toHaveLength(1);
  });

  it("rows WITHOUT an idempotency_key keep current (unconstrained) behavior", async () => {
    // Two callers that never supply a key must NOT be deduped against each
    // other — the partial index only fires WHERE idempotency_key IS NOT NULL.
    const idC = "ee110001-0000-0000-0000-0000000000c1";
    const idD = "ee110001-0000-0000-0000-0000000000c2";

    const insertC = await ctx.db
      .insert(backtests)
      .values(baseBacktestRow(idC)) // no idempotencyKey
      .returning();
    const insertD = await ctx.db
      .insert(backtests)
      .values(baseBacktestRow(idD)) // also no idempotencyKey
      .returning();

    expect(insertC).toHaveLength(1);
    expect(insertD).toHaveLength(1);

    const nullKeyRows = await ctx.db.select().from(backtests).where(eq(backtests.strategyId, STRAT_ID));
    // Every row inserted across this describe block plus the two NULL-key rows
    // here must all be present — none silently dropped by the partial index.
    const ids = nullKeyRows.map((r) => r.id);
    expect(ids).toContain(idC);
    expect(ids).toContain(idD);
  });
});
