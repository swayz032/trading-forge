import { Router } from "express";
import { db } from "../db/index.js";
import { alerts } from "../db/schema.js";
import { eq, desc, and, sql } from "drizzle-orm";
import { logger } from "../index.js";

const router = Router();

// GET /api/alerts — list alerts with optional filters
router.get("/", async (req, res) => {
  try {
    const { type, severity, read } = req.query;
    let query = db.select().from(alerts).orderBy(desc(alerts.createdAt)).$dynamic();

    const conditions = [];
    if (type) conditions.push(eq(alerts.type, type as string));
    if (severity) conditions.push(eq(alerts.severity, severity as string));
    if (read !== undefined) conditions.push(eq(alerts.acknowledged, read === "true"));

    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }

    const result = await query;
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/alerts/unread — count unread
router.get("/unread", async (_req, res) => {
  try {
    const [result] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(alerts)
      .where(eq(alerts.acknowledged, false));
    res.json({ count: result?.count ?? 0 });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/alerts — create alert
router.post("/", async (req, res) => {
  try {
    const { type, severity = "info", title, message, metadata } = req.body;
    const [alert] = await db
      .insert(alerts)
      .values({ type, severity, title, message, metadata })
      .returning();
    logger.info({ alertId: alert.id }, "Alert created");
    res.status(201).json(alert);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/alerts/:id/read — mark as read
router.patch("/:id/read", async (req, res) => {
  try {
    const [alert] = await db
      .update(alerts)
      .set({ acknowledged: true })
      .where(eq(alerts.id, req.params.id))
      .returning();
    if (!alert) return res.status(404).json({ error: "Alert not found" });
    res.json(alert);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/alerts/:id — delete alert
router.delete("/:id", async (req, res) => {
  try {
    const [alert] = await db
      .delete(alerts)
      .where(eq(alerts.id, req.params.id))
      .returning();
    if (!alert) return res.status(404).json({ error: "Alert not found" });
    res.json({ deleted: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export { router as alertRoutes };
