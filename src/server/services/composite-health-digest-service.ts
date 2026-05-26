/**
 * composite-health-digest-service.ts — Wave 28 Pass A.4
 *
 * Daily P3 composite health digest cron service. Runs aggregateStrategyHealth()
 * across all active strategies, tallies verdicts, and emits a single family-grade
 * Discord summary at 17:00 ET. Pipeline-gate exempt — fires even when pipeline
 * is PAUSED. DST-safe double-fire pattern with ET-hour guard.
 *
 * Audit actions:
 *   composite_health.daily_digest_emitted         (success — digest posted to Discord)
 *   composite_health.digest_skipped_lock_contention  (info — previous tick in-flight)
 *   composite_health.digest_skipped_dst_guard        (info — ET-hour != 17)
 *   composite_health.digest_discord_failed           (warning — Discord post failed)
 *
 * Import notes (CLAUDE.md feedback_helper_logger_import.md):
 *   logger imported from ./logger.js leaf — never from ../index.js.
 */

import { randomUUID } from "crypto";
import { inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { strategies } from "../db/schema.js";
import { logger } from "../lib/logger.js";
import { insertAuditRowSafe } from "../lib/audit-log-helper.js";
import { appendFamilyGradePostscript } from "../lib/notification-helpers.js";
import { notifyInfo } from "./notification-service.js";
import { aggregateStrategyHealth, HealthVerdict } from "./strategy-health-aggregator.js";

// ─── Public Types ─────────────────────────────────────────────────────────────

export type DigestStatus =
  | "emitted"
  | "skipped_lock_contention"
  | "skipped_dst_guard"
  | "no_active_strategies";

export interface DigestVerdictCounts {
  HEALTHY: number;
  MARGINAL: number;
  UNHEALTHY: number;
  CRITICAL: number;
  SKIPPED: number; // below-threshold strategies that couldn't produce a verdict
}

export interface DigestResult {
  status: DigestStatus;
  correlationId: string;
  durationMs: number;
  strategiesChecked?: number;
  verdicts?: DigestVerdictCounts;
  dryRun?: boolean;
}

// ─── Active pipeline states ───────────────────────────────────────────────────

/** Lifecycle states considered "active" for the digest. */
const ACTIVE_LIFECYCLE_STATES: string[] = [
  "DEPLOYED",
  "PILOT",
  "PAPER",
  "DEPLOY_READY",
];

// ─── DST-safe ET-hour guard ────────────────────────────────────────────────────

/**
 * Returns the current Eastern Time hour as an integer using Intl.DateTimeFormat.
 * This is DST-safe by design — Intl resolves America/New_York automatically.
 * Mirrors the pattern in quantum-replay-weekly-service.ts / consistency-tracker
 * scheduler cron handlers.
 */
function _getEtHour(asOf: Date): number {
  const etHourStr = asOf.toLocaleString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    hour12: false,
  });
  return parseInt(etHourStr, 10);
}

// ─── In-flight lock (mirrors scheduler._tryAcquireJobLock) ───────────────────
// The digest service manages its own lock so it can be called directly in tests
// and from the scheduler cron with identical lock semantics.

let _digestInFlight = false;

function _tryAcquireDigestLock(correlationId: string): boolean {
  if (_digestInFlight) {
    logger.warn(
      { correlationId, jobName: "composite-health-daily-digest" },
      "composite-health-digest: previous tick still in-flight — skipping",
    );
    return false;
  }
  _digestInFlight = true;
  return true;
}

function _releaseDigestLock(): void {
  _digestInFlight = false;
}

/** Exported for test isolation only. */
export function _resetDigestLockForTest(): void {
  _digestInFlight = false;
}

// ─── Discord message builder ──────────────────────────────────────────────────

