/**
 * GET /api/deployed-strategy-starvation/status
 *
 * Returns current starvation status for all PILOT/DEPLOYED strategies.
 * Used by the SignalStarvationCard dashboard component.
 *
 * NOT pipeline-pause-gated: this is a safety surface — the dashboard
 * shows this precisely when things may be going wrong.
 */

import { Router } from "express";
import { getStarvationStatus } from "../services/deployed-strategy-starvation-watchdog.js";

export const deployedStrategyStarvationRoutes = Router();

deployedStrategyStarvationRoutes.get("/status", async (req, res) => {
  try {
    const status = await getStarvationStatus();
    res.json(status);
  } catch (err) {
    req.log?.error?.({ err }, "deployed-strategy-starvation: status query failed");
    res.status(500).json({ error: "starvation_status_query_failed" });
  }
});
