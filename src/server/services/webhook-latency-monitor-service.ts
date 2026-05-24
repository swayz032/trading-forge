/**
 * Webhook Latency Monitor Service — Wave 25 (Gap 4)
 *
 * The Pine→TradingView→TradersPost→broker execution path has no latency
 * visibility. Reddit operators documented 200–500ms slippage on this path
 * (r/TradingView 2026-05-22). This monitor provides:
 *
 *   1. `computeRolling1hLatencyP95()` — reads last 1h of webhook.broker_ack
 *      audit rows and computes p50/p95 percentiles.
 *   2. A cron-callable alarm: if p95 > 2000ms over rolling 1h, fires
 *      audit webhook.latency_high + SSE alert:webhook_latency_high + Discord WARN.
 *
 * Latency instrumentation:
 *   The TradingView webhook payload may include a `firedAt` (or `time`) field
 *   from the alerting source. The tradingview-webhook.ts route writes a
 *   `webhook.broker_ack` audit row with `metadata.latency_ms` on broker ack.
 *
 * NOTE: latency_ms is stored in audit_log.result JSONB as
 *   { fire_to_ack_ms: number, source: 'traderspost' | 'direct' }
 * This avoids schema migration for a monitoring-only feature.
 *
 * Failure posture: fails open — a broken monitor never blocks the pipeline.
 */

import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { auditLog } from "../db/schema.js";
import { logger } from "../lib/logger.js";
import { broadcastSSE } from "../routes/sse.js";
import { notifyWarning } from "./notification-service.js";

// ─── Constants ────────────────────────────────────────────────────────────────
const ROLLING_WINDOW_HOURS = 1;
const P95_ALARM_THRESHOLD_MS = 2000;
const DEDUPE_HOURS = 1; // match cron cadence — one alarm per 15-min window max

// ─── Result types (exported for tests) ───────────────────────────────────────
export interface LatencyPercentiles {
  p50: number | null;
  p95: number | null;
  count: number;
  alarmed: boolean;
}

export interface LatencyMonitorRunResult {
  alarmed: boolean;
  percentiles: LatencyPercentiles;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Compute percentiles from an array of latency values in milliseconds.
 * Returns null for each percentile if the array is empty.
 */
export function computePercentiles(
  values: number[],
): { p50: number | null; p95: number | null } {
  if (values.length === 0) return { p50: null, p95: null };

  const sorted = [...values].sort((a, b) => a - b);

  function percentile(sorted: number[], pct: number): number {
    const idx = Math.ceil(pct * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
  }

  return {
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
  };
}

async function recentAlarmExists(action: string, hours: number): Promise<boolean> {
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
      "webhook-latency-monitor: recentAlarmExists query failed — assuming no recent alarm",
    );
    return false;
  }
}

// ─── Core computation ─────────────────────────────────────────────────────────

/**
 * computeRolling1hLatencyP95
 *
 * Reads the last 1h of webhook.broker_ack audit rows, extracts latency_ms
 * from the result JSONB blob, and computes p50/p95 percentiles.
 */
export async function computeRolling1hLatencyP95(): Promise<LatencyPercentiles> {
  let rawRows: Array<{ result: unknown }> = [];
  try {
    const rows = await db.execute(sql`
      SELECT result
      FROM audit_log
      WHERE action = 'webhook.broker_ack'
        AND created_at > NOW() - (${ROLLING_WINDOW_HOURS}::int * INTERVAL '1 hour')
      ORDER BY created_at DESC
    `);
    rawRows = (rows as unknown) as Array<{ result: unknown }>;
  } catch (err) {
    logger.warn({ err }, "webhook-latency-monitor: audit_log query failed — fail-open");
    return { p50: null, p95: null, count: 0, alarmed: false };
  }

  const latencies: number[] = [];
  for (const row of rawRows) {
    const result = row.result;
    if (result && typeof result === "object") {
      const r = result as Record<string, unknown>;
      const ms = r["fire_to_ack_ms"];
      if (typeof ms === "number" && ms >= 0) {
        latencies.push(ms);
      }
    }
  }

  const { p50, p95 } = computePercentiles(latencies);
  const alarmed =
    p95 !== null && p95 > P95_ALARM_THRESHOLD_MS;

  return {
    p50,
    p95,
    count: latencies.length,
    alarmed,
  };
}

// ─── Monitor run (called by cron every 15 min) ────────────────────────────────

export async function runWebhookLatencyCheck(): Promise<LatencyMonitorRunResult> {
  const percentiles = await computeRolling1hLatencyP95();

  if (!percentiles.alarmed) {
    return { alarmed: false, percentiles };
  }

  // Dedupe: don't double-fire within same 15-min window
  if (await recentAlarmExists("webhook.latency_high", DEDUPE_HOURS)) {
    return { alarmed: false, percentiles };
  }

  const payload = {
    p50Ms: percentiles.p50,
    p95Ms: percentiles.p95,
    sampleCount: percentiles.count,
    thresholdMs: P95_ALARM_THRESHOLD_MS,
    windowHours: ROLLING_WINDOW_HOURS,
    timestamp: new Date().toISOString(),
  };

  await db
    .insert(auditLog)
    .values({
      action: "webhook.latency_high",
      entityType: "system",
      entityId: null,
      input: { windowHours: ROLLING_WINDOW_HOURS, thresholdMs: P95_ALARM_THRESHOLD_MS },
      result: payload as Record<string, unknown>,
      status: "warning",
      decisionAuthority: "system",
    })
    .catch((err) =>
      logger.error({ err }, "webhook.latency_high audit insert failed"),
    );

  notifyWarning(
    "Webhook latency high",
    `Pine→TradingView→TradersPost→broker p95 latency = ${percentiles.p95}ms (threshold: ${P95_ALARM_THRESHOLD_MS}ms) over the last ${ROLLING_WINDOW_HOURS}h. ${percentiles.count} samples. Investigate TradersPost queue depth or broker ack latency.`,
    { job: "webhook-latency-check", ...payload },
  );

  try {
    broadcastSSE("alert:webhook_latency_high", payload);
  } catch (err) {
    logger.warn({ err }, "webhook-latency-monitor: SSE broadcast failed — non-fatal");
  }

  logger.warn(
    { p95Ms: percentiles.p95, p50Ms: percentiles.p50, count: percentiles.count },
    "webhook-latency-monitor: p95 latency threshold exceeded",
  );

  return { alarmed: true, percentiles };
}

// Re-exported for tests
export const __test__ = {
  ROLLING_WINDOW_HOURS,
  P95_ALARM_THRESHOLD_MS,
  DEDUPE_HOURS,
  computePercentiles,
};
