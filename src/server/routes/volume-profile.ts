/**
 * Volume Profile Routes — Track 2 (Volume Profile EXPANDED)
 *
 * GET /api/volume-profile/latest?symbol=MES        → latest VP levels
 * GET /api/volume-profile/history?symbol=MES&days=30 → recent history
 * POST /api/volume-profile/compute                 → manual trigger (rate-limited, pipeline-pause-guarded)
 */

import { Router } from "express";
import { z } from "zod";
import { getLatestVPLevels, getVPLevelsHistory, triggerVPCompute } from "../services/volume-profile-service.js";
import { logger } from "../lib/logger.js";

export const volumeProfileRoutes = Router();

const VALID_SYMBOLS = ["MES", "MNQ", "MCL"] as const;

const latestQuerySchema = z.object({
  symbol: z.enum(VALID_SYMBOLS),
  before_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const historyQuerySchema = z.object({
  symbol: z.enum(VALID_SYMBOLS),
  days: z.coerce.number().int().min(1).max(365).default(30),
});

const computeBodySchema = z.object({
  symbol: z.enum(VALID_SYMBOLS),
  session_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

// ─── GET /api/volume-profile/latest ─────────────────────────────────────────

volumeProfileRoutes.get("/latest", async (req, res) => {
  const parsed = latestQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query params", details: parsed.error.issues });
    return;
  }
  const { symbol, before_date } = parsed.data;

  try {
    const levels = await getLatestVPLevels(symbol, before_date);
    if (!levels) {
      res.status(404).json({ error: "No VP levels found", symbol });
      return;
    }
    res.json(levels);
  } catch (err) {
    logger.error({ err: String(err), symbol }, "GET /api/volume-profile/latest failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/volume-profile/history ────────────────────────────────────────

volumeProfileRoutes.get("/history", async (req, res) => {
  const parsed = historyQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query params", details: parsed.error.issues });
    return;
  }
  const { symbol, days } = parsed.data;

  try {
    const history = await getVPLevelsHistory(symbol, days);
    res.json({ symbol, days, count: history.length, levels: history });
  } catch (err) {
    logger.error({ err: String(err), symbol }, "GET /api/volume-profile/history failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/volume-profile/compute ───────────────────────────────────────
// Manual trigger. Pipeline-pause-guarded via service. Rate-limited by caller mount.

volumeProfileRoutes.post("/compute", async (req, res) => {
  const parsed = computeBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
    return;
  }
  const { symbol, session_date } = parsed.data;
  const date = session_date ?? new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

  try {
    await triggerVPCompute(symbol, date);
    const levels = await getLatestVPLevels(symbol, date);
    res.status(202).json({ message: "VP compute triggered", symbol, session_date: date, levels });
  } catch (err: unknown) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode === 423) {
      res.status(423).json({ error: "pipeline_paused", message: "Cannot compute VP while pipeline is paused" });
      return;
    }
    logger.error({ err: String(err), symbol, date }, "POST /api/volume-profile/compute failed");
    res.status(500).json({ error: "VP compute failed", detail: String(err) });
  }
});
