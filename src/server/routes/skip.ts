/**
 * Skip Engine Routes — Pre-session classifier API
 *
 * Follows the survival.ts subprocess spawn pattern:
 * - Platform detection (python vs python3)
 * - stdout -> JSON.parse
 * - stderr -> logging
 */

import { Router } from "express";
import { spawn } from "child_process";
import { resolve as pathResolve } from "path";
import { z } from "zod";
import { db } from "../db/index.js";
import { skipDecisions } from "../db/schema.js";
import { eq, desc, and, gte, lte, sql } from "drizzle-orm";
import { logger } from "../index.js";

export const skipRoutes = Router();

const PROJECT_ROOT = pathResolve(import.meta.dirname ?? ".", "../..");

// ─── Python subprocess helper ──────────────────────────────────

function runPython(module: string, configJson: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    const args = ["-m", module, "--config", configJson];

    const proc = spawn(pythonCmd, args, {
      env: { ...process.env },
      cwd: PROJECT_ROOT,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => (stdout += data.toString()));
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
      logger.info({ component: "skip-engine" }, data.toString().trim());
    });

    proc.on("close", (code) => {
      if (code === 0) {
        try {
          resolve(JSON.parse(stdout.trim()));
        } catch {
          reject(new Error(`Failed to parse skip engine output: ${stdout}`));
        }
      } else {
        reject(new Error(`Skip engine failed (exit ${code}): ${stderr}`));
      }
    });

    proc.on("error", (err) => {
      if (pythonCmd === "python") {
        const proc2 = spawn("python3", args, {
          env: { ...process.env },
          cwd: PROJECT_ROOT,
        });
        let stdout2 = "";
        let stderr2 = "";
        proc2.stdout.on("data", (data) => (stdout2 += data.toString()));
        proc2.stderr.on("data", (data) => (stderr2 += data.toString()));
        proc2.on("close", (code) => {
          if (code === 0) {
            try { resolve(JSON.parse(stdout2.trim())); }
            catch { reject(new Error(`Failed to parse: ${stdout2}`)); }
          } else {
            reject(new Error(`Skip engine failed: ${stderr2}`));
          }
        });
        proc2.on("error", () => reject(err));
      } else {
        reject(err);
      }
    });
  });
}

// ─── Validation Schemas ──────────────────────────────────────────

const classifySchema = z.object({
  strategy_id: z.string().uuid().optional(),
  signals: z.object({
    event_proximity: z.object({
      event: z.string(),
      days_until: z.number(),
      impact: z.string(),
    }).optional(),
    vix: z.number().optional(),
    overnight_gap_atr: z.number().optional(),
    premarket_volume_pct: z.number().optional(),
    day_of_week: z.string().optional(),
    consecutive_losses: z.number().optional(),
    monthly_dd_usage_pct: z.number().optional(),
    portfolio_correlation: z.number().optional(),
    calendar: z.object({
      holiday_proximity: z.number().optional(),
      triple_witching: z.boolean().optional(),
      roll_week: z.boolean().optional(),
    }).optional(),
    bad_days: z.array(z.string()).optional(),
  }),
});

const backtestSchema = z.object({
  daily_pnls: z.array(z.object({
    date: z.string(),
    pnl: z.number(),
    signals: z.record(z.unknown()),
  })).min(1),
  skip_threshold: z.number().default(6.0),
  reduce_threshold: z.number().default(3.0),
  reduce_size_factor: z.number().min(0).max(1).default(0.5),
});

const overrideSchema = z.object({
  override_reason: z.string().min(1),
});

const outcomeSchema = z.object({
  actual_outcome: z.enum(["WIN", "LOSS", "FLAT"]),
  actual_pnl: z.number(),
});

