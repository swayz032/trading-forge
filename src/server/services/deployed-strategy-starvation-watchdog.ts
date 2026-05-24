/**
 * Deployed Strategy Signal Starvation Watchdog — Wave 25 (Gap 3)
 *
 * Execution-side mirror of scout-watchdog-service.ts. The scout watchdog
 * monitors FACTORY output (are candidates being produced?). This service
 * monitors EXECUTION output (are deployed strategies actually firing?).
 *
 * Wave 25 W25.1 weighted scoring is designed to drop A+ rate 30–50%. If
 * threshold over-tightens, deployed strategies can fire ZERO signals for
 * days with nothing alerting. This watchdog surfaces that condition before
 * it causes invisible zero-trade days.
 *
 * Two alarm levels:
 *   WARN    — zero entries (paper.trade_open) for 5 RTH days AND non-zero
 *             signal evaluations (signal.a_plus_factor_evaluated). The A+ gate
 *             is triggering but nothing is passing — score threshold too tight.
 *   CRITICAL — zero signal evaluations (signal.a_plus_factor_evaluated) for
 *              5 RTH days. The feature pipeline itself is broken upstream.
 *
 * Failure posture:
 *   Fails OPEN on DB error — logs a warning and returns without firing an
 *   alert. A broken watchdog must never block the pipeline.
 *
 * SSE channel:
 *   Every fired alert broadcasts an `alert:signal_starvation_warn` or
 *   `alert:signal_starvation_critical` event with the same diagnostic payload
 *   persisted to audit_log, so the dashboard SignalStarvationCard can react
 *   in real time.
 */

import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { auditLog } from "../db/schema.js";
import { logger } from "../lib/logger.js";
import { broadcastSSE } from "../routes/sse.js";
import { notifyCritical, notifyWarning } from "./notification-service.js";

// ─── Constants ────────────────────────────────────────────────────────────────
// 5 RTH days ≈ 5 calendar days of M-F trading hours.
// We approximate by looking back 7 calendar days to cover weekends + 5 RTH days.
const LOOKBACK_CALENDAR_DAYS = 7;
const DEDUPE_HOURS = 4; // suppress repeat alerts within one cron cycle

// ─── Result types (exported for tests) ───────────────────────────────────────
export interface StarvationCheckResult {
  strategyId: string;
  strategyName: string;
  lifecycleState: string;
  entryCount: number;
  signalEvalCount: number;
  warnFired: boolean;
  criticalFired: boolean;
}

export interface StarvationRunResult {
  strategiesChecked: number;
  results: StarvationCheckResult[];
  anyAlertFired: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function recentAlertExists(action: string, hours: number): Promise<boolean> {
  try {
    const rows = await db.execute(sql`
      SELECT 1
      FROM audit_log
      WHERE action = ${action}
        AND created_at > NOW() - (${hours}::int * INTERVAL '1 hour')
      LIMIT 1
    `);
    return ((rows as unknown) as Array<unknown>).length > 0;
  } catch (err) {
    logger.warn(
      { err, action },
      "starvation-watchdog: recentAlertExists query failed — assuming no recent alert",
    );
    return false;
  }
}

async function recentStrategyAlertExists(
  action: string,
  strategyId: string,
  hours: number,
): Promise<boolean> {
  try {
    const rows = await db.execute(sql`
      SELECT 1
      FROM audit_log
      WHERE action = ${action}
        AND entity_id = ${strategyId}::uuid
        AND created_at > NOW() - (${hours}::int * INTERVAL '1 hour')
      LIMIT 1
    `);
    return ((rows as unknown) as Array<unknown>).length > 0;
  } catch (err) {
    logger.warn(
      { err, action, strategyId },
      "starvation-watchdog: recentStrategyAlertExists query failed — assuming no recent alert",
    );
    return false;
  }
}

async function broadcastFireAndForget(
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    broadcastSSE(event, payload);
  } catch (err) {
    logger.warn({ err, event }, "starvation-watchdog: SSE broadcast failed — non-fatal");
  }
}

// ─── Main check ───────────────────────────────────────────────────────────────

/**
 * runDeployedStrategyStarvationCheck
 *
 * Queries all PILOT and DEPLOYED strategies, checks their audit_log activity
 * over the rolling lookback window, and fires alerts for strategies that show
 * signal starvation patterns.
 */
