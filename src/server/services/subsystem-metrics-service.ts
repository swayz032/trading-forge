import { db } from "../db/index.js";
import { subsystemMetrics, backtests, paperSessions, paperTrades, strategies, systemJournal, deeparForecasts } from "../db/schema.js";
import { eq, sql, gte, and, desc } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const now = () => new Date();

/**
 * Record a single metric data point.
 */
export async function recordMetric(
  subsystem: string,
  metricName: string,
  metricValue: number,
  tags?: Record<string, unknown>,
): Promise<void> {
  await db.insert(subsystemMetrics).values({
    subsystem,
    metricName,
    metricValue: String(metricValue),
    tags: tags ?? null,
    measuredAt: now(),
  });
}

/**
 * Record multiple metrics in a batch.
 */
async function recordBatch(metrics: Array<{ subsystem: string; metricName: string; metricValue: number; tags?: Record<string, unknown> }>): Promise<void> {
  if (metrics.length === 0) return;
  await db.insert(subsystemMetrics).values(
    metrics.map(m => ({
      subsystem: m.subsystem,
      metricName: m.metricName,
      metricValue: String(m.metricValue),
      tags: m.tags ?? null,
      measuredAt: now(),
    })),
  );
}

// ─── Collectors ──────────────────────────────────────────────

async function collectBacktestMetrics(): Promise<void> {
  const since = new Date(Date.now() - 60 * 60 * 1000); // Last hour

  const [stats] = await db.select({
    completed: sql<number>`count(*) filter (where status = 'completed' and created_at >= ${since})::int`,
    failed: sql<number>`count(*) filter (where status = 'failed' and created_at >= ${since})::int`,
    avgExecutionMs: sql<number>`coalesce(avg(execution_time_ms) filter (where status = 'completed' and created_at >= ${since}), 0)::int`,
    totalPending: sql<number>`count(*) filter (where status = 'pending')::int`,
  }).from(backtests);

  await recordBatch([
    { subsystem: "backtest", metricName: "throughput_per_hour", metricValue: stats?.completed ?? 0 },
    { subsystem: "backtest", metricName: "failures_per_hour", metricValue: stats?.failed ?? 0 },
    { subsystem: "backtest", metricName: "avg_execution_ms", metricValue: stats?.avgExecutionMs ?? 0 },
    { subsystem: "backtest", metricName: "pending_count", metricValue: stats?.totalPending ?? 0 },
  ]);
}

async function collectPaperTradingMetrics(): Promise<void> {
  const since = new Date(Date.now() - 60 * 60 * 1000);

  const [stats] = await db.select({
    activeSessions: sql<number>`count(*) filter (where status = 'active')::int`,
  }).from(paperSessions);

  const [tradeStats] = await db.select({
    count: sql<number>`count(*)::int`,
    totalPnl: sql<number>`coalesce(sum(pnl::numeric), 0)::numeric`,
  }).from(paperTrades).where(gte(paperTrades.createdAt, since));

  await recordBatch([
    { subsystem: "paper_trading", metricName: "active_sessions", metricValue: stats?.activeSessions ?? 0 },
    { subsystem: "paper_trading", metricName: "trades_per_hour", metricValue: tradeStats?.count ?? 0 },
    { subsystem: "paper_trading", metricName: "hourly_pnl", metricValue: Number(tradeStats?.totalPnl ?? 0) },
  ]);
}

async function collectStrategyMetrics(): Promise<void> {
  const [stats] = await db.select({
    candidates: sql<number>`count(*) filter (where lifecycle_state = 'CANDIDATE')::int`,
    testing: sql<number>`count(*) filter (where lifecycle_state = 'TESTING')::int`,
    paper: sql<number>`count(*) filter (where lifecycle_state = 'PAPER')::int`,
    deployReady: sql<number>`count(*) filter (where lifecycle_state = 'DEPLOY_READY')::int`,
    deployed: sql<number>`count(*) filter (where lifecycle_state = 'DEPLOYED')::int`,
    declining: sql<number>`count(*) filter (where lifecycle_state = 'DECLINING')::int`,
    total: sql<number>`count(*)::int`,
  }).from(strategies);

  await recordBatch([
    { subsystem: "strategy", metricName: "count_candidate", metricValue: stats?.candidates ?? 0 },
    { subsystem: "strategy", metricName: "count_testing", metricValue: stats?.testing ?? 0 },
    { subsystem: "strategy", metricName: "count_paper", metricValue: stats?.paper ?? 0 },
    { subsystem: "strategy", metricName: "count_deploy_ready", metricValue: stats?.deployReady ?? 0 },
    { subsystem: "strategy", metricName: "count_deployed", metricValue: stats?.deployed ?? 0 },
    { subsystem: "strategy", metricName: "count_declining", metricValue: stats?.declining ?? 0 },
    { subsystem: "strategy", metricName: "count_total", metricValue: stats?.total ?? 0 },
  ]);
}

