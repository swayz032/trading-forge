/**
 * src/server/routes/leak-detection.ts — Wave 4 Track 4B: Layer 15 Leak Detection Route
 *
 * ADVISORY-ONLY surface. This route never gates lifecycle transitions.
 *
 * ─── Route contract ──────────────────────────────────────────────────────────
 *
 * POST /api/leak-detection/run
 *
 * Request body (optional JSON):
 *   {
 *     "strategy_ids"?:  string[]   // UUIDs of specific strategies to scan.
 *                                  // Omit to scan ALL DEPLOYED + PAPER strategies.
 *     "correlation_id"?: string    // Pass-through correlation ID from the 3AM orchestrator.
 *                                  // If omitted, a new UUID is generated.
 *   }
 *
 * Response 200:
 *   {
 *     "run_id":             string,       // UUID identifying this detection run
 *     "started_at":         string,       // ISO-8601 UTC timestamp
 *     "completed_at":       string,       // ISO-8601 UTC timestamp
 *     "strategies_scanned": number,       // Count of DEPLOYED/PAPER strategies evaluated
 *     "leaks": [
 *       {
 *         "category":           string,  // "execution_slippage" | "allocation_drift" |
 *                                        // "regime" | "attribution_opacity" | "subsystem_consensus"
 *         "severity":           string,  // "info" | "warning" | "high"
 *         "strategyId":         string,  // UUID
 *         "strategyName":       string,
 *         "evidence":           object,  // structured payload (see service for shape per category)
 *         "recommendedAction":  string
 *       },
 *       ...
 *     ]
 *   }
 *
 * Response 400: { "error": string } — invalid request body shape
 * Response 500: { "error": string } — unexpected service failure
 *
 * ─── Caller notes (Track 4A orchestrator) ────────────────────────────────────
 *   - No auth header required (internal network only; same-host orchestrator).
 *   - Content-Type: application/json (required when body is sent).
 *   - The route returns 200 even when 0 leaks are detected — leaks:[] means clean.
 *   - On service failure the route returns 500 with the error message; caller should
 *     retry once with exponential back-off and emit its own audit row on repeated failure.
 *   - correlationId in the response audit trail links back to the orchestrator's runId.
 *
 * ─── Import notes ────────────────────────────────────────────────────────────
 *   logger from ../lib/logger.js (leaf module per CLAUDE.md feedback)
 */

import { Router, type Request, type Response } from "express";
import { logger } from "../lib/logger.js";
import { runLeakDetection } from "../services/leak-detection-service.js";

export const leakDetectionRoutes = Router();

leakDetectionRoutes.post("/run", async (req: Request, res: Response): Promise<void> => {
  // ─── Parse + validate request body ───────────────────────────────────────
  const body = (req.body ?? {}) as Record<string, unknown>;

  let strategyIds: string[] | undefined;
  let correlationId: string | undefined;

  if ("strategy_ids" in body) {
    if (
      !Array.isArray(body.strategy_ids) ||
      !body.strategy_ids.every((id) => typeof id === "string")
    ) {
      res.status(400).json({ error: "strategy_ids must be an array of strings when provided" });
      return;
    }
    strategyIds = body.strategy_ids as string[];
  }

  if ("correlation_id" in body) {
    if (typeof body.correlation_id !== "string") {
      res.status(400).json({ error: "correlation_id must be a string when provided" });
      return;
    }
    correlationId = body.correlation_id;
  }

  // ─── Propagate req.id as correlation ID fallback ──────────────────────────
  const effectiveCorrelationId = correlationId ?? (req as Request & { id?: string }).id;

  // ─── Invoke leak detection (fail-soft internally, never throws) ───────────
  try {
    const result = await runLeakDetection(strategyIds, effectiveCorrelationId);
    res.status(200).json(result);
  } catch (err) {
    // The service is designed to fail-soft internally; this catch is a last-resort
    // defensive barrier against unexpected runtime failures (e.g. OOM, module load).
    logger.error({ err, strategyIds }, "leak-detection route: unexpected error");
    res.status(500).json({
      error: err instanceof Error ? err.message : "Unexpected error in leak detection run",
    });
  }
});
