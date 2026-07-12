/**
 * consistency-tracker-service.ts — Wave 26 Pass 6 / 2026-06-22 FIX A
 *
 * Topstep + MFFU 50% consistency rule: if highest_single_day_profit /
 * cycle_cumulative_profit > 0.50, payout is silently denied for that cycle.
 * Both Topstep AND MFFU enforce this rule at eval/pass-request time.
 * (Operator-confirmed 2026-06-22.)
 *
 * This service computes real-time concentration % per account on either firm,
 * emits 40% daily-digest WARN and 50% entry-block, with a false-positive
 * guard for legitimately clean strategies.
 *
 * Gate states:
 *   ok        — currentConcentrationPct < 40%
 *   warn_40   — currentConcentrationPct in [40%, 50%)
 *   block_50  — currentConcentrationPct >= 50%
 *
 * Audit actions:
 *   consistency.40pct_warned
 *   consistency.50pct_blocked
 *   consistency.false_positive_suspected
 *   consistency.gate_cleared
 *   consistency.gate_failopen    (emitted when DB error → fail-open path)
 *
 * Integration contract:
 *   paper-signal-service.ts calls shouldBlockNewEntry() AFTER the DLL gate
 *   and BEFORE position sizing. Fail-OPEN on DB error (payout-eligibility
 *   gate, not a loss gate — consistent with daily-trade-cap precedent).
 *
 * Cycle definition:
 *   Cycle = current funded period start to today. Since cycle_start is not yet
 *   modeled in DB, defaults to "first day of current calendar month".
 *   TODO: replace with lookup to a cycle_start table when operator opens TopstepX account.
 *
 * Cache:
 *   5-second per-accountId TTL prevents burning Postgres on every bar.
 */

