/**
 * Decay Detection Routes — Half-life detector + auto-quarantine
 *
 * Follows the backtest-service.ts subprocess spawn pattern:
 * - Platform detection (python vs python3)
 * - stdout -> JSON.parse
 * - stderr -> logging
 *
 * B1 fix: signals route now queries paper P&L from DB before calling Python.
 * B3 fix: quarantine/evaluate route fetches promoted_at from lifecycle_transitions.
 * B6 fix: analyze route accepts optional strategy_id for DB-derived P&L.
 * Dashboard fix: dashboard route fetches per-strategy P&L for all active strategies.
 */

import { Router } from "express";
import { z } from "zod";
import { and, eq, gte, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { paperTrades, paperSessions, strategies, lifecycleTransitions } from "../db/schema.js";
import { runPythonModule } from "../lib/python-runner.js";

export const decayRoutes = Router();

// ─── Validation Schemas ──────────────────────────────────────────

// B6 fix: strategy_id is optional. When provided and daily_pnls absent, P&L is
// derived from paper_trades. daily_pnls.min(1) is relaxed to allow omission when
// strategy_id drives the DB lookup.
const analyzeSchema = z.object({
  strategy_id: z.string().uuid().optional(),
  daily_pnls: z.array(z.number()).optional(),
  trades: z.array(z.record(z.unknown())).optional(),
  strategy_regime: z.string().optional(),
  current_regime: z.string().optional(),
  window: z.number().int().min(10).max(120).default(60),
});

// B3 fix: strategy_id added so promoted_at can be fetched from lifecycle_transitions.
const quarantineEvalSchema = z.object({
  strategy_id: z.string().uuid().optional(),
  current_level: z.enum(["healthy", "watch", "reduce", "quarantine", "retire"]),
  decay_score: z.number().min(0).max(100),
  days_at_current_level: z.number().int().min(0),
  improving_days: z.number().int().min(0).default(0),
});

// ─── DB helper: fetch paper P&L for a strategy ──────────────────
//
// Queries paper_trades (joined via paper_sessions.strategyId) for the last
// DECAY_LOOKBACK_DAYS (default 90).  Groups P&L by UTC calendar day.
//
// Returns:
//   daily_pnls  — one float per trading day, ordered oldest-first.
//   trades      — raw trade objects for sub-signal granular analysis.
//   has_data    — false when no paper trades exist yet.

const DECAY_LOOKBACK_DAYS = 90;

async function fetchStrategyPaperPnl(strategyId: string): Promise<{
  daily_pnls: number[];
  trades: Array<Record<string, unknown>>;
  has_data: boolean;
}> {
  const since = new Date(Date.now() - DECAY_LOOKBACK_DAYS * 86_400_000);

  // Join paper_trades → paper_sessions to filter by strategyId.
  // exitTime is TZ-aware (migration F-5 / 0126); UTC date grouping is correct.
  const rows = await db
    .select({
      pnl: paperTrades.pnl,
      exitTime: paperTrades.exitTime,
      mfe: paperTrades.mfe,
      slippage: paperTrades.slippage,
      contracts: paperTrades.contracts,
    })
    .from(paperTrades)
    .innerJoin(paperSessions, eq(paperTrades.sessionId, paperSessions.id))
    .where(
      and(
        eq(paperSessions.strategyId, strategyId),
        gte(paperTrades.exitTime, since),
      ),
    )
    .orderBy(paperTrades.exitTime);

  if (rows.length === 0) {
    return { daily_pnls: [], trades: [], has_data: false };
  }

  // Group net P&L by UTC date string (YYYY-MM-DD).
  const byDay = new Map<string, number>();
  for (const row of rows) {
    const day = row.exitTime.toISOString().substring(0, 10);
    const pnl = parseFloat(String(row.pnl ?? "0"));
    if (!Number.isFinite(pnl)) continue;
    byDay.set(day, (byDay.get(day) ?? 0) + pnl);
  }

  // Sort by date ascending (Map insertion is in order due to the orderBy above, but
  // explicit sort is defensive).
  const daily_pnls = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => v);

  const trades = rows.map((r) => ({
    pnl: parseFloat(String(r.pnl ?? "0")),
    mfe: r.mfe !== null && r.mfe !== undefined ? parseFloat(String(r.mfe)) : null,
    slippage: r.slippage !== null && r.slippage !== undefined ? parseFloat(String(r.slippage)) : null,
    contracts: r.contracts ?? 1,
    exit_time: r.exitTime.toISOString(),
  }));

  return { daily_pnls, trades, has_data: true };
}

