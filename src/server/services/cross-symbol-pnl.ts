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

// deepscan7 paper-MED-1 (2026-07-02): the firm-level DLL aggregate must include
// sessions stopped/paused mid-day — an "active"-only filter let a sibling session
// under-count firm losses already realized today by a session the operator (or a
// halt path) stopped after taking losses. Day-scoping stays in the per-session
// dailyPnlBreakdown[sessionDate] read, so a stopped session with only prior-day
// losses still contributes 0 to today's aggregate.
export const DLL_AGGREGATE_SESSION_STATUSES = ["active", "stopped", "paused"] as const;

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
    const { eq, and, isNull, inArray, sql } = await import("drizzle-orm");

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
        inArray(paperSessions.status, [...DLL_AGGREGATE_SESSION_STATUSES]),
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
        // deepscan7 paper-MED-1: a paused session's open positions are live firm
        // exposure — count their MTM toward the firm DLL like the active set.
        inArray(paperSessions.status, [...DLL_AGGREGATE_SESSION_STATUSES]),
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

// DLL_WARN_80PCT: alert-only band between the 67% halt and the 95% force-close.
// At 80% a family-grade warning fires once per session (in kill-switch.ts Layer 2).
// Does NOT halt or reduce size on its own — the 67% halt has already fired.
// Exported here alongside peer DLL threshold constants for auditability.
export const DLL_WARN_80PCT = (() => {
  const envVal = process.env["DLL_WARN_80PCT"];
  if (envVal && !isNaN(parseFloat(envVal))) return parseFloat(envVal);
  return 0.80;
})();

// DLL_REDUCE_SIZE_PCT: SOFT band BELOW the halt — at this fraction of personal DLL, new entries
// are sized DOWN (not blocked) to absorb a losing streak before the hard 67% halt. Completes the
// institutional 60/80/90/100 escalation ladder (NexusFi Operations Manual 2026-06; a 60% band is
// math, not paranoia — a $50K Topstep tolerates ~2.5 max-loss days). Default 60%.
export const DLL_REDUCE_SIZE_PCT = (() => {
  const envVal = process.env["DLL_REDUCE_SIZE_PCT"];
  if (envVal && !isNaN(parseFloat(envVal))) return parseFloat(envVal);
  return 0.60;
})();

// DLL_REDUCE_SIZE_FACTOR: size multiplier applied when in the reduce_size band (default 0.50 = half).
export const DLL_REDUCE_SIZE_FACTOR = (() => {
  const envVal = process.env["DLL_REDUCE_SIZE_FACTOR"];
  if (envVal && !isNaN(parseFloat(envVal))) {
    const v = parseFloat(envVal);
    if (v > 0 && v <= 1) return v;   // clamp to (0,1] — a reduce factor must shrink, never zero/grow
  }
  return 0.50;
})();

export interface CrossSymbolDllResult {
  /** none — within limits; reduce_size — soft 60% band (size down, don't block); halt — 67%; force_close — 95% */
  action: "none" | "reduce_size" | "halt" | "force_close";
  combinedPnL: number;
  dllPct: number;   // fraction of personal DLL consumed (negative = loss, positive = gain)
  reduceThreshold: number;
  reduceSizeFactor: number;   // multiplier to apply to new-entry contracts when action === "reduce_size"
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
  const reduceThreshold = personalDllDollars * DLL_REDUCE_SIZE_PCT;
  const haltThreshold = personalDllDollars * DLL_HALT_PCT;
  const forceCloseThreshold = personalDllDollars * DLL_FORCE_CLOSE_PCT;

  // Only drawdown (negative P&L) is relevant for DLL.
  // A positive combined P&L never triggers a halt.
  const drawdown = pnl.totalPnL < 0 ? Math.abs(pnl.totalPnL) : 0;
  const dllPct = personalDllDollars > 0 ? drawdown / personalDllDollars : 0;

  // Escalation ladder (highest band wins): force_close (95%) > halt (67%) > reduce_size (60%) > none.
  let action: CrossSymbolDllResult["action"] = "none";
  if (drawdown >= forceCloseThreshold) {
    action = "force_close";
  } else if (drawdown >= haltThreshold) {
    action = "halt";
  } else if (drawdown >= reduceThreshold) {
    action = "reduce_size";
  }

  return {
    action,
    combinedPnL: pnl.totalPnL,
    dllPct,
    reduceThreshold,
    reduceSizeFactor: DLL_REDUCE_SIZE_FACTOR,
    haltThreshold,
    forceCloseThreshold,
    pnLBySymbol: pnl.pnLBySymbol,
  };
}