import { randomUUID } from "crypto";
import { eq, and, gte, isNull, isNotNull, sql, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { paperPositions, paperSessions, paperTrades, brokerAccounts } from "../db/schema.js";
import { logger } from "../lib/logger.js";
import { insertAuditRowSafe } from "../lib/audit-log-helper.js";
import { notifyWarning, notifyCritical } from "./notification-service.js";
import { appendFamilyGradePostscript } from "../lib/notification-helpers.js";

// ─── Firm coverage ────────────────────────────────────────────────────────────

// CAP-3: account/firm scope resolution moved to consistency-scope.ts (DB-free, unit-tested).
// Re-exported here so existing importers (paper-execution-service.ts) keep their import path.
import { CONSISTENCY_RULE_FIRMS, _buildScopeClause } from "./consistency-scope.js";
export { CONSISTENCY_RULE_FIRMS, _buildScopeClause } from "./consistency-scope.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type GateState = "ok" | "warn_40" | "block_50";

export interface ConsistencyState {
  accountId: string;
  cycleStartDate: string;          // ISO date string — "YYYY-MM-DD"
  cycleDay: number;                // 1-based day count within the cycle
  cycleCumulativeProfit: number;   // total realized profit since cycleStartDate ($)
  todayProfit: number;             // realized closed P&L for today ($)
  todayProfitProjected: number;    // todayProfit + unrealizedPnl on open positions ($)
  highestDayProfit: number;        // highest single-day P&L in the cycle ($)
  highestDayDate: string | null;   // date of highestDayProfit ("YYYY-MM-DD") or null
  currentConcentrationPct: number; // highestDayProfit / cycleCumulativeProfit × 100
  projectedConcentrationPct: number; // todayProfitProjected / cycleCumulativeProfit × 100 (if today is highest)
  distanceTo50Cap: number;         // how much more today can earn before hitting 50% ($); negative = already over
  distanceTo40Warn: number;        // how much more today can earn before hitting 40% warn ($)
  gateState: GateState;
  falsePositiveSuspected: boolean; // true when block_50 is fired but strategy looks legitimately clean
  computedAt: string;              // ISO timestamp
}

export interface StrategyContext {
  rollingSharpe30d?: number;
  sessionsRunClean?: number;
  currentRegime?: string;
  confluenceScoreAtEntry?: number;
}

const WARN_THRESHOLD_PCT = 40;
const BLOCK_THRESHOLD_PCT = 50;

// False-positive guard thresholds (all must be met)
const FP_MIN_SHARPE = 1.5;
const FP_MIN_CLEAN_SESSIONS = 20;
const FP_MIN_CONFLUENCE = 0.85;
const FP_CLEAN_REGIMES = new Set(["trending_up", "trending_down", "expansion"]);

// ─── Cache ────────────────────────────────────────────────────────────────────

interface CacheEntry {
  state: ConsistencyState;
  expiresAt: number;
}

const CACHE_TTL_MS = 5_000; // 5 seconds per spec
const _stateCache = new Map<string, CacheEntry>();

function _getCached(accountId: string): ConsistencyState | null {
  const entry = _stateCache.get(accountId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    _stateCache.delete(accountId);
    return null;
  }
  return entry.state;
}

function _setCache(accountId: string, state: ConsistencyState): void {
  _stateCache.set(accountId, { state, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ─── Cycle boundary helpers ───────────────────────────────────────────────────

/**
 * Returns the cycle start date as a Date.
 *
 * Default: first day of current calendar month (UTC).
 * TODO: replace with lookup to cycle_start table once TopstepX account is opened.
 */
function _getCycleStart(asOf: Date): Date {
  const d = new Date(asOf);
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function _toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// LOW#15 (fresh-scan 2026-07-12): the daily P&L buckets are keyed by
// DATE(exit_time AT TIME ZONE 'America/New_York'), so "today" for bucket lookup MUST be the
// New-York calendar date. Using the UTC date made the 20:00–23:59 ET window resolve to the NEXT
// day → dailyProfits.get(today) missed the real current-day bucket → todayProfit /
// todayProfitProjected / projectedConcentrationPct (the SSE + Discord surfaces) read 0 for the
// operator's live evening. en-CA yields YYYY-MM-DD.
function _toNyDateString(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
}

// ─── Account/firm scope resolution (CAP-3 fix) ─────────────────────────────────

// ─── Core computation ─────────────────────────────────────────────────────────

/**
 * Computes the consistency state for a Topstep account.
 *
 * Reads:
 *   - paper_positions (via paper_sessions with firmId IN CONSISTENCY_RULE_FIRMS)
 *   - closed positions for realized daily P&L bucketed by date
 *   - open positions for unrealized projection on today
 *
 * asOf defaults to now. Pass a Date to enable time-travel (tests, simulation).
 *
 * @param dryRun - When true, suppresses audit_log writes and Discord notifications
 *   (notifyWarning / notifyCritical). The computed ConsistencyState is still returned
 *   so callers can inspect gate thresholds. Pass 2 replay-grading uses this path.
 */
export async function getConsistencyState(
  accountId: string,
  asOf: Date = new Date(),
  dryRun: boolean = false,
): Promise<ConsistencyState> {
  // Cache check first — LIVE (now-query) path ONLY. deep-scan 2026-07-11 MED fix: the 5s cache is
  // keyed on accountId alone (ignores asOf), so a replay/time-travel caller looping over dates within
  // 5s would get the FIRST date's state for every date (corrupting concentrationPct → payoutDenied in
  // the replay confusion matrix). Skip the cache entirely on the dryRun (replay/simulation) path so
  // each asOf is computed fresh; the live now-query path (dryRun=false, asOf≈now) keeps the 5s cache.
  if (!dryRun) {
    const cached = _getCached(accountId);
    if (cached) return cached;
  }

  const correlationId = randomUUID();
  const cycleStart = _getCycleStart(asOf);
  const cycleStartDate = _toDateString(cycleStart);
  // LOW#15: NY-calendar "today" to match the NY-keyed daily P&L buckets (see _toNyDateString).
  const today = _toNyDateString(asOf);

  // Cycle day = number of calendar days from cycle start to today (1-based)
  const cycleDay = Math.floor((asOf.getTime() - cycleStart.getTime()) / 86_400_000) + 1;

  // ─── Query closed trades in cycle — REALIZED P&L from paper_trades ─────────
  //
  // BUG FIX (2026-06-24): The prior query read SUM(COALESCE(pp.unrealized_pnl, 0))
  // from paper_positions WHERE closedAt IS NOT NULL. paper-execution-service.ts
  // resets unrealized_pnl = '0' on position close (the realized P&L lands in
  // paper_trades.pnl). So the prior aggregation was always summing zeros — making
  // highestDayProfit / cycleCumulativeProfit / currentConcentrationPct permanently
  // zero, and the Topstep/MFFU 50% single-day concentration gate was invisible.
  //
  // Fix: source realized P&L from paper_trades (the canonical realized journal),
  // grouped by DATE(exit_time AT TIME ZONE 'America/New_York') to match the
  // trading-day boundary convention used by daily-trade-cap.ts and closePosition().
  //
  // NOTE: This gate is opt-in / default-OFF today (shouldBlockNewEntry not yet
  // wired into paper-signal-service.ts). The data source must be correct before
  // enable — this fix ensures it is.
  //
  // FIX A (2026-06-22): Cover all CONSISTENCY_RULE_FIRMS, not just 'topstep'.
  // Both Topstep and MFFU enforce the 50% single-day concentration rule.
  //
  // CAP-3 (2026-07-11): scope BOTH queries to the passed accountId's own
  // session/firm instead of the firm UNION of both firms + every session. See
  // _buildScopeClause — the same fragment is reused for the realized daily query
  // and the open-MTM query so the concentration number is computed per funded
  // account, not netted across firms/accounts.

  type DailyRow = { day: string; pnl: number };

  const scopeClause = _buildScopeClause(accountId);
  const dailyRows = await db.execute<DailyRow>(
    sql`
      SELECT
        DATE(pt.exit_time AT TIME ZONE 'America/New_York') AS day,
        SUM(pt.pnl::numeric) AS pnl
      FROM paper_trades pt
      JOIN paper_sessions ps ON ps.id = pt.session_id
      WHERE
        ${scopeClause}
        AND pt.exit_time >= ${cycleStart.toISOString()}::timestamptz
      GROUP BY 1
      ORDER BY 1
    `,
  );

  // ─── Query open positions for today's projection ──────────────────────────────

  type UnrealizedRow = { total_unrealized: number };

  const [unrealizedRow] = await db.execute<UnrealizedRow>(
    sql`
      SELECT COALESCE(SUM(pp.unrealized_pnl), 0) AS total_unrealized
      FROM paper_positions pp
      JOIN paper_sessions ps ON ps.id = pp.session_id
      WHERE
        ${scopeClause}
        AND pp.closed_at IS NULL
        AND ps.status = 'active'
    `,
  );

  const totalUnrealized = Number(unrealizedRow?.total_unrealized ?? 0);

  // ─── Compute per-day profit map ────────────────────────────────────────────────

  const dailyProfits: Map<string, number> = new Map();
  for (const row of (dailyRows as unknown as DailyRow[])) {
    dailyProfits.set(row.day, Number(row.pnl));
  }

  // Include today's realized P&L if not yet in the map
  const todayRealized = dailyProfits.get(today) ?? 0;
  const todayProfitProjected = todayRealized + totalUnrealized;

  // Determine highestDayProfit and highestDayDate from cycle history
  let highestDayProfit = 0;
  let highestDayDate: string | null = null;
  let cycleCumulativeProfit = 0;

  for (const [day, pnl] of dailyProfits) {
    if (pnl > 0) {
      cycleCumulativeProfit += pnl;
      if (pnl > highestDayProfit) {
        highestDayProfit = pnl;
        highestDayDate = day;
      }
    }
    // Negative-P&L days still reduce cumulative even though we only count positive for consistency math
    // Topstep: "profit" days only contribute to the cap; losing days don't offset the best day's %.
    // But the denominator is total PROFIT days' sum (cumulative positive P&L).
    // We err on the side of conservative interpretation: cumulative = sum of profitable days only.
    // TODO: verify with TopstepX API once account is opened.
  }

  // Check if today's projected P&L would be the new highestDayProfit
  const projectedHighest = Math.max(highestDayProfit, todayProfitProjected);
  const projectedCycleCumulative = cycleCumulativeProfit + (todayProfitProjected > 0 && !dailyProfits.has(today) ? todayProfitProjected : 0);

  const currentConcentrationPct =
    cycleCumulativeProfit > 0
      ? (highestDayProfit / cycleCumulativeProfit) * 100
      : 0;

  const projectedConcentrationPct =
    projectedCycleCumulative > 0
      ? (projectedHighest / projectedCycleCumulative) * 100
      : 0;

  // Distance to cap/warn = how much more today can earn before breaching
  // If cumulative is 0 or today's profit is already highest, math would be:
  //   distanceTo50Cap = cycleCumulativeProfit * 0.5 - highestDayProfit (if today earns this → 50%)
  const distanceTo50Cap =
    cycleCumulativeProfit > 0
      ? cycleCumulativeProfit * 0.5 - highestDayProfit
      : Infinity;

  const distanceTo40Warn =
    cycleCumulativeProfit > 0
      ? cycleCumulativeProfit * 0.4 - highestDayProfit
      : Infinity;

  // Gate state
  let gateState: GateState = "ok";
  if (currentConcentrationPct >= BLOCK_THRESHOLD_PCT) {
    gateState = "block_50";
  } else if (currentConcentrationPct >= WARN_THRESHOLD_PCT) {
    gateState = "warn_40";
  }

  const state: ConsistencyState = {
    accountId,
    cycleStartDate,
    cycleDay,
    cycleCumulativeProfit,
    todayProfit: todayRealized,
    todayProfitProjected,
    highestDayProfit,
    highestDayDate,
    currentConcentrationPct,
    projectedConcentrationPct,
    distanceTo50Cap: isFinite(distanceTo50Cap) ? distanceTo50Cap : 0,
    distanceTo40Warn: isFinite(distanceTo40Warn) ? distanceTo40Warn : 0,
    gateState,
    falsePositiveSuspected: false,   // set below if guard fires
    computedAt: asOf.toISOString(),
  };

  // ─── Emit audit + alerts (suppressed in dry-run) ──────────────────────────────

  if (!dryRun) {
    if (gateState === "block_50") {
      await _handleBlock50(state, correlationId);
    } else if (gateState === "warn_40") {
      await _handleWarn40(state, correlationId);
    } else if (gateState === "ok" && currentConcentrationPct < WARN_THRESHOLD_PCT) {
      // Gate cleared (may have been triggered previously)
      await insertAuditRowSafe({
        action: "consistency.gate_cleared",
        entityType: "broker_account",
        entityId: accountId,
        result: {
          currentConcentrationPct,
          cycleCumulativeProfit,
          highestDayProfit,
          cycleDay,
        },
        status: "success",
        decisionAuthority: "system",
        correlationId,
      });
    }
  }

  // deep-scan 2026-07-11 MED fix: never populate the live 5s cache from a dryRun (replay/time-travel)
  // computation — it would serve a past date's state to a subsequent live now-query.
  if (!dryRun) _setCache(accountId, state);
  return state;
}

// ─── Internal alert handlers ──────────────────────────────────────────────────

async function _handleBlock50(
  state: ConsistencyState,
  correlationId: string,
  strategyCtx?: StrategyContext,
): Promise<void> {
  const falsePositive = _evaluateFalsePositiveGuard(state, strategyCtx);
  state.falsePositiveSuspected = falsePositive;

  const pct = state.currentConcentrationPct.toFixed(1);
  const highestDayFormatted = state.highestDayProfit.toFixed(2);
  const cumulativeFormatted = state.cycleCumulativeProfit.toFixed(2);
  const dateStr = state.highestDayDate ?? "unknown";

  const operatorBody =
    `🛑 [CRITICAL] Consistency Gate Blocked — Account ${state.accountId}\n` +
    `Current concentration: ${pct}% (threshold: 50%)\n` +
    `Highest day: $${highestDayFormatted} on ${dateStr}\n` +
    `Cycle cumulative: $${cumulativeFormatted}\n` +
    `New entries blocked until next session reset.\n` +
    `False-positive guard: ${falsePositive}\n` +
    `Correlation ID: ${correlationId}`;

  const plainWhat =
    "Your bot paused trading temporarily — it's been using the same strategy too much today, which is a rule from your prop firm.";
  const plainAction =
    "It will resume automatically tomorrow. No action needed.";

  const fullBody = appendFamilyGradePostscript(operatorBody, plainWhat, plainAction);

  if (falsePositive) {
    // Clean strategy detected — downgrade to WARNING
    await insertAuditRowSafe({
      action: "consistency.false_positive_suspected",
      entityType: "broker_account",
      entityId: state.accountId,
      result: {
        currentConcentrationPct: state.currentConcentrationPct,
        cycleCumulativeProfit: state.cycleCumulativeProfit,
        highestDayProfit: state.highestDayProfit,
        highestDayDate: state.highestDayDate,
        gateState: state.gateState,
        falsePositiveSuspected: true,
        strategyCtx,
      },
      status: "warning",
      decisionAuthority: "system",
      correlationId,
    });

    notifyWarning(
      `[W26] Consistency 50% gate (FP suspected) — Account ${state.accountId}`,
      fullBody,
      { accountId: state.accountId, concentrationPct: state.currentConcentrationPct, falsePositiveSuspected: true, correlationId },
    );

    logger.warn(
      { accountId: state.accountId, concentrationPct: state.currentConcentrationPct, falsePositiveSuspected: true, correlationId },
      "consistency-tracker: block_50 fired but false-positive guard active — downgraded to WARN",
    );
  } else {
    // True block — emit CRITICAL
    await insertAuditRowSafe({
      action: "consistency.50pct_blocked",
      entityType: "broker_account",
      entityId: state.accountId,
      result: {
        currentConcentrationPct: state.currentConcentrationPct,
        cycleCumulativeProfit: state.cycleCumulativeProfit,
        highestDayProfit: state.highestDayProfit,
        highestDayDate: state.highestDayDate,
        gateState: state.gateState,
        falsePositiveSuspected: false,
      },
      status: "failure",
      decisionAuthority: "system",
      correlationId,
    });

    notifyCritical(
      `[W26] Consistency Gate BLOCKED — Account ${state.accountId}`,
      fullBody,
      { accountId: state.accountId, concentrationPct: state.currentConcentrationPct, falsePositiveSuspected: false, correlationId },
    );

    logger.error(
      { accountId: state.accountId, concentrationPct: state.currentConcentrationPct, falsePositiveSuspected: false, correlationId },
      "consistency-tracker: block_50 — new entries BLOCKED",
    );
  }
}

async function _handleWarn40(
  state: ConsistencyState,
  correlationId: string,
): Promise<void> {
  const pct = state.currentConcentrationPct.toFixed(1);
  const highestDayFormatted = state.highestDayProfit.toFixed(2);
  const cumulativeFormatted = state.cycleCumulativeProfit.toFixed(2);
  const dateStr = state.highestDayDate ?? "unknown";

  const operatorBody =
    `⚠️ [WARNING] Consistency Gate Warning — Account ${state.accountId}\n` +
    `Current concentration: ${pct}% (threshold: 40% warn / 50% block)\n` +
    `Highest day: $${highestDayFormatted} on ${dateStr}\n` +
    `Cycle cumulative: $${cumulativeFormatted}\n` +
    `Distance to 50% block: $${Math.max(0, state.distanceTo50Cap).toFixed(2)} remaining today.\n` +
    `Correlation ID: ${correlationId}`;

  const plainWhat =
    "Your bot is getting close to the prop firm's daily limit for how much it can make in one day compared to the whole month.";
  const plainAction =
    "No action needed yet. The bot is monitoring this and will stop automatically if needed.";

  const fullBody = appendFamilyGradePostscript(operatorBody, plainWhat, plainAction);

  await insertAuditRowSafe({
    action: "consistency.40pct_warned",
    entityType: "broker_account",
    entityId: state.accountId,
    result: {
      currentConcentrationPct: state.currentConcentrationPct,
      cycleCumulativeProfit: state.cycleCumulativeProfit,
      highestDayProfit: state.highestDayProfit,
      highestDayDate: state.highestDayDate,
      distanceTo50Cap: state.distanceTo50Cap,
    },
    status: "warning",
    decisionAuthority: "system",
    correlationId,
  });

  notifyWarning(
    `[W26] Consistency Gate Warning (40%) — Account ${state.accountId}`,
    fullBody,
    { accountId: state.accountId, concentrationPct: state.currentConcentrationPct, distanceTo50Cap: state.distanceTo50Cap, correlationId },
  );

  logger.warn(
    { accountId: state.accountId, concentrationPct: state.currentConcentrationPct, distanceTo50Cap: state.distanceTo50Cap, correlationId },
    "consistency-tracker: warn_40 — approaching 50% consistency cap",
  );
}

// ─── False-positive guard ──────────────────────────────────────────────────────

/**
 * Returns true when a block_50 gate is suspected to be a false positive
 * because the underlying strategy has strong clean evidence:
 *   - rollingSharpe30d >= 1.5
 *   - sessionsRunClean >= 20
 *   - currentRegime in (trending_up, trending_down, expansion)
 *   - confluenceScoreAtEntry >= 0.85
 *
 * ALL four conditions must be met. Missing values (undefined) are treated
 * as not-met — the guard is conservative by default.
 */
function _evaluateFalsePositiveGuard(
  state: ConsistencyState,
  strategyCtx?: StrategyContext,
): boolean {
  if (state.gateState !== "block_50") return false;
  if (!strategyCtx) return false;

  const sharpeMet = typeof strategyCtx.rollingSharpe30d === "number"
    && strategyCtx.rollingSharpe30d >= FP_MIN_SHARPE;
  const sessionsMet = typeof strategyCtx.sessionsRunClean === "number"
    && strategyCtx.sessionsRunClean >= FP_MIN_CLEAN_SESSIONS;
  const regimeMet = typeof strategyCtx.currentRegime === "string"
    && FP_CLEAN_REGIMES.has(strategyCtx.currentRegime);
  const confluenceMet = typeof strategyCtx.confluenceScoreAtEntry === "number"
    && strategyCtx.confluenceScoreAtEntry >= FP_MIN_CONFLUENCE;

  return sharpeMet && sessionsMet && regimeMet && confluenceMet;
}

// ─── Entry gate ───────────────────────────────────────────────────────────────

/**
 * shouldBlockNewEntry — determines whether a proposed trade should be blocked
 * based on the projected consistency concentration.
 *
 * Called by paper-signal-service.ts in a future coordination pass.
 *
 * Integration contract:
 *   paper-signal-service.ts shall call this function in its entry gate sequence
 *   AFTER the DLL gate and BEFORE position sizing.
 *
 * @param accountId           - broker_accounts.account_id (UUID)
 * @param projectedTradeProfitR - projected trade profit in R-multiples (used to estimate USD profit)
 * @param currentRiskUsd      - current trade risk in USD (stop × contracts × point value)
 * @param strategyCtx         - optional strategy metadata for false-positive guard
 * @returns { block, reason, audit }
 */
export async function shouldBlockNewEntry(
  accountId: string,
  projectedTradeProfitR: number,
  currentRiskUsd: number,
  strategyCtx?: StrategyContext,
): Promise<{ block: boolean; reason: string; audit: Record<string, unknown> }> {
  const correlationId = randomUUID();
  const state = await getConsistencyState(accountId);

  // Estimate projected trade profit in USD: R × risk
  const estimatedTradeProfit = projectedTradeProfitR * currentRiskUsd;

  // If this trade wins, what is today's new profit?
  const projectedTodayProfit = state.todayProfit + estimatedTradeProfit;

  // Compute projected concentration with this trade winning
  const projectedHighest = Math.max(state.highestDayProfit, projectedTodayProfit);
  const projectedCumulative = state.cycleCumulativeProfit + (projectedTodayProfit > state.todayProfit ? estimatedTradeProfit : 0);
  const projectedPct =
    projectedCumulative > 0 ? (projectedHighest / projectedCumulative) * 100 : 0;

  const wouldTriggerBlock = projectedPct >= BLOCK_THRESHOLD_PCT;

  // Also check current state as a hard gate
  const alreadyBlocked = state.gateState === "block_50";

  const block = alreadyBlocked || wouldTriggerBlock;

  const audit: Record<string, unknown> = {
    accountId,
    currentConcentrationPct: state.currentConcentrationPct,
    projectedConcentrationPct: projectedPct,
    projectedTradeProfitR,
    currentRiskUsd,
    estimatedTradeProfit,
    projectedTodayProfit,
    projectedHighest,
    projectedCumulative,
    alreadyBlocked,
    wouldTriggerBlock,
    block,
    gateState: state.gateState,
    falsePositiveSuspected: state.falsePositiveSuspected,
    correlationId,
  };

  if (block) {
    const reason = alreadyBlocked
      ? `Consistency gate BLOCKED: current concentration ${state.currentConcentrationPct.toFixed(1)}% already at 50% cap`
      : `Consistency gate BLOCKED: projected concentration ${projectedPct.toFixed(1)}% would exceed 50% cap`;

    // Check false-positive guard for projected block
    const fpGuard = _evaluateFalsePositiveGuard(
      { ...state, gateState: "block_50" },
      strategyCtx,
    );
    audit.falsePositiveSuspected = fpGuard;

    if (!fpGuard) {
      await insertAuditRowSafe({
        action: "consistency.50pct_blocked",
        entityType: "broker_account",
        entityId: accountId,
        result: audit,
        status: "failure",
        decisionAuthority: "system",
        correlationId,
      });
    } else {
      await insertAuditRowSafe({
        action: "consistency.false_positive_suspected",
        entityType: "broker_account",
        entityId: accountId,
        result: audit,
        status: "warning",
        decisionAuthority: "system",
        correlationId,
      });

      // FP guard fires WARN not CRITICAL — downgrade notification severity
      const pct = state.currentConcentrationPct.toFixed(1);
      const operatorBody =
        `🟡 [FP-GUARD] Consistency 50% gate suspected false-positive — Account ${accountId}\n` +
        `Concentration: ${pct}% (50% threshold)\n` +
        `Strategy passes clean-evidence criteria: Sharpe≥1.5, sessions≥20, clean regime, confluence≥0.85\n` +
        `Block is still enforced. No new entries until session reset.\n` +
        `Correlation ID: ${correlationId}`;

      const plainWhat =
        "Your bot paused trading temporarily — it's been using the same strategy too much today, which is a rule from your prop firm.";
      const plainAction =
        "It will resume automatically tomorrow. No action needed.";

      notifyWarning(
        `[W26] Consistency FP-Guard (50%) — Account ${accountId}`,
        appendFamilyGradePostscript(operatorBody, plainWhat, plainAction),
        { accountId, concentrationPct: state.currentConcentrationPct, falsePositiveSuspected: true, correlationId },
      );
    }

    logger.warn(
      { accountId, projectedPct, block, correlationId, falsePositiveSuspected: fpGuard },
      "consistency-tracker: shouldBlockNewEntry returning block=true",
    );

    return { block: true, reason, audit };
  }

  return { block: false, reason: "ok", audit };
}

// ─── Daily digest helper ───────────────────────────────────────────────────────

/**
 * runConsistencyDailyDigest — iterate all enabled Topstep + MFFU accounts
 * (CONSISTENCY_RULE_FIRMS) and send a Discord digest for any account at >= 40%.
 *
 * Called by the "consistency-tracker-daily-digest" cron job in scheduler.ts.
 */
export async function runConsistencyDailyDigest(): Promise<{
  accountsChecked: number;
  accountsWarned: number;
  accountsBlocked: number;
}> {
  const correlationId = randomUUID();
  logger.info({ correlationId, jobName: "consistency-tracker-daily-digest" }, "cron tick start");

  // FIX A (2026-06-22): Query both Topstep AND MFFU accounts.
  // Both firms enforce the 50% single-day consistency rule at eval/pass-request.
  const accounts = await db
    .select({ accountId: brokerAccounts.accountId })
    .from(brokerAccounts)
    .where(
      and(
        inArray(brokerAccounts.firmId, CONSISTENCY_RULE_FIRMS),
        eq(brokerAccounts.enabled, true),
      ),
    );

  let accountsWarned = 0;
  let accountsBlocked = 0;

  for (const account of accounts) {
    try {
      const state = await getConsistencyState(account.accountId);

      if (state.gateState === "ok") continue;

      const isBlocked = state.gateState === "block_50";
      if (isBlocked) accountsBlocked++;
      else accountsWarned++;

      const pct = state.currentConcentrationPct.toFixed(1);
      const operatorBody =
        `📊 [DAILY DIGEST] Consistency Status — Account ${account.accountId}\n` +
        `Current concentration: ${pct}%\n` +
        `Gate state: ${state.gateState.toUpperCase()}\n` +
        `Highest day: $${state.highestDayProfit.toFixed(2)} on ${state.highestDayDate ?? "none"}\n` +
        `Cycle cumulative: $${state.cycleCumulativeProfit.toFixed(2)}\n` +
        `Distance to 50% block: $${Math.max(0, state.distanceTo50Cap).toFixed(2)}\n` +
        `False-positive guard: ${state.falsePositiveSuspected}\n` +
        `Correlation ID: ${correlationId}`;

      const plainWhat =
        isBlocked
          ? "Your bot paused trading temporarily — it's been using the same strategy too much today, which is a rule from your prop firm."
          : "Your bot is getting close to the prop firm's daily limit for how much it can make in one day compared to the whole month.";
      const plainAction =
        "It will resume automatically tomorrow. No action needed.";

      const fullBody = appendFamilyGradePostscript(operatorBody, plainWhat, plainAction);

      if (isBlocked) {
        notifyCritical(
          `[W26 Digest] Consistency BLOCKED (${pct}%) — Account ${account.accountId}`,
          fullBody,
          { accountId: account.accountId, concentrationPct: state.currentConcentrationPct, gateState: state.gateState, correlationId },
        );
      } else {
        notifyWarning(
          `[W26 Digest] Consistency Warning (${pct}%) — Account ${account.accountId}`,
          fullBody,
          { accountId: account.accountId, concentrationPct: state.currentConcentrationPct, gateState: state.gateState, correlationId },
        );
      }
    } catch (err) {
      logger.error({ err, accountId: account.accountId, correlationId }, "consistency-tracker: digest failed for account — skipping");
    }
  }

  logger.info(
    { correlationId, accountsChecked: accounts.length, accountsWarned, accountsBlocked },
    "consistency-tracker: daily digest complete",
  );

  return { accountsChecked: accounts.length, accountsWarned, accountsBlocked };
}

// ─── Invalidate cache (for testing) ──────────────────────────────────────────

export function _invalidateConsistencyCache(accountId?: string): void {
  if (accountId) {
    _stateCache.delete(accountId);
  } else {
    _stateCache.clear();
  }
}
