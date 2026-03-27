/**
 * Anti-Setup Routes — Mine and filter false-positive trade setups
 *
 * Follows the survival.ts subprocess spawn pattern:
 * - Platform detection (python vs python3)
 * - stdout -> JSON.parse
 * - stderr -> logging
 */

import { Router } from "express";
import { z } from "zod";
import { logger } from "../index.js";
import { runPythonModule } from "../lib/python-runner.js";

export const antiSetupRoutes = Router();

// ─── Validation Schemas ──────────────────────────────────────────

const mineSchema = z.object({
  trades: z.array(z.object({
    entry_time: z.string().optional(),
    exit_time: z.string().optional(),
    pnl: z.number(),
    direction: z.string().optional(),
    entry_price: z.number().optional(),
    atr: z.number().optional(),
    volume: z.number().optional(),
    regime: z.string().optional(),
    archetype: z.string().optional(),
    day_of_week: z.number().optional(),
    days_to_event: z.number().optional(),
  }).passthrough()).min(1),
  bars: z.array(z.record(z.unknown())).default([]),
  min_sample_size: z.number().int().min(5).max(200).default(20),
  min_failure_rate: z.number().min(0.5).max(1.0).default(0.65),
});

const checkSchema = z.object({
  trade_context: z.object({
    time: z.string().optional(),
    hour: z.number().optional(),
    atr: z.number().optional(),
    volume: z.number().optional(),
    regime: z.string().optional(),
    archetype: z.string().optional(),
    day_of_week: z.number().optional(),
    days_to_event: z.number().optional(),
    streak: z.number().optional(),
    streak_type: z.string().optional(),
  }).passthrough(),
  anti_setups: z.array(z.record(z.unknown())),
  confidence_threshold: z.number().min(0).max(1).default(0.80),
});

const backtestSchema = z.object({
  trades: z.array(z.object({
    pnl: z.number(),
  }).passthrough()).min(1),
  anti_setups: z.array(z.record(z.unknown())),
  confidence_threshold: z.number().min(0).max(1).default(0.80),
});

// ─── POST /api/anti-setups/mine ─────────────────────────────────
// Mine anti-setups from historical data
antiSetupRoutes.post("/mine", async (req, res) => {
  const parsed = mineSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  try {
    const result = await runPythonModule({
      module: "src.engine.anti_setups.miner",
      config: parsed.data as unknown as Record<string, unknown>,
      timeoutMs: 300_000,
      componentName: "anti-setup-miner",
    });
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Anti-setup mining failed");
    res.status(500).json({ error: "Anti-setup mining failed", details: String(err) });
  }
});

// ─── POST /api/anti-setups/check ────────────────────────────────
// Check if current context matches anti-setup
antiSetupRoutes.post("/check", async (req, res) => {
  const parsed = checkSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  try {
    const result = await runPythonModule({
      module: "src.engine.anti_setups.filter_gate",
      config: parsed.data as unknown as Record<string, unknown>,
      componentName: "anti-setup-check",
    });
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Anti-setup check failed");
    res.status(500).json({ error: "Anti-setup check failed", details: String(err) });
  }
});

// ─── GET /api/anti-setups/active/:strategyId ────────────────────
// Get active anti-setup filters for a strategy
antiSetupRoutes.get("/active/:strategyId", async (_req, res) => {
  res.status(501).json({ error: "Not implemented — anti-setup persistence not yet available" });
});

// ─── POST /api/anti-setups/backtest ─────────────────────────────
// Backtest impact of anti-setup filters
antiSetupRoutes.post("/backtest", async (req, res) => {
  const parsed = backtestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  try {
    const result = await runPythonModule({
      module: "src.engine.anti_setups.anti_setup_backtest",
      config: parsed.data as unknown as Record<string, unknown>,
      componentName: "anti-setup-backtester",
    });
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Anti-setup backtest failed");
    res.status(500).json({ error: "Anti-setup backtest failed", details: String(err) });
  }
});

// ─── GET /api/anti-setups/stats ─────────────────────────────────
// Overall anti-setup statistics
antiSetupRoutes.get("/stats", async (_req, res) => {
  res.json({
    message: "Anti-setup statistics endpoint. Mine anti-setups first via POST /api/anti-setups/mine",
    supported_conditions: [
      "time_of_day",
      "volatility",
      "volume",
      "day_of_week",
      "regime",
      "archetype",
      "event_proximity",
      "streak",
    ],
  });
});
