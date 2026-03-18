import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { strategies } from "../db/schema.js";
import { LifecycleService } from "../services/lifecycle-service.js";

export const strategyRoutes = Router();
const lifecycleService = new LifecycleService();

// List all strategies
strategyRoutes.get("/", async (_req, res) => {
  const rows = await db.select().from(strategies).orderBy(strategies.createdAt);
  res.json(rows);
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

// Delete strategy
strategyRoutes.delete("/:id", async (req, res) => {
  const [row] = await db
    .delete(strategies)
    .where(eq(strategies.id, req.params.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Strategy not found" });
    return;
  }
  res.json({ deleted: true });
});
