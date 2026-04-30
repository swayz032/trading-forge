/**
 * A+ Market Auditor Routes — Tier 3.3 (Gemini Quantum Blueprint, W3b)
 *
 * POST /api/auditor/scan
 *   Triggers an on-demand A+ Market Auditor scan.
 *   The 8:00 AM ET cron job calls this same service function.
 *   Auth: Bearer token (API_KEY).
 *
 * GET /api/auditor/latest
 *   Returns the most recent completed scan row for today (or ?date=YYYY-MM-DD).
 *
 * Authority: advisory / challenger_only.
 * No execution, lifecycle, or position authority.
 */

import { Router, Request, Response } from "express";
import { runAuditScan, getLatestScan } from "../services/a-plus-auditor-service.js";
import { logger } from "../lib/logger.js";

export const auditorRoutes = Router();

// ─── POST /api/auditor/scan ───────────────────────────────────────────────────

auditorRoutes.post("/scan", async (req: Request, res: Response) => {
  const correlationId = (req as Request & { correlationId?: string }).correlationId;

  // Body is optional — callers can pass pre-computed market_inputs to skip
  // inner quantum circuits (useful for tests). Production cron sends nothing
  // and lets the service use defaults / compute via Python.
  const body = req.body as {
    marketInputs?: Record<string, {
      atr_5m: number;
      atr_8yr_avg: number;
      vix: number;
      gap_atr: number;
      spread: number;
      p_target_hit?: number | null;
      noise_score?: number | null;
    }>;
    corrMatrix?: Record<string, Record<string, number>>;
    seed?: number;
  };

  // Default market inputs when caller provides none (representative pre-market values)
  const marketInputs = body.marketInputs ?? {
    MES: { atr_5m: 2.5, atr_8yr_avg: 2.5, vix: 18.0, gap_atr: 0.2, spread: 0.05 },
    MNQ: { atr_5m: 4.0, atr_8yr_avg: 4.0, vix: 18.0, gap_atr: 0.3, spread: 0.04 },
    MCL: { atr_5m: 0.3, atr_8yr_avg: 0.3, vix: 18.0, gap_atr: 0.1, spread: 0.10 },
  };

  try {
    const result = await runAuditScan(
      {
        marketInputs,
        corrMatrix: body.corrMatrix,
        seed: body.seed,
      },
      correlationId,
    );

    if (result.skipped) {
      res.json({
        status: "skipped",
        reason: "QUANTUM_AMARKET_AUDITOR_ENABLED=false",
        governance: { authoritative: false, decision_role: "challenger_only" },
      });
      return;
    }

    res.json({
      status: "ok",
      scanRowId: result.scanRowId,
      winnerMarket: result.winnerMarket,
      observationMode: result.observationMode,
      edgeScores: result.edgeScores,
      leadMarket: result.leadMarket,
      lagWindowMinutes: result.lagWindowMinutes,
      entanglementStrength: result.entanglementStrength,
      scanDurationMs: result.scanDurationMs,
      hardware: result.hardware,
      seed: result.seed,
      governance: result.governance,
      // Compliance note — always surfaced in response
      complianceHandoff: {
        note: "Correlated position enforcement is handled by Tier 5.3.1 (check_correlated_position_guard, W5b — not yet shipped).",
        leadMarketIsSignalOnly: true,
      },
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error({ err, correlationId }, "POST /api/auditor/scan failed");
    res.status(500).json({ status: "error", error: errorMessage });
  }
});

// ─── GET /api/auditor/latest ─────────────────────────────────────────────────

auditorRoutes.get("/latest", async (req: Request, res: Response) => {
  const dateStr = req.query.date as string | undefined;

  // Validate date format if provided
  if (dateStr && !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    res.status(400).json({ status: "error", error: "date must be in YYYY-MM-DD format" });
    return;
  }

  try {
    const row = await getLatestScan(dateStr);
    if (!row) {
      res.status(404).json({
        status: "not_found",
        scanDate: dateStr ?? new Date().toISOString().slice(0, 10),
      });
      return;
    }
    res.json({ status: "ok", scan: row });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "GET /api/auditor/latest failed");
    res.status(500).json({ status: "error", error: errorMessage });
  }
});
