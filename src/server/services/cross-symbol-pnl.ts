/**
 * cross-symbol-pnl.ts — W23H.F Cross-Symbol DLL Coordinator
 *
 * Aggregates realized P&L + open MTM P&L across ALL symbols on a given firmId
 * (= paper account grouping) for today's trading session.
 *
 * Called once per bar entry signal evaluation.  Results are NOT cached because
 * they must reflect the latest closed trades; the risk-gate daily-loss cache
 * in paper-risk-gate.ts handles global loss at a coarser level.
 *
 * DLL thresholds (from CLAUDE.md §4):
 *   HALT new entries  at 67% of personal_dll  (env: DLL_HALT_PCT, default 0.67)
 *   FORCE-CLOSE all   at 95% of personal_dll  (env: DLL_FORCE_CLOSE_PCT, default 0.95)
 *   personal_dll      = 67% of firm DLL
 *
 * Design:
 *  - groups by firmId (paper sessions have firmId; broker_accounts also carry firmId)
 *  - sums realized PnL from paper_trades.pnl WHERE exit_time on today's CME trading day
 *  - sums unrealized PnL from paper_positions WHERE closed_at IS NULL
 *  - returns pnLBySymbol breakdown for audit
 *
 * Fail-open: any DB error returns a result with totalPnL=0 so trading is never blocked
 * by a query error.
 */

import { logger } from "../lib/logger.js";

export interface AccountSessionPnL {
  firmId: string;
  sessionDate: string;
  realizedPnL: number;
  openPnLMtm: number;
  totalPnL: number;       // realized + open MTM
  pnLBySymbol: Record<string, number>;
}

/**
 * Compute cumulative P&L (realized + open MTM) across all symbols on a firmId
 * for today's CME trading day.
 *
 * Returns a zero-valued result on any error so callers always get a valid object.
 */
export async function getAccountSessionCumulativePnL(
  firmId: string,
  sessionDate: string,
): Promise<AccountSessionPnL> {
  const zero: AccountSessionPnL = {
    firmId,
    sessionDate,
    realizedPnL: 0,
    openPnLMtm: 0,
    totalPnL: 0,
    pnLBySymbol: {},
  };

  try {
    // Lazy imports to avoid top-level DB bootstrap in tests
    const { db } = await import("../db/index.js");
    const { paperPositions, paperSessions } = await import("../db/schema.js");
    const { eq, and, isNull, sql } = await import("drizzle-orm");

    // ── 1. Realized P&L: sum paper_trades.pnl for today ──────────────────────
    // We use the dailyPnlBreakdown JSONB on each session (already maintained by
    // the trade-close path) as the realized P&L source. This avoids a full
    // paper_trades scan and gives the same result.
    const sessionRows = await db
      .select({
        id: paperSessions.id,
        symbol: sql<string>`(${paperSessions.config}->>'symbol')`.as("symbol"),
        dailyPnlBreakdown: paperSessions.dailyPnlBreakdown,
      })
      .from(paperSessions)
      .where(and(
        eq(paperSessions.firmId, firmId),
        eq(paperSessions.status, "active"),
      ));

    let totalRealized = 0;
    const bySymbol: Record<string, number> = {};

    for (const session of sessionRows) {
      const breakdown = (session.dailyPnlBreakdown as Record<string, number> | null) ?? {};
      const todayPnl = breakdown[sessionDate] ?? 0;
      totalRealized += todayPnl;

      const sym = session.symbol ?? "UNKNOWN";
      bySymbol[sym] = (bySymbol[sym] ?? 0) + todayPnl;
    }

    // ── 2. Open MTM P&L: sum unrealized_pnl from open positions ─────────────
    // Join paper_positions to paper_sessions to filter by firmId.
    const openPositions = await db
      .select({
        symbol: paperPositions.symbol,
        unrealizedPnl: paperPositions.unrealizedPnl,
      })
      .from(paperPositions)
      .innerJoin(paperSessions, eq(paperSessions.id, paperPositions.sessionId))
      .where(and(
        isNull(paperPositions.closedAt),
        eq(paperSessions.firmId, firmId),
        eq(paperSessions.status, "active"),
      ));

    let totalMtm = 0;
    for (const pos of openPositions) {
      const mtm = parseFloat(pos.unrealizedPnl ?? "0");
      totalMtm += mtm;
      const sym = pos.symbol ?? "UNKNOWN";
      bySymbol[sym] = (bySymbol[sym] ?? 0) + mtm;
    }

    return {
      firmId,
      sessionDate,
      realizedPnL: totalRealized,
      openPnLMtm: totalMtm,
      totalPnL: totalRealized + totalMtm,
      pnLBySymbol: bySymbol,
    };
  } catch (err) {
    logger.warn(
      { err, firmId, sessionDate },
      "cross-symbol-pnl: DB query failed — returning zero (fail-open, trading not blocked)",
    );
    return zero;
  }
}

