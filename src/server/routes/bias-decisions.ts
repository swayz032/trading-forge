/**
 * Bias Decisions Ingest Route — Track 5 Phase D Readiness
 *
 * POST /api/bias-decisions/ingest
 *   Receives a bias decision payload from bias_engine.py fire-and-forget subprocess.
 *   Writes to bias_decisions table. Fails-open on any error.
 *
 * GET /api/bias-decisions/recent
 *   Returns the 50 most recent bias_decisions rows for the dashboard.
 *
 * Gated on BIAS_ENGINE_MODE != 'OFF'.
 * Pipeline pause guard: writes are allowed even when pipeline is paused (observability).
 */

import { Router, Request, Response } from "express";
import { db } from "../db/index.js";
import { biasDecisions } from "../db/schema.js";
import { logger } from "../index.js";
import { sql } from "drizzle-orm";

export const biasDecisionsRoutes = Router();

const ENGINE_MODE = process.env.BIAS_ENGINE_MODE ?? "SHADOW";

// ─── POST /api/bias-decisions/ingest ─────────────────────────────────────────

biasDecisionsRoutes.post("/ingest", async (req: Request, res: Response) => {
  if (ENGINE_MODE === "OFF") {
    res.json({ success: true, skipped: true, reason: "engine_mode_off" });
    return;
  }

  try {
    const body = req.body as {
      symbol: string;
      decisionTimestamp: string;
      featureSnapshot: Record<string, unknown>;
      featureVersions: Record<string, string>;
      classifierVersion: string;
      rawStateProbs: Record<string, number>;
      routerVersion: string;
      routerHash: string;
      playbook: string;
      allowedStrategies: string[];
      hysteresisApplied: boolean;
      engineMode: string;
    };

    if (!body.symbol || !body.decisionTimestamp || !body.playbook) {
      res.status(400).json({ success: false, error: "Missing required fields" });
      return;
    }

    // Upsert — ON CONFLICT DO NOTHING preserves idempotency
    // (same symbol + timestamp + router_version should not produce duplicate rows)
    await db.execute(sql`
      INSERT INTO bias_decisions (
        symbol, decision_timestamp, feature_snapshot, feature_versions,
        classifier_version, raw_state_probs, router_version, router_hash,
        playbook, allowed_strategies, hysteresis_applied, engine_mode
      ) VALUES (
        ${body.symbol},
        ${body.decisionTimestamp}::timestamptz,
        ${JSON.stringify(body.featureSnapshot)}::jsonb,
        ${JSON.stringify(body.featureVersions)}::jsonb,
        ${body.classifierVersion},
        ${JSON.stringify(body.rawStateProbs)}::jsonb,
        ${body.routerVersion},
        ${body.routerHash},
        ${body.playbook},
        ${JSON.stringify(body.allowedStrategies ?? [])}::jsonb,
        ${body.hysteresisApplied ?? false},
        ${body.engineMode ?? ENGINE_MODE}
      )
      ON CONFLICT (symbol, decision_timestamp, router_version) DO NOTHING
    `);

    res.json({ success: true });
  } catch (err) {
    // Fail-open: log but return 200 so the Python fire-and-forget subprocess does not retry
    logger.warn({ err }, "bias-decisions/ingest: non-fatal write error");
    res.json({ success: false, error: "write_error" });
  }
});

// ─── GET /api/bias-decisions/recent ──────────────────────────────────────────

biasDecisionsRoutes.get("/recent", async (_req: Request, res: Response) => {
  try {
    const rows = await db.execute(sql`
      SELECT id, symbol, decision_timestamp, playbook, engine_mode,
             hysteresis_applied, raw_state_probs, calibrated_confidence
      FROM bias_decisions
      ORDER BY decision_timestamp DESC
      LIMIT 50
    `);
    res.json({ success: true, data: rows.rows });
  } catch (err) {
    logger.error({ err }, "bias-decisions/recent: query error");
    res.status(500).json({ success: false, error: "query_error" });
  }
});