export async function runDeployedStrategyStarvationCheck(): Promise<StarvationRunResult> {
  // Fetch all PILOT + DEPLOYED strategies
  let deployedStrategies: Array<{ id: string; name: string; lifecycleState: string }> = [];
  try {
    const rows = await db.execute(sql`
      SELECT id::text, name, lifecycle_state
      FROM strategies
      WHERE lifecycle_state IN ('PILOT', 'DEPLOYED')
      ORDER BY created_at ASC
    `);
    deployedStrategies = ((rows as unknown) as Array<{
      id: string;
      name: string;
      lifecycle_state: string;
    }>).map((r) => ({
      id: r.id,
      name: r.name,
      lifecycleState: r.lifecycle_state,
    }));
  } catch (err) {
    logger.warn({ err }, "starvation-watchdog: deployed-strategies query failed — fail-open");
    return { strategiesChecked: 0, results: [], anyAlertFired: false };
  }

  if (deployedStrategies.length === 0) {
    // No deployed strategies — nothing to check. Normal during early pipeline stages.
    logger.debug("starvation-watchdog: no PILOT/DEPLOYED strategies — no-op");
    return { strategiesChecked: 0, results: [], anyAlertFired: false };
  }

  const results: StarvationCheckResult[] = [];
  let anyAlertFired = false;

  for (const strategy of deployedStrategies) {
    const result = await checkStrategy(strategy);
    results.push(result);
    if (result.warnFired || result.criticalFired) anyAlertFired = true;
  }

  return {
    strategiesChecked: deployedStrategies.length,
    results,
    anyAlertFired,
  };
}

async function checkStrategy(strategy: {
  id: string;
  name: string;
  lifecycleState: string;
}): Promise<StarvationCheckResult> {
  const { id: strategyId, name: strategyName, lifecycleState } = strategy;

  // Count paper trade entries (opened positions) in lookback window
  let entryCount = 0;
  try {
    const rows = await db.execute(sql`
      SELECT count(*)::int AS n
      FROM audit_log
      WHERE entity_id = ${strategyId}::uuid
        AND action = 'paper.trade_open'
        AND created_at > NOW() - (${LOOKBACK_CALENDAR_DAYS}::int * INTERVAL '1 day')
    `);
    entryCount = Number(((rows as unknown) as Array<{ n?: number }>)?.[0]?.n ?? 0);
  } catch (err) {
    logger.warn(
      { err, strategyId },
      "starvation-watchdog: entry-count query failed — fail-open",
    );
    return {
      strategyId,
      strategyName,
      lifecycleState,
      entryCount: 0,
      signalEvalCount: 0,
      warnFired: false,
      criticalFired: false,
    };
  }

  // Count A+ signal evaluations in lookback window
  let signalEvalCount = 0;
  try {
    const rows = await db.execute(sql`
      SELECT count(*)::int AS n
      FROM audit_log
      WHERE entity_id = ${strategyId}::uuid
        AND action = 'signal.a_plus_factor_evaluated'
        AND created_at > NOW() - (${LOOKBACK_CALENDAR_DAYS}::int * INTERVAL '1 day')
    `);
    signalEvalCount = Number(((rows as unknown) as Array<{ n?: number }>)?.[0]?.n ?? 0);
  } catch (err) {
    logger.warn(
      { err, strategyId },
      "starvation-watchdog: signal-eval-count query failed — fail-open",
    );
    return {
      strategyId,
      strategyName,
      lifecycleState,
      entryCount,
      signalEvalCount: 0,
      warnFired: false,
      criticalFired: false,
    };
  }

  let warnFired = false;
  let criticalFired = false;

  // CRITICAL: zero signal evaluations — feature pipeline broken upstream
  if (signalEvalCount === 0) {
    const dedupeAction = `signal.starvation_critical`;
    const alreadyFired = await recentStrategyAlertExists(dedupeAction, strategyId, DEDUPE_HOURS);
    if (!alreadyFired) {
      const payload = {
        strategyId,
        strategyName,
        lifecycleState,
        entryCount,
        signalEvalCount,
        lookbackDays: LOOKBACK_CALENDAR_DAYS,
        alarmLevel: "CRITICAL",
        timestamp: new Date().toISOString(),
      };

      await db
        .insert(auditLog)
        .values({
          action: dedupeAction,
          entityType: "strategy",
          entityId: strategyId,
          input: { lookbackDays: LOOKBACK_CALENDAR_DAYS },
          result: payload as Record<string, unknown>,
          status: "warning",
          decisionAuthority: "system",
        })
        .catch((err) =>
          logger.error({ err, strategyId }, "signal.starvation_critical audit insert failed"),
        );

      notifyCritical(
        `Signal pipeline broken on strategy ${strategyName}`,
        `Strategy ${strategyName} (${lifecycleState}) has had ZERO A+ signal evaluations in the last ${LOOKBACK_CALENDAR_DAYS} calendar days. Feature pipeline may be broken — paper session may not be running or signal service not wired to this strategy.`,
        { job: "deployed-strategy-starvation-check", ...payload },
      );

      await broadcastFireAndForget("alert:signal_starvation_critical", payload);

      logger.warn(
        { strategyId, strategyName, lifecycleState, signalEvalCount, entryCount },
        "starvation-watchdog: CRITICAL — zero signal evaluations in lookback window",
      );

      criticalFired = true;
    }
  } else if (entryCount === 0) {
    // WARN: signal evals exist but zero entries — A+ threshold too tight
    const dedupeAction = `signal.starvation_warning`;
    const alreadyFired = await recentStrategyAlertExists(dedupeAction, strategyId, DEDUPE_HOURS);
    if (!alreadyFired) {
      const payload = {
        strategyId,
        strategyName,
        lifecycleState,
        entryCount,
        signalEvalCount,
        lookbackDays: LOOKBACK_CALENDAR_DAYS,
        alarmLevel: "WARN",
        implication: "W25.1 score threshold may be too tight — signals evaluated but none passing entry filter",
        timestamp: new Date().toISOString(),
      };

      await db
        .insert(auditLog)
        .values({
          action: dedupeAction,
          entityType: "strategy",
          entityId: strategyId,
          input: { lookbackDays: LOOKBACK_CALENDAR_DAYS },
          result: payload as Record<string, unknown>,
          status: "warning",
          decisionAuthority: "system",
        })
        .catch((err) =>
          logger.error({ err, strategyId }, "signal.starvation_warning audit insert failed"),
        );

      notifyWarning(
        `Signal starvation warning on strategy ${strategyName}`,
        `Strategy ${strategyName} (${lifecycleState}) has ${signalEvalCount} signal evaluations but ZERO entries in the last ${LOOKBACK_CALENDAR_DAYS} days. W25.1 score threshold may be too tight.`,
        { job: "deployed-strategy-starvation-check", ...payload },
      );

      await broadcastFireAndForget("alert:signal_starvation_warn", payload);

      logger.warn(
        { strategyId, strategyName, lifecycleState, signalEvalCount, entryCount },
        "starvation-watchdog: WARN — zero entries despite signal evaluations in lookback window",
      );

      warnFired = true;
    }
  }

  return {
    strategyId,
    strategyName,
    lifecycleState,
    entryCount,
    signalEvalCount,
    warnFired,
    criticalFired,
  };
}

