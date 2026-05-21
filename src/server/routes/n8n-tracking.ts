import { Router } from "express";
import { desc, sql, gte, eq } from "drizzle-orm";
import { createHmac, timingSafeEqual } from "crypto";
import { db } from "../db/index.js";
import { n8nExecutionLog, auditLog } from "../db/schema.js";
import { logger } from "../lib/logger.js";
import { broadcastSSE } from "./sse.js";

export const n8nTrackingRoutes = Router();

// ─── HMAC verification (Pass 6 / Track C F-3) ─────────────────────────────────
// n8n posts execution telemetry over the public relay; without auth any caller
// can pollute the execution log and skew health metrics. We verify a
// signature header against N8N_WEBHOOK_SECRET using constant-time compare.
//
// Signature convention (documented in docs/n8n-fixes-pass6-runbook.md):
//   header:  X-N8N-Signature: sha256=<hex of HMAC-SHA256(secret, JSON.stringify(body))>
//
// Fail-CLOSED in production: if N8N_WEBHOOK_SECRET is unset and NODE_ENV is
// "production", every request is rejected. Dev/test environments allow
// requests through when the secret is unset (so local smoke tests still work).
function verifyN8nHmac(headerValue: string | undefined, body: unknown): { ok: true } | { ok: false; reason: string } {
  const secret = process.env.N8N_WEBHOOK_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      return { ok: false, reason: "secret_unset_in_production" };
    }
    return { ok: true };
  }
  if (!headerValue || typeof headerValue !== "string") {
    return { ok: false, reason: "missing_signature_header" };
  }
  const provided = headerValue.startsWith("sha256=") ? headerValue.slice(7) : headerValue;
  let payload: string;
  try {
    payload = typeof body === "string" ? body : JSON.stringify(body ?? {});
  } catch {
    return { ok: false, reason: "body_not_serializable" };
  }
  const expected = createHmac("sha256", secret).update(payload, "utf8").digest("hex");
  if (provided.length !== expected.length) {
    return { ok: false, reason: "signature_mismatch" };
  }
  try {
    const ok = timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(expected, "hex"));
    return ok ? { ok: true } : { ok: false, reason: "signature_mismatch" };
  } catch {
    return { ok: false, reason: "signature_mismatch" };
  }
}

// ─── F-2 (Pass 6 / Track A 2026-05-21): HMAC enforcement-mode transition ─────
// The HMAC verify gate was added in Pass 6 but n8n workflows have not all been
// updated to sign their requests. Forcing "enforce" immediately would 401 every
// live caller. We add a transition window:
//   N8N_HMAC_ENFORCE_MODE = "warn"    → log+accept unsigned/invalid (default)
//   N8N_HMAC_ENFORCE_MODE = "enforce" → 401 on missing/invalid signature
// Default is "warn" for the next 7 days. Operator flips to "enforce" after all
// n8n workflows have been audited to attach a signed header. Every accept-
// without-signature in "warn" mode writes an audit_log row so the operator can
// query who is still sending unsigned traffic before the flip.
type HmacEnforceMode = "warn" | "enforce";

function getHmacEnforceMode(): HmacEnforceMode {
  const raw = (process.env["N8N_HMAC_ENFORCE_MODE"] ?? "warn").toLowerCase().trim();
  return raw === "enforce" ? "enforce" : "warn";
}