async function collectScoutMetrics(): Promise<void> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000); // Last 24h

  const [stats] = await db.select({
    scouted: sql<number>`count(*) filter (where status = 'scouted' and created_at >= ${since})::int`,
    tested: sql<number>`count(*) filter (where status = 'tested' and created_at >= ${since})::int`,
    promoted: sql<number>`count(*) filter (where status = 'promoted' and created_at >= ${since})::int`,
  }).from(systemJournal);

  const scoutedCount = stats?.scouted ?? 0;
  const testedCount = stats?.tested ?? 0;
  const promotedCount = stats?.promoted ?? 0;

  await recordBatch([
    { subsystem: "scout", metricName: "scouted_24h", metricValue: scoutedCount },
    { subsystem: "scout", metricName: "tested_24h", metricValue: testedCount },
    { subsystem: "scout", metricName: "promoted_24h", metricValue: promotedCount },
    { subsystem: "scout", metricName: "conversion_rate", metricValue: scoutedCount > 0 ? testedCount / scoutedCount : 0 },
  ]);
}

async function collectDeepARMetrics(): Promise<void> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // Last 30d

  const [stats] = await db.select({
    totalForecasts: sql<number>`count(*)::int`,
    avgHitRate: sql<number>`coalesce(avg(hit_rate::numeric) filter (where hit_rate is not null), 0)::numeric`,
  }).from(deeparForecasts).where(gte(deeparForecasts.generatedAt, since));

  await recordBatch([
    { subsystem: "deepar", metricName: "forecasts_30d", metricValue: stats?.totalForecasts ?? 0 },
    { subsystem: "deepar", metricName: "avg_hit_rate_30d", metricValue: Number(stats?.avgHitRate ?? 0) },
  ]);
}

async function collectSystemHealthMetrics(): Promise<void> {
  const memUsage = process.memoryUsage();
  await recordBatch([
    { subsystem: "system", metricName: "heap_used_mb", metricValue: Math.round(memUsage.heapUsed / 1024 / 1024) },
    { subsystem: "system", metricName: "heap_total_mb", metricValue: Math.round(memUsage.heapTotal / 1024 / 1024) },
    { subsystem: "system", metricName: "rss_mb", metricValue: Math.round(memUsage.rss / 1024 / 1024) },
  ]);
}

/**
 * Run all metric collectors. Called by scheduler every 30 minutes.
 */
export async function collectAllMetrics(): Promise<void> {
  const collectors = [
    { name: "backtest", fn: collectBacktestMetrics },
    { name: "paper_trading", fn: collectPaperTradingMetrics },
    { name: "strategy", fn: collectStrategyMetrics },
    { name: "scout", fn: collectScoutMetrics },
    { name: "deepar", fn: collectDeepARMetrics },
    { name: "system", fn: collectSystemHealthMetrics },
  ];

  for (const collector of collectors) {
    try {
      await collector.fn();
    } catch (err) {
      logger.error({ err, collector: collector.name }, "Metrics collector failed");
    }
  }
}

/**
 * Query metrics for a subsystem.
 */
export async function queryMetrics(subsystem: string, since?: Date, limit = 100) {
  const conditions = [eq(subsystemMetrics.subsystem, subsystem)];
  if (since) conditions.push(gte(subsystemMetrics.measuredAt, since));

  return db.select()
    .from(subsystemMetrics)
    .where(and(...conditions))
    .orderBy(desc(subsystemMetrics.measuredAt))
    .limit(limit);
}

/**
 * Get latest value for each metric across all subsystems (dashboard view).
 */
export async function getDashboardMetrics() {
  const latest = await db.execute(sql`
    SELECT DISTINCT ON (subsystem, metric_name)
      subsystem, metric_name, metric_value, tags, measured_at
    FROM subsystem_metrics
    ORDER BY subsystem, metric_name, measured_at DESC
  `);
  return latest as unknown as Record<string, unknown>[];
}
