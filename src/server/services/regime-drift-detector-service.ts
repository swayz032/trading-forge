/**
 * regime-drift-detector-service.ts — Wave 29 Pass B.3 (critic-optimizer)
 *
 * Monitors DEPLOYED strategies for persistent regime drift. Runs daily at
 * 18:00 ET (22:00 UTC). If the last 5 consecutive days of bias_state.regime_label
 * for a strategy's symbol ALL differ from the strategy's regime_trained_on, the
 * strategy is demoted DEPLOYED → DECLINING → TESTING and a Discord WARN is fired.
 *
 * Per arXiv 2509.14385 (2025-09-17): regime-conditioned policies must be re-trained
 * when regime shifts persistently. 5-consecutive-day threshold is the operator's
 * production setting. Must be ALL 5 consecutive days (not 5-of-7-day average).
 *
 * Audit actions:
 *   regime_drift_detector.skipped_lock_contention  (info)
 *   regime_drift_detector.skipped_dst_guard        (info)
 *   regime_drift_detector.legacy_strategy_skipped  (info — regime_trained_on IS NULL)
 *   regime_drift_detector.dry_run                  (info — drift detected but demotion suppressed)
 *   strategy.regime_drift_detected                 (warn — 5-consecutive-day drift found)
 *   lifecycle.regime_drift_demotion                (warn — DEPLOYED → DECLINING → TESTING)
 *   regime_drift_detector.completed                (info — summary counts)
 *
 * Lifecycle path on drift:
 *   DEPLOYED → DECLINING (first step; supported by VALID_TRANSITIONS)
 *   DECLINING → TESTING  (second step; supported by VALID_TRANSITIONS)
 *
 * Import notes:
 *   logger from ./logger.js leaf module (per CLAUDE.md feedback_helper_logger_import.md)
 */

import { randomUUID } from "crypto";
import { eq, and, isNotNull, desc, lt } from "drizzle-orm";
import { db } from "../db/index.js";
import { strategies, biasState } from "../db/schema.js";
import { logger } from "../lib/logger.js";
import { insertAuditRowSafe } from "../lib/audit-log-helper.js";
import { regimeDriftDetectionsTotal } from "../lib/metrics-registry.js";
import { appendFamilyGradePostscript } from "../lib/notification-helpers.js";
import { notifyCritical, notifyWarning } from "./notification-service.js";
import { LifecycleService } from "./lifecycle-service.js";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Number of consecutive days ALL must differ from trained regime to trigger demotion. */
export const DRIFT_CONSECUTIVE_DAYS = 5;

// FINDING #3 FIX: zombie DECLINING sweep threshold.
// When step1 (DEPLOYED→DECLINING) succeeds but step2 (DECLINING→TESTING) fails, the strategy
// is stranded in zombie DECLINING — the detector only queries DEPLOYED, so it never re-fires.
// This sweep runs each detector invocation and retries DECLINING→TESTING for stranded rows.
// 25h (slightly more than 1 day) ensures we catch failures from the prior daily run.
export const ZOMBIE_DECLINING_THRESHOLD_MS = parseInt(
  process.env.ZOMBIE_DECLINING_THRESHOLD_MS ?? String(25 * 60 * 60 * 1000),
  10,
);

/** Target ET hour for DST-safe guard (18 = 6:00 PM ET). */
const TARGET_ET_HOUR = 18;

// ─── Public types ─────────────────────────────────────────────────────────────

export interface DriftDetectorStrategyResult {
  strategyId: string;
  strategyName: string;
  regimeTrainedOn: string;
  recentRegimes: string[];
  driftDetected: boolean;
  demoted: boolean;
  skippedReason?: "legacy_null_regime" | "insufficient_bias_data" | "dry_run";
}

export interface DriftDetectorResult {
  status: "completed" | "skipped_lock_contention" | "skipped_dst_guard";
  correlationId: string;
  durationMs: number;
  strategiesChecked: number;
  driftDetected: number;
  demoted: number;
  skipped: number;
  dryRun: boolean;
  strategyResults?: DriftDetectorStrategyResult[];
}

