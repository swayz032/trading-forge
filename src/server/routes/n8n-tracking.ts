import { Router } from "express";
import { desc, sql, gte } from "drizzle-orm";
import { db } from "../db/index.js";
import { n8nExecutionLog } from "../db/schema.js";
import { broadcastSSE } from "./sse.js";

export const n8nTrackingRoutes = Router();

// ─── POST /api/n8n/execution-log — n8n calls this at end of each workflow ──
n8nTrackingRoutes.post("/execution-log", async (req, res) => {
  const { workflowId, workflowName, executionId, status, startedAt, finishedAt, durationMs, errorMessage, triggerType, metadata } = req.body;
  if (!workflowId || !workflowName || !status) {
    res.status(400).json({ error: "workflowId, workflowName, and status are required" });
    return;
  }
  const [entry] = await db.insert(n8nExecutionLog).values({
    workflowId,
    workflowName,
    executionId,
    status,
    startedAt: startedAt ? new Date(startedAt) : undefined,
    finishedAt: finishedAt ? new Date(finishedAt) : undefined,
    durationMs,
    errorMessage,
    triggerType,
    metadata,
  }).returning();

  if (status === "failed" || status === "error") {
    broadcastSSE("n8n:workflow-failed", { workflowName, executionId, errorMessage });
    req.log.warn({ workflowName, executionId, errorMessage }, "n8n workflow failed");
  }

  res.status(201).json(entry);
});

// ─── GET /api/n8n/execution-log — List recent executions ────────
n8nTrackingRoutes.get("/execution-log", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const items = await db.select().from(n8nExecutionLog)
    .orderBy(desc(n8nExecutionLog.createdAt))
    .limit(limit);
  res.json({ data: items, count: items.length });
});

// ─── GET /api/n8n/execution-log/health — Per-workflow success rate ─
n8nTrackingRoutes.get("/execution-log/health", async (req, res) => {
  const days = Math.min(Number(req.query.days) || 7, 90);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const workflows = await db.select({
    workflowId: n8nExecutionLog.workflowId,
    workflowName: n8nExecutionLog.workflowName,
    total: sql<number>`count(*)::int`,
    successes: sql<number>`count(*) filter (where ${n8nExecutionLog.status} = 'success')::int`,
    failures: sql<number>`count(*) filter (where ${n8nExecutionLog.status} IN ('failed', 'error'))::int`,
    successRate: sql<number>`round(count(*) filter (where ${n8nExecutionLog.status} = 'success')::numeric / nullif(count(*), 0), 4)`,
    avgDurationMs: sql<number>`avg(${n8nExecutionLog.durationMs})::int`,
    lastFailure: sql<string>`max(case when ${n8nExecutionLog.status} IN ('failed', 'error') then ${n8nExecutionLog.createdAt}::text end)`,
    lastExecution: sql<string>`max(${n8nExecutionLog.createdAt}::text)`,
  }).from(n8nExecutionLog)
    .where(gte(n8nExecutionLog.createdAt, since))
    .groupBy(n8nExecutionLog.workflowId, n8nExecutionLog.workflowName);

  const unhealthy = workflows.filter((w) => (w.successRate ?? 0) < 0.9 || w.failures > 0);

  res.json({
    data: workflows,
    unhealthy: unhealthy.map((w) => w.workflowName),
    since: since.toISOString(),
    days,
  });
});

// ─── GET /api/n8n/execution-log/stats — Workflow health summary ─
n8nTrackingRoutes.get("/execution-log/stats", async (req, res) => {
  const since = new Date();
  since.setDate(since.getDate() - 7);
  const stats = await db.select({
    workflowName: n8nExecutionLog.workflowName,
    total: sql<number>`count(*)::int`,
    failures: sql<number>`count(*) filter (where status IN ('failed', 'error'))::int`,
    avgDurationMs: sql<number>`avg(duration_ms)::int`,
  }).from(n8nExecutionLog)
    .where(gte(n8nExecutionLog.createdAt, since))
    .groupBy(n8nExecutionLog.workflowName);
  res.json(stats);
});
