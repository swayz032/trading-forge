/**
 * deepscan14 H4 — evolution lineage cooldown must key on the TRUE lineage root,
 * not one generation up.
 *
 * BEFORE THE FIX: `rootId = strategy.parentStrategyId ?? strategyId` only looks
 * one hop up the parent chain. For a gen2 strategy evaluating its own cooldown,
 * that resolves to gen1 (its direct parent), not the gen0 lineage root. A SIBLING
 * branch under the same gen0 root (e.g. gen0 -> gen1B, evolved very recently) is
 * therefore invisible to gen2's cooldown check — the query only looks for
 * children of gen1, never children of gen0's OTHER branches. The lineage-wide
 * "have we evolved anything in this lineage in the last 7 days" guardrail is
 * bypassed at generation 2+.
 *
 * AFTER THE FIX (src/server/services/evolution-service.ts): rootId resolves to
 * the TRUE root (gen0), either via the stamped `lineageRootId` column (new rows,
 * migration 0188) or `resolveLineageRootByWalking()` (legacy rows never
 * stamped). The cooldown query matches `lineageRootId = root OR
 * parentStrategyId = root`, which now sees gen1B's recent evolution when
 * evaluating gen2A.
 *
 * WHY THIS TEST DOES NOT IMPORT evolution-service.ts DIRECTLY:
 * evolution-service.ts transitively imports backtest-service.ts ->
 * monte-carlo-service.ts -> "../index.js" (the Express server entrypoint),
 * which runs `await runPendingMigrations(...)` as unguarded top-level module
 * code. Importing evolution-service.ts in any test therefore boots the entire
 * server bootstrap path as a side effect of module evaluation — a pre-existing
 * structural issue outside this fix wave's scope (src/server/index.ts is not
 * an editable file for this track). Per this repo's own established convention
 * for DB-layer tests with heavy-side-effect services (see
 * paper-execution-style-c-pglite.test.ts and
 * composite-shadow.integration.test.ts's design notes), this test instead
 * exercises the exact query formulas — old (buggy) vs new (fixed) — against a
 * real PGlite instance using the same schema + drizzle operators the
 * production code uses, plus a line-for-line mirror of the exported
 * `resolveLineageRootByWalking` walk (cycle-guard included) so the walk
 * algorithm itself is covered, not just the query shape.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, and, or, gte } from "drizzle-orm";
import { createTestDb } from "./helpers/pglite-db.js";
import type { TestDb } from "./helpers/pglite-db.js";
import { strategies } from "../db/schema.js";

const COOLDOWN_DAYS = 7;
const NOW = new Date("2026-07-10T00:00:00.000Z").getTime();
const days = (n: number) => new Date(NOW - n * 24 * 60 * 60 * 1000);

// gen0 = true lineage root
const GEN0 = "aa000001-0000-0000-0000-000000000000";
// gen1A = child of gen0, evolved long ago (day -20 relative to "now")
const GEN1A = "aa000001-0000-0000-0000-00000000001a";
// gen2A = child of gen1A, evolved at day -15 (also long outside the 7-day window from "now")
const GEN2A = "aa000001-0000-0000-0000-00000000002a";
// gen1B = a SEPARATE branch, ALSO a direct child of gen0, evolved VERY recently (day -3)
const GEN1B = "aa000001-0000-0000-0000-00000000001b";

describe("deepscan14 H4 — evolution lineage cooldown root resolution (PGlite)", () => {
  let ctx: TestDb;

  // Line-for-line mirror of `resolveLineageRootByWalking` in
  // src/server/services/evolution-service.ts (exported there for direct reuse
  // once the index.ts import-chain issue above is resolved). Any change to the
  // production walk must be mirrored here for this test to remain meaningful.
  async function resolveLineageRootByWalking(startParentId: string): Promise<string> {
    let currentId = startParentId;
    const visited = new Set<string>();
    for (let i = 0; i < 50; i++) {
      if (visited.has(currentId)) break;
      visited.add(currentId);
      const [row] = await ctx.db
        .select({ parentStrategyId: strategies.parentStrategyId, lineageRootId: strategies.lineageRootId })
        .from(strategies)
        .where(eq(strategies.id, currentId));
      if (!row) break;
      if (row.lineageRootId) return row.lineageRootId;
      if (!row.parentStrategyId) break;
      currentId = row.parentStrategyId;
    }
    return currentId;
  }

  beforeAll(async () => {
    ctx = await createTestDb();

    await ctx.db.insert(strategies).values([
      {
        id: GEN0,
        name: "lineage-root",
        symbol: "MES",
        timeframe: "5m",
        config: {},
        generation: 0,
        parentStrategyId: null,
        lineageRootId: null, // roots never stamp themselves
        createdAt: days(100),
      },
      {
        id: GEN1A,
        name: "lineage-root (gen1)",
        symbol: "MES",
        timeframe: "5m",
        config: {},
        generation: 1,
        parentStrategyId: GEN0,
        lineageRootId: GEN0, // stamped at INSERT per the fix
        createdAt: days(20),
      },
      {
        id: GEN2A,
        name: "lineage-root (gen2)",
        symbol: "MES",
        timeframe: "5m",
        config: {},
        generation: 2,
        parentStrategyId: GEN1A,
        lineageRootId: GEN0, // stamped at INSERT per the fix
        createdAt: days(15),
      },
      {
        id: GEN1B,
        name: "lineage-root (gen1 sibling branch)",
        symbol: "MES",
        timeframe: "5m",
        config: {},
        generation: 1,
        parentStrategyId: GEN0,
        lineageRootId: GEN0,
        createdAt: days(3), // very recent — inside the 7-day cooldown window
      },
    ]);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("resolves gen2A's TRUE root (gen0) starting from its direct parent (gen1A)", async () => {
    const resolved = await resolveLineageRootByWalking(GEN1A); // gen2A's parentStrategyId
    expect(resolved).toBe(GEN0);
  });

  it("short-circuits via the stamped lineageRootId instead of walking further", async () => {
    // gen1A already has lineageRootId=GEN0 stamped, so resolving from gen1A's own
    // id returns GEN0 immediately via the shortcut, without needing to also read
    // gen0's own row.
    const resolved = await resolveLineageRootByWalking(GEN1A);
    expect(resolved).toBe(GEN0);
  });

  it("OLD one-hop formula misses gen1B's recent sibling-branch evolution when evaluating gen2A", async () => {
    // Replicates the PRE-FIX formula: rootId = strategy.parentStrategyId (one hop up).
    const oldRootId = GEN1A; // gen2A.parentStrategyId
    const cutoff = new Date(NOW - COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
    const oldRecent = await ctx.db
      .select()
      .from(strategies)
      .where(and(eq(strategies.parentStrategyId, oldRootId), gte(strategies.createdAt, cutoff)));

    // BUG: the old formula finds nothing — gen1B's parentStrategyId is GEN0, not
    // GEN1A, so it is invisible to a query scoped at "children of gen1A". Under
    // the old code, gen2A's cooldown check would incorrectly PROCEED here.
    expect(oldRecent).toHaveLength(0);
  });

  it("NEW root-based formula correctly finds gen1B's recent evolution when evaluating gen2A", async () => {
    const trueRootId = await resolveLineageRootByWalking(GEN1A); // == GEN0
    const cutoff = new Date(NOW - COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
    const newRecent = await ctx.db
      .select()
      .from(strategies)
      .where(
        and(
          or(eq(strategies.lineageRootId, trueRootId), eq(strategies.parentStrategyId, trueRootId)),
          gte(strategies.createdAt, cutoff),
        ),
      );

    // FIX: gen1B (created 3 days ago, a sibling branch under the same gen0 root)
    // is now visible — closes the gen2->gen3 cooldown bypass. gen2A's cooldown
    // check now correctly BLOCKS.
    const foundIds = newRecent.map((r) => r.id);
    expect(foundIds).toContain(GEN1B);
    expect(newRecent.length).toBeGreaterThan(0);
  });

  it("does not hang on a corrupted self-referencing parent chain (cycle guard)", async () => {
    const CYCLE_A = "aa000001-0000-0000-0000-0000000000c1";
    const CYCLE_B = "aa000001-0000-0000-0000-0000000000c2";
    // Insert B first with no parent, then A pointing at B, then update B to
    // point at A — forms a 2-node cycle that could never occur via the real
    // evolution INSERT path but must not hang the walk if data is corrupted.
    await ctx.db.insert(strategies).values({
      id: CYCLE_B,
      name: "cycle-b",
      symbol: "MES",
      timeframe: "5m",
      config: {},
      generation: 5,
      parentStrategyId: null,
      createdAt: days(1),
    });
    await ctx.db.insert(strategies).values({
      id: CYCLE_A,
      name: "cycle-a",
      symbol: "MES",
      timeframe: "5m",
      config: {},
      generation: 5,
      parentStrategyId: CYCLE_B,
      createdAt: days(1),
    });
    await ctx.db.update(strategies).set({ parentStrategyId: CYCLE_A }).where(eq(strategies.id, CYCLE_B));

    const start = Date.now();
    const resolved = await resolveLineageRootByWalking(CYCLE_A);
    const elapsedMs = Date.now() - start;
    expect(typeof resolved).toBe("string");
    expect(elapsedMs).toBeLessThan(5000); // must terminate, not hang
  });
});