// ─── Status query (for API route) ────────────────────────────────────────────

export interface StarvationStatus {
  checkedAt: string;
  deployedStrategyCount: number;
  strategies: Array<{
    id: string;
    name: string;
    lifecycleState: string;
    entryCount: number;
    signalEvalCount: number;
    alarmLevel: "NONE" | "WARN" | "CRITICAL";
    lastWarnAt: string | null;
    lastCriticalAt: string | null;
  }>;
}

export async function getStarvationStatus(): Promise<StarvationStatus> {
  const deployedRows = await db.execute(sql`
    SELECT id::text, name, lifecycle_state
    FROM strategies
    WHERE lifecycle_state IN ('PILOT', 'DEPLOYED')
    ORDER BY created_at ASC
  `);

  const strategies = (deployedRows as unknown) as Array<{
    id: string;
    name: string;
    lifecycle_state: string;
  }>;

  const statusItems = await Promise.all(
    strategies.map(async (s) => {
      const [entryRow, evalRow, lastWarnRow, lastCritRow] = await Promise.all([
        db.execute(sql`
          SELECT count(*)::int AS n FROM audit_log
          WHERE entity_id = ${s.id}::uuid AND action = 'paper.trade_open'
            AND created_at > NOW() - (${LOOKBACK_CALENDAR_DAYS}::int * INTERVAL '1 day')
        `),
        db.execute(sql`
          SELECT count(*)::int AS n FROM audit_log
          WHERE entity_id = ${s.id}::uuid AND action = 'signal.a_plus_factor_evaluated'
            AND created_at > NOW() - (${LOOKBACK_CALENDAR_DAYS}::int * INTERVAL '1 day')
        `),
        db.execute(sql`
          SELECT MAX(created_at) AS t FROM audit_log
          WHERE entity_id = ${s.id}::uuid AND action = 'signal.starvation_warning'
        `),
        db.execute(sql`
          SELECT MAX(created_at) AS t FROM audit_log
          WHERE entity_id = ${s.id}::uuid AND action = 'signal.starvation_critical'
        `),
      ]);

      const entryCount = Number(((entryRow as unknown) as Array<{ n?: number }>)?.[0]?.n ?? 0);
      const signalEvalCount = Number(((evalRow as unknown) as Array<{ n?: number }>)?.[0]?.n ?? 0);
      const lastWarnAt = ((lastWarnRow as unknown) as Array<{ t?: unknown }>)?.[0]?.t;
      const lastCritAt = ((lastCritRow as unknown) as Array<{ t?: unknown }>)?.[0]?.t;

      let alarmLevel: "NONE" | "WARN" | "CRITICAL" = "NONE";
      if (signalEvalCount === 0) alarmLevel = "CRITICAL";
      else if (entryCount === 0) alarmLevel = "WARN";

      return {
        id: s.id,
        name: s.name,
        lifecycleState: s.lifecycle_state,
        entryCount,
        signalEvalCount,
        alarmLevel,
        lastWarnAt: lastWarnAt instanceof Date
          ? lastWarnAt.toISOString()
          : typeof lastWarnAt === "string" ? lastWarnAt : null,
        lastCriticalAt: lastCritAt instanceof Date
          ? lastCritAt.toISOString()
          : typeof lastCritAt === "string" ? lastCritAt : null,
      };
    }),
  );

  return {
    checkedAt: new Date().toISOString(),
    deployedStrategyCount: strategies.length,
    strategies: statusItems,
  };
}

// Re-exported for tests
export const __test__ = {
  LOOKBACK_CALENDAR_DAYS,
  DEDUPE_HOURS,
};
