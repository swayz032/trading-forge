/**
 * Strategy Names Routes — Manage the Forge codename pool.
 *
 * GET  /api/strategy-names          — Pool overview (claimed/available/retired counts + list)
 * GET  /api/strategy-names/available — List unclaimed names
 * GET  /api/strategy-names/:id      — Get specific name entry
 */

import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db } from "../db/index.js";
import { strategyNames } from "../db/schema.js";

export const strategyNameRoutes = Router();

// ─── GET /api/strategy-names — Pool overview ──────────────────
strategyNameRoutes.get("/", async (_req, res) => {
  const all = await db.select().from(strategyNames).orderBy(strategyNames.codename);

  const claimed = all.filter((n) => n.claimed);
  const available = all.filter((n) => !n.claimed && !n.retired);
  const retired = all.filter((n) => n.retired);

  res.json({
    total: all.length,
    claimed: claimed.length,
    available: available.length,
    retired: retired.length,
    names: all,
  });
});

// ─── GET /api/strategy-names/available — Unclaimed names ──────
strategyNameRoutes.get("/available", async (_req, res) => {
  const rows = await db
    .select()
    .from(strategyNames)
    .where(and(eq(strategyNames.claimed, false), eq(strategyNames.retired, false)))
    .orderBy(strategyNames.codename);

  res.json({ count: rows.length, names: rows });
});

// ─── GET /api/strategy-names/:id — Single entry ──────────────
strategyNameRoutes.get("/:id", async (req, res) => {
  const [row] = await db
    .select()
    .from(strategyNames)
    .where(eq(strategyNames.id, req.params.id))
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "Name not found" });
    return;
  }
  res.json(row);
});
