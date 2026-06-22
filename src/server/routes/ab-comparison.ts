/**
 * src/server/routes/ab-comparison.ts — Wave 29 Pass D.2 (paper-parity)
 *
 * READ-ONLY A/B paper sub-account Sharpe comparison endpoint.
 * Pure observability — no gate authority, no write side effects.
 *
 * Routes:
 *   GET /api/ab-comparison/recent
 *     → Rolling 20-session Sharpe, cumulative P&L, max drawdown, trade count
 *       for both slumdawg-baseline (Sub-Account 1) and slumdawg-rl-challenger
 *       (Sub-Account 2), plus derived deltas.
 *     → Kill switch status from the latest quantum_rl.kill_switch_evaluated audit row.
 *     → Returns 200 with trade_count=0 empty payload when no positions yet.
 *     → Fail-soft: if broker_accounts row missing for either sub-account, logs
 *       a warn audit row and returns empty payload for that sub-account.
 *
 * Design:
 *   - READ-ONLY. No buttons, no actions, no kill switch override.
 *   - Drizzle ORM only — no raw SQL where avoidable.
 *   - inArray() for array filters (per CLAUDE.md §13 "Don't" list).
 *   - Sharpe via inline computation (rolling session returns, std-dev, sqrt annualisation).
 *     The MetricsAggregator uses trade-level sqrt(252) for display; we use session-level
 *     rolling-20 variant here (same formula, different window unit) consistent with the
 *     kill switch definition in the plan.
 *   - Logger from ./logger.js leaf module.
 */

import { Router, type Request, type Response } from "express";
import { db } from "../db/index.js";
import {
  brokerAccounts,
  paperSessions,
  paperTrades,
  auditLog,
} from "../db/schema.js";
import {
  desc,
  eq,
  inArray,
  isNull,
  isNotNull,
  sql,
} from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { rlAbSharpeDelta, rlAbPnlDelta } from "../lib/metrics-registry.js";

export const abComparisonRoutes = Router();

// ─── Slugs ────────────────────────────────────────────────────────────────────

const BASELINE_SLUG     = "slumdawg-baseline";
const CHALLENGER_SLUG   = "slumdawg-rl-challenger";
const KILL_SWITCH_ACTION = "quantum_rl.kill_switch_evaluated";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SubAccountMetrics {
  rolling_20_session_sharpe: number;
  cumulative_pnl: number;
  max_drawdown: number;
  trade_count: number;
}

export interface ABComparisonDelta {
  sharpe_delta: number;
  pnl_delta: number;
  drawdown_delta: number;
}

export interface KillSwitchStatus {
  is_armed: boolean;
  currently_dormant: boolean;
  last_evaluated: Date | null;
}

export interface ABComparisonPayload {
  sub_account_1: SubAccountMetrics;
  sub_account_2: SubAccountMetrics;
  delta: ABComparisonDelta;
  kill_switch_status: KillSwitchStatus;
  last_updated: Date;
}

// ─── Sharpe helper ────────────────────────────────────────────────────────────

const EMPTY_METRICS: SubAccountMetrics = {
  rolling_20_session_sharpe: 0,
  cumulative_pnl: 0,
  max_drawdown: 0,
  trade_count: 0,
};

/**
 * Compute rolling 20-session Sharpe from an array of per-session P&L totals.
 *
 * Formula: mean(daily_returns) / std(daily_returns) * sqrt(252)
 * where daily_returns = per-session P&L over the last 20 sessions.
 *
 * When fewer than 2 sessions: returns 0 (insufficient data).
 * When std = 0 (all sessions same P&L): returns 0.
 *
 * Annualisation factor sqrt(252) is the 2026 institutional standard for
 * futures strategies where each "session" = one US trading day.
 */
export function computeRolling20SessionSharpe(sessionPnls: number[]): number {
  if (sessionPnls.length < 2) return 0;
  const window = sessionPnls.slice(-20);
  const n = window.length;
  const mean = window.reduce((a, b) => a + b, 0) / n;
  const variance = window.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1);
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) return 0;
  return (mean / stdDev) * Math.sqrt(252);
}

/**
 * Compute max drawdown from a series of cumulative P&Ls.
 * Returns a negative number (or zero when no drawdown).
 */
