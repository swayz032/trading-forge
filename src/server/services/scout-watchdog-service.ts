/**
 * Scout Watchdog Service — Pass 10 (Scout Observability Hardening)
 *
 * Three monitors that surface scout-pipeline misbehavior automatically.
 * All three are registered as standalone crons in `scheduler.ts` and all
 * three BYPASS the pipeline pause gate — silent stalls during pause must
 * surface, mirroring C1/C2/C7/C8 safety crons and Pass 7's
 * b14-strategy-production-check.
 *
 * Monitor 1 — runDrainStallCheck (every 30 min)
 *   Appends a fresh row to scout_drain_samples each tick (and prunes >7 day
 *   rows), then compares the current scouted backlog with the watchdog's own
 *   sample from ~2h ago. Fires alert when the backlog has NOT decreased over
 *   that window despite the drain cron running every 10 min — but only when:
 *     - Pipeline is ACTIVE (skip when PAUSED — backlog growth is expected
 *       per the n8n-never-pauses contract).
 *     - Current backlog count is > 5 (don't alert on tiny in-flight numbers).
 *   Suppresses repeat alerts within a 2h window.
 *
 * Monitor 2 — runRejectDistributionCheck (every hour)
 *   Aggregates the last 24h of `scout.rejected_*` audit_log actions and
 *   alerts when total > 10 AND any single category accounts for > 80% of
 *   total. The alert message names the dominant reject and what it implies
 *   so the operator can triage without re-querying audit_log.
 *
 * Monitor 3 — runRejectSpikeCheck (every 5 min)
 *   Early-detection sibling to Monitor 2. Alerts when ≥10 rejects of any
 *   single type fire in the last 5 minutes — fast enough to catch a wedged
 *   auditor or a placeholder-flood scout source before the hourly rollup.
 *
 * Failure posture:
 *   All three watchdogs FAIL OPEN on DB error — they log a warning and
 *   return without firing an alert. A broken watchdog must never block
 *   the pipeline from drawing operator attention to an unrelated issue.
 *
 * SSE channel: every fired alert also broadcasts a `scout-health:*` event
 * with the same diagnostic payload that's persisted to audit_log, so the
 * dashboard ScoutHealthCard tile can react in real time instead of waiting
 * for its 30s React Query poll.
 */

import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { auditLog, scoutDrainSamples } from "../db/schema.js";
import { logger } from "../lib/logger.js";
import { broadcastSSE } from "../routes/sse.js";
import { getMode as getPipelineMode } from "./pipeline-control-service.js";
import { notifyCritical } from "./notification-service.js";
import { appendFamilyGradePostscript } from "../lib/notification-helpers.js";

// ─── Constants ───────────────────────────────────────────────────────
const DRAIN_STALL_LOOKBACK_HOURS = 2;
const DRAIN_STALL_MIN_BACKLOG = 5;
const DRAIN_STALL_DEDUPE_HOURS = 2;            // suppress repeat alerts within this window
const DRAIN_SAMPLE_RETENTION_DAYS = 7;

const REJECT_DIST_LOOKBACK_HOURS = 24;
const REJECT_DIST_MIN_TOTAL = 10;
const REJECT_DIST_DOMINANCE_PCT = 0.80;
const REJECT_DIST_DEDUPE_HOURS = 6;            // hourly cron — dedupe a bit longer than the cadence

const REJECT_SPIKE_LOOKBACK_MINUTES = 5;
const REJECT_SPIKE_THRESHOLD = 10;
const REJECT_SPIKE_DEDUPE_MINUTES = 5;         // only fire once per 5-min bucket per type

const REJECT_ACTIONS = [
  "scout.rejected_regex",
  "scout.rejected_auditor",
  "scout.synthesizer_refused",
  "scout.rejected_compile",
  "scout.rejected_critic",
] as const;

type RejectAction = (typeof REJECT_ACTIONS)[number];

// ─── Result types (exported for tests) ───────────────────────────────
export interface DrainStallResult {
  alertFired: boolean;
  reason?: string;
  scoutedNow: number;
  scoutedThen: number | null;
  pipelineMode: string;
}

export interface RejectDistributionResult {
  alertFired: boolean;
  total: number;
  distribution: Record<string, number>;
  dominantCategory?: string;
  dominantPct?: number;
}

