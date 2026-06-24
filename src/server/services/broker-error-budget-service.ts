/**
 * Broker Error Budget Service — Wave 25 Gap 8
 *
 * Aggregates `broker_router.route_rejected` and `broker_router.compliance_rejected`
 * events from audit_log over a rolling window and computes per-broker, per-class
 * rejection rates. Alarms when any (broker, rejectionClass) pair exceeds 5% of
 * attempts within the window.
 *
 * PURPOSE: broker-router.ts:180/420 already writes every rejection to audit_log.
 * Nobody aggregated them until now. This service makes spiking rejection classes
 * visible before they cost a payout.
 *
 * Parity note: No paper-layer changes. This is pure aggregation over existing
 * audit_log rows — fully additive, no schema changes, no event emission changes.
 */

import { sql, gte, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { auditLog } from "../db/schema.js";
import { logger } from "../lib/logger.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RejectionClassStats {
  count: number;
  pct: number; // 0–1, fraction of totalAttempts for this broker
}

export interface BrokerBudgetEntry {
  totalAttempts: number;
  totalRejections: number;
  byRejectionClass: Record<string, RejectionClassStats>;
  alarmed: boolean; // true if any class > ALARM_THRESHOLD_PCT
}

export interface BrokerErrorBudgetResult {
  byBroker: Record<string, BrokerBudgetEntry>;
  computedAt: string; // ISO-8601
  windowHours: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Rejection class rate above which we alarm. */
export const ALARM_THRESHOLD_PCT = 0.05; // 5%

/**
 * audit_log actions that represent a routing ATTEMPT (successful or not).
 * broker_router.route_order is written for every attempt (success + failure)
 * by the internal writeAuditLog helper in broker-router.ts.
 */
const ATTEMPT_ACTIONS = [
  "broker_router.route_order",
] as const;

/**
 * audit_log actions that represent a REJECTION.
 * broker_router.route_rejected — kill-switch / pipeline-paused / account gates
 * broker_router.compliance_rejected — compliance gate violation (F-5)
 *
 * Note: broker-router.ts line 180 writes "broker_router.route_rejected" for the
 * kill-switch halt; line 420 writes "broker_router.compliance_rejected" for the
 * compliance gate. Both include broker identity (firmId/brokerType) in the input
 * or result JSONB fields.
 */
const REJECTION_ACTIONS = [
  "broker_router.route_rejected",
  "broker_router.compliance_rejected",
] as const;

// ─── Raw DB row type ──────────────────────────────────────────────────────────

interface AuditRawRow {
  action: string;
  input: unknown;
  result: unknown;
  createdAt: Date;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract broker identity from an audit_log row.
 * broker-router.ts encodes `brokerType` and `firmId` in both `input` and `result`
 * JSONB fields depending on which gate rejected.
 *
 * Priority:
 *   result.brokerType  → most specific (set on successful route + compliance block)
 *   input.brokerType   → set when broker was resolved before the gate
 *   result.firmId      → fallback for compliance rejections
 *   "unknown"          → sentinel when no broker info is available (kill-switch
 *                        fires before account lookup, so firmId/brokerType = absent)
 */
function extractBroker(row: AuditRawRow): string {
  const r = (row.result ?? {}) as Record<string, unknown>;
  const inp = (row.input ?? {}) as Record<string, unknown>;
  return (
    (typeof r.brokerType === "string" ? r.brokerType : null) ??
    (typeof inp.brokerType === "string" ? inp.brokerType : null) ??
    (typeof r.firmId === "string" ? r.firmId : null) ??
    (typeof inp.firmId === "string" ? inp.firmId : null) ??
    "unknown"
  );
}

/**
 * Extract rejection class from a rejection row.
 * Uses `result.reason` first (set by BrokerResult.reason in broker-router.ts),
 * then `result.message` for compliance rejections, then `input.violations[]`.
 */
function extractRejectionClass(row: AuditRawRow): string {
  const r = (row.result ?? {}) as Record<string, unknown>;
  const inp = (row.input ?? {}) as Record<string, unknown>;
  if (typeof r.reason === "string" && r.reason.length > 0) return r.reason;
  if (typeof r.message === "string" && r.message.length > 0) {
    // Trim long compliance messages to a short class key
    return r.message.slice(0, 64);
  }
  if (Array.isArray(inp.violations) && inp.violations.length > 0) {
    return `compliance:${String(inp.violations[0]).slice(0, 48)}`;
  }
  return "unknown_rejection";
}

// ─── Primary computation ──────────────────────────────────────────────────────

/**
 * Compute per-broker error budget over a rolling window.
 *
 * Algorithm:
 *   1. Pull all attempt + rejection rows from audit_log for the window.
 *   2. Group by broker.
 *   3. For each broker, count totalAttempts (from route_order rows) and
 *      break out rejections by class from rejection rows.
 *   4. Compute pct = count / totalAttempts per class.
 *   5. Alarm when pct > ALARM_THRESHOLD_PCT for any class.
 *
 * NOTE: totalAttempts is counted from `broker_router.route_order` rows
 * (written for every call — success or failure). Rejections are counted
 * from `broker_router.route_rejected` and `broker_router.compliance_rejected`.
 * Both sets share the same broker-identity extraction logic.
 */
export async function computeBrokerErrorBudget(
  windowHours = 24,
): Promise<BrokerErrorBudgetResult> {
  const windowStart = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  // Pull all relevant rows in one query
  const allActions = [...ATTEMPT_ACTIONS, ...REJECTION_ACTIONS] as string[];
  const rows = await db
    .select({
      action: auditLog.action,
      input: auditLog.input,
      result: auditLog.result,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .where(
      sql`${auditLog.action} = ANY(${sql.raw(`ARRAY[${allActions.map((a) => `'${a}'`).join(",")}]`)}) AND ${auditLog.createdAt} >= ${windowStart.toISOString()}`,
    );

  // Segregate attempts vs rejections
  const attemptRows = rows.filter((r) => (ATTEMPT_ACTIONS as readonly string[]).includes(r.action));
  const rejectionRows = rows.filter((r) => (REJECTION_ACTIONS as readonly string[]).includes(r.action));

  // Count attempts per broker
  const attemptsByBroker = new Map<string, number>();
  for (const row of attemptRows) {
    const broker = extractBroker(row as AuditRawRow);
    attemptsByBroker.set(broker, (attemptsByBroker.get(broker) ?? 0) + 1);
  }

  // Count rejections per (broker, class)
  const rejectionsByBrokerClass = new Map<string, Map<string, number>>();
  for (const row of rejectionRows) {
    const broker = extractBroker(row as AuditRawRow);
    const cls = extractRejectionClass(row as AuditRawRow);
    if (!rejectionsByBrokerClass.has(broker)) {
      rejectionsByBrokerClass.set(broker, new Map());
    }
    const clsMap = rejectionsByBrokerClass.get(broker)!;
    clsMap.set(cls, (clsMap.get(cls) ?? 0) + 1);
  }

  // Collect all brokers (from either set)
  const allBrokers = new Set([
    ...attemptsByBroker.keys(),
    ...rejectionsByBrokerClass.keys(),
  ]);

  const byBroker: Record<string, BrokerBudgetEntry> = {};

  for (const broker of allBrokers) {
    const totalAttempts = attemptsByBroker.get(broker) ?? 0;
    const clsMap = rejectionsByBrokerClass.get(broker) ?? new Map<string, number>();

    const byRejectionClass: Record<string, RejectionClassStats> = {};
    let totalRejections = 0;
    let alarmed = false;

    for (const [cls, count] of clsMap) {
      totalRejections += count;
      const pct = totalAttempts > 0 ? count / totalAttempts : 0;
      if (pct > ALARM_THRESHOLD_PCT) alarmed = true;
      byRejectionClass[cls] = { count, pct };
    }

    // Edge case: rejections with no attempt rows (data gap or broker unknown sentinel)
    // Still surface them with pct=1 so they alarm by default.
    if (totalAttempts === 0 && totalRejections > 0) {
      alarmed = true;
      for (const cls of Object.keys(byRejectionClass)) {
        byRejectionClass[cls] = {
          count: byRejectionClass[cls].count,
          pct: 1,
        };
      }
    }

    byBroker[broker] = {
      totalAttempts,
      totalRejections,
      byRejectionClass,
      alarmed,
    };
  }

  return {
    byBroker,
    computedAt: new Date().toISOString(),
    windowHours,
  };
}

/**
 * Returns only brokers where `alarmed === true`.
 */
export async function computeAlarmedBrokers(
  windowHours = 24,
): Promise<BrokerErrorBudgetResult> {
  const full = await computeBrokerErrorBudget(windowHours);
  const alarmedOnly: Record<string, BrokerBudgetEntry> = {};
  for (const [broker, entry] of Object.entries(full.byBroker)) {
    if (entry.alarmed) alarmedOnly[broker] = entry;
  }
  return { ...full, byBroker: alarmedOnly };
}

/**
 * Run the hourly budget check: log, audit, SSE, Discord for any alarmed broker.
 * Called from scheduler.ts every hour during RTH.
 */
export async function runBrokerErrorBudgetCheck(): Promise<void> {
  const result = await computeBrokerErrorBudget(24);
  const alarmedBrokers = Object.entries(result.byBroker).filter(
    ([, entry]) => entry.alarmed,
  );

  if (alarmedBrokers.length === 0) {
    logger.debug({ computedAt: result.computedAt }, "broker-error-budget-check: no alarms");
    return;
  }

  for (const [broker, entry] of alarmedBrokers) {
    const topClass = Object.entries(entry.byRejectionClass)
      .filter(([, s]) => s.pct > ALARM_THRESHOLD_PCT)
      .sort(([, a], [, b]) => b.pct - a.pct)[0];

    const className = topClass?.[0] ?? "unknown";
    const classPct = Math.round((topClass?.[1].pct ?? 0) * 100);
    const classCount = topClass?.[1].count ?? 0;

    logger.warn(
      {
        broker,
        rejectionClass: className,
        pct: classPct,
        count: classCount,
        totalAttempts: entry.totalAttempts,
      },
      "broker-error-budget: ALARM — rejection class exceeds 5% threshold",
    );

    // Audit the breach
    try {
      const { insertAuditRowSafe } = await import("../lib/audit-log-helper.js");
      await insertAuditRowSafe({
        action: "broker.error_budget_breach",
        entityType: "broker_account",
        entityId: null,
        decisionAuthority: "scheduler",
        input: { broker, windowHours: 24 } as Record<string, unknown>,
        result: {
          broker,
          rejectionClass: className,
          pct: classPct,
          count: classCount,
          totalAttempts: entry.totalAttempts,
          byRejectionClass: entry.byRejectionClass,
        } as Record<string, unknown>,
        status: "failure",
        correlationId: null,
      });
    } catch (err) {
      logger.warn({ err }, "broker-error-budget: audit write failed (non-blocking)");
    }

    // SSE alert
    try {
      const { broadcastSSE } = await import("../routes/sse.js");
      broadcastSSE("alert:broker_error_budget", {
        broker,
        rejectionClass: className,
        pct: classPct,
        count: classCount,
        totalAttempts: entry.totalAttempts,
        computedAt: result.computedAt,
      });
    } catch (err) {
      logger.warn({ err }, "broker-error-budget: SSE broadcast failed (non-blocking)");
    }

    // Discord WARN (batched by notification-service)
    try {
      const { notifyWarning } = await import("./notification-service.js");
      const { appendFamilyGradePostscript } = await import("../lib/notification-helpers.js");
      notifyWarning(
        `Broker ${broker} error budget breach`,
        appendFamilyGradePostscript(
          `Broker **${broker}** has **${classPct}%** ${className}-class rejections over the last 24h (${classCount}/${entry.totalAttempts} attempts). Threshold: 5%.`,
          "The bot has encountered too many broker errors recently.",
          "No action needed — the bot is monitoring itself. Call Tony if trading stops.",
        ),
        {
          broker,
          rejectionClass: className,
          pct: classPct,
          count: classCount,
          totalAttempts: entry.totalAttempts,
        },
      );
    } catch (err) {
      logger.warn({ err }, "broker-error-budget: Discord notify failed (non-blocking)");
    }
  }
}