// ─── DB helper: fetch promoted_at for a strategy ────────────────
//
// Looks up the earliest CANDIDATE → PAPER (or TESTING → PAPER / SHADOW → PAPER)
// transition in lifecycle_transitions to derive the promotion date.
// Returns null when no promotion transition exists yet.

async function fetchStrategyPromotedAt(strategyId: string): Promise<string | null> {
  const PROMOTION_STATES = ["PAPER", "SHADOW", "DEPLOY_READY", "DEPLOYED"];

  const rows = await db
    .select({ createdAt: lifecycleTransitions.createdAt, toState: lifecycleTransitions.toState })
    .from(lifecycleTransitions)
    .where(
      and(
        eq(lifecycleTransitions.strategyId, strategyId),
        inArray(lifecycleTransitions.toState, PROMOTION_STATES),
      ),
    )
    .orderBy(lifecycleTransitions.createdAt)
    .limit(1);

  return rows.length > 0 ? rows[0].createdAt.toISOString() : null;
}

// ─── GET /api/decay/status/:strategyId ──────────────────────────
// Current decay status + quarantine level
decayRoutes.get("/status/:strategyId", async (req, res) => {
  const { strategyId } = req.params;

  try {
    const result = await runPythonModule({
      module: "src.engine.decay.half_life",
      config: { action: "status", strategy_id: strategyId },
      componentName: "decay-status",
    });
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Decay status failed");
    const status = String(err).includes("timed out") ? 504 : 500;
    res.status(status).json({ error: "Failed to get decay status", details: String(err) });
  }
});

// ─── POST /api/decay/analyze ────────────────────────────────────
// Run full decay analysis on a strategy.
//
// B6 fix: if strategy_id is provided and daily_pnls is absent or empty, the route
// fetches real paper P&L from DB before calling Python.  Fail-soft when no paper
// data exists yet: Python still runs (with empty daily_pnls) and half_life.py
// returns the documented "No P&L data supplied" message.
decayRoutes.post("/analyze", async (req, res) => {
  const parsed = analyzeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  let { daily_pnls, trades } = parsed.data;
  const { strategy_id, ...rest } = parsed.data;

  // B6: if caller didn't supply daily_pnls (or passed an empty array), derive from DB.
  if (strategy_id && (!daily_pnls || daily_pnls.length === 0)) {
    try {
      const fetched = await fetchStrategyPaperPnl(strategy_id);
      daily_pnls = fetched.daily_pnls;
      trades = fetched.trades as Array<Record<string, unknown>>;
    } catch (dbErr) {
      req.log.warn({ dbErr, strategy_id }, "Decay analyze: DB P&L fetch failed; proceeding with empty");
      daily_pnls = [];
      trades = [];
    }
  }

  // Guard: still no data after DB attempt → fail-soft with documented shape.
  if (!daily_pnls || daily_pnls.length === 0) {
    res.json({
      insufficient_sample: true,
      composite_score: 0.0,
      reason: "no_paper_data",
      strategy_id: strategy_id ?? null,
    });
    return;
  }

  try {
    const result = await runPythonModule({
      module: "src.engine.decay.half_life",
      config: {
        action: "analyze",
        ...rest,
        strategy_id: strategy_id ?? null,
        daily_pnls,
        trades: trades ?? [],
      } as unknown as Record<string, unknown>,
      componentName: "decay-analysis",
    });
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Decay analysis failed");
    const status = String(err).includes("timed out") ? 504 : 500;
    res.status(status).json({ error: "Decay analysis failed", details: String(err) });
  }
});

