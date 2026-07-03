/**
 * deepscan14-cf H4b — evolution mutation-history context must key on the
 * TRUE lineage root, not one generation up.
 *
 * `evolveStrategy()` in src/server/services/evolution-service.ts already had
 * this exact one-hop bug fixed ONCE for the 7-day cooldown check (deepscan14
 * H4, see deepscan14-evolution-lineage-cooldown.test.ts):
 *
 *     const rootId = strategy.lineageRootId
 *       ?? (strategy.parentStrategyId ? await resolveLineageRootByWalking(strategy.parentStrategyId) : strategyId);
 *
 * A few lines further down, a SECOND, independent computation of the same
 * concept survived unfixed:
 *
 *     const lineageRootId = strategy.parentStrategyId ?? strategyId;   // BUG (one hop)
 *
 * `lineageRootId` feeds the prior-mutation-outcomes query that builds the
 * LLM's `mutation_history` context. For a gen2 strategy, the buggy line
 * resolved to gen1 (its direct parent) instead of gen0 (the true lineage
 * root) — the same one-hop miss H4 closed for cooldown, left open here.
 *
 * THE FIX: reuse the already-resolved `rootId` local (computed once, a few
 * lines above, via the stamped `lineageRootId` column or
 * `resolveLineageRootByWalking()`) instead of recomputing a second,
 * independently-buggy one-hop value. This also means the two lineage
 * concepts in the function can never drift apart again — there is only one
 * root-resolution call site now, not two.
 *
 * WHY THIS TEST DOES NOT IMPORT evolution-service.ts DIRECTLY: same reason
 * documented in deepscan14-evolution-lineage-cooldown.test.ts —
 * evolution-service.ts transitively imports backtest-service.ts ->
 * monte-carlo-service.ts -> "../index.js", which runs unguarded top-level
 * migration bootstrap as an import side effect. This test instead (a) proves
 * the buggy pattern is gone from source and the fixed pattern (variable
 * reuse) is present, and (b) behaviorally proves — via the same PGlite
 * lineage fixture used by the H4 cooldown test plus a mirror of the exported
 * `resolveLineageRootByWalking` — that resolving root once and reusing it
 * for both purposes yields the TRUE root (gen0) for a gen2 descendant,
 * where the old one-hop formula stopped at gen1.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { eq } from "drizzle-orm";
import { createTestDb } from "./helpers/pglite-db.js";
import type { TestDb } from "./helpers/pglite-db.js";
import { strategies } from "../db/schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVOLUTION_SERVICE_PATH = resolve(__dirname, "../services/evolution-service.ts");

const GEN0 = "bb000001-0000-0000-0000-000000000000";
const GEN1A = "bb000001-0000-0000-0000-00000000001a";
const GEN2A = "bb000001-0000-0000-0000-00000000002a";

describe("deepscan14-cf H4b — evolution mutation-history root resolution", () => {
  describe("source-level regression guard", () => {
    const source = readFileSync(EVOLUTION_SERVICE_PATH, "utf-8");

    it("no longer recomputes lineageRootId via the one-hop formula", () => {
      // The exact pre-fix bug: a second, independent one-hop resolution
      // (`strategy.parentStrategyId ?? strategyId`) that must never
      // reappear once `rootId` above already resolves the true root.
      expect(source).not.toMatch(/const lineageRootId = strategy\.parentStrategyId \?\? strategyId;/);
    });

    it("reuses the already-resolved rootId for the mutation-history lineage key", () => {
      expect(source).toMatch(/const lineageRootId = rootId;/);
    });
  });

  describe("behavioral: root resolution used for mutation history matches the true lineage root (PGlite)", () => {
    let ctx: TestDb;

    // Line-for-line mirror of `resolveLineageRootByWalking` in
    // src/server/services/evolution-service.ts (see deepscan14 H4 test for
    // the canonical copy this mirrors).
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
          name: "h4b-lineage-root",
          symbol: "MES",
          timeframe: "5m",
          config: {},
          generation: 0,
          parentStrategyId: null,
          lineageRootId: null,
        },
        {
          id: GEN1A,
          name: "h4b-lineage-root (gen1)",
          symbol: "MES",
          timeframe: "5m",
          config: {},
          generation: 1,
          parentStrategyId: GEN0,
          lineageRootId: GEN0,
        },
        {
          id: GEN2A,
          name: "h4b-lineage-root (gen2)",
          symbol: "MES",
          timeframe: "5m",
          config: {},
          generation: 2,
          parentStrategyId: GEN1A,
          lineageRootId: GEN0,
        },
      ]);
    });

    afterAll(async () => {
      await ctx.close();
    });

    it("OLD one-hop formula resolves gen2A's mutation-history root to gen1 (WRONG)", async () => {
      const [gen2a] = await ctx.db.select().from(strategies).where(eq(strategies.id, GEN2A));
      const oldLineageRootId = gen2a.parentStrategyId ?? GEN2A; // pre-fix formula
      expect(oldLineageRootId).toBe(GEN1A);
      expect(oldLineageRootId).not.toBe(GEN0);
    });

    it("NEW formula (reusing the resolved rootId) resolves gen2A's mutation-history root to gen0 (TRUE root)", async () => {
      const [gen2a] = await ctx.db.select().from(strategies).where(eq(strategies.id, GEN2A));
      const rootId = gen2a.lineageRootId
        ?? (gen2a.parentStrategyId ? await resolveLineageRootByWalking(gen2a.parentStrategyId) : GEN2A);
      const lineageRootId = rootId; // mirrors the fixed `const lineageRootId = rootId;` line
      expect(lineageRootId).toBe(GEN0);
    });

    it("legacy unstamped row still resolves via the parent-chain walk, not a one-hop guess", async () => {
      const LEGACY_GEN1 = "bb000001-0000-0000-0000-000000000ab1";
      const LEGACY_GEN2 = "bb000001-0000-0000-0000-000000000ab2";
      await ctx.db.insert(strategies).values([
        {
          id: LEGACY_GEN1,
          name: "h4b-legacy-gen1",
          symbol: "MES",
          timeframe: "5m",
          config: {},
          generation: 1,
          parentStrategyId: GEN0,
          lineageRootId: null, // never stamped (pre-migration-0188 row)
        },
        {
          id: LEGACY_GEN2,
          name: "h4b-legacy-gen2",
          symbol: "MES",
          timeframe: "5m",
          config: {},
          generation: 2,
          parentStrategyId: LEGACY_GEN1,
          lineageRootId: null, // never stamped
        },
      ]);

      const [legacyGen2] = await ctx.db.select().from(strategies).where(eq(strategies.id, LEGACY_GEN2));
      const oldLineageRootId = legacyGen2.parentStrategyId ?? LEGACY_GEN2; // pre-fix formula
      const rootId = legacyGen2.lineageRootId
        ?? (legacyGen2.parentStrategyId ? await resolveLineageRootByWalking(legacyGen2.parentStrategyId) : LEGACY_GEN2);

      expect(oldLineageRootId).toBe(LEGACY_GEN1); // old bug: stops one hop up
      expect(rootId).toBe(GEN0); // fix: walks all the way to the true root
    });
  });
});
