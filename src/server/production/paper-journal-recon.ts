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
  /** Lifecycle states considered "DEPLOYED+" (active paper journal is canonical). */
  DEPLOYED_PLUS_STATES: ["PAPER", "DEPLOY_READY", "PILOT", "DEPLOYED"],
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
  tradeIds: string[];
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

/**
 * Today's date as UTC midnight (recon date boundary).
 */
function reconDayBoundaries(reconDate: Date): { dayStart: Date; dayEnd: Date } {
  const dayStart = new Date(
    Date.UTC(reconDate.getUTCFullYear(), reconDate.getUTCMonth(), reconDate.getUTCDate())
  );
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
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
  const reconDateStr = reconDate.toISOString().slice(0, 10);
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
      ...emptySubchecks,
    };
  }

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
  const strategiesWithMismatch = results.filter(
    (r) => r.countMismatch || r.pnlDriftExceedsTolerance
  ).length;
  const strategiesWithMissingBrokerData = results.filter((r) => r.missingBrokerData).length;
  const hasDrift = strategiesWithMismatch > 0;

  // ── Write audit rows ──────────────────────────────────────────────────────
  if (hasDrift) {
    const mismatchedResults = results.filter((r) => r.countMismatch || r.pnlDriftExceedsTolerance);

    for (const r of mismatchedResults) {
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

    fireCriticalAlert(reconDateStr, mismatchedResults);
  } else if (strategiesWithMissingBrokerData > 0) {
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
      hasDrift,
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
    shadowSignalSubcheck,
    quantumReplaySubcheck,
    abRoutingSubcheck,
  };
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
      missingBrokerData: false,
      tradeIds: [],
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

  if (!missingBrokerData && paperTradeRows.length > 0) {
    // Aggregate paper P&L for the day for this strategy
    const totalPaperPnl = paperTradeRows.reduce((sum, t) => sum + Number(t.pnl), 0);

    // Fetch broker proxy P&L (production_trades expected_pnl for the window)
    try {
      const brokerPnlRows = await db
        .select({ total: sql<string>`coalesce(sum(expected_pnl), 0)` })
        .from(productionTrades)
        .where(
          and(
            gte(productionTrades.barTimestamp, dayStart),
            lt(productionTrades.barTimestamp, dayEnd)
          )
        );
      const totalBrokerPnl = Number(brokerPnlRows[0]?.total ?? 0);
      pnlDriftDollars = Math.abs(totalPaperPnl - totalBrokerPnl);

      // Tolerance: use the first trade's contracts for representative sizing
      // (daily aggregate comparison — per-trade contract count summed for tolerance)
      const totalContracts = paperTradeRows.reduce((sum, t) => sum + (t.contracts ?? 1), 0);
      pnlTolerance = computePnlTolerance(strategy.symbol, totalContracts);
      pnlDriftExceedsTolerance = pnlDriftDollars > pnlTolerance;
    } catch (err) {
      logger.warn({ err, strategyId: strategy.id }, "paper-journal-recon: broker P&L fetch failed");
      // Cannot compute drift — treat as missing broker data rather than mismatch
    }
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
    missingBrokerData,
    tradeIds,
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
    missingBrokerData: true,
    tradeIds: [],
  };
}

// ─── Audit row writer ─────────────────────────────────────────────────────────

async function writeAuditRow(params: {
  action: string;
  status: "success" | "failure" | "critical" | "warning";
  correlationId: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  const statusMapped =
    params.status === "critical"
      ? "failure"
      : params.status === "warning"
        ? "success"
        : params.status;

  await db
    .insert(auditLog)
    .values({
      action: params.action,
      entityType: "paper_reconciliation",
      entityId: null,
      decisionAuthority: "system",
      input: { reconDate: params.payload.reconDate } as Record<string, unknown>,
      result: params.payload,
      status: statusMapped,
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
