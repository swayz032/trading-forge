import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { strategies } from "../db/schema.js";

export const strategyRoutes = Router();

// List all strategies
strategyRoutes.get("/", async (_req, res) => {
  const rows = await db.select().from(strategies).orderBy(strategies.createdAt);
  res.json(rows);
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
  const { name, description, symbol, timeframe, config, status, tags } = req.body;
  const [row] = await db
    .update(strategies)
    .set({
      ...(name && { name }),
      ...(description && { description }),
      ...(symbol && { symbol }),
      ...(timeframe && { timeframe }),
      ...(config && { config }),
      ...(status && { status }),
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
