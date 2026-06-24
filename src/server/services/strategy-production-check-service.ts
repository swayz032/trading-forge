/**
 * Pass 7 Task 3 — Strategy production-assertion check.
 *
 * Asserts that ≥1 lifecycle_transitions row to_state='CANDIDATE' exists for
 * today (date_trunc('day', now())). When count==0, fires a CRITICAL alert
 * and writes audit_log("alert.no_strategies_today") with a breakdown of
 * scout backlog and synthesizer/auditor/critic counts so the operator can
 * triage where the pipeline stalled (regex? auditor? compile? critic?).
 *
 * BYPASSES PIPELINE PAUSE: this is a SAFETY signal — silent stalls must
 * surface even when paused. Mirrors C1/C2/C7/C8.
 */

import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { auditLog } from "../db/schema.js";
import { logger } from "../lib/logger.js";
import { getMode as getPipelineMode } from "./pipeline-control-service.js";
import { notifyCritical } from "./notification-service.js";
import { appendFamilyGradePostscript } from "../lib/notification-helpers.js";
import { broadcastSSE } from "../routes/sse.js";

export async function runStrategyProductionCheck(): Promise<{
  count: number;
  alertFired: boolean;
}> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const producedRows = await db.execute(sql`
    SELECT count(*)::int AS n
    FROM lifecycle_transitions
    WHERE to_state = 'CANDIDATE'
      AND created_at >= date_trunc('day', NOW())
  `);
  const count = Number(((producedRows as unknown) as Array<{ n?: number }>)?.[0]?.n ?? 0);

  if (count >= 1) {
    return { count, alertFired: false };
  }

  // Build breakdown for audit row context
  let mode: string = "UNKNOWN";
  try {
    mode = await getPipelineMode();
  } catch (err) {
    logger.warn({ err }, "strategy-production-check: getPipelineMode failed");
  }

  const scoutBacklog: Record<string, number> = {};
  const synthesizerStats: Record<string, number> = {};
  try {
    const backlogRows = await db.execute(sql`
      SELECT status, count(*)::int AS n
      FROM system_journal
      WHERE created_at >= date_trunc('day', NOW())
      GROUP BY status
    `);
    for (const row of (backlogRows as unknown) as Array<{ status?: string; n?: number }>) {
      if (row?.status) scoutBacklog[row.status] = Number(row.n ?? 0);
    }
    const synthRows = await db.execute(sql`
      SELECT action, count(*)::int AS n
      FROM audit_log
      WHERE created_at >= date_trunc('day', NOW())
        AND action IN (
          'scout.audited',
          'scout.rejected_regex',
          'scout.rejected_auditor',
          'scout.synthesizer_refused',
          'scout.rejected_compile',
          'scout.rejected_critic',
          'llm.gpt5mini_call',
          'llm.ollama_fallback'
        )
      GROUP BY action
    `);
    for (const row of (synthRows as unknown) as Array<{ action?: string; n?: number }>) {
      if (row?.action) synthesizerStats[row.action] = Number(row.n ?? 0);
    }
  } catch (err) {
    logger.warn({ err }, "strategy-production-check: breakdown query failed");
  }

  await db
    .insert(auditLog)
    .values({
      action: "alert.no_strategies_today",
      entityType: "lifecycle",
      entityId: null,
      input: { mode, today: today.toISOString() } as Record<string, unknown>,
      result: {
        strategiesProducedToday: count,
        scoutBacklog,
        synthesizerStats,
      } as Record<string, unknown>,
      status: "warning",
      decisionAuthority: "system",
    })
    .catch((err) => logger.error({ err }, "alert.no_strategies_today audit insert failed"));

  notifyCritical(
    "No new strategies today",
    appendFamilyGradePostscript(
      `Pipeline mode: ${mode}. CANDIDATE transitions today: ${count}. Scout backlog (today): ${JSON.stringify(scoutBacklog)}. Synthesizer/critic counts (today): ${JSON.stringify(synthesizerStats)}. Check /scout health tile.`,
      "The bot's production readiness check failed.",
      "No action needed — the bot is protecting you from unsafe trading. Call Tony to review.",
    ),
    { job: "b14-strategy-production-check", mode, scoutBacklog, synthesizerStats },
  );

  // Pass 10 — SSE fire-and-forget so the dashboard ScoutHealthCard tile
  // can react in real time. Wrapped in try/catch so the SSE bus can never
  // block or fail the production check itself.
  try {
    broadcastSSE("scout-health:no-strategies-today", {
      mode,
      strategiesProducedToday: count,
      scoutBacklog,
      synthesizerStats,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.warn({ err }, "scout-health:no-strategies-today SSE broadcast failed — non-fatal");
  }

  return { count, alertFired: true };
}
