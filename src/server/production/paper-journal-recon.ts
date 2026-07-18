/**
 * src/server/production/paper-journal-recon.ts
 *
 * Pass 6 Track A — paper_journal_recon daily cron.
 *
 * 6th reconciliation source extending reconciliation-service.ts:
 * Joins paper_trades against traderspost_log (production_trades proxy)
 * and tradingview_markers on strategyId / symbol / bar_timestamp window
 * for every DEPLOYED+ strategy. Asserts:
 *   1. Trade-count parity per strategy per day.
 *   2. Per-trade P&L within tick tolerance:
 *      |paper_pnl - broker_pnl| <= MAX(0.50, 2 * tick_size_$ * filled_qty)
 *      (2-tick or 50¢ floor — handles MES $1.25 / MNQ $0.50 / MCL $1.00)
 *
 * On drift:
 *   - Writes audit_log `paper_reconciliation.mismatch_detected` (status=critical)
 *   - Fires Discord CRITICAL via notifyCritical + appendFamilyGradePostscript
 *
 * On missing broker data (TradersPost row absent):
 *   - Writes audit_log `paper_reconciliation.missing_broker_data` (status=warning)
 *   - No critical alert (broker offline path)
 *
 * On clean run:
 *   - Writes audit_log `paper_reconciliation.evaluated` (status=success)
 *
 * ─── HARD ISOLATION BOUNDARY ───────────────────────────────────────────────
 * This file MUST NOT import from: agent-service, critic-optimizer-service,
 * quantum_* modules, synthetic_market_simulator, or any scout-* service.
 * Violation detection: `npm run check:production-isolation`
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Registered cron: daily 22:30 UTC (after 21:00/22:00 cluster) via scheduler.ts
 * Pipeline gate: _PIPELINE_GATE_EXEMPT — reconciliation is a safety signal.
 */

import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import {
  paperTrades,
  paperSessions,
  paperSignalLogs,
  strategies,
  tradingviewMarkers,
  productionTrades,
  auditLog,
  lifecycleShadowSignals,
  backtests,
  quantumMcRuns,
  brokerAccounts,
} from "../db/schema.js";
import {
  eq,
  sql,
  gte,
  lt,
  and,
  inArray,
  isNull,
} from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { notifyCritical, notifyWarning } from "../services/notification-service.js";
import { appendFamilyGradePostscript } from "../lib/notification-helpers.js";
// deep-scan round 2 HIGH-2/MED-3: import the canonical CME-day helpers from
// the SIBLING production/ file rather than paper-risk-gate.ts directly —
// paper-risk-gate.ts transitively imports the full server bootstrap
// (`../index.js`), which regressed this file's + kill-switch.ts's narrow
// unit-test mocks (verified empirically; see the block comment in
// reconciliation-service.ts next to toCmeTradingDayString() for the full
// story). reconciliation-service.ts's toCmeTradingDayString() is a
// byte-identical reimplementation of paper-risk-gate.ts::toFuturesTradingDayString().
import { getCmeTradingDayBoundaries, toCmeTradingDayString } from "./reconciliation-service.js";

// ─── Config (no magic numbers) ────────────────────────────────────────────────

/**
 * Tick sizes in dollars per contract, per symbol.
 * MES: $1.25/tick, MNQ: $0.50/tick, MCL: $1.00/tick
 * Used in per-trade P&L tolerance: MAX(PNL_FLOOR_DOLLARS, 2 * tick_size * filled_qty)
 */
const TICK_SIZE_DOLLARS: Record<string, number> = {
  MES: 1.25,
  MNQ: 0.50,
  MCL: 1.00,
  // Safe defaults for any unrecognised symbol
  DEFAULT: 1.25,
};

export const PAPER_RECON_CONFIG = {
  /** Per-trade P&L floor tolerance in dollars (50¢ minimum regardless of tick math). */
  PNL_FLOOR_DOLLARS: Number(process.env["PAPER_RECON_PNL_FLOOR_DOLLARS"] ?? 0.50),
  /** ±5 minutes bar_timestamp window for JOIN matching. */
  BAR_WINDOW_MINUTES: Number(process.env["PAPER_RECON_BAR_WINDOW_MINUTES"] ?? 5),
  /**
   * Lifecycle states whose paper journal is broker-authoritative (TradersPost is the
   * canonical trade tape to reconcile against). PAPER removed post-M3 (2026-07-17):
   * PAPER-state strategies now use the internal engine exclusively and never call the
   * broker — reconciling them against a broker tape that was never populated would
   * either sit permanently dormant (no broker tape) or, once a real broker tape exists
   * for other reasons, spuriously flag missing-broker-data on every PAPER-state
   * strategy every recon cycle. See src/server/lib/paper-authority-states.ts
   * (BROKER_AUTHORITATIVE_STATES) — this list should track that one.
   */
  DEPLOYED_PLUS_STATES: ["DEPLOY_READY", "PILOT", "DEPLOYED"],
  /**
   * Shadow-signal recon: delta > 5% across ≥20 signals = intercept is silently dropping.
   * These mirror SHADOW_DIVERGENCE_THRESHOLD_PCT / SHADOW_DIVERGENCE_MIN_SAMPLE but are
   * read-only diagnostics — the recon never blocks signal flow.
   */
  SHADOW_SIGNAL_DELTA_THRESHOLD_PCT: Number(
    process.env["PAPER_RECON_SHADOW_SIGNAL_DELTA_THRESHOLD_PCT"] ?? 0.05
  ),
  SHADOW_SIGNAL_MIN_SAMPLE: Number(
    process.env["PAPER_RECON_SHADOW_SIGNAL_MIN_SAMPLE"] ?? 20
  ),
} as const;

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface PaperReconStrategyResult {
  strategyId: string;
  strategyName: string;
  symbol: string;
  paperTradeCount: number;
  brokerTradeCount: number;
  tradingviewMarkerCount: number | null;
  countMismatch: boolean;
  pnlDriftDollars: number | null;
  pnlTolerance: number | null;
  pnlDriftExceedsTolerance: boolean;
  missingBrokerData: boolean;
  // deep-scan Accuracy CRITICAL: production_trades rows exist but every expected_pnl is NULL
  // (broker-router writes it null by design pre server-mediated execution). The P&L drift join
  // MUST NOT coalesce NULL→$0 (that turns any real paper P&L into a false CRITICAL drift alert).
  // When true, P&L reconciliation was not performed — drift is null, never a mismatch.
  brokerPnlUnavailable: boolean;
  tradeIds: string[];
  // deep-scan round 2 HIGH-1: per-trade windowed join results. Independent of
  // countMismatch/pnlDriftExceedsTolerance (both day-level SUM aggregates) —
  // catches offsetting per-trade errors that net to zero in the day-sum (trade A
  // paper +$500 vs broker +$300 = +$200 error; trade B paper -$200 vs broker $0 =
  // -$200 error; day-sum delta = $0, both individually wrong).
  perTradeCheckedCount: number;
  perTradeMismatchCount: number;
  perTradeMismatchTradeIds: string[];
  perTradeUnmatchedCount: number;
  perTradeMismatchDetected: boolean;
}

export interface PaperJournalReconResult {
  reconDate: string;
  ranAt: Date;
  correlationId: string;
  strategiesEvaluated: number;
  strategiesWithMismatch: number;
  strategiesWithMissingBrokerData: number;
  results: PaperReconStrategyResult[];
  hasDrift: boolean;
  /**
   * deepscan14 C1: true when `production_trades` (the broker-tape proxy this recon
   * joins against) has NEVER been populated by any TradersPost ingest pipeline. When
   * true, every `missingBrokerData` strategy result below reflects a STRUCTURAL gap
   * (nothing to verify), not a per-day data miss — `hasDrift=false` in that state
   * means "unverified", not "clean". See `paper_reconciliation.inactive_no_broker_tape`.
   */
  brokerTapeSourceActive: boolean;
  /** Convenience flag: recon ran but produced no verification signal at all. */
  reconciliationInactive: boolean;
  /** M10 sub-check summary counts */
  shadowSignalSubcheck: ShadowSignalReconResult;
  quantumReplaySubcheck: QuantumReplayReconResult;
  abRoutingSubcheck: AbRoutingReconResult;
}

