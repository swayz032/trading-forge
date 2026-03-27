import { Router } from "express";
import { eq, sql, desc, and, ilike } from "drizzle-orm";
import { db } from "../db/index.js";
import { strategies, strategyNames, backtests, backtestTrades, monteCarloRuns, stressTestRuns, backtestMatrix, systemJournal, complianceReviews, paperSessions, skipDecisions, strategyGraveyard } from "../db/schema.js";
import { inArray } from "drizzle-orm";
import { LifecycleService } from "../services/lifecycle-service.js";

export const strategyRoutes = Router();
const lifecycleService = new LifecycleService();

// List all strategies (with optional pagination + filters)
strategyRoutes.get("/", async (req, res) => {
  const { limit, offset, name, lifecycleState, symbol } = req.query;

  // Build filter conditions
  const conditions = [];
  if (name) conditions.push(ilike(strategies.name, `%${String(name)}%`));
  if (lifecycleState) conditions.push(eq(strategies.lifecycleState, String(lifecycleState)));
  if (symbol) conditions.push(eq(strategies.symbol, String(symbol)));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  if (limit) {
    // Paginated mode
    const countQuery = where
      ? db.select({ count: sql<number>`count(*)::int` }).from(strategies).where(where)
      : db.select({ count: sql<number>`count(*)::int` }).from(strategies);
    const [{ count: total }] = await countQuery;

    let query = db.select().from(strategies).where(where).orderBy(desc(strategies.createdAt));
    query = query.limit(Number(limit)) as typeof query;
    if (offset) {
      query = query.offset(Number(offset)) as typeof query;
    }
    const rows = await query;
    res.json({ data: rows, total });
  } else {
    // Non-paginated (backward compatible)
    const rows = await db.select().from(strategies).where(where).orderBy(strategies.createdAt);
    res.json(rows);
  }
});

// Pipeline health
strategyRoutes.get("/pipeline", async (_req, res) => {
  const health = await lifecycleService.getPipelineHealth();
  res.json(health);
});

// Get single strategy
strategyRoutes.get("/:id", async (req, res) => {
  const [row] = await db
    .select()
    .from(strategies)
    .where(eq(strategies.id, req.params.id));
  if (!row) {
    res.status(404).json({ error: "Strategy not found" });
    return;
  }
  res.json(row);
});

// Create strategy
strategyRoutes.post("/", async (req, res) => {
  const { name, description, symbol, timeframe, config, tags } = req.body;
  const [row] = await db
    .insert(strategies)
    .values({ name, description, symbol, timeframe, config, tags })
    .returning();
  res.status(201).json(row);
});

// Update strategy
strategyRoutes.patch("/:id", async (req, res) => {
  const { name, description, symbol, timeframe, config, lifecycleState, tags } = req.body;
  const [row] = await db
    .update(strategies)
    .set({
      ...(name && { name }),
      ...(description && { description }),
      ...(symbol && { symbol }),
      ...(timeframe && { timeframe }),
      ...(config && { config }),
      ...(lifecycleState && { lifecycleState }),
      ...(tags && { tags }),
      updatedAt: new Date(),
    })
    .where(eq(strategies.id, req.params.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Strategy not found" });
    return;
  }
  res.json(row);
});

// Transition lifecycle state
strategyRoutes.patch("/:id/lifecycle", async (req, res) => {
  const { fromState, toState } = req.body;
  if (!fromState || !toState) {
    res.status(400).json({ error: "fromState and toState required" });
    return;
  }

  const result = await lifecycleService.promoteStrategy(req.params.id, fromState, toState);
  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }

  res.json({ success: true, id: req.params.id, newState: toState });
});

// POST /api/strategies/lifecycle/check — trigger auto-promotion and demotion checks
strategyRoutes.post("/lifecycle/check", async (_req, res) => {
  try {
    const [promotions, demotions] = await Promise.all([
      lifecycleService.checkAutoPromotions(),
      lifecycleService.checkAutoDemotions(),
    ]);
    res.json({ promotions, demotions });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Delete strategy (cascades to all dependent records)
strategyRoutes.delete("/:id", async (req, res) => {
  const strategyId = req.params.id;

  // Find backtest IDs for this strategy
  const btRows = await db.select({ id: backtests.id }).from(backtests).where(eq(backtests.strategyId, strategyId));
  const btIds = btRows.map((r) => r.id);

  // Delete backtest-dependent records
  if (btIds.length > 0) {
    await db.delete(backtestTrades).where(inArray(backtestTrades.backtestId, btIds));
    await db.delete(monteCarloRuns).where(inArray(monteCarloRuns.backtestId, btIds));
    await db.delete(stressTestRuns).where(inArray(stressTestRuns.backtestId, btIds));
  }

  // Delete strategy-dependent records
  await db.delete(backtests).where(eq(backtests.strategyId, strategyId));
  await db.delete(backtestMatrix).where(eq(backtestMatrix.strategyId, strategyId));
  await db.delete(systemJournal).where(eq(systemJournal.strategyId, strategyId));
  await db.delete(complianceReviews).where(eq(complianceReviews.strategyId, strategyId));
  await db.delete(paperSessions).where(eq(paperSessions.strategyId, strategyId));
  await db.delete(skipDecisions).where(eq(skipDecisions.strategyId, strategyId));
  await db.delete(strategyGraveyard).where(eq(strategyGraveyard.strategyId, strategyId));

  // Delete the strategy itself
  const [row] = await db.delete(strategies).where(eq(strategies.id, strategyId)).returning();
  if (!row) {
    res.status(404).json({ error: "Strategy not found" });
    return;
  }
  res.json({ deleted: true });
});
