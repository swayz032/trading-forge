/**
 * Admin Routes — pipeline control endpoints.
 *
 * GET  /pipeline/status   — current pipeline mode
 * POST /pipeline/start    — set mode to ACTIVE
 * POST /pipeline/pause    — set engine mode to PAUSED; n8n remains always-on
 * POST /pipeline/vacation — set engine mode to VACATION; n8n remains always-on
 */

import { Router } from "express";
import { desc, eq, and } from "drizzle-orm";
import { getMode, setMode } from "../services/pipeline-control-service.js";
import { db } from "../db/index.js";
import { agentHealthReports, dataIntegrityFindings } from "../db/schema.js";

export const adminRoutes = Router();

// ─── GET /pipeline/status ────────────────────────────────────────
adminRoutes.get("/pipeline/status", async (req, res) => {
  try {
    const mode = await getMode();
    const subsystems: Record<string, string> = {
      scheduler: mode === "ACTIVE" ? "running" : "paused",
      lifecycle: mode === "ACTIVE" ? "running" : "paused",
      n8n: "always_on",
      openclaw: "always_on",
      paper_trading: mode === "VACATION" ? "stopped" : mode === "ACTIVE" ? "active" : "paused",
    };
    res.json({ mode, subsystems, timestamp: new Date().toISOString() });
  } catch (err) {
    req.log.error({ err }, "Admin: failed to get pipeline status");
    res.status(500).json({ error: "Failed to get pipeline status" });
  }
});

// ─── POST /pipeline/start ────────────────────────────────────────
adminRoutes.post("/pipeline/start", async (req, res) => {
  try {
    const reason = (req.body as { reason?: string })?.reason ?? "Manual start";
    const result = await setMode("ACTIVE", reason);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Admin: failed to start pipeline");
    res.status(500).json({ error: "Failed to start pipeline" });
  }
});

// ─── POST /pipeline/pause ────────────────────────────────────────
adminRoutes.post("/pipeline/pause", async (req, res) => {
  try {
    const reason = (req.body as { reason?: string })?.reason ?? "Manual pause";
    const result = await setMode("PAUSED", reason);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Admin: failed to pause pipeline");
    res.status(500).json({ error: "Failed to pause pipeline" });
  }
});

// ─── POST /pipeline/vacation ─────────────────────────────────────
adminRoutes.post("/pipeline/vacation", async (req, res) => {
  try {
    const reason = (req.body as { reason?: string })?.reason ?? "Vacation mode";
    const result = await setMode("VACATION", reason);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Admin: failed to set vacation mode");
    res.status(500).json({ error: "Failed to set vacation mode" });
  }
});

// ─── GET /scheduler/jobs — List all jobs with health ─────────────
adminRoutes.get("/scheduler/jobs", async (req, res) => {
  try {
    const { getSchedulerJobs, getSchedulerHealth, getSchedulerHealthExtended, getAllJobHealth } = await import("../scheduler.js");

    const jobs = getSchedulerJobs();
    const health = getSchedulerHealth();
    const healthExtended = getSchedulerHealthExtended();
    const jobHealth = getAllJobHealth();

    const result = Object.entries(jobs).map(([name, info]) => ({
      name,
      ...info,
      lastError: healthExtended[name]?.lastError ?? null,
      health: (() => {
        const h = jobHealth.get(name);
        return h
          ? { consecutiveFailures: h.consecutiveFailures, lastFailure: h.lastFailure, disabled: h.disabled, disabledAt: h.disabledAt, disableReason: h.disableReason }
          : { consecutiveFailures: 0, disabled: false };
      })(),
    }));

    res.json({ jobs: result, schedulerHealth: health, schedulerHealthExtended: healthExtended });
  } catch (err) {
    req.log.error({ err }, "Admin: failed to list scheduler jobs");
    res.status(500).json({ error: "Failed to list scheduler jobs" });
  }
});

// ─── POST /scheduler/jobs/:name/enable — Re-enable a disabled job ──
adminRoutes.post("/scheduler/jobs/:name/enable", async (req, res) => {
  try {
    const { enableJob } = await import("../scheduler.js");
    const enabled = enableJob(req.params.name);
    if (!enabled) {
      res.status(404).json({ error: `Job "${req.params.name}" not found or not disabled` });
      return;
    }
    res.json({ enabled: true, job: req.params.name });
  } catch (err) {
    req.log.error({ err }, "Admin: failed to enable scheduler job");
    res.status(500).json({ error: "Failed to enable scheduler job" });
  }
});

// ─── POST /scheduler/jobs/:name/disable — Manually disable a job ──
adminRoutes.post("/scheduler/jobs/:name/disable", async (req, res) => {
  try {
    const { getAllJobHealth } = await import("../scheduler.js");
    const healthMap = getAllJobHealth();
    const health = healthMap.get(req.params.name);
    if (!health) {
      res.status(404).json({ error: `Job "${req.params.name}" not found` });
      return;
    }
    health.disabled = true;
    health.disabledAt = new Date();
    health.disableReason = "Manually disabled via admin API";
    res.json({ disabled: true, job: req.params.name });
  } catch (err) {
    req.log.error({ err }, "Admin: failed to disable scheduler job");
    res.status(500).json({ error: "Failed to disable scheduler job" });
  }
});

// ─── GET /admin/agent-health-reports ────────────────────────────
// Surfaces the most-recent rows from agent_health_reports for the operator
// dashboard. The agent-audit-service writes here every 2 h (agent-health-sweep
// cron) but until the 2026-04-30 integration audit, no consumer existed.
// Optional ?limit (default 50, max 200).
adminRoutes.get("/agent-health-reports", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const rows = await db
      .select()
      .from(agentHealthReports)
      .orderBy(desc(agentHealthReports.createdAt))
      .limit(limit);
    res.json({ data: rows, count: rows.length });
  } catch (err) {
    req.log.error({ err }, "Admin: failed to fetch agent health reports");
    res.status(500).json({ error: "Failed to fetch agent health reports" });
  }
});

// ─── GET /admin/data-integrity-findings ─────────────────────────
// Surfaces unresolved (default) or all rows from data_integrity_findings (A8).
// data-integrity-service writes here nightly at 4:00 AM ET but until the
// 2026-04-30 integration audit, no consumer existed — the consolidated
// reconciliation + drift-detection rows were a write-only sink.
// Query params:
//   ?resolved=true     — include resolved findings (default false)
//   ?severity=critical|warning|info — filter by severity
//   ?limit=50          — max 500
adminRoutes.get("/data-integrity-findings", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 500);
    const includeResolved = req.query.resolved === "true";
    const severity = req.query.severity as string | undefined;

    const conditions = [];
    if (!includeResolved) conditions.push(eq(dataIntegrityFindings.resolved, false));
    if (severity && ["critical", "warning", "info"].includes(severity)) {
      conditions.push(eq(dataIntegrityFindings.severity, severity));
    }

    const rows = await db
      .select()
      .from(dataIntegrityFindings)
      .where(conditions.length === 0 ? undefined : (conditions.length === 1 ? conditions[0] : and(...conditions)))
      .orderBy(desc(dataIntegrityFindings.runAt))
      .limit(limit);
    res.json({ data: rows, count: rows.length, filters: { includeResolved, severity: severity ?? null } });
  } catch (err) {
    req.log.error({ err }, "Admin: failed to fetch data integrity findings");
    res.status(500).json({ error: "Failed to fetch data integrity findings" });
  }
});
