/**
 * GET /api/webhook-latency/status
 *
 * Returns rolling 1h p50/p95 webhook latency percentiles.
 * Used by the dashboard latency read-out panel.
 *
 * NOT pipeline-pause-gated: latency monitoring is always active.
 */

import { Router } from "express";
import { computeRolling1hLatencyP95 } from "../services/webhook-latency-monitor-service.js";

export const webhookLatencyRoutes = Router();

webhookLatencyRoutes.get("/status", async (req, res) => {
  try {
    const percentiles = await computeRolling1hLatencyP95();
    res.json({
      checkedAt: new Date().toISOString(),
      windowHours: 1,
      p50Ms: percentiles.p50,
      p95Ms: percentiles.p95,
      sampleCount: percentiles.count,
      alarmed: percentiles.alarmed,
      thresholdMs: 2000,
    });
  } catch (err) {
    req.log?.error?.({ err }, "webhook-latency: status query failed");
    res.status(500).json({ error: "webhook_latency_query_failed" });
  }
});

/**
 * GET /api/webhook-latency/regime-coverage
 *
 * Returns regime coverage status for all regimes.
 */
webhookLatencyRoutes.get("/regime-coverage", async (req, res) => {
  try {
    const { getRegimeCoverageStatus } = await import(
      "../services/regime-coverage-monitor-service.js"
    );
    const status = await getRegimeCoverageStatus();
    res.json(status);
  } catch (err) {
    req.log?.error?.({ err }, "webhook-latency: regime-coverage query failed");
    res.status(500).json({ error: "regime_coverage_query_failed" });
  }
});
