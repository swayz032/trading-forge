/**
 * Pre-Market Route — W23H.2 operator visibility
 *
 * GET /api/pre-market/today/:symbol
 *   Returns the latest pre_market_sessions row for (CURRENT_DATE, symbol).
 *   404 if not yet computed for today.
 *
 * GET /api/pre-market/history/:symbol?limit=N
 *   Returns last N days of rows for the symbol (default 30, max 90).
 *
 * Always available regardless of pipeline pause state.
 * Fail-open: errors return 200 with success:false rather than 500.
 */

import { Router, Request, Response } from "express";
import { db } from "../db/index.js";
import { preMarketSessions } from "../db/schema.js";
import { logger } from "../lib/logger.js";
import { eq, desc, and } from "drizzle-orm";
import { sql } from "drizzle-orm";

export const preMarketRoutes = Router();

// ─── GET /api/pre-market/today/:symbol ───────────────────────────────────────

preMarketRoutes.get("/today/:symbol", async (req: Request, res: Response) => {
  const { symbol } = req.params;
  const todayStr = new Date().toISOString().slice(0, 10);

  try {
    const rows = await db
      .select()
      .from(preMarketSessions)
      .where(
        and(
          sql`session_date = ${todayStr}::date`,
          eq(preMarketSessions.symbol, symbol.toUpperCase()),
        ),
      )
      .orderBy(desc(preMarketSessions.computedAt))
      .limit(1);

    if (rows.length === 0) {
      res.status(404).json({
        success: false,
        error: "not_yet_computed",
        message: `Pre-market session not yet computed for ${symbol} on ${todayStr}`,
        sessionDate: todayStr,
        symbol: symbol.toUpperCase(),
      });
      return;
    }

    res.json({
      success: true,
      data: rows[0],
    });
  } catch (err) {
    logger.error({ err, symbol, date: todayStr }, "pre-market route: today lookup error");
    res.status(500).json({
      success: false,
      error: "internal_error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

// ─── GET /api/pre-market/history/:symbol?limit=N ────────────────────────────

preMarketRoutes.get("/history/:symbol", async (req: Request, res: Response) => {
  const { symbol } = req.params;
  const rawLimit = parseInt(String(req.query.limit ?? "30"), 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 90) : 30;

  try {
    const rows = await db
      .select()
      .from(preMarketSessions)
      .where(eq(preMarketSessions.symbol, symbol.toUpperCase()))
      .orderBy(desc(preMarketSessions.sessionDate))
      .limit(limit);

    res.json({
      success: true,
      symbol: symbol.toUpperCase(),
      limit,
      count: rows.length,
      data: rows,
    });
  } catch (err) {
    logger.error({ err, symbol, limit }, "pre-market route: history lookup error");
    res.status(500).json({
      success: false,
      error: "internal_error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});
