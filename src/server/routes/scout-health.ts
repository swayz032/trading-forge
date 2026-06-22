/**
 * GET /api/scout/health
 *
 * Compact operational snapshot for the dashboard ScoutHealthCard tile.
 * Read-only — joins lifecycle_transitions / system_journal / audit_log /
 * strategies / system_parameters and returns a flat KPI payload.
 *
 * NOT pipeline-pause-gated: this endpoint is a SAFETY surface (operator
 * watches it precisely WHEN the pipeline is paused or has stalled). Same
 * rationale as /api/validation-cadence/dashboard.
 */

import { Router } from "express";
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { getMode } from "../services/pipeline-control-service.js";

export const scoutHealthRoutes = Router();

scoutHealthRoutes.get("/health", async (req, res) => {
  try {
    // ─── lastStrategyCreatedAt ──────────────────────────────────────
    const lastStrategyRows = await db.execute(sql`
      SELECT MAX(created_at) AS last_at
      FROM strategies
      WHERE lifecycle_state IN ('CANDIDATE','TESTING','PAPER','DEPLOY_READY','PILOT','DEPLOYED')
    `);
    const lastStrategyCreatedAt =
      (lastStrategyRows as any)?.[0]?.last_at ?? null;

    // ─── strategiesProducedToday (CANDIDATE transitions today) ──────
    const producedRows = await db.execute(sql`
      SELECT count(*)::int AS n
      FROM lifecycle_transitions
      WHERE to_state = 'CANDIDATE'
        AND created_at >= date_trunc('day', NOW())
    `);
    const strategiesProducedToday = Number(
      (producedRows as any)?.[0]?.n ?? 0,
    );

    // ─── scoutsBySourceLast7d ────────────────────────────────────────
    const sourceRows = await db.execute(sql`
      SELECT source, count(*)::int AS n
      FROM system_journal
      WHERE status = 'scouted'
        AND created_at > NOW() - INTERVAL '7 days'
      GROUP BY source
      ORDER BY n DESC
    `);
    const scoutsBySourceLast7d: Record<string, number> = {};
    for (const row of sourceRows as any[]) {
      if (row?.source) scoutsBySourceLast7d[row.source] = Number(row.n ?? 0);
    }

    // ─── synthesizerHealth (audit_log today) ─────────────────────────
    const synthRows = await db.execute(sql`
      SELECT action, count(*)::int AS n
      FROM audit_log
      WHERE created_at >= date_trunc('day', NOW())
        AND action IN (
          'scout.audited',
          'scout.rejected_auditor',
          'scout.rejected_compile',
          'scout.rejected_critic',
          'llm.gpt5mini_call',
          'llm.ollama_fallback'
        )
      GROUP BY action
    `);
    const synthCounts: Record<string, number> = {};
    for (const row of synthRows as any[]) {
      if (row?.action) synthCounts[row.action] = Number(row.n ?? 0);
    }
    const synthesizerHealth = {
      gpt5mini_calls_today: synthCounts["llm.gpt5mini_call"] ?? 0,
      ollama_fallback_calls_today: synthCounts["llm.ollama_fallback"] ?? 0,
      rejected_compile_today: synthCounts["scout.rejected_compile"] ?? 0,
      rejected_critic_today: synthCounts["scout.rejected_critic"] ?? 0,
    };

    // ─── auditorRejectsLast24h ───────────────────────────────────────
    const auditorRows = await db.execute(sql`
      SELECT count(*)::int AS n
      FROM audit_log
      WHERE action = 'scout.rejected_auditor'
        AND created_at > NOW() - INTERVAL '24 hours'
    `);
    const auditorRejectsLast24h = Number(
      (auditorRows as any)?.[0]?.n ?? 0,
    );

    // ─── pipelineMode ────────────────────────────────────────────────
    let pipelineMode: string = "ACTIVE";
    try {
      pipelineMode = await getMode();
    } catch (err) {
      req.log?.warn?.({ err }, "scout-health: getMode() failed, defaulting ACTIVE");
    }

    // ─── recentAlerts (Pass 10) ─────────────────────────────────────
    // Last-24h roll-up of scout-health audit rows fired by the watchdog
    // service. The dashboard ScoutHealthCard renders a small badge when
    // any alert is present so the operator can see recent stalls/skews
    // without leaving the home page.
    const recentAlertActions = [
      "alert.drain_stall",
      "alert.reject_distribution_skewed",
      "alert.no_strategies_today",
    ];
    let recentAlerts: Array<{
      action: string;
      createdAt: string;
      result: unknown;
    }> = [];
    try {
      const alertRows = await db.execute(sql`
        SELECT action, result, created_at
        FROM audit_log
        WHERE (
            action IN (
              'alert.drain_stall',
              'alert.reject_distribution_skewed',
              'alert.no_strategies_today'
            )
            OR action LIKE 'alert.reject_spike:%'
          )
          AND created_at > NOW() - INTERVAL '24 hours'
        ORDER BY created_at DESC
        LIMIT 20
      `);
      recentAlerts = (alertRows as any[]).map((r) => ({
        action: String(r.action),
        createdAt:
          r.created_at instanceof Date
            ? r.created_at.toISOString()
            : String(r.created_at),
        result: r.result,
      }));
    } catch (err) {
      req.log?.warn?.({ err }, "scout-health: recent-alerts query failed");
    }
    void recentAlertActions; // referenced for documentation; query enumerates actions inline

    res.json({
      lastStrategyCreatedAt,
      strategiesProducedToday,
      scoutsBySourceLast7d,
      synthesizerHealth,
      auditorRejectsLast24h,
      pipelineMode,
      recentAlerts,
    });
  } catch (err) {
    req.log?.error?.({ err }, "scout-health: query failed");
    res.status(500).json({ error: "scout_health_query_failed" });
  }
});