// ─── POST /api/n8n/execution-log — n8n calls this at end of each workflow ──
n8nTrackingRoutes.post("/execution-log", async (req, res) => {
  // Pass 6 / Track C F-3: HMAC verify BEFORE touching the DB
  const sig = req.header("x-n8n-signature");
  const verified = verifyN8nHmac(sig, req.body);
  const enforceMode = getHmacEnforceMode();
  if (!verified.ok) {
    if (enforceMode === "enforce") {
      req.log.warn(
        { reason: verified.reason, mode: enforceMode },
        "n8n execution-log: HMAC verification failed — rejecting (enforce mode)",
      );
      res.status(401).json({ error: "unauthorized", reason: verified.reason });
      return;
    }
    // F-2 warn mode: log + audit + accept, continue to the rest of the handler.
    // This preserves observability of unsigned callers without blocking them
    // during the transition window.
    req.log.warn(
      { reason: verified.reason, mode: enforceMode },
      "n8n execution-log: HMAC verification failed — accepting (warn mode, transition window)",
    );
    db.insert(auditLog)
      .values({
        action: "n8n_tracking.unsigned_accepted",
        entityType: "n8n_workflow",
        entityId: null,
        decisionAuthority: "system",
        input: {
          workflowId: (req.body as { workflowId?: unknown })?.workflowId ?? null,
          reason: verified.reason,
          mode: enforceMode,
        } as Record<string, unknown>,
        result: { accepted: true, reason: verified.reason } as Record<string, unknown>,
        status: "success",
        correlationId: null,
      })
      .catch((auditErr: unknown) => {
        logger.error({ auditErr }, "n8n-tracking: audit_log write failed for unsigned accept (non-blocking)");
      });
  }

  const { workflowId, workflowName, executionId, status, startedAt, finishedAt, durationMs, errorMessage, triggerType, metadata } = req.body;
  if (!workflowId || !workflowName || !status) {
    res.status(400).json({ error: "workflowId, workflowName, and status are required" });
    return;
  }

  // Pass 6 / Track C F-3: idempotency — if the same execution_id has already
  // been logged, return the existing row (HTTP 200) rather than inserting a
  // duplicate. n8n_execution_log has no unique constraint on execution_id
  // (would require a migration, out of ownership scope), so we guard at the
  // application layer: SELECT-then-INSERT inside a small race window. The
  // worst case under concurrent retries is one extra duplicate row, which is
  // acceptable and bounded — far better than today's unbounded duplication.
  if (executionId) {
    const existing = await db.select().from(n8nExecutionLog)
      .where(eq(n8nExecutionLog.executionId, executionId))
      .limit(1);
    if (existing.length > 0) {
      res.status(200).json(existing[0]);
      return;
    }
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
// Pass 6 / Track C F-8: the denominator must exclude in-flight rows
// ('running', 'waiting', 'new') and manual one-off runs ('manual' triggerType).
// Including them produced misleading success rates (rate = succ / total
// including not-yet-finished or operator-triggered noise). When the filtered
// denominator is 0 we return successRate=null + status="no_data" and DO NOT
// treat the workflow as unhealthy — absence of data is not a failure.
n8nTrackingRoutes.get("/execution-log/health", async (req, res) => {
  const days = Math.min(Number(req.query.days) || 7, 90);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const workflows = await db.select({
    workflowId: n8nExecutionLog.workflowId,
    workflowName: n8nExecutionLog.workflowName,
    total: sql<number>`count(*) filter (where ${n8nExecutionLog.status} NOT IN ('running','waiting','new') AND coalesce(${n8nExecutionLog.triggerType},'') <> 'manual')::int`,
    successes: sql<number>`count(*) filter (where ${n8nExecutionLog.status} = 'success' AND coalesce(${n8nExecutionLog.triggerType},'') <> 'manual')::int`,
    failures: sql<number>`count(*) filter (where ${n8nExecutionLog.status} IN ('failed', 'error') AND coalesce(${n8nExecutionLog.triggerType},'') <> 'manual')::int`,
    // successRate divides successes by the filtered denominator. nullif() keeps
    // a 0-denominator row from returning 0% — instead it becomes NULL which the
    // caller maps to "no_data". status carries that signal explicitly.
    successRate: sql<number | null>`round(
      count(*) filter (where ${n8nExecutionLog.status} = 'success' AND coalesce(${n8nExecutionLog.triggerType},'') <> 'manual')::numeric
      / nullif(count(*) filter (where ${n8nExecutionLog.status} NOT IN ('running','waiting','new') AND coalesce(${n8nExecutionLog.triggerType},'') <> 'manual'), 0),
      4
    )`,
    status: sql<string>`case when count(*) filter (where ${n8nExecutionLog.status} NOT IN ('running','waiting','new') AND coalesce(${n8nExecutionLog.triggerType},'') <> 'manual') = 0 then 'no_data' else 'ok' end`,
    avgDurationMs: sql<number>`avg(${n8nExecutionLog.durationMs})::int`,
    lastFailure: sql<string>`max(case when ${n8nExecutionLog.status} IN ('failed', 'error') then ${n8nExecutionLog.createdAt}::text end)`,
    lastExecution: sql<string>`max(${n8nExecutionLog.createdAt}::text)`,
  }).from(n8nExecutionLog)
    .where(gte(n8nExecutionLog.createdAt, since))
    .groupBy(n8nExecutionLog.workflowId, n8nExecutionLog.workflowName);

  // F-8: a workflow with no completed non-manual runs in the window is NOT
  // "unhealthy" — it's "no_data". Only flag rows that actually have evidence
  // of underperformance (status=ok AND (successRate<0.9 OR failures>0)).
  //
  // F-7 (Pass 6 / Track A 2026-05-21): stale detection. If a workflow
  // has data but its lastExecution timestamp is older than STALE_THRESHOLD_MS
  // (default 2h — appropriate for hourly-scheduled scout/audit workflows),
  // promote status from "ok" to "stale". This distinguishes "the workflow runs
  // hourly and one cycle missed" (stale) from "the workflow has never run in
  // the window" (no_data). Operator alerting can page on "stale" without
  // false-positiving on cold-start "no_data".
  const STALE_THRESHOLD_MS = Number(process.env["N8N_STALE_THRESHOLD_MS"] ?? 2 * 60 * 60 * 1000);
  const nowMs = Date.now();
  const enrichedWorkflows = workflows.map((w) => {
    if (w.status !== "ok" || !w.lastExecution) return w;
    const lastMs = new Date(w.lastExecution).getTime();
    if (Number.isFinite(lastMs) && nowMs - lastMs > STALE_THRESHOLD_MS) {
      return { ...w, status: "stale" };
    }
    return w;
  });

  const unhealthy = enrichedWorkflows.filter((w) =>
    w.status === "ok" && ((w.successRate ?? 1) < 0.9 || w.failures > 0)
  );
  const stale = enrichedWorkflows.filter((w) => w.status === "stale");

  res.json({
    data: enrichedWorkflows,
    unhealthy: unhealthy.map((w) => w.workflowName),
    stale: stale.map((w) => w.workflowName),
    staleThresholdMs: STALE_THRESHOLD_MS,
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