// ─── DLL threshold constants ─────────────────────────────────────────────────
// From CLAUDE.md §4: personal DLL = 67% of firm DLL.
// At 67% of personal DLL → HALT new entries.
// At 95% of personal DLL → FORCE-CLOSE all positions.
//
// The firm DLL is a $ amount per firm. We use a reasonable default of $1,000
// for paper trading (matches MFFU 50K eval at 2% = $1,000). Operator can
// override via PERSONAL_DLL_DOLLARS env var.

export const DEFAULT_PERSONAL_DLL_DOLLARS = (() => {
  const envVal = process.env["PERSONAL_DLL_DOLLARS"];
  if (envVal && !isNaN(parseFloat(envVal))) return parseFloat(envVal);
  return 1_000;   // $1,000 default personal DLL for paper sessions
})();

// DLL_HALT_PCT: halt new entries at this fraction of personal DLL (default 67%)
export const DLL_HALT_PCT = (() => {
  const envVal = process.env["DLL_HALT_PCT"];
  if (envVal && !isNaN(parseFloat(envVal))) return parseFloat(envVal);
  return 0.67;
})();

// DLL_FORCE_CLOSE_PCT: force-close all positions at this fraction (default 95%)
export const DLL_FORCE_CLOSE_PCT = (() => {
  const envVal = process.env["DLL_FORCE_CLOSE_PCT"];
  if (envVal && !isNaN(parseFloat(envVal))) return parseFloat(envVal);
  return 0.95;
})();

export interface CrossSymbolDllResult {
  /** No action — P&L is within limits */
  action: "none" | "halt" | "force_close";
  combinedPnL: number;
  dllPct: number;   // fraction of personal DLL consumed (negative = loss, positive = gain)
  haltThreshold: number;
  forceCloseThreshold: number;
  pnLBySymbol: Record<string, number>;
}

/**
 * Check combined P&L against cross-symbol DLL thresholds.
 * Pure function — no DB access.
 */
export function evaluateCrossSymbolDll(
  pnl: AccountSessionPnL,
  personalDllDollars: number = DEFAULT_PERSONAL_DLL_DOLLARS,
): CrossSymbolDllResult {
  const haltThreshold = personalDllDollars * DLL_HALT_PCT;
  const forceCloseThreshold = personalDllDollars * DLL_FORCE_CLOSE_PCT;

  // Only drawdown (negative P&L) is relevant for DLL.
  // A positive combined P&L never triggers a halt.
  const drawdown = pnl.totalPnL < 0 ? Math.abs(pnl.totalPnL) : 0;
  const dllPct = personalDllDollars > 0 ? drawdown / personalDllDollars : 0;

  let action: CrossSymbolDllResult["action"] = "none";
  if (drawdown >= forceCloseThreshold) {
    action = "force_close";
  } else if (drawdown >= haltThreshold) {
    action = "halt";
  }

  return {
    action,
    combinedPnL: pnl.totalPnL,
    dllPct,
    haltThreshold,
    forceCloseThreshold,
    pnLBySymbol: pnl.pnLBySymbol,
  };
}