export interface RejectSpikeResult {
  alertFired: boolean;
  spikedActions: Array<{ action: string; count: number }>;
}

// ─── Reject reason → operator-facing implication mapping ────────────
function implicationFor(action: string): string {
  switch (action) {
    case "scout.rejected_regex":
      return "scout sources are sending too much placeholder garbage; check 5J's shape node or the Tier-1 patterns";
    case "scout.rejected_auditor":
      return "LLM bouncer too strict, OR scouts genuinely sending too much noise; review prompt";
    case "scout.synthesizer_refused":
      return "synthesizer prompt rejecting valid candidates; review scout-auditor prompt or schema KB drift";
    case "scout.rejected_compile":
      return "strategy_proposer hallucinating malformed DSLs; review prompt or schema KB drift";
    case "scout.rejected_critic":
      return "synthesis quality low; review proposer prompt or KB anti-pattern catalog";
    default:
      return "review audit_log for context";
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────
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
    logger.warn({ err, action }, "scout-watchdog: recentAlertExists query failed — assuming no recent alert");
    return false;
  }
}

async function recentAlertExistsMinutes(action: string, minutes: number): Promise<boolean> {
  try {
    const rows = await db.execute(sql`
      SELECT 1
      FROM audit_log
      WHERE action = ${action}
        AND created_at > NOW() - (${minutes}::int * INTERVAL '1 minute')
      LIMIT 1
    `);
    return ((rows as unknown) as Array<unknown>).length > 0;
  } catch (err) {
    logger.warn({ err, action }, "scout-watchdog: recentAlertExistsMinutes query failed — assuming no recent alert");
    return false;
  }
}

async function broadcastFireAndForget(event: string, payload: Record<string, unknown>): Promise<void> {
  try {
    broadcastSSE(event, payload);
  } catch (err) {
    logger.warn({ err, event }, "scout-watchdog: SSE broadcast failed — non-fatal");
  }
}

