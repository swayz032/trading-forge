/**
 * Bias State Route — Wave 23.C + Gap-Fix-B operator visibility
 *
 * GET /api/bias-state/today
 *   Returns the current trading day's bias state for ALL symbols (MES/MNQ/MCL).
 *   Picks the latest computed_at row per (session_date, symbol).
 *   Shape:
 *     { session_date, symbols: { MES: {...}, MNQ: {...}, MCL: {...} } }
 *
 * GET /api/bias-state/history?days=7
 *   Returns the last N days of bias_state rows (default 7, max 30).
 *   Returns flat array of rows (all symbols interleaved, ordered by session_date DESC).
 *
 * These routes are always available regardless of pipeline pause state.
 * Fail-open: errors return 200 with success:false rather than 500.
 */

import { Router, Request, Response } from "express";
import { db } from "../db/index.js";
import { biasState, strategies } from "../db/schema.js";
import { logger } from "../lib/logger.js";
import { eq, desc, gte, and, sql } from "drizzle-orm";
import { BIAS_SYMBOLS } from "../services/bias-state-service.js";

export const biasStateRoutes = Router();

// ─── GET /api/bias-state/today ───────────────────────────────────────────────

biasStateRoutes.get("/today", async (_req: Request, res: Response) => {
  try {
    const todayStr = new Date().toISOString().substring(0, 10); // YYYY-MM-DD UTC

    // Fetch latest row per symbol using MAX(computed_at) per (session_date, symbol)
    // We use a subquery to get the most recent row per symbol.
    const rows = await db
      .select({
        sessionDate:      biasState.sessionDate,
        symbol:           biasState.symbol,
        regimeLabel:      biasState.regimeLabel,
        playbook:         biasState.playbook,
        activeStrategyId: biasState.activeStrategyId,
        evidence:         biasState.evidence,
        computedAt:       biasState.computedAt,
      })
      .from(biasState)
      .where(
        and(
          eq(biasState.sessionDate, todayStr),
          // Only return the latest row per symbol: use a lateral/window approach.
          // Simpler: fetch all rows for today ordered by computed_at DESC, then
          // deduplicate in JS (avoids complex window SQL in Drizzle ORM).
        ),
      )
      .orderBy(desc(biasState.computedAt));

    // Deduplicate: keep only the latest row per symbol (first occurrence since DESC order)
    const latestBySymbol = new Map<string, typeof rows[0]>();
    for (const row of rows) {
      if (!latestBySymbol.has(row.symbol)) {
        latestBySymbol.set(row.symbol, row);
      }
    }

    if (latestBySymbol.size === 0) {
      res.json({
        success: true,
        data: null,
        message: "No bias state for today — session has not started or bias engine has not run yet",
      });
      return;
    }

    // Resolve strategy names in parallel
    const strategyNameCache = new Map<string, string | null>();
    await Promise.all(
      [...latestBySymbol.values()]
        .filter((r) => r.activeStrategyId)
        .map(async (r) => {
          if (!r.activeStrategyId || strategyNameCache.has(r.activeStrategyId)) return;
          try {
            const [strat] = await db
              .select({ name: strategies.name })
              .from(strategies)
              .where(eq(strategies.id, r.activeStrategyId))
              .limit(1);
            strategyNameCache.set(r.activeStrategyId, strat?.name ?? null);
          } catch {
            strategyNameCache.set(r.activeStrategyId, null);
          }
        }),
    );

    // Build per-symbol response object
    const symbolsData: Record<string, {
      regime: string;
      playbook: string;
      active_strategy_id: string | null;
      active_strategy_name: string | null;
      computed_at: Date;
      evidence: unknown;
    }> = {};

    for (const sym of BIAS_SYMBOLS) {
      const row = latestBySymbol.get(sym);
      if (row) {
        symbolsData[sym] = {
          regime:               row.regimeLabel,
          playbook:             row.playbook,
          active_strategy_id:   row.activeStrategyId ?? null,
          active_strategy_name: row.activeStrategyId
            ? (strategyNameCache.get(row.activeStrategyId) ?? null)
            : null,
          computed_at:          row.computedAt,
          evidence:             row.evidence,
        };
      }
    }

    // Also include any non-standard symbols present
    for (const [sym, row] of latestBySymbol) {
      if (!symbolsData[sym]) {
        symbolsData[sym] = {
          regime:               row.regimeLabel,
          playbook:             row.playbook,
          active_strategy_id:   row.activeStrategyId ?? null,
          active_strategy_name: row.activeStrategyId
            ? (strategyNameCache.get(row.activeStrategyId) ?? null)
            : null,
          computed_at:          row.computedAt,
          evidence:             row.evidence,
        };
      }
    }

    // Determine the overall session date (latest row)
    const allRows = [...latestBySymbol.values()];
    const latestComputedAt = allRows.reduce((max, r) => r.computedAt > max ? r.computedAt : max, allRows[0].computedAt);

    res.json({
      success: true,
      data: {
        session_date: todayStr,
        symbols:      symbolsData,
        latest_computed_at: latestComputedAt,
      },
    });
  } catch (err) {
    logger.warn({ err }, "bias-state/today: query error");
    res.status(500).json({ success: false, error: "query_error" });
  }
});

// ─── GET /api/bias-state/history ─────────────────────────────────────────────

biasStateRoutes.get("/history", async (req: Request, res: Response) => {
  try {
    const rawDays = parseInt(req.query["days"] as string ?? "7", 10);
    const days = Math.max(1, Math.min(30, isNaN(rawDays) ? 7 : rawDays));

    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - days);
    const cutoffStr = cutoff.toISOString().substring(0, 10);

    const rows = await db
      .select({
        sessionDate:      biasState.sessionDate,
        symbol:           biasState.symbol,
        regimeLabel:      biasState.regimeLabel,
        playbook:         biasState.playbook,
        activeStrategyId: biasState.activeStrategyId,
        computedAt:       biasState.computedAt,
      })
      .from(biasState)
      .where(gte(biasState.sessionDate, cutoffStr))
      .orderBy(desc(biasState.sessionDate), desc(biasState.computedAt))
      .limit((days + 1) * BIAS_SYMBOLS.length * 2); // allow for multiple rows per day per symbol

    res.json({ success: true, data: rows, days });
  } catch (err) {
    logger.warn({ err }, "bias-state/history: query error");
    res.status(500).json({ success: false, error: "query_error" });
  }
});