function _buildDigestBody(
  verdicts: DigestVerdictCounts,
  strategiesChecked: number,
  correlationId: string,
): string {
  const total = verdicts.HEALTHY + verdicts.MARGINAL + verdicts.UNHEALTHY + verdicts.CRITICAL + verdicts.SKIPPED;
  const lines: string[] = [
    `[W28 DAILY DIGEST] Composite Strategy Health — ${strategiesChecked} active strategies`,
    `HEALTHY: ${verdicts.HEALTHY}  |  MARGINAL: ${verdicts.MARGINAL}  |  UNHEALTHY: ${verdicts.UNHEALTHY}  |  CRITICAL: ${verdicts.CRITICAL}`,
  ];

  if (verdicts.SKIPPED > 0) {
    lines.push(`SKIPPED (below min subsystem threshold): ${verdicts.SKIPPED}`);
  }

  if (verdicts.CRITICAL > 0) {
    lines.push(`ALERT: ${verdicts.CRITICAL} of ${total} strategies returned CRITICAL composite health.`);
    lines.push("Review audit_log for composite_health.evaluated rows to identify affected strategies.");
  } else if (verdicts.UNHEALTHY > 0) {
    lines.push(`Note: ${verdicts.UNHEALTHY} strategies are UNHEALTHY — monitor over next 48 hours.`);
  } else if (verdicts.HEALTHY === strategiesChecked) {
    lines.push("All active strategies are HEALTHY.");
  }

  lines.push(`Correlation ID: ${correlationId}`);
  return lines.join("\n");
}

// ─── Main public function ─────────────────────────────────────────────────────

/**
 * runCompositeHealthDailyDigest
 *
 * Runs aggregateStrategyHealth() for every active strategy (DEPLOYED / PILOT /
 * PAPER / DEPLOY_READY), tallies verdicts, and posts a single family-grade
 * Discord notification.
 *
 * Guards:
 *   1. Lock contention guard — mirrors scheduler._tryAcquireJobLock pattern.
 *   2. DST-safe ET-hour guard — only fires when ET hour == 17 (5 PM ET).
 *      Caller passes `asOf` to enable time-travel in tests.
 *
 * @param opts.asOf    Override "now" for the DST guard. Default: new Date().
 * @param opts.dryRun  Skip Discord post; audit row still written. Default: false.
 */
