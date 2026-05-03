/**
 * Signal Correlation Route — A7 (W11 Team B)
 *
 * GET /api/signal-correlation/matrix
 *
 * Returns the pairwise cosine similarity matrix for all strategies at PAPER or
 * DEPLOYED lifecycle state that have signal vectors stored.
 *
 * Used for human review: the operator can see which strategies are producing
 * near-identical signals before manually approving deployment.
 *
 * Pipeline pause guard: returns 423 when pipeline is paused.
 *
 * Response schema:
 * {
 *   pairs: MatrixEntry[],    // sorted by similarity desc
 *   threshold: number,       // current SIGNAL_CORRELATION_THRESHOLD
 *   high_correlation_count: number,
 *   total_pairs: number,
 *   strategy_count: number,
 * }
 */

import { Router, type Request, type Response } from "express";
import { isActive as isPipelineActive } from "../services/pipeline-control-service.js";
import {
  buildCorrelationMatrix,
  SIGNAL_CORRELATION_THRESHOLD,
} from "../services/signal-correlation-service.js";
import { logger } from "../lib/logger.js";

export const signalCorrelationRoutes = Router();

// ─── GET /api/signal-correlation/matrix ─────────────────────────────────────

signalCorrelationRoutes.get(
  "/matrix",
  async (req: Request, res: Response): Promise<void> => {
    // Pipeline pause guard
    if (!(await isPipelineActive())) {
      res.status(423).json({
        error: "pipeline_paused",
        message: "Signal correlation matrix is unavailable while the pipeline is paused",
        pairs: [],
        threshold: SIGNAL_CORRELATION_THRESHOLD,
        high_correlation_count: 0,
        total_pairs: 0,
        strategy_count: 0,
      });
      return;
    }

    try {
      const pairs = await buildCorrelationMatrix();

      const highCorrelationCount = pairs.filter((p) => p.exceeds_threshold).length;
      const strategyIds = new Set<string>();
      for (const p of pairs) {
        strategyIds.add(p.strategyIdA);
        strategyIds.add(p.strategyIdB);
      }

      res.json({
        pairs,
        threshold: SIGNAL_CORRELATION_THRESHOLD,
        high_correlation_count: highCorrelationCount,
        total_pairs: pairs.length,
        strategy_count: strategyIds.size,
      });
    } catch (err) {
      logger.error({ err }, "GET /api/signal-correlation/matrix: unexpected error");
      res.status(500).json({
        error: "internal_error",
        message: err instanceof Error ? err.message : String(err),
        pairs: [],
        threshold: SIGNAL_CORRELATION_THRESHOLD,
        high_correlation_count: 0,
        total_pairs: 0,
        strategy_count: 0,
      });
    }
  },
);