function computeMaxDrawdown(cumulativePnls: number[]): number {
  let peak = 0;
  let maxDd = 0;
  for (const pnl of cumulativePnls) {
    if (pnl > peak) peak = pnl;
    const dd = pnl - peak;
    if (dd < maxDd) maxDd = dd;
  }
  return maxDd;
}

// ─── Sub-account metrics loader ───────────────────────────────────────────────

/**
 * Compute SubAccountMetrics for a given broker_account UUID.
 *
 * Approach:
 *   1. Find all paper_sessions whose config references this broker account ID.
 *      The paper routing path (paper-signal-service.ts) fires signals to the
 *      TradersPost sub-account identified by account_id_external. Sessions are
 *      linked by session strategy routing, not a hard FK to broker_accounts.
 *      We approximate by joining through strategies.paper_account_routing
 *      to the slug, then finding sessions for strategies with that routing.
 *   2. Group closed trades by session (trading day), sum per-session P&L.
 *   3. Compute rolling Sharpe, cumulative P&L, max drawdown, trade count.
 */
async function loadSubAccountMetrics(
  routingSlug: string,       // 'baseline' | 'rl-challenger'
  accountExternal: string,   // 'slumdawg-baseline' | 'slumdawg-rl-challenger'
): Promise<SubAccountMetrics> {
  // Map slug to strategies.paper_account_routing value
  const routingValue = routingSlug === "baseline" ? "baseline" : "rl-challenger";

  // Step 1: find strategy IDs with matching routing
  const matchingStrategies = await db
    .select({ id: sql<string>`id::text` })
    .from(sql`strategies`)
    .where(sql`paper_account_routing = ${routingValue}`);

  if (matchingStrategies.length === 0) {
    logger.info(
      { routingSlug, accountExternal },
      "ab-comparison: no strategies with this routing — returning empty metrics",
    );
    return { ...EMPTY_METRICS };
  }

  const strategyIds = matchingStrategies.map((s) => s.id);

  // Step 2: find paper sessions for those strategies
  const sessionRows = await db
    .select({ id: paperSessions.id })
    .from(paperSessions)
    .where(inArray(sql`strategy_id::text`, strategyIds));

  if (sessionRows.length === 0) {
    return { ...EMPTY_METRICS };
  }

  const sessionIds = sessionRows.map((s) => s.id);

  // Step 3: fetch all closed trades for those sessions, ordered by exit time
  const tradeRows = await db
    .select({
      sessionId: paperTrades.sessionId,
      pnl: paperTrades.pnl,
      exitTime: paperTrades.exitTime,
    })
    .from(paperTrades)
    .where(
      inArray(paperTrades.sessionId, sessionIds),
    )
    .orderBy(paperTrades.exitTime);

  if (tradeRows.length === 0) {
    return { ...EMPTY_METRICS };
  }

  const tradeCount = tradeRows.length;

  // Step 4: group P&L by calendar date (session = trading day)
  // Use ET date bucketing (UTC-5 / UTC-4): CME day cutoff is 5pm ET = 22:00 UTC
  // For display purposes, we use ISO date string from exitTime as session key.
  const sessionPnlMap = new Map<string, number>();
  let cumulativePnl = 0;
  const cumulativeTimeline: number[] = [];

  for (const trade of tradeRows) {
    const pnl = Number(trade.pnl);
    if (!isFinite(pnl)) continue;

    // Session key = ISO date of exit (UTC day boundary is fine for display)
    const dateKey = trade.exitTime instanceof Date
      ? trade.exitTime.toISOString().slice(0, 10)
      : String(trade.exitTime).slice(0, 10);

    sessionPnlMap.set(dateKey, (sessionPnlMap.get(dateKey) ?? 0) + pnl);
    cumulativePnl += pnl;
    cumulativeTimeline.push(cumulativePnl);
  }

  const sessionPnlsChronological = Array.from(sessionPnlMap.values());
  const rolling20SessionSharpe = computeRolling20SessionSharpe(sessionPnlsChronological);
  const maxDrawdown = computeMaxDrawdown(cumulativeTimeline);

  return {
    rolling_20_session_sharpe: rolling20SessionSharpe,
    cumulative_pnl: cumulativePnl,
    max_drawdown: maxDrawdown,
    trade_count: tradeCount,
  };
}

// ─── Kill switch status ───────────────────────────────────────────────────────