// ─── M10 sub-check result types ───────────────────────────────────────────────

export interface ShadowSignalReconResult {
  /** Was the check run? False only when sample below MIN_SAMPLE threshold. */
  checked: boolean;
  shadowStrategiesChecked: number;
  totalShadowSignals: number;
  totalSignalLogs: number;
  deltaPct: number | null;
  deltaExceedsThreshold: boolean;
  belowMinSample: boolean;
}

export interface QuantumReplayReconResult {
  /** Was the check run? False when QUANTUM_REPLAY_AUTO_FIRE_ENABLED is off/unset. */
  checked: boolean;
  skipped: boolean;
  orphanBacktestIds: string[];
  orphanCount: number;
}

export interface AbRoutingReconResult {
  checked: boolean;
  orphanStrategyIds: string[];
  orphanCount: number;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function getTickSizeDollars(symbol: string): number {
  const upper = symbol.toUpperCase();
  return TICK_SIZE_DOLLARS[upper] ?? TICK_SIZE_DOLLARS["DEFAULT"]!;
}

/**
 * Compute P&L tolerance for a given symbol and contract count.
 * MAX(0.50, 2 * tick_size_$ * filled_qty)
 */
export function computePnlTolerance(symbol: string, filledQty: number): number {
  const tick = getTickSizeDollars(symbol);
  return Math.max(PAPER_RECON_CONFIG.PNL_FLOOR_DOLLARS, 2 * tick * filledQty);
}

// ─── Per-trade windowed join (deep-scan round 2 HIGH-1) ───────────────────────

/** A production_trades row shaped for the per-trade join (bigserial id → number). */
export interface PerTradeBrokerRow {
  id: number;
  barTimestamp: Date;
  expectedPnl: string | null;
}

/** A paper_trades row shaped for the per-trade join. */
export interface PerTradeCandidate {
  id: string;
  pnl: string;
  contracts: number;
  entryTime: Date;
  symbol: string;
}

export interface PerTradeMatchResult {
  perTradeCheckedCount: number;
  perTradeMismatchCount: number;
  perTradeMismatchTradeIds: string[];
  perTradeUnmatchedCount: number;
}

/**
 * Per-trade windowed join between paper trades and their broker-tape
 * (production_trades) counterpart, within ±BAR_WINDOW_MINUTES of the paper
 * trade's entry bar_timestamp — the check this file's header docstring has
 * always described, but which the day-level SUM aggregate in evaluateStrategy()
 * did NOT actually implement (`barWindowMs` was computed and never referenced).
 *
 * Why this matters: the day-SUM aggregate nets offsetting per-trade errors to
 * zero. Trade A paper +$500 vs broker +$300 (+$200 error) and trade B paper
 * -$200 vs broker $0 (-$200 error) sum to a $0 day-level delta — a clean
 * "success" while BOTH trades are individually wrong by more than tolerance.
 * This function evaluates each trade's OWN tolerance
 * (MAX(0.50, 2*tick*qty), same formula as the day-aggregate) independently, so
 * an offsetting-error pair is caught even when the aggregate looks clean.
 *
 * Greedy nearest-match: each production_trades row is consumed by at most one
 * paper trade (closest in time, sorted by paper trade entryTime ascending —
 * deterministic run-to-run), so one broker row can never silently "cover" for
 * more than one paper trade's drift. A trade with no production_trades row
 * within the window counts as `perTradeUnmatchedCount` (distinct from a
 * mismatch — nothing was compared, so nothing can be asserted wrong).
 */
export function matchPerTradeBrokerRows(
  paperTrades: PerTradeCandidate[],
  productionRows: PerTradeBrokerRow[],
  barWindowMs: number
): PerTradeMatchResult {
  const used = new Set<number>();
  let perTradeMismatchCount = 0;
  const perTradeMismatchTradeIds: string[] = [];
  let perTradeUnmatchedCount = 0;
  let perTradeCheckedCount = 0;

  const sortedTrades = [...paperTrades].sort(
    (a, b) => a.entryTime.getTime() - b.entryTime.getTime()
  );

  for (const trade of sortedTrades) {
    let best: PerTradeBrokerRow | null = null;
    let bestDeltaMs = Infinity;

    for (const row of productionRows) {
      if (used.has(row.id)) continue;
      // expected_pnl unpopulated by design (broker-router pre server-mediated
      // execution) — cannot compare; skip rather than coalesce NULL→$0, which
      // would turn any real paper P&L into a false per-trade mismatch.
      if (row.expectedPnl === null) continue;
      const deltaMs = Math.abs(row.barTimestamp.getTime() - trade.entryTime.getTime());
      if (deltaMs <= barWindowMs && deltaMs < bestDeltaMs) {
        best = row;
        bestDeltaMs = deltaMs;
      }
    }

    if (!best) {
      perTradeUnmatchedCount++;
      continue;
    }

    used.add(best.id);
    perTradeCheckedCount++;

    const paperPnl = Number(trade.pnl);
    const brokerPnl = Number(best.expectedPnl);
    const delta = Math.abs(paperPnl - brokerPnl);
    const tolerance = computePnlTolerance(trade.symbol, trade.contracts || 1);

    if (delta > tolerance) {
      perTradeMismatchCount++;
      perTradeMismatchTradeIds.push(trade.id);
    }
  }

  return {
    perTradeCheckedCount,
    perTradeMismatchCount,
    perTradeMismatchTradeIds,
    perTradeUnmatchedCount,
  };
}

/**
 * CME futures-trading-day boundaries for the day `reconDate` falls into.
 *
 * deep-scan round 2 HIGH-2: this previously bucketed by RAW UTC calendar day
 * (Date.UTC(y,m,d)..+86_400_000), NOT the canonical CME 5pm-ET trading-day
 * rollover the rest of the system (kill-switch DLL, daily-trade-cap, paper
 * P&L attribution via paper-risk-gate.ts::toFuturesTradingDayString()) uses.
 * A trade closed 17:00-23:59 ET belongs to the NEXT calendar day's trading
 * session — raw-UTC bucketing compared this recon against a DIFFERENT trade
 * population than the one every other daily gate attributes it to. Delegates
 * to reconciliation-service.ts's getCmeTradingDayBoundaries() (single source
 * of truth shared by both recon subsystems) instead of re-deriving locally.
 */
function reconDayBoundaries(reconDate: Date): { dayStart: Date; dayEnd: Date } {
  const { dayStart, dayEnd } = getCmeTradingDayBoundaries(reconDate);
  return { dayStart, dayEnd };
}

// ─── M10 Sub-check: Shadow-signal recon ──────────────────────────────────────

/**
 * Sub-check 1: Shadow-signal recon.
 *
 * For SHADOW-state strategies on the recon day, compare:
 *   - Count of lifecycle_shadow_signals rows (what the interceptor recorded)
 *   - Count of paper_signal_logs rows for the same sessions (what should have fired)
 *
 * Delta > SHADOW_SIGNAL_DELTA_THRESHOLD_PCT across ≥ SHADOW_SIGNAL_MIN_SAMPLE signals
 * means the shadow intercept is silently dropping signals.
 */
async function runShadowSignalRecon(
  dayStart: Date,
  dayEnd: Date,
  reconDateStr: string,
  correlationId: string
): Promise<ShadowSignalReconResult> {
  const empty: ShadowSignalReconResult = {
    checked: false,
    shadowStrategiesChecked: 0,
    totalShadowSignals: 0,
    totalSignalLogs: 0,
    deltaPct: null,
    deltaExceedsThreshold: false,
    belowMinSample: true,
  };

  try {
    // Fetch SHADOW-state strategies
    const shadowStrategies = await db
      .select({ id: strategies.id })
      .from(strategies)
      .where(eq(strategies.lifecycleState, "SHADOW"));

    if (shadowStrategies.length === 0) {
      await writeAuditRow({
        action: "paper_recon.shadow_signal_recon",
        status: "success",
        correlationId,
        payload: { reconDate: reconDateStr, reason: "no_shadow_strategies" },
      });
      return { ...empty, checked: true, belowMinSample: false };
    }

    const shadowStrategyIds = shadowStrategies.map((s) => s.id);

    // Count lifecycle_shadow_signals for the day
    const shadowRows = await db
      .select({ cnt: sql<string>`count(*)` })
      .from(lifecycleShadowSignals)
      .where(
        and(
          inArray(lifecycleShadowSignals.strategyId, shadowStrategyIds),
          gte(lifecycleShadowSignals.signalTs, dayStart),
          lt(lifecycleShadowSignals.signalTs, dayEnd)
        )
      );
    const totalShadowSignals = Number(shadowRows[0]?.cnt ?? 0);

    // Count paper_signal_logs for the same sessions (via SHADOW strategy sessions)
    const sessionRows = await db
      .select({ id: paperSessions.id })
      .from(paperSessions)
      .where(inArray(paperSessions.strategyId, shadowStrategyIds));

    let totalSignalLogs = 0;
    if (sessionRows.length > 0) {
      const sessionIds = sessionRows.map((s) => s.id);
      const signalLogRows = await db
        .select({ cnt: sql<string>`count(*)` })
        .from(paperSignalLogs)
        .where(
          and(
            inArray(paperSignalLogs.sessionId, sessionIds),
            gte(paperSignalLogs.createdAt, dayStart),
            lt(paperSignalLogs.createdAt, dayEnd)
          )
        );
      totalSignalLogs = Number(signalLogRows[0]?.cnt ?? 0);
    }

    const totalSample = Math.max(totalShadowSignals, totalSignalLogs);

    if (totalSample < PAPER_RECON_CONFIG.SHADOW_SIGNAL_MIN_SAMPLE) {
      await writeAuditRow({
        action: "paper_recon.shadow_signal_recon",
        status: "success",
        correlationId,
        payload: {
          reconDate: reconDateStr,
          reason: "below_min_sample",
          totalShadowSignals,
          totalSignalLogs,
          minSample: PAPER_RECON_CONFIG.SHADOW_SIGNAL_MIN_SAMPLE,
        },
      });
      return {
        checked: true,
        shadowStrategiesChecked: shadowStrategies.length,
        totalShadowSignals,
        totalSignalLogs,
        deltaPct: null,
        deltaExceedsThreshold: false,
        belowMinSample: true,
      };
    }

    // Compute delta — denominator is max(shadow, logs) so that totalSignalLogs=0
    // with non-zero totalShadowSignals (or vice versa) yields delta=1.0 (max divergence),
    // not silent delta=0. totalSample (== denom) is already guaranteed >= SHADOW_SIGNAL_MIN_SAMPLE
    // by the early return above, so divide-by-zero is impossible at this point.
    const deltaPct = Math.abs(totalShadowSignals - totalSignalLogs) / totalSample;

    const deltaExceedsThreshold = deltaPct > PAPER_RECON_CONFIG.SHADOW_SIGNAL_DELTA_THRESHOLD_PCT;

    if (deltaExceedsThreshold) {
      logger.warn(
        { reconDate: reconDateStr, deltaPct, totalShadowSignals, totalSignalLogs },
        "paper-journal-recon: shadow-signal delta exceeds threshold"
      );
      await writeAuditRow({
        action: "paper_recon.shadow_signal_delta_detected",
        status: "warning",
        correlationId,
        payload: {
          reconDate: reconDateStr,
          deltaPct,
          totalShadowSignals,
          totalSignalLogs,
          threshold: PAPER_RECON_CONFIG.SHADOW_SIGNAL_DELTA_THRESHOLD_PCT,
          shadowStrategiesChecked: shadowStrategies.length,
        },
      });

      // Discord WARN — non-critical but requires investigation
      const body = appendFamilyGradePostscript(
        `Shadow-signal intercept delta of ${(deltaPct * 100).toFixed(1)}% detected on ${reconDateStr}. ` +
        `Expected ${totalSignalLogs} signal_log rows but intercepted only ${totalShadowSignals} shadow rows. ` +
        `The SHADOW intercept may be silently dropping signals — verify paper-signal-service.ts shadow path. ` +
        `Review audit_log action=paper_recon.shadow_signal_delta_detected.`,
        "The bot is running in a test mode and may have missed some trade signals today.",
        "No action needed — tell the operator (Tonio) to check the bot logs."
      );
      notifyWarning(
        `[PAPER RECON] Shadow-signal delta ${(deltaPct * 100).toFixed(1)}% on ${reconDateStr}`,
        body,
        { reconDate: reconDateStr, deltaPct, totalShadowSignals, totalSignalLogs }
      );
    } else {
      // Delta within threshold — silent info audit
      await writeAuditRow({
        action: "paper_recon.shadow_signal_recon",
        status: "success",
        correlationId,
        payload: {
          reconDate: reconDateStr,
          deltaPct,
          totalShadowSignals,
          totalSignalLogs,
          shadowStrategiesChecked: shadowStrategies.length,
        },
      });
    }

    return {
      checked: true,
      shadowStrategiesChecked: shadowStrategies.length,
      totalShadowSignals,
      totalSignalLogs,
      deltaPct,
      deltaExceedsThreshold,
      belowMinSample: false,
    };
  } catch (err) {
    logger.warn({ err, reconDate: reconDateStr }, "paper-journal-recon: shadow-signal sub-check failed");
    return empty;
  }
}

// ─── M10 Sub-check: Quantum-replay orphan recon ────────────────────────────────

/**
 * Sub-check 2: Quantum-replay orphan recon.
 *
 * When QUANTUM_REPLAY_AUTO_FIRE_ENABLED=true, every completed backtest in the last 24h
 * should have a matching quantum_mc_runs row with governanceLabels->>'replay_mode'='true'.
 * Orphan backtests = auto-fire failed silently.
 *
 * Skipped entirely when QUANTUM_REPLAY_AUTO_FIRE_ENABLED is false or unset.
 */
async function runQuantumReplayOrphanRecon(
  reconDateStr: string,
  correlationId: string
): Promise<QuantumReplayReconResult> {
  const autoFireEnabled =
    (process.env["QUANTUM_REPLAY_AUTO_FIRE_ENABLED"] ?? "true") === "true";

  if (!autoFireEnabled) {
    await writeAuditRow({
      action: "paper_recon.quantum_replay_check_disabled",
      status: "success",
      correlationId,
      payload: { reconDate: reconDateStr, reason: "QUANTUM_REPLAY_AUTO_FIRE_ENABLED=false" },
    });
    return { checked: false, skipped: true, orphanBacktestIds: [], orphanCount: 0 };
  }

  try {
    // Find completed backtests in the last 24 hours
    const cutoff = new Date(Date.now() - 86_400_000);

    const recentCompleted = await db
      .select({ id: backtests.id })
      .from(backtests)
      .where(
        and(
          eq(backtests.status, "completed"),
          gte(backtests.createdAt, cutoff)
        )
      );

    if (recentCompleted.length === 0) {
      await writeAuditRow({
        action: "paper_recon.quantum_replay_check_disabled",
        status: "success",
        correlationId,
        payload: { reconDate: reconDateStr, reason: "no_completed_backtests_in_24h" },
      });
      return { checked: true, skipped: false, orphanBacktestIds: [], orphanCount: 0 };
    }

    const completedIds = recentCompleted.map((b) => b.id);

    // Find which of those have a matching quantum_mc_runs replay row
    const replayRows = await db
      .select({ backtestId: quantumMcRuns.backtestId })
      .from(quantumMcRuns)
      .where(
        and(
          inArray(quantumMcRuns.backtestId, completedIds),
          // governanceLabels->>'replay_mode' = 'true'
          sql`${quantumMcRuns.governanceLabels}->>'replay_mode' = 'true'`
        )
      );

    const replayedIds = new Set(replayRows.map((r) => r.backtestId));
    const orphanBacktestIds = completedIds.filter((id) => !replayedIds.has(id));
    const orphanCount = orphanBacktestIds.length;

    if (orphanCount > 0) {
      logger.warn(
        { reconDate: reconDateStr, orphanCount, orphanBacktestIds },
        "paper-journal-recon: quantum-replay orphan backtests detected"
      );
      await writeAuditRow({
        action: "paper_recon.quantum_replay_orphans_detected",
        status: "warning",
        correlationId,
        payload: {
          reconDate: reconDateStr,
          orphanCount,
          orphanBacktestIds,
          totalCompletedIn24h: recentCompleted.length,
        },
      });
    } else {
      await writeAuditRow({
        action: "paper_recon.quantum_replay_check_clean",
        status: "success",
        correlationId,
        payload: {
          reconDate: reconDateStr,
          totalCompletedIn24h: recentCompleted.length,
          allHaveReplayRows: true,
        },
      });
    }

    return { checked: true, skipped: false, orphanBacktestIds, orphanCount };
  } catch (err) {
    logger.warn({ err, reconDate: reconDateStr }, "paper-journal-recon: quantum-replay sub-check failed");
    return { checked: false, skipped: false, orphanBacktestIds: [], orphanCount: 0 };
  }
}

// ─── M10 Sub-check: A/B account session recon ─────────────────────────────────

/**
 * Sub-check 3: A/B account session recon.
 *
 * For each strategy with paper_account_routing IN ('slumdawg-baseline','slumdawg-rl-challenger'),
 * verify:
 *   1. The corresponding broker_accounts.account_id_external row EXISTS.
 *   2. There's an active (no closed_at) paper_sessions row for it.
 *
 * Missing broker_account OR no active session = the A/B Friday digest will be vacuous.
 */
async function runAbRoutingRecon(
  reconDateStr: string,
  correlationId: string
): Promise<AbRoutingReconResult> {
  const AB_ROUTING_VALUES = ["slumdawg-baseline", "slumdawg-rl-challenger"];

  try {
    // Fetch A/B routed strategies
    const abStrategies = await db
      .select({ id: strategies.id, paperAccountRouting: strategies.paperAccountRouting })
      .from(strategies)
      .where(inArray(strategies.paperAccountRouting, AB_ROUTING_VALUES));

    if (abStrategies.length === 0) {
      await writeAuditRow({
        action: "paper_recon.ab_routing_recon",
        status: "success",
        correlationId,
        payload: { reconDate: reconDateStr, reason: "no_ab_routed_strategies" },
      });
      return { checked: true, orphanStrategyIds: [], orphanCount: 0 };
    }

    const orphanStrategyIds: string[] = [];

    for (const strat of abStrategies) {
      // 1. Check broker_accounts: needs a row with account_id_external matching the routing value
      const brokerRows = await db
        .select({ accountId: brokerAccounts.accountId })
        .from(brokerAccounts)
        .where(eq(brokerAccounts.accountIdExternal, strat.paperAccountRouting));

      if (brokerRows.length === 0) {
        logger.warn(
          { strategyId: strat.id, paperAccountRouting: strat.paperAccountRouting },
          "paper-journal-recon: A/B routing orphan — missing broker_account row"
        );
        await writeAuditRow({
          action: "paper_recon.ab_routing_orphan_detected",
          status: "warning",
          correlationId,
          payload: {
            reconDate: reconDateStr,
            strategyId: strat.id,
            paperAccountRouting: strat.paperAccountRouting,
            reason: "missing_broker_account_row",
          },
        });
        orphanStrategyIds.push(strat.id);
        continue;
      }

      // 2. Check active paper_sessions (no closed_at = still open)
      const activeSessions = await db
        .select({ id: paperSessions.id })
        .from(paperSessions)
        .where(
          and(
            eq(paperSessions.strategyId, strat.id),
            eq(paperSessions.status, "active")
          )
        );

      if (activeSessions.length === 0) {
        logger.warn(
          { strategyId: strat.id, paperAccountRouting: strat.paperAccountRouting },
          "paper-journal-recon: A/B routing orphan — no active paper_sessions row"
        );
        await writeAuditRow({
          action: "paper_recon.ab_routing_orphan_detected",
          status: "warning",
          correlationId,
          payload: {
            reconDate: reconDateStr,
            strategyId: strat.id,
            paperAccountRouting: strat.paperAccountRouting,
            reason: "no_active_session",
          },
        });
        orphanStrategyIds.push(strat.id);
      }
    }

    if (orphanStrategyIds.length === 0) {
      await writeAuditRow({
        action: "paper_recon.ab_routing_recon",
        status: "success",
        correlationId,
        payload: {
          reconDate: reconDateStr,
          abStrategiesChecked: abStrategies.length,
          orphanCount: 0,
        },
      });
    }

    return {
      checked: true,
      orphanStrategyIds,
      orphanCount: orphanStrategyIds.length,
    };
  } catch (err) {
    logger.warn({ err, reconDate: reconDateStr }, "paper-journal-recon: A/B routing sub-check failed");
    return { checked: false, orphanStrategyIds: [], orphanCount: 0 };
  }
}

// ─── Sub-check empty-result builder ──────────────────────────────────────────

/**
 * Returns empty/zero sub-check results for early-exit paths
 * (strategy fetch error, no DEPLOYED+ strategies).
 */
function buildEmptySubchecks(): {
  shadowSignalSubcheck: ShadowSignalReconResult;
  quantumReplaySubcheck: QuantumReplayReconResult;
  abRoutingSubcheck: AbRoutingReconResult;
} {
  return {
    shadowSignalSubcheck: {
      checked: false,
      shadowStrategiesChecked: 0,
      totalShadowSignals: 0,
      totalSignalLogs: 0,
      deltaPct: null,
      deltaExceedsThreshold: false,
      belowMinSample: true,
    },
    quantumReplaySubcheck: {
      checked: false,
      skipped: false,
      orphanBacktestIds: [],
      orphanCount: 0,
    },
    abRoutingSubcheck: {
      checked: false,
      orphanStrategyIds: [],
      orphanCount: 0,
    },
  };
}

// ─── Core recon logic ─────────────────────────────────────────────────────────

/**
 * Run paper journal reconciliation for the given date.
 *
 * For each DEPLOYED+ strategy:
 * 1. Count paper_trades rows for the day via paperSessions JOIN.
 * 2. Count production_trades (TradersPost proxy) for the same window.
 * 3. Count tradingview_markers for the same window.
 * 4. Assert count parity.
 * 5. For each paper_trade, compute P&L delta vs nearest broker proxy.
 *
 * Returns the full result; callers decide whether to write audit rows.
 */
export async function runPaperJournalRecon(
  reconDate: Date = new Date()
): Promise<PaperJournalReconResult> {
  const correlationId = randomUUID();
  // deep-scan round 2 HIGH-2: canonical CME trading-day string, not a raw UTC slice.
  const reconDateStr = toCmeTradingDayString(reconDate);
  const { dayStart, dayEnd } = reconDayBoundaries(reconDate);

  logger.info(
    { reconDate: reconDateStr, correlationId },
    "paper-journal-recon: starting"
  );

  // ── Fetch DEPLOYED+ strategies ────────────────────────────────────────────
  let deployedStrategies: Array<{ id: string; name: string; symbol: string }>;
  try {
    deployedStrategies = await db
      .select({ id: strategies.id, name: strategies.name, symbol: strategies.symbol })
      .from(strategies)
      .where(inArray(strategies.lifecycleState, [...PAPER_RECON_CONFIG.DEPLOYED_PLUS_STATES]));
  } catch (err) {
    logger.error({ err, reconDate: reconDateStr }, "paper-journal-recon: failed to fetch strategies");
    // Fail-CLOSED: write critical audit and return empty result
    await writeAuditRow({
      action: "paper_reconciliation.mismatch_detected",
      status: "critical",
      correlationId,
      payload: {
        reconDate: reconDateStr,
        error: err instanceof Error ? err.message : String(err),
        source: "strategy_fetch",
      },
    });
    fireCriticalAlert(reconDateStr, [{
      strategyId: "unknown",
      error: err instanceof Error ? err.message : String(err),
    }]);
    const emptySubchecks = buildEmptySubchecks();
    return {
      reconDate: reconDateStr,
      ranAt: new Date(),
      correlationId,
      strategiesEvaluated: 0,
      strategiesWithMismatch: 0,
      strategiesWithMissingBrokerData: 0,
      results: [],
      hasDrift: true,
      brokerTapeSourceActive: false,
      reconciliationInactive: false,
      ...emptySubchecks,
    };
  }

  if (deployedStrategies.length === 0) {
    logger.info(
      { reconDate: reconDateStr },
      "paper-journal-recon: no DEPLOYED+ strategies — clean (nothing to reconcile)"
    );
    await writeAuditRow({
      action: "paper_reconciliation.evaluated",
      status: "success",
      correlationId,
      payload: {
        reconDate: reconDateStr,
        strategiesEvaluated: 0,
        strategiesWithMismatch: 0,
        summary: "no_deployed_strategies",
      },
    });
    const emptySubchecks = buildEmptySubchecks();
    return {
      reconDate: reconDateStr,
      ranAt: new Date(),
      correlationId,
      strategiesEvaluated: 0,
      strategiesWithMismatch: 0,
      strategiesWithMissingBrokerData: 0,
      results: [],
      hasDrift: false,
      brokerTapeSourceActive: true,
      reconciliationInactive: false,
      ...emptySubchecks,
    };
  }

  // ── deepscan14 C1: is the broker-tape proxy (production_trades) populated at
  // all, system-wide? This is checked ONCE per run (not per-strategy) — it answers
  // "does any ingest pipeline write this table", distinct from "did THIS strategy
  // have a broker fill today". Fail-loud: a DB error here is treated as inactive
  // (conservative — never silently assume the tape is healthy on an error).
  const brokerTapeSourceActive = await checkBrokerTapeSourceActive();

  // ── Per-strategy evaluation ───────────────────────────────────────────────
  const results: PaperReconStrategyResult[] = [];

  for (const strategy of deployedStrategies) {
    const stratResult = await evaluateStrategy(strategy, dayStart, dayEnd, reconDateStr);
    results.push(stratResult);
  }

  // ── M10 sub-checks (run in parallel after the per-strategy evaluation) ───────
  const [shadowSignalSubcheck, quantumReplaySubcheck, abRoutingSubcheck] =
    await Promise.all([
      runShadowSignalRecon(dayStart, dayEnd, reconDateStr, correlationId),
      runQuantumReplayOrphanRecon(reconDateStr, correlationId),
      runAbRoutingRecon(reconDateStr, correlationId),
    ]);

  // ── Aggregate ─────────────────────────────────────────────────────────────
  // deep-scan round 2 HIGH-1: strategiesWithMismatch/hasDrift now ALSO trip on
  // perTradeMismatchDetected — an offsetting-error pair can leave countMismatch
  // and pnlDriftExceedsTolerance both false (the day-SUM aggregates cancel out)
  // while individual trades are genuinely wrong. Without this, hasDrift=false
  // would still read as "clean" even though the per-trade join below caught it.
  const strategiesWithMismatch = results.filter(
    (r) => r.countMismatch || r.pnlDriftExceedsTolerance || r.perTradeMismatchDetected
  ).length;
  const strategiesWithMissingBrokerData = results.filter((r) => r.missingBrokerData).length;
  const hasDrift = strategiesWithMismatch > 0;

  // ── Write audit rows ──────────────────────────────────────────────────────
  // Preserves the ORIGINAL if/else-if/else-if exclusivity (hasDrift vs missing-
  // broker-data branches) — hasDrift now ALSO trips on perTradeMismatchDetected
  // (see strategiesWithMismatch above), so this outer branch's gating is
  // unchanged; only its INSIDE is split into two DISTINCT audit/alert writers
  // per HIGH-1 (day-aggregate mismatch and per-trade offsetting-error mismatch
  // are independent signals — a day can have one, the other, or both).
  const aggregateMismatchedResults = results.filter(
    (r) => r.countMismatch || r.pnlDriftExceedsTolerance
  );
  const perTradeMismatchedResults = results.filter((r) => r.perTradeMismatchDetected);

  if (hasDrift) {
    // Day-aggregate mismatch (count parity + day-SUM P&L drift) — the ORIGINAL
    // recon signal. Still meaningful (whole-day count drift, non-offsetting
    // P&L drift) but no longer the only one contributing to hasDrift.
    if (aggregateMismatchedResults.length > 0) {
      for (const r of aggregateMismatchedResults) {
        await writeAuditRow({
          action: "paper_reconciliation.mismatch_detected",
          status: "critical",
          correlationId,
          payload: {
            reconDate: reconDateStr,
            strategy_id: r.strategyId,
            symbol: r.symbol,
            expected_count: r.paperTradeCount,
            actual_count: r.brokerTradeCount,
            pnl_diff_dollars: r.pnlDriftDollars,
            drift_threshold: r.pnlTolerance,
            count_mismatch: r.countMismatch,
            pnl_drift_exceeds_tolerance: r.pnlDriftExceedsTolerance,
            trade_ids: r.tradeIds,
          },
        });
      }

      fireCriticalAlert(reconDateStr, aggregateMismatchedResults);
    }

    // deep-scan round 2 HIGH-1: per-trade windowed-join mismatch — DISTINCT
    // audit action + alert from the day-aggregate above. Fires whenever ANY
    // individual trade's |paper_pnl - broker_pnl| exceeds its OWN per-trade
    // tolerance — exactly the offsetting-error case the day-SUM aggregate
    // cannot see (it can be non-empty even when aggregateMismatchedResults is
    // empty, since that's the whole point of this fix).
    if (perTradeMismatchedResults.length > 0) {
      for (const r of perTradeMismatchedResults) {
        await writeAuditRow({
          action: "paper_reconciliation.per_trade_mismatch_detected",
          status: "critical",
          correlationId,
          payload: {
            reconDate: reconDateStr,
            strategy_id: r.strategyId,
            symbol: r.symbol,
            per_trade_checked_count: r.perTradeCheckedCount,
            per_trade_mismatch_count: r.perTradeMismatchCount,
            per_trade_mismatch_trade_ids: r.perTradeMismatchTradeIds,
            per_trade_unmatched_count: r.perTradeUnmatchedCount,
            day_aggregate_pnl_drift_dollars: r.pnlDriftDollars,
            day_aggregate_exceeds_tolerance: r.pnlDriftExceedsTolerance,
            bar_window_minutes: PAPER_RECON_CONFIG.BAR_WINDOW_MINUTES,
          },
        });
      }

      firePerTradeCriticalAlert(reconDateStr, perTradeMismatchedResults);
    }
  } else if (strategiesWithMissingBrokerData > 0 && !brokerTapeSourceActive) {
    // deepscan14 C1: production_trades has NEVER been populated (checked once,
    // system-wide, above) — every "missing broker data" result below is a
    // STRUCTURAL gap, not a per-day miss. Writing the routine
    // `missing_broker_data` warn here would read as "occasional data hiccup"
    // when the truth is "this reconciliation has verified nothing, ever."
    // ONE aggregated, unmistakably distinct audit row instead of N per-strategy
    // warns — the point is honesty about scope, not alert volume.
    const affected = results.filter((r) => r.missingBrokerData);
    await writeAuditRow({
      action: "paper_reconciliation.inactive_no_broker_tape",
      status: "warning",
      correlationId,
      payload: {
        reconDate: reconDateStr,
        message:
          "Paper<->broker reconciliation is INACTIVE, not clean: production_trades " +
          "(the broker-tape proxy this recon joins against) has zero rows system-wide. " +
          "No TradersPost fill ingest writes this table yet. Nothing was verified today " +
          "for the affected strategies — do NOT read hasDrift=false as a passing check.",
        affected_strategy_ids: affected.map((r) => r.strategyId),
        affected_strategy_count: affected.length,
        paper_trade_counts: affected.map((r) => ({ strategyId: r.strategyId, paperTradeCount: r.paperTradeCount })),
      },
    });
  } else if (strategiesWithMissingBrokerData > 0) {
    // Broker tape source IS populated in general — these specific strategies/days
    // just have no matching rows. A genuine per-day data gap, not a structural one.
    for (const r of results.filter((r) => r.missingBrokerData)) {
      await writeAuditRow({
        action: "paper_reconciliation.missing_broker_data",
        status: "warning",
        correlationId,
        payload: {
          reconDate: reconDateStr,
          strategy_id: r.strategyId,
          symbol: r.symbol,
          paper_trade_count: r.paperTradeCount,
          trade_ids: r.tradeIds,
        },
      });
    }
  }

  // deep-scan Accuracy CRITICAL: strategies whose production_trades rows exist but carry only NULL
  // expected_pnl. Their P&L drift was intentionally NOT computed (would have false-alerted). Surface
  // it as a distinct WARN so hasDrift=false is not misread as "P&L verified clean".
  const strategiesWithBrokerPnlUnavailable = results.filter((r) => r.brokerPnlUnavailable).length;
  if (strategiesWithBrokerPnlUnavailable > 0) {
    const affectedPnl = results.filter((r) => r.brokerPnlUnavailable);
    await writeAuditRow({
      action: "paper_reconciliation.broker_pnl_unavailable",
      status: "warning",
      correlationId,
      payload: {
        reconDate: reconDateStr,
        message:
          "P&L reconciliation was NOT performed for these strategies: production_trades rows exist " +
          "but every expected_pnl is NULL (broker-router writes it null by design — no server-mediated " +
          "fill ingest populates it yet). Trade-count parity still ran; P&L drift is unverified. Do NOT " +
          "read hasDrift=false as 'P&L verified clean' for these strategies.",
        affected_strategy_ids: affectedPnl.map((r) => r.strategyId),
        affected_strategy_count: affectedPnl.length,
      },
    });
  }

  const reconciliationInactive = !brokerTapeSourceActive && strategiesWithMissingBrokerData > 0;

  // Always write the top-level evaluated row (includes all 4 sub-check summaries)
  await writeAuditRow({
    action: "paper_reconciliation.evaluated",
    status: hasDrift ? "failure" : "success",
    correlationId,
    payload: {
      reconDate: reconDateStr,
      strategiesEvaluated: deployedStrategies.length,
      strategiesWithMismatch,
      strategiesWithMissingBrokerData,
      strategies_with_broker_pnl_unavailable: strategiesWithBrokerPnlUnavailable,
      hasDrift,
      broker_tape_source_active: brokerTapeSourceActive,
      reconciliation_inactive: reconciliationInactive,
      subcheck_summary: {
        paper_journal: {
          strategiesEvaluated: deployedStrategies.length,
          strategiesWithMismatch,
          hasDrift,
        },
        shadow_signal: {
          checked: shadowSignalSubcheck.checked,
          deltaExceedsThreshold: shadowSignalSubcheck.deltaExceedsThreshold,
          deltaPct: shadowSignalSubcheck.deltaPct,
          belowMinSample: shadowSignalSubcheck.belowMinSample,
        },
        quantum_replay: {
          checked: quantumReplaySubcheck.checked,
          skipped: quantumReplaySubcheck.skipped,
          orphanCount: quantumReplaySubcheck.orphanCount,
        },
        ab_routing: {
          checked: abRoutingSubcheck.checked,
          orphanCount: abRoutingSubcheck.orphanCount,
        },
      },
    },
  });

  logger.info(
    {
      reconDate: reconDateStr,
      strategiesEvaluated: deployedStrategies.length,
      strategiesWithMismatch,
      hasDrift,
      shadowSignalDelta: shadowSignalSubcheck.deltaPct,
      quantumReplayOrphans: quantumReplaySubcheck.orphanCount,
      abRoutingOrphans: abRoutingSubcheck.orphanCount,
    },
    "paper-journal-recon: complete"
  );

  return {
    reconDate: reconDateStr,
    ranAt: new Date(),
    correlationId,
    strategiesEvaluated: deployedStrategies.length,
    strategiesWithMismatch,
    strategiesWithMissingBrokerData,
    results,
    hasDrift,
    brokerTapeSourceActive,
    reconciliationInactive,
    shadowSignalSubcheck,
    quantumReplaySubcheck,
    abRoutingSubcheck,
  };
}

/**
 * deepscan14 C1: has any TradersPost fill-ingest pipeline ever written to
 * `production_trades`? Checked ONCE per recon run (not per-strategy) — cheap
 * global existence probe, not a per-day/per-strategy query. Fail-loud: a query
 * error is treated as inactive (conservative default; never silently assume
 * healthy).
 */
async function checkBrokerTapeSourceActive(): Promise<boolean> {
  try {
    // `.where(sql\`1=1\`)` (rather than `.limit(1)`) matches the from().where()
    // query shape used by every other query in this file/its test mocks.
    const rows = await db.select({ cnt: sql<string>`count(*)` }).from(productionTrades).where(sql`1=1`);
    return Number(rows[0]?.cnt ?? 0) > 0;
  } catch (err) {
    logger.warn(
      { err },
      "paper-journal-recon: broker-tape-source-active check failed — treating as INACTIVE (fail-loud, not fail-open)"
    );
    return false;
  }
}

// ─── Per-strategy evaluation ──────────────────────────────────────────────────

async function evaluateStrategy(
  strategy: { id: string; name: string; symbol: string },
  dayStart: Date,
  dayEnd: Date,
  reconDateStr: string
): Promise<PaperReconStrategyResult> {
  const barWindowMs = PAPER_RECON_CONFIG.BAR_WINDOW_MINUTES * 60 * 1000;

  // ── 1. Fetch paper_trades for this strategy today ──────────────────────
  let paperTradeRows: Array<{
    id: string;
    pnl: string;
    contracts: number;
    exitTime: Date;
    entryTime: Date;
  }>;
  try {
    paperTradeRows = await db
      .select({
        id: paperTrades.id,
        pnl: paperTrades.pnl,
        contracts: paperTrades.contracts,
        exitTime: paperTrades.exitTime,
        entryTime: paperTrades.entryTime,
      })
      .from(paperTrades)
      .innerJoin(paperSessions, eq(paperTrades.sessionId, paperSessions.id))
      .where(
        and(
          eq(paperSessions.strategyId, strategy.id),
          gte(paperTrades.exitTime, dayStart),
          lt(paperTrades.exitTime, dayEnd)
        )
      );
  } catch (err) {
    logger.warn({ err, strategyId: strategy.id }, "paper-journal-recon: paper_trades fetch failed");
    return buildErrorResult(strategy, "paper_trades_fetch_failed");
  }

  const paperTradeCount = paperTradeRows.length;
  const tradeIds = paperTradeRows.map((r) => r.id);

  if (paperTradeCount === 0) {
    // No paper trades today — nothing to reconcile for this strategy.
    return {
      strategyId: strategy.id,
      strategyName: strategy.name,
      symbol: strategy.symbol,
      paperTradeCount: 0,
      brokerTradeCount: 0,
      tradingviewMarkerCount: null,
      countMismatch: false,
      pnlDriftDollars: null,
      pnlTolerance: null,
      pnlDriftExceedsTolerance: false,
      brokerPnlUnavailable: false,
      missingBrokerData: false,
      tradeIds: [],
      perTradeCheckedCount: 0,
      perTradeMismatchCount: 0,
      perTradeMismatchTradeIds: [],
      perTradeUnmatchedCount: 0,
      perTradeMismatchDetected: false,
    };
  }

  // ── 2. Fetch broker proxy count (production_trades) ────────────────────
  // production_trades is the current TradersPost proxy (paper-engine authority).
  // Until Phase 4C wires real TradersPost webhook confirm IDs, this is the
  // available cross-check source for PAPER+ strategies.
  //
  // BL-11 FIX: filter by strategy_id so that with 2+ concurrent strategies
  // each strategy is reconciled against its OWN broker trades only.
  // Filtering by date alone aggregates ALL strategies' broker tapes and compares
  // them against a per-strategy paper count — arithmetically wrong.
  // production_trades.strategy_id is guaranteed non-null (schema NOT NULL constraint).
  let brokerTradeCount = 0;
  let missingBrokerData = false;
  try {
    const brokerRows = await db
      .select({ cnt: sql<string>`count(*)` })
      .from(productionTrades)
      .where(
        and(
          eq(productionTrades.strategyId, strategy.id),
          gte(productionTrades.barTimestamp, dayStart),
          lt(productionTrades.barTimestamp, dayEnd)
        )
      );
    brokerTradeCount = Number(brokerRows[0]?.cnt ?? 0);
    missingBrokerData = brokerTradeCount === 0 && paperTradeCount > 0;
  } catch (err) {
    logger.warn({ err, strategyId: strategy.id }, "paper-journal-recon: broker count fetch failed");
    missingBrokerData = true;
  }

  // ── 3. Fetch TradingView marker count ──────────────────────────────────
  let tradingviewMarkerCount: number | null = null;
  try {
    const tvRows = await db
      .select({ cnt: sql<string>`count(*)` })
      .from(tradingviewMarkers)
      .where(
        and(
          eq(tradingviewMarkers.strategyId, strategy.id),
          gte(tradingviewMarkers.barTimestamp, dayStart),
          lt(tradingviewMarkers.barTimestamp, dayEnd)
        )
      );
    tradingviewMarkerCount = Number(tvRows[0]?.cnt ?? 0);
  } catch (err) {
    // Table may not exist yet on older installs — fail-soft.
    logger.debug(
      { err: err instanceof Error ? err.message : String(err), strategyId: strategy.id },
      "paper-journal-recon: tradingview_markers fetch skipped"
    );
    tradingviewMarkerCount = null;
  }

  // ── 4. Count mismatch check ────────────────────────────────────────────
  const countMismatch = !missingBrokerData && brokerTradeCount !== paperTradeCount;

  // ── 5. P&L drift check ─────────────────────────────────────────────────
  // When missing broker data, skip P&L drift (nothing to compare against).
  // Otherwise, sum paper P&L and compare against broker proxy.
  let pnlDriftDollars: number | null = null;
  let pnlTolerance: number | null = null;
  let pnlDriftExceedsTolerance = false;
  let brokerPnlUnavailable = false;

  if (!missingBrokerData && paperTradeRows.length > 0) {
    // Aggregate paper P&L for the day for this strategy
    const totalPaperPnl = paperTradeRows.reduce((sum, t) => sum + Number(t.pnl), 0);

    // Fetch broker proxy P&L (production_trades expected_pnl for the window)
    try {
      // FINDING #3 FIX: must filter by strategyId here (matches the COUNT query at line ~928).
      // Without this filter, a multi-strategy account's combined broker P&L was compared
      // against a single strategy's paper P&L → false CRITICAL drift alerts + masked real drift.
      const brokerPnlRows = await db
        .select({
          total: sql<string>`coalesce(sum(expected_pnl), 0)`,
          // deep-scan Accuracy CRITICAL: count() ignores NULLs → distinguishes "expected_pnl
          // unpopulated" (broker-router writes it null by design) from a genuine $0 broker P&L.
          populated: sql<string>`count(expected_pnl)`,
        })
        .from(productionTrades)
        .where(
          and(
            eq(productionTrades.strategyId, strategy.id),
            gte(productionTrades.barTimestamp, dayStart),
            lt(productionTrades.barTimestamp, dayEnd)
          )
        );
      const populatedExpectedPnl = Number(brokerPnlRows[0]?.populated ?? 0);
      if (populatedExpectedPnl === 0) {
        // No production_trades row in the window carries a real expected_pnl → paper-vs-broker P&L
        // reconciliation is impossible. Coalescing NULL→$0 here would make totalBrokerPnl=0 and turn
        // ANY real paper P&L into a false CRITICAL drift. Degrade honestly: drift null, never a mismatch.
        pnlDriftDollars = null;
        pnlDriftExceedsTolerance = false;
        brokerPnlUnavailable = true;
      } else {
        const totalBrokerPnl = Number(brokerPnlRows[0]?.total ?? 0);
        pnlDriftDollars = Math.abs(totalPaperPnl - totalBrokerPnl);

        // Tolerance: use the first trade's contracts for representative sizing
        // (daily aggregate comparison — per-trade contract count summed for tolerance)
        const totalContracts = paperTradeRows.reduce((sum, t) => sum + (t.contracts ?? 1), 0);
        pnlTolerance = computePnlTolerance(strategy.symbol, totalContracts);
        pnlDriftExceedsTolerance = pnlDriftDollars > pnlTolerance;
      }
    } catch (err) {
      logger.warn({ err, strategyId: strategy.id }, "paper-journal-recon: broker P&L fetch failed");
      // Cannot compute drift — treat as missing broker data rather than mismatch
    }
  }

  // ── 6. Per-trade windowed join (deep-scan round 2 HIGH-1) ───────────────
  // Independent of missingBrokerData/countMismatch/pnlDriftExceedsTolerance
  // above (all day-level SUM aggregates, which offsetting per-trade errors
  // can net to zero). Runs whenever there are paper trades to check —
  // production_trades rows outside the ±barWindowMs window from a given
  // trade's entryTime simply won't match, correctly surfacing as "unmatched"
  // rather than a false pass. Padding the query window by ±barWindowMs
  // around [dayStart, dayEnd) catches trades whose entryTime sits near the
  // trading-day boundary but whose broker counterpart landed just outside it.
  let perTradeResult: PerTradeMatchResult = {
    perTradeCheckedCount: 0,
    perTradeMismatchCount: 0,
    perTradeMismatchTradeIds: [],
    perTradeUnmatchedCount: 0,
  };
  try {
    const productionRowsForJoin = await db
      .select({
        id: productionTrades.id,
        barTimestamp: productionTrades.barTimestamp,
        expectedPnl: productionTrades.expectedPnl,
      })
      .from(productionTrades)
      .where(
        and(
          eq(productionTrades.strategyId, strategy.id),
          gte(productionTrades.barTimestamp, new Date(dayStart.getTime() - barWindowMs)),
          lt(productionTrades.barTimestamp, new Date(dayEnd.getTime() + barWindowMs))
        )
      );

    perTradeResult = matchPerTradeBrokerRows(
      paperTradeRows.map((t) => ({
        id: t.id,
        pnl: t.pnl,
        contracts: t.contracts,
        entryTime: t.entryTime,
        symbol: strategy.symbol,
      })),
      productionRowsForJoin as unknown as PerTradeBrokerRow[],
      barWindowMs
    );
  } catch (err) {
    logger.warn({ err, strategyId: strategy.id }, "paper-journal-recon: per-trade broker join failed");
    // Fail-soft on the per-trade check specifically — the day-aggregate check
    // above already ran and remains the fallback signal; a per-trade query
    // error must not mask an otherwise-successful day-level evaluation.
  }

  return {
    strategyId: strategy.id,
    strategyName: strategy.name,
    symbol: strategy.symbol,
    paperTradeCount,
    brokerTradeCount,
    tradingviewMarkerCount,
    countMismatch,
    pnlDriftDollars,
    pnlTolerance,
    pnlDriftExceedsTolerance,
    brokerPnlUnavailable,
    missingBrokerData,
    tradeIds,
    perTradeCheckedCount: perTradeResult.perTradeCheckedCount,
    perTradeMismatchCount: perTradeResult.perTradeMismatchCount,
    perTradeMismatchTradeIds: perTradeResult.perTradeMismatchTradeIds,
    perTradeUnmatchedCount: perTradeResult.perTradeUnmatchedCount,
    perTradeMismatchDetected: perTradeResult.perTradeMismatchCount > 0,
  };
}

// ─── Error result builder ─────────────────────────────────────────────────────

function buildErrorResult(
  strategy: { id: string; name: string; symbol: string },
  _reason: string
): PaperReconStrategyResult {
  return {
    strategyId: strategy.id,
    strategyName: strategy.name,
    symbol: strategy.symbol,
    paperTradeCount: 0,
    brokerTradeCount: 0,
    tradingviewMarkerCount: null,
    countMismatch: false,
    pnlDriftDollars: null,
    pnlTolerance: null,
    pnlDriftExceedsTolerance: false,
    brokerPnlUnavailable: true,
    missingBrokerData: true,
    tradeIds: [],
    perTradeCheckedCount: 0,
    perTradeMismatchCount: 0,
    perTradeMismatchTradeIds: [],
    perTradeUnmatchedCount: 0,
    perTradeMismatchDetected: false,
  };
}

// ─── Audit row writer ─────────────────────────────────────────────────────────

async function writeAuditRow(params: {
  action: string;
  status: "success" | "failure" | "critical" | "warning";
  correlationId: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  // deep-scan 2026-07-09 (MED, non-instrument): write the severity VERBATIM.
  // Previously this remapped "warning"→"success" and "critical"→"failure" — the
  // ONLY writer in the codebase to do so — which buried genuine WARN recon findings
  // (paper_recon.shadow_signal_delta_detected, missing_broker_data,
  // quantum_replay_orphans_detected, ab_routing_orphan_detected) under
  // status="success", invisible to any dashboard/query keyed on the codebase-wide
  // status='warning' convention (57 other files write "warning" literally).
  // audit_log.status is free text(); live Discord alerts fire via notify* independent
  // of this field, so this changes DB queryability only — no gate/behavior impact.
  await db
    .insert(auditLog)
    .values({
      action: params.action,
      entityType: "paper_reconciliation",
      entityId: null,
      decisionAuthority: "system",
      input: { reconDate: params.payload.reconDate } as Record<string, unknown>,
      result: params.payload,
      status: params.status,
      correlationId: params.correlationId,
    })
    .catch((err) =>
      logger.error({ err, action: params.action }, "paper-journal-recon: audit_log write failed")
    );
}

// ─── Discord critical alert ───────────────────────────────────────────────────

function fireCriticalAlert(
  reconDateStr: string,
  mismatchedResults: ReadonlyArray<{ strategyId?: string; symbol?: string; error?: string }>
): void {
  const count = mismatchedResults.length;
  const strategyList = mismatchedResults
    .map((r) => r.strategyId ?? "unknown")
    .join(", ");

  const operatorBody =
    `Paper journal reconciliation DRIFT on ${reconDateStr}. ` +
    `${count} strategy/strategies with mismatch: ${strategyList}. ` +
    `paper_trades vs TradersPost broker tape divergence detected. ` +
    `Review audit_log action=paper_reconciliation.mismatch_detected for full payload.`;

  const body = appendFamilyGradePostscript(
    operatorBody,
    "The bot's recorded trades don't match what the broker confirmed. " +
    "This means there could be a discrepancy in P&L or missed trades.",
    "Don't panic — no money has been lost yet. " +
    "Tell the operator (Tonio) so he can check the bot's trade history vs the broker dashboard."
  );

  notifyCritical(
    `[PAPER RECON] Drift detected on ${reconDateStr}`,
    body,
    { reconDate: reconDateStr, mismatchCount: count, strategies: strategyList }
  );
}

/**
 * deep-scan round 2 HIGH-1: distinct Discord CRITICAL for per-trade offsetting-
 * error drift — separate from fireCriticalAlert (the day-aggregate signal)
 * because the whole point of this check is that it can fire when the
 * day-aggregate looks clean (offsetting errors net to $0 in the day-SUM).
 * The operator needs to know THAT distinction, not just "drift detected".
 */
function firePerTradeCriticalAlert(
  reconDateStr: string,
  perTradeMismatchedResults: ReadonlyArray<{
    strategyId: string;
    symbol: string;
    perTradeMismatchCount: number;
    perTradeMismatchTradeIds: string[];
  }>
): void {
  const strategyCount = perTradeMismatchedResults.length;
  const totalMismatchedTrades = perTradeMismatchedResults.reduce(
    (sum, r) => sum + r.perTradeMismatchCount,
    0
  );
  const strategyList = perTradeMismatchedResults.map((r) => r.strategyId).join(", ");

  const operatorBody =
    `Paper journal PER-TRADE reconciliation drift on ${reconDateStr}. ` +
    `${totalMismatchedTrades} individual trade(s) across ${strategyCount} strategy/strategies exceeded ` +
    `per-trade P&L tolerance vs the broker tape, within a ${PAPER_RECON_CONFIG.BAR_WINDOW_MINUTES}-minute ` +
    `bar_timestamp window: ${strategyList}. This check exists specifically because OFFSETTING per-trade ` +
    `errors can net to zero in the day-level sum — the day-aggregate check may show no drift even while ` +
    `this fires. Review audit_log action=paper_reconciliation.per_trade_mismatch_detected for full payload.`;

  const body = appendFamilyGradePostscript(
    operatorBody,
    "The bot's recorded trades don't match the broker's numbers on a trade-by-trade basis, " +
    "even though the daily total looked fine. Some individual trades may be wrong in ways that cancel out overall.",
    "Don't panic — no money has been lost yet. " +
    "Tell the operator (Tonio) so he can check the bot's individual trade history vs the broker dashboard."
  );

  notifyCritical(
    `[PAPER RECON] Per-trade drift detected on ${reconDateStr}`,
    body,
    {
      reconDate: reconDateStr,
      strategyCount,
      totalMismatchedTrades,
      strategies: strategyList,
    }
  );
}
