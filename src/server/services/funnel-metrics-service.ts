/**
 * Scout Pipeline Funnel Metrics
 *
 * Computes conversion funnel from scouted → tested → promoted → paper → deployed,
 * plus archival/failure counts.  Stores daily snapshots in subsystem_metrics
 * so the dashboard can show funnel trends over time.
 */

import { db } from "../db/index.js";
import { systemJournal, strategies, subsystemMetrics } from "../db/schema.js";
import { sql, gte } from "drizzle-orm";
import { logger } from "../lib/logger.js";

export async function computeFunnelMetrics(since?: Date) {
  const sinceDate = since ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // Default 30 days

  // Stage counts from systemJournal
  const [journalStats] = await db
    .select({
      scouted: sql<number>`count(*) filter (where ${systemJournal.status} = 'scouted')::int`,
      tested: sql<number>`count(*) filter (where ${systemJournal.status} = 'tested')::int`,
      promoted: sql<number>`count(*) filter (where ${systemJournal.status} = 'promoted')::int`,
      archived: sql<number>`count(*) filter (where ${systemJournal.status} = 'archived')::int`,
      failed: sql<number>`count(*) filter (where ${systemJournal.status} = 'failed')::int`,
    })
    .from(systemJournal)
    .where(gte(systemJournal.createdAt, sinceDate));

  // Strategy lifecycle counts
  const [strategyStats] = await db
    .select({
      paper: sql<number>`count(*) filter (where ${strategies.lifecycleState} = 'PAPER')::int`,
      deployReady: sql<number>`count(*) filter (where ${strategies.lifecycleState} = 'DEPLOY_READY')::int`,
      deployed: sql<number>`count(*) filter (where ${strategies.lifecycleState} = 'DEPLOYED')::int`,
    })
    .from(strategies)
    .where(gte(strategies.createdAt, sinceDate));

  const funnel = {
    scouted: journalStats?.scouted ?? 0,
    tested: journalStats?.tested ?? 0,
    promoted: journalStats?.promoted ?? 0,
    paper: strategyStats?.paper ?? 0,
    deployReady: strategyStats?.deployReady ?? 0,
    deployed: strategyStats?.deployed ?? 0,
    archived: journalStats?.archived ?? 0,
    failed: journalStats?.failed ?? 0,
  };

  // Conversion rates
  const conversionRates = {
    scouted_to_tested: funnel.scouted > 0 ? funnel.tested / funnel.scouted : 0,
    tested_to_promoted: funnel.tested > 0 ? funnel.promoted / funnel.tested : 0,
    promoted_to_paper: funnel.promoted > 0 ? funnel.paper / funnel.promoted : 0,
    paper_to_deploy: funnel.paper > 0 ? funnel.deployed / funnel.paper : 0,
    overall: funnel.scouted > 0 ? funnel.deployed / funnel.scouted : 0,
  };

  return { funnel, conversionRates, since: sinceDate.toISOString() };
}

/** Store daily funnel snapshot in subsystem_metrics */
export async function recordFunnelSnapshot(): Promise<void> {
  const result = await computeFunnelMetrics(
    new Date(Date.now() - 24 * 60 * 60 * 1000),
  );
  const now = new Date();

  const metrics = [
    ...Object.entries(result.funnel).map(([key, value]) => ({
      subsystem: "scout_funnel",
      metricName: `count_${key}`,
      metricValue: String(value),
      tags: null,
      measuredAt: now,
    })),
    ...Object.entries(result.conversionRates).map(([key, value]) => ({
      subsystem: "scout_funnel",
      metricName: `rate_${key}`,
      metricValue: String(Math.round(Number(value) * 10000) / 10000),
      tags: null,
      measuredAt: now,
    })),
  ];

  if (metrics.length > 0) {
    await db.insert(subsystemMetrics).values(metrics);
  }
  logger.info({ funnel: result.funnel }, "Scout funnel metrics recorded");
}