export async function runCompositeHealthDailyDigest(
  opts: { asOf?: Date; dryRun?: boolean } = {},
): Promise<DigestResult> {
  const correlationId = randomUUID();
  const t0 = Date.now();
  const asOf = opts.asOf ?? new Date();
  const dryRun = opts.dryRun ?? false;

  // ── 1. Lock contention guard ────────────────────────────────────────────────
  if (!_tryAcquireDigestLock(correlationId)) {
    await insertAuditRowSafe({
      action: "composite_health.digest_skipped_lock_contention",
      entityType: "composite_health_daily_digest",
      entityId: null,
      result: { correlationId, dryRun },
      status: "info",
      decisionAuthority: "system",
      correlationId,
    });
    return {
      status: "skipped_lock_contention",
      correlationId,
      durationMs: Date.now() - t0,
      dryRun,
    };
  }

  try {
    // ── 2. DST-safe ET-hour guard ─────────────────────────────────────────────
    const etHour = _getEtHour(asOf);
    if (etHour !== 17) {
      logger.debug(
        { etHour, correlationId, jobName: "composite-health-daily-digest" },
        "composite-health-digest: ET-hour != 17 — skipping (DST guard)",
      );
      await insertAuditRowSafe({
        action: "composite_health.digest_skipped_dst_guard",
        entityType: "composite_health_daily_digest",
        entityId: null,
        result: { etHour, correlationId, dryRun },
        status: "info",
        decisionAuthority: "system",
        correlationId,
      });
      return {
        status: "skipped_dst_guard",
        correlationId,
        durationMs: Date.now() - t0,
        dryRun,
      };
    }

    logger.info(
      { correlationId, jobName: "composite-health-daily-digest", dryRun },
      "composite-health-digest: tick start (ET-hour=17 confirmed)",
    );

    // ── 3. Query active strategies ────────────────────────────────────────────
    const activeStrategies = await db
      .select({ id: strategies.id, name: strategies.name })
      .from(strategies)
      .where(inArray(strategies.lifecycleState, ACTIVE_LIFECYCLE_STATES));

    if (activeStrategies.length === 0) {
      logger.info(
        { correlationId },
        "composite-health-digest: no active strategies — skipping Discord post",
      );
      await insertAuditRowSafe({
        action: "composite_health.daily_digest_emitted",
        entityType: "composite_health_daily_digest",
        entityId: null,
        result: {
          strategies_checked: 0,
          verdicts: { HEALTHY: 0, MARGINAL: 0, UNHEALTHY: 0, CRITICAL: 0, SKIPPED: 0 },
          dry_run: dryRun,
          correlationId,
          duration_ms: Date.now() - t0,
        },
        status: "success",
        decisionAuthority: "system",
        correlationId,
      });
      return {
        status: "no_active_strategies",
        correlationId,
        durationMs: Date.now() - t0,
        strategiesChecked: 0,
        verdicts: { HEALTHY: 0, MARGINAL: 0, UNHEALTHY: 0, CRITICAL: 0, SKIPPED: 0 },
        dryRun,
      };
    }

    // ── 4. Aggregate per-strategy health ─────────────────────────────────────
    const verdicts: DigestVerdictCounts = {
      HEALTHY: 0,
      MARGINAL: 0,
      UNHEALTHY: 0,
      CRITICAL: 0,
      SKIPPED: 0,
    };

    for (const strat of activeStrategies) {
      try {
        const result = await aggregateStrategyHealth(strat.id);
        if (!result.written || result.verdict == null) {
          verdicts.SKIPPED++;
        } else {
          const v = result.verdict as HealthVerdict;
          verdicts[v]++;
        }
      } catch (err) {
        // Aggregator re-throws on uncaught error; per strategy isolation we count SKIPPED
        verdicts.SKIPPED++;
        logger.warn(
          { err, strategyId: strat.id, strategyName: strat.name, correlationId },
          "composite-health-digest: aggregator threw for strategy — counted as SKIPPED",
        );
      }
    }

    // ── 5. Build Discord message ──────────────────────────────────────────────
    const operatorBody = _buildDigestBody(verdicts, activeStrategies.length, correlationId);

    const hasCritical = verdicts.CRITICAL > 0;
    const hasUnhealthy = verdicts.UNHEALTHY > 0;

    const plainWhat = hasCritical
      ? `The bot's health check found ${verdicts.CRITICAL} strategy with a CRITICAL composite score — multiple validation checks are failing.`
      : hasUnhealthy
        ? `The bot's health check found ${verdicts.UNHEALTHY} strategy showing warning signs across its validation checks.`
        : "The bot's daily health check ran successfully. All active strategies look OK.";

    const plainAction = hasCritical
      ? "Tony needs to review this — it may affect trading decisions."
      : hasUnhealthy
        ? "No action needed yet. Tony will review the audit logs."
        : "No action needed.";

    const fullBody = appendFamilyGradePostscript(operatorBody, plainWhat, plainAction);

    // ── 6. Post to Discord (skip in dryRun) ───────────────────────────────────
    if (!dryRun) {
      try {
        notifyInfo(
          `[W28 Digest] Composite Strategy Health — ${activeStrategies.length} strategies`,
          fullBody,
          {
            job: "composite-health-daily-digest",
            strategiesChecked: activeStrategies.length,
            verdicts,
            correlationId,
          },
        );
      } catch (discordErr) {
        // Discord post failure must NOT throw to caller per charter
        const errMsg = discordErr instanceof Error ? discordErr.message : String(discordErr);
        logger.error(
          { err: discordErr, correlationId, jobName: "composite-health-daily-digest" },
          "composite-health-digest: Discord post failed — emitting discord_failed audit",
        );
        await insertAuditRowSafe({
          action: "composite_health.digest_discord_failed",
          entityType: "composite_health_daily_digest",
          entityId: null,
          result: { error: errMsg, correlationId, dryRun },
          status: "warning",
          decisionAuthority: "system",
          correlationId,
        });
        // Continue — audit row still written below
      }
    } else {
      logger.info(
        { correlationId, operatorBody, verdicts },
        "composite-health-digest: dryRun=true — Discord post suppressed",
      );
    }

    // ── 7. Emit success audit row ─────────────────────────────────────────────
    const durationMs = Date.now() - t0;
    await insertAuditRowSafe({
      action: "composite_health.daily_digest_emitted",
      entityType: "composite_health_daily_digest",
      entityId: null,
      result: {
        strategies_checked: activeStrategies.length,
        verdicts,
        dry_run: dryRun,
        correlationId,
        duration_ms: durationMs,
      },
      status: "success",
      decisionAuthority: "system",
      correlationId,
    });

    logger.info(
      {
        correlationId,
        strategiesChecked: activeStrategies.length,
        verdicts,
        dryRun,
        durationMs,
        jobName: "composite-health-daily-digest",
      },
      "composite-health-digest: daily digest complete",
    );

    return {
      status: "emitted",
      correlationId,
      durationMs,
      strategiesChecked: activeStrategies.length,
      verdicts,
      dryRun,
    };
  } finally {
    _releaseDigestLock();
  }
}