// ─── Monitor 1: drain-rate watchdog ──────────────────────────────────
export async function runDrainStallCheck(): Promise<DrainStallResult> {
  let pipelineMode = "UNKNOWN";
  try {
    pipelineMode = await getPipelineMode();
  } catch (err) {
    logger.warn({ err }, "scout-watchdog/drain-stall: getPipelineMode failed — proceeding as UNKNOWN");
  }

  // Always sample + prune so the table has data the moment ACTIVE resumes.
  let scoutedNow = 0;
  try {
    const rows = await db.execute(sql`
      SELECT count(*)::int AS n
      FROM system_journal
      WHERE status = 'scouted'
        AND COALESCE(strategy_params->>'signal_type', 'strategy_candidate') = 'strategy_candidate'
    `);
    scoutedNow = Number(((rows as unknown) as Array<{ n?: number }>)?.[0]?.n ?? 0);
  } catch (err) {
    logger.warn({ err }, "scout-watchdog/drain-stall: scouted-count query failed — fail-open");
    return { alertFired: false, scoutedNow: 0, scoutedThen: null, pipelineMode };
  }

  // Append sample (best-effort) + prune (best-effort). Never let either
  // failure block the watchdog logic.
  try {
    await db.insert(scoutDrainSamples).values({
      scoutedCount: scoutedNow,
      pipelineMode,
    });
  } catch (err) {
    logger.warn({ err }, "scout-watchdog/drain-stall: sample insert failed — non-fatal");
  }
  try {
    await db.execute(sql`
      DELETE FROM scout_drain_samples
      WHERE sampled_at < NOW() - (${DRAIN_SAMPLE_RETENTION_DAYS}::int * INTERVAL '1 day')
    `);
  } catch (err) {
    logger.warn({ err }, "scout-watchdog/drain-stall: prune failed — non-fatal");
  }

  // Skip alert path when pipeline isn't ACTIVE — backlog growth during pause
  // is expected and intentional (see CLAUDE.md "n8n NEVER pauses").
  if (pipelineMode !== "ACTIVE") {
    return { alertFired: false, scoutedNow, scoutedThen: null, pipelineMode };
  }

  if (scoutedNow <= DRAIN_STALL_MIN_BACKLOG) {
    return { alertFired: false, scoutedNow, scoutedThen: null, pipelineMode };
  }

  // Fetch a sample from ~2h ago. Use the closest-to-2h sample so a slightly
  // delayed cron run doesn't miss the comparison.
  let scoutedThen: number | null = null;
  try {
    const rows = await db.execute(sql`
      SELECT scouted_count
      FROM scout_drain_samples
      WHERE sampled_at <= NOW() - (${DRAIN_STALL_LOOKBACK_HOURS}::int * INTERVAL '1 hour')
      ORDER BY sampled_at DESC
      LIMIT 1
    `);
    const row = ((rows as unknown) as Array<{ scouted_count?: number }>)?.[0];
    scoutedThen = row && typeof row.scouted_count === "number" ? row.scouted_count : null;
  } catch (err) {
    logger.warn({ err }, "scout-watchdog/drain-stall: historical sample query failed — fail-open");
    return { alertFired: false, scoutedNow, scoutedThen: null, pipelineMode };
  }

  // Not enough history yet — 2h hasn't elapsed since first sample.
  if (scoutedThen === null) {
    return { alertFired: false, scoutedNow, scoutedThen: null, pipelineMode };
  }

  // Stall = backlog has not decreased over the lookback window.
  if (scoutedNow < scoutedThen) {
    return { alertFired: false, scoutedNow, scoutedThen, pipelineMode };
  }

  // Suppress repeat alerts.
  if (await recentAlertExists("alert.drain_stall", DRAIN_STALL_DEDUPE_HOURS)) {
    return { alertFired: false, scoutedNow, scoutedThen, pipelineMode };
  }

  // Diagnostic context: synthesizer success rate last 2h, last successful
  // CANDIDATE creation, last 5 reject reasons.
  const synthesizerStats: Record<string, number> = {};
  let lastCandidateAt: string | null = null;
  let lastRejectReasons: Array<{ action: string; reason: unknown; createdAt: string }> = [];
  try {
    const synthRows = await db.execute(sql`
      SELECT action, count(*)::int AS n
      FROM audit_log
      WHERE created_at > NOW() - (${DRAIN_STALL_LOOKBACK_HOURS}::int * INTERVAL '1 hour')
        AND action IN (
          'scout.audited',
          'scout.rejected_regex',
          'scout.rejected_auditor',
          'scout.synthesizer_refused',
          'scout.rejected_compile',
          'scout.rejected_critic'
        )
      GROUP BY action
    `);
    for (const row of ((synthRows as unknown) as Array<{ action?: string; n?: number }>)) {
      if (row?.action) synthesizerStats[row.action] = Number(row.n ?? 0);
    }
  } catch (err) {
    logger.warn({ err }, "scout-watchdog/drain-stall: synthesizer-stats query failed");
  }
  try {
    const rows = await db.execute(sql`
      SELECT MAX(created_at) AS last_at
      FROM lifecycle_transitions
      WHERE to_state = 'CANDIDATE'
    `);
    const v = ((rows as unknown) as Array<{ last_at?: unknown }>)?.[0]?.last_at;
    lastCandidateAt = v instanceof Date ? v.toISOString() : (typeof v === "string" ? v : null);
  } catch (err) {
    logger.warn({ err }, "scout-watchdog/drain-stall: last-candidate query failed");
  }
  try {
    const rows = await db.execute(sql`
      SELECT action, result, created_at
      FROM audit_log
      WHERE action IN (
          'scout.rejected_regex',
          'scout.rejected_auditor',
          'scout.synthesizer_refused',
          'scout.rejected_compile',
          'scout.rejected_critic'
        )
      ORDER BY created_at DESC
      LIMIT 5
    `);
    lastRejectReasons = ((rows as unknown) as Array<{ action: string; result: unknown; created_at: unknown }>)
      .map((r) => ({
        action: r.action,
        reason: r.result,
        createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      }));
  } catch (err) {
    logger.warn({ err }, "scout-watchdog/drain-stall: last-reject-reasons query failed");
  }

  const payload = {
    scoutedNow,
    scoutedThen,
    lookbackHours: DRAIN_STALL_LOOKBACK_HOURS,
    pipelineMode,
    synthesizerStats,
    lastCandidateAt,
    lastRejectReasons,
    timestamp: new Date().toISOString(),
  };

  await db
    .insert(auditLog)
    .values({
      action: "alert.drain_stall",
      entityType: "scout_pipeline",
      entityId: null,
      input: { lookbackHours: DRAIN_STALL_LOOKBACK_HOURS },
      result: payload as Record<string, unknown>,
      status: "warning",
      decisionAuthority: "system",
    })
    .catch((err) => logger.error({ err }, "alert.drain_stall audit insert failed"));

  notifyCritical(
    "Scout drain stall detected",
    appendFamilyGradePostscript(
      `Scouted backlog has NOT decreased over the last ${DRAIN_STALL_LOOKBACK_HOURS}h despite drain cron running every 10 min. Now=${scoutedNow}, ${DRAIN_STALL_LOOKBACK_HOURS}h ago=${scoutedThen}. Pipeline mode: ${pipelineMode}. Last CANDIDATE: ${lastCandidateAt ?? "never"}. Synthesizer stats: ${JSON.stringify(synthesizerStats)}.`,
      "The strategy discovery pipeline has a backlog that is not draining — it is finding new strategy ideas but they are not being processed into candidates.",
      "No trading is affected. Tell Tony: 'The strategy scout pipeline looks stuck.' He will check it when available.",
    ),
    { job: "scout-drain-stall-check", ...payload },
  );

  await broadcastFireAndForget("scout-health:drain-stall", payload);

  return {
    alertFired: true,
    reason: "drain_backlog_not_decreasing",
    scoutedNow,
    scoutedThen,
    pipelineMode,
  };
}

