/**
 * Skip Engine Routes — Pre-session classifier API
 *
 * Follows the survival.ts subprocess spawn pattern:
 * - Platform detection (python vs python3)
 * - stdout -> JSON.parse
 * - stderr -> logging
 */

import { Router } from "express";
import { z } from "zod";
import { db } from "../db/index.js";
import { skipDecisions } from "../db/schema.js";
import { eq, desc, and, gte, lte } from "drizzle-orm";
import { runPythonModule } from "../lib/python-runner.js";
import { getRegimeState, getAllRegimeState } from "../services/regime-state-service.js";
import { getLatestForecast, getDeepARWeight } from "../services/deepar-service.js";

export const skipRoutes = Router();

/**
 * Symbol used to fetch regime weights for portfolio-wide skip decisions.
 * NQ is Trading Forge's primary instrument — when no symbol is in the
 * signal payload, NQ regime is used as the proxy for "market regime".
 */
const DEFAULT_REGIME_SYMBOL = "NQ";

const stableSkipDecisionSelect = {
  id: skipDecisions.id,
  strategyId: skipDecisions.strategyId,
  decisionDate: skipDecisions.decisionDate,
  decision: skipDecisions.decision,
  score: skipDecisions.score,
  signals: skipDecisions.signals,
  triggeredSignals: skipDecisions.triggeredSignals,
  reason: skipDecisions.reason,
  override: skipDecisions.override,
  overrideReason: skipDecisions.overrideReason,
  actualOutcome: skipDecisions.actualOutcome,
  actualPnl: skipDecisions.actualPnl,
  createdAt: skipDecisions.createdAt,
};

// ─── Validation Schemas ──────────────────────────────────────────