// ─── DST-safe ET-hour helper ──────────────────────────────────────────────────

/**
 * Returns the current Eastern Time hour (0-23) using Intl.DateTimeFormat.
 * DST-safe: America/New_York resolves spring-forward/fall-back automatically.
 * Mirrors composite-health-digest-service.ts / quantum-replay-weekly-service.ts.
 */
export function _getEtHour(asOf: Date): number {
  const etHourStr = asOf.toLocaleString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    hour12: false,
  });
  return parseInt(etHourStr, 10);
}

// ─── In-flight lock ───────────────────────────────────────────────────────────
// Mirrors scheduler._tryAcquireJobLock for services that manage their own lock.

let _detectorInFlight = false;

export function _tryAcquireDetectorLock(): boolean {
  if (_detectorInFlight) return false;
  _detectorInFlight = true;
  return true;
}

export function _releaseDetectorLock(): void {
  _detectorInFlight = false;
}

/** Test seam — reset the in-flight lock between tests. Do NOT call from production code. */
export function _resetDetectorLockForTest(): void {
  _detectorInFlight = false;
}

// ─── Core detector ────────────────────────────────────────────────────────────

/**
 * runRegimeDriftDetector — main entry point.
 *
 * Flow:
 *  1. Acquire job lock (skip + audit on contention)
 *  2. DST-safe ET-hour=18 guard (skip + audit if not at target hour)
 *  3. Query DEPLOYED strategies with regime_trained_on IS NOT NULL
 *  4. For each strategy: read last 5 days of bias_state.regime_label by symbol
 *  5. If all 5 days != regime_trained_on → drift detected
 *  6. On drift: Discord WARN + DEPLOYED → DECLINING → TESTING demotion
 *  7. Legacy strategies (regime_trained_on IS NULL): skipped + info audit
 *  8. dryRun=true: detect but suppress Discord + demotion + emit dry_run audit
 *
 * @param opts.asOf   Override the "now" timestamp (default: new Date()). Used
 *                    in tests to simulate different ET hours and date windows.
 * @param opts.dryRun When true, drift detection runs but no lifecycle changes or
 *                    Discord posts are made. Audit `regime_drift_detector.dry_run`
 *                    is emitted instead. Default: false.
 */