// ─── Monitor 2: reject distribution ──────────────────────────────────
export async function runRejectDistributionCheck(): Promise<RejectDistributionResult> {
  const distribution: Record<string, number> = {};
  let total = 0;
  try {
    const rows = await db.execute(sql`
      SELECT action, count(*)::int AS n
      FROM audit_log
      WHERE created_at > NOW() - (${REJECT_DIST_LOOKBACK_HOURS}::int * INTERVAL '1 hour')
        AND action IN (
          'scout.rejected_regex',
          'scout.rejected_auditor',
          'scout.synthesizer_refused',
          'scout.rejected_compile',
          'scout.rejected_critic'
        )
      GROUP BY action
    `);
    for (const row of ((rows as unknown) as Array<{ action?: string; n?: number }>)) {
      if (row?.action) {
        const n = Number(row.n ?? 0);
        distribution[row.action] = n;
        total += n;
      }
    }
  } catch (err) {
    logger.warn({ err }, "scout-watchdog/reject-distribution: query failed — fail-open");
    return { alertFired: false, total: 0, distribution: {} };
  }

  if (total < REJECT_DIST_MIN_TOTAL) {
    return { alertFired: false, total, distribution };
  }

  // Find dominant category.
  let dominantCategory: string | undefined;
  let dominantPct = 0;
  for (const [action, n] of Object.entries(distribution)) {
    const pct = n / total;
    if (pct > dominantPct) {
      dominantPct = pct;
      dominantCategory = action;
    }
  }

  if (!dominantCategory || dominantPct <= REJECT_DIST_DOMINANCE_PCT) {
    return { alertFired: false, total, distribution };
  }

  if (await recentAlertExists("alert.reject_distribution_skewed", REJECT_DIST_DEDUPE_HOURS)) {
    return { alertFired: false, total, distribution, dominantCategory, dominantPct };
  }

  const implication = implicationFor(dominantCategory);
  const payload = {
    total,
    distribution,
    dominantCategory,
    dominantPct: Number(dominantPct.toFixed(4)),
    implication,
    lookbackHours: REJECT_DIST_LOOKBACK_HOURS,
    timestamp: new Date().toISOString(),
  };

  await db
    .insert(auditLog)
    .values({
      action: "alert.reject_distribution_skewed",
      entityType: "scout_pipeline",
      entityId: null,
      input: { lookbackHours: REJECT_DIST_LOOKBACK_HOURS },
      result: payload as Record<string, unknown>,
      status: "warning",
      decisionAuthority: "system",
    })
    .catch((err) => logger.error({ err }, "alert.reject_distribution_skewed audit insert failed"));

  notifyCritical(
    "Scout reject distribution skewed",
    appendFamilyGradePostscript(
      `${dominantCategory} accounts for ${(dominantPct * 100).toFixed(1)}% of ${total} rejects in last ${REJECT_DIST_LOOKBACK_HOURS}h. Implication: ${implication}.`,
      "The strategy discovery system is rejecting most of its candidates for the same reason. The pipeline is still running, but fewer strategies will be produced until Tony looks into it.",
      "No trading is affected. Tell Tony: 'The scout pipeline reject pattern looks abnormal.' He will review it when available.",
    ),
    { job: "scout-reject-distribution-check", ...payload },
  );

  await broadcastFireAndForget("scout-health:reject-skew", payload);

  return { alertFired: true, total, distribution, dominantCategory, dominantPct };
}

