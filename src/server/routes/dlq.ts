import { Router } from "express";
import { eq, desc, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { deadLetterQueue } from "../db/schema.js";

export const dlqRoutes = Router();

// ─── GET /api/dlq — List dead-letter queue items ────────────────
dlqRoutes.get("/", async (_req, res) => {
  const items = await db
    .select()
    .from(deadLetterQueue)
    .orderBy(desc(deadLetterQueue.lastFailedAt))
    .limit(100);
  const unresolvedCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(deadLetterQueue)
    .where(eq(deadLetterQueue.resolved, false));
  res.json({ data: items, unresolvedCount: unresolvedCount[0]?.count ?? 0 });
});

// ─── GET /api/dlq/stats — DLQ summary stats ────────────────────
dlqRoutes.get("/stats", async (_req, res) => {
  const stats = await db
    .select({
      operationType: deadLetterQueue.operationType,
      count: sql<number>`count(*)::int`,
      unresolved: sql<number>`count(*) filter (where resolved = false)::int`,
    })
    .from(deadLetterQueue)
    .groupBy(deadLetterQueue.operationType);
  res.json(stats);
});

// ─── GET /api/dlq/metrics — DLQ health metrics ─────────────────
dlqRoutes.get("/metrics", async (_req, res) => {
  const { getDLQMetrics } = await import("../lib/dlq-service.js");
  const metrics = await getDLQMetrics();
  res.json(metrics);
});

// ─── PATCH /api/dlq/:id/resolve — Mark a DLQ item as resolved ──
dlqRoutes.patch("/:id/resolve", async (req, res) => {
  const [updated] = await db
    .update(deadLetterQueue)
    .set({ resolved: true, resolvedAt: new Date() })
    .where(eq(deadLetterQueue.id, req.params.id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "DLQ item not found" });
    return;
  }
  res.json(updated);
});

// ─── POST /api/dlq/:id/retry — Retry a DLQ item ────────────────
dlqRoutes.post("/:id/retry", async (req, res) => {
  try {
    const { retryDLQItem } = await import("../lib/dlq-service.js");
    const resolved = await retryDLQItem(req.params.id);
    res.json({ resolved });
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : "Retry failed" });
  }
});