const classifySchema = z.object({
  strategy_id: z.string().uuid().optional(),
  /** Optional symbol override for regime weighting; defaults to NQ */
  symbol: z.string().optional(),
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
    /** C1: caller may pre-attach regime weights; otherwise route fetches them */
    regime_probs: z.object({
      high_vol: z.number(),
      trending: z.number(),
      mean_revert: z.number(),
      effective_weight: z.number(),
    }).optional(),
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

const SkipResult = z.object({
  decision: z.enum(["TRADE", "REDUCE", "SKIP"]),
  score: z.number(),
  signals: z.array(z.object({ name: z.string(), score: z.number(), detail: z.string() })).optional(),
  triggered_signals: z.array(z.string()).optional(),
  reason: z.string().optional(),
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
    // C1: enrich signals with DeepAR regime state if caller didn't attach it.
    // We never fail the skip classify if regime fetch errors — the classifier
    // simply scores regime_bias as 0 when the field is absent.
    //
    // Wiring order:
    //   1. getRegimeState — in-memory (set by scheduler after predictRegime),
    //      or DB fallback, or uniform fallback.
    //   2. If getRegimeState returned uniform fallback (source === "fallback_uniform"),
    //      attempt a direct getLatestForecast() to hydrate raw DeepAR probs.
    //      This ensures the pre-session path never silently degrades to uniform
    //      weights when a real forecast row exists but the in-memory map was cleared.
    //   3. DeepAR governance: if getDeepARWeight() === 0, effective_weight is 0 and
    //      skip_classifier contributes 0 from regime_bias — challenger_only preserved.
    let enrichedSignals: Record<string, unknown> = { ...parsed.data.signals };
    if (!parsed.data.signals.regime_probs) {
      try {
        const regimeSym = parsed.data.symbol ?? DEFAULT_REGIME_SYMBOL;
        const regime = await getRegimeState(regimeSym);

        // If the regime-state service fell back to uniform weights (in-memory map
        // was empty AND DB had no row), attempt a direct DeepAR forecast read.
        // This closes the gap where the scheduler hasn't run yet today but a
        // forecast row from a prior run exists in deeparForecasts.
        let high_vol = regime.weights.high_vol;
        let trending = regime.weights.trending;
        let mean_revert = regime.weights.mean_revert;
        let effectiveWeight = regime.effectiveWeight;

        if (regime.source === "fallback_uniform") {
          try {
            const rawForecast = await getLatestForecast(regimeSym);
            if (rawForecast) {
              // Raw forecast exists — override the uniform fallback values.
              // effective_weight still comes from getDeepARWeight() so governance
              // is not loosened: challenger_only weight is still 0 in shadow mode.
              high_vol = Number(rawForecast.pHighVol ?? 1 / 3);
              trending = Number(rawForecast.pTrending ?? 1 / 3);
              mean_revert = Number(rawForecast.pMeanRevert ?? 1 / 3);
              effectiveWeight = getDeepARWeight();
              req.log.info(
                { symbol: regimeSym, forecastDate: rawForecast.forecastDate, effectiveWeight },
                "Skip classify: hydrated regime_probs from raw DeepAR forecast (fallback path)",
              );
            }
          } catch (forecastErr) {
            // Non-blocking — uniform weights will be used; classifier scores 0 for regime_bias.
            req.log.warn({ err: forecastErr, symbol: regimeSym }, "Skip classify: direct DeepAR forecast fetch failed (non-blocking)");
          }
        }

        enrichedSignals = {
          ...enrichedSignals,
          regime_probs: {
            high_vol,
            trending,
            mean_revert,
            effective_weight: effectiveWeight,
          },
        };
      } catch (regimeErr) {
        req.log.warn({ err: regimeErr }, "Skip classify: regime state fetch failed (non-blocking)");
      }
    }

    const pythonConfig = {
      ...parsed.data,
      signals: enrichedSignals,
    };

    const raw = await runPythonModule({
      module: "src.engine.skip_engine.skip_classifier",
      config: pythonConfig as unknown as Record<string, unknown>,
      componentName: "skip-classifier",
    });

    const skipParsed = SkipResult.safeParse(raw);
    if (!skipParsed.success) {
      req.log.error({ issues: skipParsed.error.issues }, "Invalid skip classifier response");
      res.status(502).json({ error: "Invalid skip classifier response", details: skipParsed.error.issues });
      return;
    }
    const result = skipParsed.data;

    // Store decision in DB — persist the enriched signals so replay sees the
    // exact regime weights we used (replayability is non-negotiable).
    const [saved] = await db.insert(skipDecisions).values({
      strategyId: parsed.data.strategy_id || null,
      decisionDate: new Date(),
      decision: result.decision,
      score: String(result.score),
      signals: enrichedSignals,
      triggeredSignals: result.triggered_signals as string[],
      reason: String(result.reason || ""),
    }).returning();

    res.json({ ...result, id: saved.id });
  } catch (err) {
    req.log.error({ err }, "Skip classify failed");
    res.status(500).json({ error: "Skip classification failed", details: String(err) });
  }
});

// ─── GET /api/skip/today ──────────────────────────────────────────
// Today's skip decisions for all strategies
skipRoutes.get("/today", async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const decisions = await db
      .select(stableSkipDecisionSelect)
      .from(skipDecisions)
      .where(
        and(
          gte(skipDecisions.decisionDate, today),
          lte(skipDecisions.decisionDate, tomorrow),
        )
      )
      .orderBy(desc(skipDecisions.createdAt));

    // C1: surface current regime state alongside decisions so dashboards
    // and n8n workflows see the same view the classifier used.
    const regimeState = getAllRegimeState();

    res.json({
      date: today.toISOString().split("T")[0],
      decisions,
      regime: regimeState,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch today's skip decisions");
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
    const result = await runPythonModule({
      module: "src.engine.skip_engine.historical_skip_stats",
      config: parsed.data as unknown as Record<string, unknown>,
      componentName: "skip-backtester",
    });
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Skip backtest failed");
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
      .select(stableSkipDecisionSelect)
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
    req.log.error({ err }, "Failed to fetch skip history");
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
    req.log.error({ err }, "Failed to override skip decision");
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
    req.log.error({ err }, "Failed to record outcome");
    res.status(500).json({ error: "Outcome update failed", details: String(err) });
  }
});