// ─── Monitor 3: 5-min reject spike ───────────────────────────────────
export async function runRejectSpikeCheck(): Promise<RejectSpikeResult> {
  const counts: Record<string, number> = {};
  try {
    const rows = await db.execute(sql`
      SELECT action, count(*)::int AS n
      FROM audit_log
      WHERE created_at > NOW() - (${REJECT_SPIKE_LOOKBACK_MINUTES}::int * INTERVAL '1 minute')
        AND action IN (
          'scout.rejected_regex',
          'scout.rejected_auditor',
          'scout.synthesizer_refused',
          'scout.rejected_compile',
          'scout.rejected_critic'
        )
      GROUP BY action
    `);
    for (const row of ((rows as unknown) as Array<{ action?: string; n?: number }>)) {
      if (row?.action) counts[row.action] = Number(row.n ?? 0);
    }
  } catch (err) {
    logger.warn({ err }, "scout-watchdog/reject-spike: query failed — fail-open");
    return { alertFired: false, spikedActions: [] };
  }

  const spiked = Object.entries(counts)
    .filter(([, n]) => n >= REJECT_SPIKE_THRESHOLD)
    .map(([action, count]) => ({ action, count }));

  if (spiked.length === 0) {
    return { alertFired: false, spikedActions: [] };
  }

  // Per-action dedupe so a sustained spike doesn't flood alerts every 5 min,
  // but two different reject types spiking together both fire.
  const firedActions: Array<{ action: string; count: number }> = [];
  for (const item of spiked) {
    const dedupeAction = `alert.reject_spike:${item.action}`;
    if (await recentAlertExistsMinutes(dedupeAction, REJECT_SPIKE_DEDUPE_MINUTES)) {
      continue;
    }
    firedActions.push(item);

    const payload = {
      action: item.action,
      count: item.count,
      lookbackMinutes: REJECT_SPIKE_LOOKBACK_MINUTES,
      threshold: REJECT_SPIKE_THRESHOLD,
      implication: implicationFor(item.action),
      timestamp: new Date().toISOString(),
    };

    await db
      .insert(auditLog)
      .values({
        action: dedupeAction,
        entityType: "scout_pipeline",
        entityId: null,
        input: { lookbackMinutes: REJECT_SPIKE_LOOKBACK_MINUTES, action: item.action },
        result: payload as Record<string, unknown>,
        status: "warning",
        decisionAuthority: "system",
      })
      .catch((err) => logger.error({ err }, `${dedupeAction} audit insert failed`));

    await broadcastFireAndForget("scout-health:reject-spike", payload);
  }

  if (firedActions.length === 0) {
    return { alertFired: false, spikedActions: spiked };
  }

  return { alertFired: true, spikedActions: firedActions };
}

// Re-exported for tests & potential future call sites.
export const __test__ = {
  REJECT_ACTIONS,
  DRAIN_STALL_LOOKBACK_HOURS,
  DRAIN_STALL_MIN_BACKLOG,
  DRAIN_STALL_DEDUPE_HOURS,
  REJECT_DIST_LOOKBACK_HOURS,
  REJECT_DIST_MIN_TOTAL,
  REJECT_DIST_DOMINANCE_PCT,
  REJECT_SPIKE_LOOKBACK_MINUTES,
  REJECT_SPIKE_THRESHOLD,
  REJECT_SPIKE_DEDUPE_MINUTES,
  implicationFor,
};

export type { RejectAction };