/**
 * Read the latest quantum_rl.kill_switch_evaluated audit row.
 * If no row exists (legacy / not yet evaluated), returns safe defaults:
 *   is_armed=true, currently_dormant=false (RL running, not triggered).
 */
async function loadKillSwitchStatus(): Promise<KillSwitchStatus> {
  try {
    const rows = await db
      .select({
        result: auditLog.result,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .where(eq(auditLog.action, KILL_SWITCH_ACTION))
      .orderBy(desc(auditLog.createdAt))
      .limit(1);

    if (rows.length === 0) {
      // No audit row — default to armed + not dormant (safe state: RL is running)
      return { is_armed: true, currently_dormant: false, last_evaluated: null };
    }

    const row = rows[0]!;
    const result = row.result as Record<string, unknown> | null;

    // Parse from audit result payload written by C.2 rl-signal-fetcher pattern
    const isArmed = result?.["is_armed"] !== false; // default true
    const dormant = result?.["dormant"] === true;

    return {
      is_armed: isArmed,
      currently_dormant: dormant,
      last_evaluated: row.createdAt instanceof Date ? row.createdAt : new Date(String(row.createdAt)),
    };
  } catch (err) {
    logger.warn({ err: String(err) }, "ab-comparison: kill switch audit query failed — using defaults");
    return { is_armed: true, currently_dormant: false, last_evaluated: null };
  }
}

// ─── Route ────────────────────────────────────────────────────────────────────

abComparisonRoutes.get(
  "/recent",
  async (_req: Request, res: Response): Promise<void> => {
    try {
      // Step 1: verify broker_accounts rows exist (fail-soft if missing)
      const accountRows = await db
        .select({
          accountId: brokerAccounts.accountId,
          accountIdExternal: brokerAccounts.accountIdExternal,
        })
        .from(brokerAccounts)
        .where(
          inArray(brokerAccounts.accountIdExternal, [BASELINE_SLUG, CHALLENGER_SLUG]),
        );

      const baselineAccount = accountRows.find(
        (r) => r.accountIdExternal === BASELINE_SLUG,
      );
      const challengerAccount = accountRows.find(
        (r) => r.accountIdExternal === CHALLENGER_SLUG,
      );

      if (!baselineAccount) {
        logger.warn({ slug: BASELINE_SLUG }, "ab-comparison: broker_accounts row missing for baseline — fail-soft");
      }
      if (!challengerAccount) {
        logger.warn({ slug: CHALLENGER_SLUG }, "ab-comparison: broker_accounts row missing for challenger — fail-soft");
      }

      // Step 2: load metrics for both sub-accounts in parallel
      const [subAccount1, subAccount2, killSwitch] = await Promise.all([
        baselineAccount
          ? loadSubAccountMetrics("baseline", BASELINE_SLUG)
          : Promise.resolve({ ...EMPTY_METRICS }),
        challengerAccount
          ? loadSubAccountMetrics("rl-challenger", CHALLENGER_SLUG)
          : Promise.resolve({ ...EMPTY_METRICS }),
        loadKillSwitchStatus(),
      ]);

      // Step 3: compute deltas (Sub-Account 2 − Sub-Account 1 = RL marginal edge)
      const delta: ABComparisonDelta = {
        sharpe_delta: subAccount2.rolling_20_session_sharpe - subAccount1.rolling_20_session_sharpe,
        pnl_delta: subAccount2.cumulative_pnl - subAccount1.cumulative_pnl,
        drawdown_delta: subAccount2.max_drawdown - subAccount1.max_drawdown,
      };

      // Wave 29 prod hardening: set Prom gauges #8 and #9 (rl_ab_sharpe_delta, rl_ab_pnl_delta)
      // Gauges are unlabeled per registry declaration — single time series per delta metric.
      try {
        rlAbSharpeDelta.set(delta.sharpe_delta);
        rlAbPnlDelta.set(delta.pnl_delta);
      } catch (_promErr) { /* non-blocking */ }

      const payload: ABComparisonPayload = {
        sub_account_1: subAccount1,
        sub_account_2: subAccount2,
        delta,
        kill_switch_status: killSwitch,
        last_updated: new Date(),
      };

      res.status(200).json(payload);
    } catch (err) {
      logger.error({ err }, "ab-comparison: /recent query failed");
      res.status(500).json({ error: "Failed to compute A/B comparison" });
    }
  },
);