// ─── GET /api/decay/signals/:strategyId ─────────────────────────
// Individual sub-signal breakdown.
//
// B1 fix: queries paper P&L from paper_trades/paper_sessions before calling
// sub_signals.py.  Without real P&L, composite_decay_score returns 0.0 for
// ALL sub-signals (insufficient_data branches fire in Python).
// Fail-soft: returns { insufficient_sample: true } when no paper trades exist.
decayRoutes.get("/signals/:strategyId", async (req, res) => {
  const { strategyId } = req.params;

  try {
    const { daily_pnls, trades, has_data } = await fetchStrategyPaperPnl(strategyId);

    // Fail-soft: document the absence of data rather than letting Python emit
    // silent 0.0 scores that look like a healthy strategy with no decay.
    if (!has_data) {
      res.json({
        insufficient_sample: true,
        composite_score: 0.0,
        reason: "no_paper_data",
        strategy_id: strategyId,
      });
      return;
    }

    const result = await runPythonModule({
      module: "src.engine.decay.sub_signals",
      config: {
        action: "signals",
        strategy_id: strategyId,
        daily_pnls,
        trades,
      } as unknown as Record<string, unknown>,
      componentName: "decay-signals",
    });
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Decay signals failed");
    const status = String(err).includes("timed out") ? 504 : 500;
    res.status(status).json({ error: "Failed to get decay signals", details: String(err) });
  }
});

// ─── POST /api/decay/quarantine/evaluate ────────────────────────
// Evaluate quarantine level transition.
//
// B3 fix: fetches promoted_at from lifecycle_transitions when strategy_id is
// provided.  Without promoted_at, Python's _within_grace_period() always returns
// False — newly promoted strategies are incorrectly subject to immediate quarantine
// escalation before the grace window expires.
decayRoutes.post("/quarantine/evaluate", async (req, res) => {
  const parsed = quarantineEvalSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  const { strategy_id, ...evalData } = parsed.data;

  // B3: derive promoted_at from the first promotion transition.
  let promoted_at: string | null = null;
  if (strategy_id) {
    try {
      promoted_at = await fetchStrategyPromotedAt(strategy_id);
    } catch (dbErr) {
      req.log.warn({ dbErr, strategy_id }, "Decay quarantine: promoted_at fetch failed; proceeding without");
    }
  }

  try {
    const result = await runPythonModule({
      module: "src.engine.decay.quarantine",
      config: {
        action: "evaluate",
        ...evalData,
        strategy_id: strategy_id ?? null,
        promoted_at,
      } as unknown as Record<string, unknown>,
      componentName: "quarantine-eval",
    });
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Quarantine evaluation failed");
    const status = String(err).includes("timed out") ? 504 : 500;
    res.status(status).json({ error: "Quarantine evaluation failed", details: String(err) });
  }
});

// ─── GET /api/decay/dashboard ───────────────────────────────────
// All strategies with their decay status.
//
// Dashboard fix: fetches per-strategy paper P&L for active strategies (PAPER /
// SHADOW / DEPLOY_READY / DEPLOYED) and passes them to Python as the `strategies`
// array. Without this, Python always receives an empty list and emits a
// `{ strategies: [], summary: { total: 0, healthy: 0, declining: 0 } }`.
decayRoutes.get("/dashboard", async (req, res) => {
  try {
    // Query active strategies that have paper trades (P&L data to analyse).
    const ACTIVE_LIFECYCLE_STAGES = ["PAPER", "SHADOW", "DEPLOY_READY", "DEPLOYED"];
    const activeStrats = await db
      .select({ id: strategies.id, name: strategies.name })
      .from(strategies)
      .where(inArray(strategies.lifecycleState, ACTIVE_LIFECYCLE_STAGES));

    // Fetch per-strategy daily P&L in parallel; skip strategies with no data.
    const strategyPayloads = await Promise.all(
      activeStrats.map(async (s) => {
        try {
          const { daily_pnls, has_data } = await fetchStrategyPaperPnl(s.id);
          if (!has_data) return null;
          return { strategy_id: s.id, daily_pnls, window: 60 };
        } catch {
          return null;
        }
      }),
    );

    const strategiesForPython = strategyPayloads.filter(Boolean);

    const result = await runPythonModule({
      module: "src.engine.decay.half_life",
      config: {
        action: "dashboard",
        strategies: strategiesForPython,
      } as unknown as Record<string, unknown>,
      componentName: "decay-dashboard",
    });
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Decay dashboard failed");
    const status = String(err).includes("timed out") ? 504 : 500;
    res.status(status).json({ error: "Failed to get decay dashboard", details: String(err) });
  }
});