export async function runRegimeDriftDetector(opts?: {
  asOf?: Date;
  dryRun?: boolean;
}): Promise<DriftDetectorResult> {
  const asOf = opts?.asOf ?? new Date();
  const dryRun = opts?.dryRun ?? false;
  const correlationId = randomUUID();
  const startMs = Date.now();

  // ── Step 1: Job lock ──────────────────────────────────────────────────────
  const acquired = _tryAcquireDetectorLock();
  if (!acquired) {
    logger.info(
      { correlationId, jobName: "regime-drift-detector" },
      "regime-drift-detector: previous tick still in-flight — skipping",
    );
    await insertAuditRowSafe({
      action: "regime_drift_detector.skipped_lock_contention",
      entityType: "scheduler_job",
      entityId: "regime-drift-detector",
      result: { correlationId },
      status: "info",
      decisionAuthority: "system",
      correlationId,
    });
    return {
      status: "skipped_lock_contention",
      correlationId,
      durationMs: Date.now() - startMs,
      strategiesChecked: 0,
      driftDetected: 0,
      demoted: 0,
      skipped: 0,
      dryRun,
    };
  }

  try {
    // ── Step 1.5: Zombie DECLINING compensating sweep ──────────────────────
    // FINDING #3 FIX: strategies stranded in DECLINING (step2 failed on a prior run)
    // are never re-evaluated because the main detector only queries DEPLOYED.
    // This sweep runs on every detector invocation (not gated by ET-hour) and
    // re-attempts DECLINING → TESTING for strategies that have been stuck >25h.
    // True DB atomicity for the two-step demotion deferred: requires threading a
    // Drizzle tx through LifecycleService.promoteStrategy — flagged as tech-debt.
    try {
      const zombieThresholdAt = new Date(Date.now() - ZOMBIE_DECLINING_THRESHOLD_MS);
      const zombieCandidates = await db
        .select({ id: strategies.id, name: strategies.name, updatedAt: strategies.updatedAt })
        .from(strategies)
        .where(and(eq(strategies.lifecycleState, "DECLINING"), lt(strategies.updatedAt, zombieThresholdAt)));

      if (zombieCandidates.length > 0) {
        logger.warn(
          { correlationId, zombieCount: zombieCandidates.length, thresholdH: ZOMBIE_DECLINING_THRESHOLD_MS / 3_600_000 },
          "regime-drift-detector: found zombie DECLINING strategies — attempting DECLINING→TESTING recovery",
        );
        const zombieLifecycle = new LifecycleService();
        for (const zombie of zombieCandidates) {
          const zombieCorrelationId = randomUUID();
          try {
            const recovery = await zombieLifecycle.promoteStrategy(
              zombie.id,
              "DECLINING",
              "TESTING",
              { correlationId: zombieCorrelationId, actor: "system", reason: "zombie_declining_sweep: step2 retry from regime-drift-detector" },
            );
            if (recovery.success) {
              logger.warn(
                { correlationId: zombieCorrelationId, strategyId: zombie.id, strategyName: zombie.name },
                "regime-drift-detector: zombie DECLINING → TESTING recovery succeeded",
              );
              await insertAuditRowSafe({
                action: "lifecycle.zombie_declining_recovered",
                entityType: "strategy",
                entityId: zombie.id,
                result: { correlationId: zombieCorrelationId, strategyId: zombie.id, strategyName: zombie.name, updatedAt: zombie.updatedAt },
                status: "warning",
                decisionAuthority: "system",
                correlationId: zombieCorrelationId,
              });
            } else {
              logger.error(
                { correlationId: zombieCorrelationId, strategyId: zombie.id, error: recovery.error },
                "regime-drift-detector: zombie DECLINING → TESTING recovery FAILED",
              );
              notifyCritical(
                `[regime-drift] Zombie DECLINING strategy cannot be recovered: ${zombie.name}`,
                // Deep-scan #5 A-3 (2026-06-29): family-grade postscript so an unattended
                // family operator gets a plain-English action, not raw lifecycle jargon.
                appendFamilyGradePostscript(
                  `Strategy "${zombie.name}" (${zombie.id}) has been stuck in DECLINING for >${ZOMBIE_DECLINING_THRESHOLD_MS / 3_600_000}h. ` +
                  `Automated DECLINING → TESTING recovery failed: ${recovery.error ?? "unknown"}. Manual lifecycle correction required.`,
                  "A strategy got stuck part-way through being paused and the bot could not auto-fix it.",
                  "No trades are at risk — the strategy is halted. Tell Tony to reset its status when convenient.",
                ),
                { strategyId: zombie.id, strategyName: zombie.name, zombieCorrelationId },
              );
            }
          } catch (zombieErr) {
            logger.error({ err: zombieErr, strategyId: zombie.id }, "regime-drift-detector: zombie recovery threw");
          }
        }
      }
    } catch (zombieSweepErr) {
      logger.error({ err: zombieSweepErr, correlationId }, "regime-drift-detector: zombie sweep threw — continuing with main detection");
    }

    // ── Step 2: DST-safe ET-hour guard ──────────────────────────────────────
    const etHour = _getEtHour(asOf);
    if (etHour !== TARGET_ET_HOUR) {
      logger.info(
        { correlationId, jobName: "regime-drift-detector", etHour, expected: TARGET_ET_HOUR },
        "regime-drift-detector: ET-hour guard failed — skipping (DST double-fire protection)",
      );
      await insertAuditRowSafe({
        action: "regime_drift_detector.skipped_dst_guard",
        entityType: "scheduler_job",
        entityId: "regime-drift-detector",
        result: { correlationId, etHour, expected: TARGET_ET_HOUR },
        status: "info",
        decisionAuthority: "system",
        correlationId,
      });
      return {
        status: "skipped_dst_guard",
        correlationId,
        durationMs: Date.now() - startMs,
        strategiesChecked: 0,
        driftDetected: 0,
        demoted: 0,
        skipped: 0,
        dryRun,
      };
    }

    // ── Step 3: Query DEPLOYED strategies ──────────────────────────────────
    // Include both strategies with and without regime_trained_on so we can
    // emit legacy-skip audits for null rows.
    const deployedStrategies = await db
      .select({
        id: strategies.id,
        name: strategies.name,
        symbol: strategies.symbol,
        regimeTrainedOn: strategies.regimeTrainedOn,
      })
      .from(strategies)
      .where(eq(strategies.lifecycleState, "DEPLOYED"));

    logger.info(
      { correlationId, strategyCount: deployedStrategies.length, dryRun },
      "regime-drift-detector: starting daily sweep",
    );

    const lifecycleService = new LifecycleService();
    const strategyResults: DriftDetectorStrategyResult[] = [];
    let driftDetectedCount = 0;
    let demotedCount = 0;
    let skippedCount = 0;

    // ── Step 4-6: Per-strategy evaluation ─────────────────────────────────
    for (const strategy of deployedStrategies) {
      const strategy_id = strategy.id;
      let result: DriftDetectorStrategyResult;
      try {
        result = await _evaluateStrategyDrift(
          strategy,
          asOf,
          dryRun,
          correlationId,
          lifecycleService,
        );
      } catch (err) {
        logger.error(
          { strategy_id, err },
          "regime-drift-detector: per-strategy lookup failed — skipping strategy",
        );
        await insertAuditRowSafe({
          action: "regime_drift_detector.strategy_lookup_failed",
          entityType: "strategy",
          entityId: strategy_id,
          result: { correlationId, error_message: String(err) },
          status: "warning",
          decisionAuthority: "system",
          correlationId,
        });
        skippedCount++;
        continue;
      }
      strategyResults.push(result);

      // "dry_run" is a special skip — drift was detected but suppressed; count as detected.
      // Other skipped reasons (legacy_null_regime, insufficient_bias_data) are true skips.
      if (result.skippedReason && result.skippedReason !== "dry_run") {
        skippedCount++;
      } else if (result.driftDetected) {
        driftDetectedCount++;
        if (result.demoted) demotedCount++;
      }
    }

    // ── Step 7: Completion audit ───────────────────────────────────────────
    const durationMs = Date.now() - startMs;
    logger.info(
      {
        correlationId,
        strategiesChecked: deployedStrategies.length,
        driftDetected: driftDetectedCount,
        demoted: demotedCount,
        skipped: skippedCount,
        durationMs,
        dryRun,
      },
      "regime-drift-detector: sweep completed",
    );

    await insertAuditRowSafe({
      action: "regime_drift_detector.completed",
      entityType: "scheduler_job",
      entityId: "regime-drift-detector",
      result: {
        correlationId,
        strategiesChecked: deployedStrategies.length,
        driftDetected: driftDetectedCount,
        demoted: demotedCount,
        skipped: skippedCount,
        durationMs,
        dryRun,
      },
      status: "success",
      decisionAuthority: "system",
      correlationId,
    });

    return {
      status: "completed",
      correlationId,
      durationMs,
      strategiesChecked: deployedStrategies.length,
      driftDetected: driftDetectedCount,
      demoted: demotedCount,
      skipped: skippedCount,
      dryRun,
      strategyResults,
    };
  } finally {
    _releaseDetectorLock();
  }
}

