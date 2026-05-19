/**
 * C7 — Validation Cadence Routes (W16 Team C)
 *
 * GET  /api/validation-cadence/dashboard         — full panel payload (cadence + throughput + score)
 * POST /api/validation-cadence/reality-check     — manual trigger (operator UI button)
 *
 * NOTE: this route is intentionally NOT pipeline-pause guarded. The whole point
 * of the forcing function is that it keeps reporting accurately even when the
 * pipeline is paused — paused means "stop promotion authority", not "stop
 * observability". An operator inspecting the panel during a pause MUST see
 * the same numbers they would see normally; otherwise the panel itself
 * becomes a vector for the very failure mode this service exists to prevent.
 */

import { Router, type Request, type Response } from "express";
import {
  getValidationCadenceDashboard,
  runMonthlyRealityCheckReport,
} from "../services/validation-cadence-service.js";
import { logger } from "../lib/logger.js";

export const validationCadenceRoutes = Router();

// ─── GET /api/validation-cadence/dashboard ──────────────────────────────────

validationCadenceRoutes.get(
  "/dashboard",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const dashboard = await getValidationCadenceDashboard();
      res.json(dashboard);
    } catch (err) {
      logger.error({ err }, "GET /api/validation-cadence/dashboard: failed");
      res.status(500).json({
        error: "internal_error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  },
);

// ─── POST /api/validation-cadence/reality-check ─────────────────────────────
// Manual trigger of the monthly Reality Check report (also runs via scheduler
// on the 1st of each month). Useful when the operator wants an on-demand
// reality check after running a strategy through the pipeline.

validationCadenceRoutes.post(
  "/reality-check",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const report = await runMonthlyRealityCheckReport();
      res.json(report);
    } catch (err) {
      logger.error({ err }, "POST /api/validation-cadence/reality-check: failed");
      res.status(500).json({
        error: "internal_error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  },
);