// ─── POST /api/skip/classify ─────────────────────────────────────
// Run skip classifier for strategy + date
skipRoutes.post("/classify", async (req, res) => {
  const parsed = classifySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  try {
    const result = await runPython(
      "src.engine.skip_engine.skip_classifier",
      JSON.stringify(parsed.data),
    );

    // Store decision in DB
    const [saved] = await db.insert(skipDecisions).values({
      strategyId: parsed.data.strategy_id || null,
      decisionDate: new Date(),
      decision: String(result.decision),
      score: String(result.score),
      signals: parsed.data.signals,
      triggeredSignals: result.triggered_signals as string[],
      reason: String(result.reason || ""),
    }).returning();

    res.json({ ...result, id: saved.id });
  } catch (err) {
    logger.error({ err }, "Skip classify failed");
    res.status(500).json({ error: "Skip classification failed", details: String(err) });
  }
});

// ─── GET /api/skip/today ──────────────────────────────────────────
// Today's skip decisions for all strategies
skipRoutes.get("/today", async (_req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const decisions = await db
      .select()
      .from(skipDecisions)
      .where(
        and(
          gte(skipDecisions.decisionDate, today),
          lte(skipDecisions.decisionDate, tomorrow),
        )
      )
      .orderBy(desc(skipDecisions.createdAt));

    res.json({ date: today.toISOString().split("T")[0], decisions });
  } catch (err) {
    logger.error({ err }, "Failed to fetch today's skip decisions");
    res.status(500).json({ error: "Failed to fetch today's decisions", details: String(err) });
  }
});

// ─── POST /api/skip/backtest ──────────────────────────────────────
// Backtest skip engine on historical data
skipRoutes.post("/backtest", async (req, res) => {
  const parsed = backtestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  try {
    const result = await runPython(
      "src.engine.skip_engine.historical_skip_stats",
      JSON.stringify(parsed.data),
    );
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Skip backtest failed");
    res.status(500).json({ error: "Skip backtest failed", details: String(err) });
  }
});

// ─── GET /api/skip/history ────────────────────────────────────────
// Historical skip decisions
skipRoutes.get("/history", async (req, res) => {
  try {
    const { strategy_id, decision, limit = "50", offset = "0" } = req.query;

    const conditions = [];
    if (strategy_id) {
      conditions.push(eq(skipDecisions.strategyId, String(strategy_id)));
    }
    if (decision) {
      conditions.push(eq(skipDecisions.decision, String(decision)));
    }

    const query = db
      .select()
      .from(skipDecisions)
      .orderBy(desc(skipDecisions.decisionDate))
      .limit(Number(limit))
      .offset(Number(offset));

    if (conditions.length > 0) {
      const decisions = await query.where(and(...conditions));
      res.json({ decisions, limit: Number(limit), offset: Number(offset) });
    } else {
      const decisions = await query;
      res.json({ decisions, limit: Number(limit), offset: Number(offset) });
    }
  } catch (err) {
    logger.error({ err }, "Failed to fetch skip history");
    res.status(500).json({ error: "Failed to fetch history", details: String(err) });
  }
});

// ─── PATCH /api/skip/:id/override ─────────────────────────────────
// Human override a skip decision
skipRoutes.patch("/:id/override", async (req, res) => {
  const parsed = overrideSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  try {
    const { id } = req.params;
    const [updated] = await db
      .update(skipDecisions)
      .set({
        override: true,
        overrideReason: parsed.data.override_reason,
      })
      .where(eq(skipDecisions.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Skip decision not found" });
      return;
    }

    res.json(updated);
  } catch (err) {
    logger.error({ err }, "Failed to override skip decision");
    res.status(500).json({ error: "Override failed", details: String(err) });
  }
});

// ─── PATCH /api/skip/:id/outcome ──────────────────────────────────
// Record actual outcome post-session
skipRoutes.patch("/:id/outcome", async (req, res) => {
  const parsed = outcomeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  try {
    const { id } = req.params;
    const [updated] = await db
      .update(skipDecisions)
      .set({
        actualOutcome: parsed.data.actual_outcome,
        actualPnl: String(parsed.data.actual_pnl),
      })
      .where(eq(skipDecisions.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Skip decision not found" });
      return;
    }

    res.json(updated);
  } catch (err) {
    logger.error({ err }, "Failed to record outcome");
    res.status(500).json({ error: "Outcome update failed", details: String(err) });
  }
});