// ─── Per-strategy drift evaluation ──────────────────────────────────────────

async function _evaluateStrategyDrift(
  strategy: { id: string; name: string; symbol: string; regimeTrainedOn: string | null },
  asOf: Date,
  dryRun: boolean,
  correlationId: string,
  lifecycleService: LifecycleService,
): Promise<DriftDetectorStrategyResult> {
  const { id: strategyId, name: strategyName, symbol, regimeTrainedOn } = strategy;

  // Step 6a: Legacy null / UNKNOWN-sentinel regime_trained_on — skip with info audit.
  // FG-2 (deep-scan 2026-07-11): the freeze path stamps regime_trained_on="UNKNOWN" when bias_state
  // was empty/errored at freeze time. Real regimeLabel values are never literally "UNKNOWN", so the
  // allDiffer check below (every r !== regimeTrainedOn) would be unconditionally true and falsely
  // demote a strategy frozen during a bias-data outage — a freeze-time provenance gap, not drift.
  if (!regimeTrainedOn || regimeTrainedOn === "UNKNOWN") {
    logger.info(
      { correlationId, strategyId, strategyName },
      "regime-drift-detector: legacy strategy (regime_trained_on IS NULL) — skipped",
    );
    await insertAuditRowSafe({
      action: "regime_drift_detector.legacy_strategy_skipped",
      entityType: "strategy",
      entityId: strategyId,
      result: { correlationId, strategyId, strategyName, symbol },
      status: "info",
      decisionAuthority: "system",
      correlationId,
    });
    return {
      strategyId,
      strategyName,
      regimeTrainedOn: "(null)",
      recentRegimes: [],
      driftDetected: false,
      demoted: false,
      skippedReason: "legacy_null_regime",
    };
  }

  // Step 4: Read the last DRIFT_CONSECUTIVE_DAYS DISTINCT trading days of bias_state.regime_label.
  // FG-1 (deep-scan 2026-07-11): bias_state carries MULTIPLE rows per (session_date, symbol) —
  // session-start + intraday refresh / position-lock INSERTs with no unique constraint. A plain
  // `.orderBy(session_date DESC).limit(5)` returned ~2-3 CALENDAR days of mixed superseded +
  // authoritative rows, violating the "5 consecutive DAYS" contract. Order by session_date DESC then
  // computed_at DESC so each day's authoritative (latest computed_at) row sorts first, over-fetch,
  // then dedup by session_date in JS to yield 5 DISTINCT days. Plain select + JS dedup keeps it
  // portable (no DB-specific selectDistinctOn) and unit-mockable.
  const recentRows = await db
    .select({ regimeLabel: biasState.regimeLabel, sessionDate: biasState.sessionDate })
    .from(biasState)
    .where(eq(biasState.symbol, symbol))
    .orderBy(desc(biasState.sessionDate), desc(biasState.computedAt))
    .limit(DRIFT_CONSECUTIVE_DAYS * 10);

  const seenDays = new Set<string>();
  const recentRegimes: string[] = [];
  for (const r of recentRows) {
    const dayKey = String(r.sessionDate);
    if (seenDays.has(dayKey)) continue;
    seenDays.add(dayKey);
    recentRegimes.push(r.regimeLabel);
    if (recentRegimes.length >= DRIFT_CONSECUTIVE_DAYS) break;
  }

  if (recentRegimes.length < DRIFT_CONSECUTIVE_DAYS) {
    // Insufficient data — cannot establish 5-consecutive-day pattern
    logger.info(
      { correlationId, strategyId, strategyName, symbol, rowsFound: recentRegimes.length },
      "regime-drift-detector: insufficient bias_state data for strategy — skipped",
    );
    return {
      strategyId,
      strategyName,
      regimeTrainedOn,
      recentRegimes,
      driftDetected: false,
      demoted: false,
      skippedReason: "insufficient_bias_data",
    };
  }

  // Step 5: Drift check — ALL 5 consecutive days must differ from regime_trained_on
  const allDiffer = recentRegimes.every((r) => r !== regimeTrainedOn);

  if (!allDiffer) {
    // No drift — at least one of the last 5 days matched trained regime
    return {
      strategyId,
      strategyName,
      regimeTrainedOn,
      recentRegimes,
      driftDetected: false,
      demoted: false,
    };
  }

  // ── Drift detected ─────────────────────────────────────────────────────────
  logger.warn(
    { correlationId, strategyId, strategyName, symbol, regimeTrainedOn, recentRegimes },
    "regime-drift-detector: 5-consecutive-day regime drift detected",
  );

  await insertAuditRowSafe({
    action: "strategy.regime_drift_detected",
    entityType: "strategy",
    entityId: strategyId,
    result: {
      correlationId,
      strategyId,
      strategyName,
      symbol,
      regime_trained_on: regimeTrainedOn,
      recent_regimes: recentRegimes,
      days_observed: DRIFT_CONSECUTIVE_DAYS,
    },
    status: "warning",
    decisionAuthority: "system",
    correlationId,
  });
  // Wave 29 prod hardening: Prom counter #7 at this site only (scope: line 375 original)
  try {
    // Use most recent observed regime as to_regime; trained regime as from_regime.
    // LOW (freshscan6 2026-07-12): recentRegimes is built from rows ordered desc(sessionDate),
    // desc(computedAt) — so index 0 is the NEWEST day and [length-1] is the OLDEST. The old
    // [length-1] mislabeled the Prometheus to_regime with the 5-days-ago regime instead of today's.
    const mostRecentRegime = recentRegimes.length > 0 ? recentRegimes[0] : "UNKNOWN";
    regimeDriftDetectionsTotal.labels({
      from_regime: regimeTrainedOn,
      to_regime: mostRecentRegime,
    }).inc();
  } catch (_promErr) { /* non-blocking */ }

  // dryRun: detect but suppress Discord + lifecycle changes
  if (dryRun) {
    logger.info(
      { correlationId, strategyId, strategyName },
      "regime-drift-detector: dry_run=true — skipping Discord and demotion",
    );
    await insertAuditRowSafe({
      action: "regime_drift_detector.dry_run",
      entityType: "strategy",
      entityId: strategyId,
      result: {
        correlationId,
        strategyId,
        strategyName,
        symbol,
        regime_trained_on: regimeTrainedOn,
        recent_regimes: recentRegimes,
        days_observed: DRIFT_CONSECUTIVE_DAYS,
        dry_run: true,
      },
      status: "info",
      decisionAuthority: "system",
      correlationId,
    });
    return {
      strategyId,
      strategyName,
      regimeTrainedOn,
      recentRegimes,
      driftDetected: true,
      demoted: false,
      skippedReason: "dry_run",
    };
  }

  // Step 6: Discord WARN with family-grade postscript
  const operatorBody =
    `[WARN] Regime Drift Detected — Strategy: ${strategyName} (${strategyId})\n` +
    `Symbol: ${symbol}\n` +
    `Trained on regime: ${regimeTrainedOn}\n` +
    `Last ${DRIFT_CONSECUTIVE_DAYS} days observed: ${recentRegimes.join(", ")}\n` +
    `Action: Strategy demoted DEPLOYED → TESTING for re-validation.\n` +
    `Strategy must complete fresh CPCV + PBO + WFE before re-promotion.\n` +
    `Correlation ID: ${correlationId}`;

  const plainWhat =
    "Your bot detected that market conditions have shifted away from what one of the strategies was trained on for 5 days in a row.";
  const plainAction =
    "The strategy was automatically moved to re-validation mode. No manual action is needed — it will re-qualify before trading again.";

  const fullBody = appendFamilyGradePostscript(operatorBody, plainWhat, plainAction);

  notifyWarning(
    `[W29B.3] Regime Drift — Strategy ${strategyName} demoted to TESTING`,
    fullBody,
    { strategyId, strategyName, symbol, regimeTrainedOn, recentRegimes, correlationId },
  );

  // Step 6: Demote DEPLOYED → DECLINING → TESTING
  // VALID_TRANSITIONS: DEPLOYED → DECLINING is allowed; DECLINING → TESTING is allowed.
  let demoted = false;
  try {
    const step1 = await lifecycleService.promoteStrategy(
      strategyId,
      "DEPLOYED",
      "DECLINING",
      { correlationId, actor: "system", reason: `regime_drift: ${regimeTrainedOn} → [${recentRegimes.join(",")}]` },
    );

    if (!step1.success) {
      logger.error(
        { correlationId, strategyId, error: step1.error },
        "regime-drift-detector: DEPLOYED → DECLINING failed",
      );
    } else {
      const step2 = await lifecycleService.promoteStrategy(
        strategyId,
        "DECLINING",
        "TESTING",
        { correlationId, actor: "system", reason: `regime_drift_demotion: fresh CPCV required` },
      );

      if (!step2.success) {
        logger.error(
          { correlationId, strategyId, error: step2.error },
          "regime-drift-detector: DECLINING → TESTING failed — strategy in zombie DECLINING state",
        );
        // FINDING #3 FIX: CRITICAL alert so operator knows before the 25h zombie sweep fires.
        // True atomicity deferred — requires threading db.transaction() through LifecycleService.
        // Deep-scan #16 Band G: this second zombie-DECLINING failure path (step2 itself
        // failing here, vs. the 25h compensating-sweep recovery failing above) was raw
        // technical jargon with NO appendFamilyGradePostscript — an unattended family
        // operator would see lifecycle-transition internals instead of a plain-English
        // "no trades are at risk" reassurance + action. Matches the sweep-path pattern above.
        notifyCritical(
          `[regime-drift] Strategy ${strategyName} stuck in zombie DECLINING — step2 failed`,
          appendFamilyGradePostscript(
            `Strategy "${strategyName}" (${strategyId}) was moved DEPLOYED → DECLINING but the ` +
            `second step (DECLINING → TESTING) failed: ${step2.error ?? "unknown error"}. ` +
            `The strategy is now in zombie DECLINING state. The compensating sweep will retry within 25h.`,
            "A strategy got stuck part-way through being paused and the bot could not auto-fix it.",
            "No trades are at risk — the strategy is halted. Tell Tony to reset its status when convenient.",
          ),
          { strategyId, strategyName, correlationId, step2_error: step2.error },
        );
        await insertAuditRowSafe({
          action: "lifecycle.regime_drift_zombie_declining",
          entityType: "strategy",
          entityId: strategyId,
          result: {
            correlationId,
            strategyId,
            strategyName,
            step2_error: step2.error,
            note: "zombie_declining_sweep will retry DECLINING→TESTING on next detector run",
          },
          status: "error",
          decisionAuthority: "system",
          correlationId,
        });
      } else {
        demoted = true;
        logger.warn(
          { correlationId, strategyId, strategyName },
          "regime-drift-detector: strategy demoted DEPLOYED → DECLINING → TESTING",
        );

        await insertAuditRowSafe({
          action: "lifecycle.regime_drift_demotion",
          entityType: "strategy",
          entityId: strategyId,
          result: {
            correlationId,
            strategyId,
            strategyName,
            symbol,
            regime_trained_on: regimeTrainedOn,
            recent_regimes: recentRegimes,
            days_observed: DRIFT_CONSECUTIVE_DAYS,
            from_state: "DEPLOYED",
            to_state: "TESTING",
            note: "Two-step demotion via DECLINING intermediate state",
          },
          status: "warning",
          decisionAuthority: "system",
          correlationId,
        });
      }
    }
  } catch (err) {
    logger.error(
      { err, correlationId, strategyId },
      "regime-drift-detector: demotion threw — strategy may still be in DEPLOYED state",
    );
  }

  return {
    strategyId,
    strategyName,
    regimeTrainedOn,
    recentRegimes,
    driftDetected: true,
    demoted,
  };
}
