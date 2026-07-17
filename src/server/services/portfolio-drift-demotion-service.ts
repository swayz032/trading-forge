/**
 * portfolio-drift-demotion-service.ts — Deep-Scan #16 Wave 3 (dead-auto-demotion HIGH)
 *
 * Restores, IN SOURCE CONTROL, the demotion that the live n8n "Daily Portfolio
 * Monitor" workflow ("Log Drift Alert and Transition" node) was SUPPOSED to be
 * doing but silently was NOT.
 *
 * ── Why the n8n node was dead ────────────────────────────────────────────────
 * The node PATCHed /api/strategies/{id}/lifecycle with body only {fromState,
 * toState}. That route HARD-REQUIRES an HMAC timestamp+signature
 * (ADMIN_PROMOTE_HMAC_SECRET, 60s drift). The node sent neither → every call
 * returned 401 (or 503 if the secret is unset), which onError:continueRegularOutput
 * swallowed → the workflow showed GREEN while NO demotion ever occurred.
 * Portfolio-drift auto-demotion has therefore been silently non-functional.
 *
 * ── What the dead n8n node demoted on ────────────────────────────────────────
 * ABSOLUTE rolling-30-day Sharpe floor: `rolling_sharpe_30d < 1.0`
 * (n8n fell back to `sharpeRatio` then to `0` — a fail-DANGEROUS default that
 * would have demoted EVERY strategy if the API ever omitted both fields).
 *
 * This condition is NOT covered by any server-side cron:
 *   - regime-drift-detector-service.ts  → regime MISMATCH (regime_trained_on vs
 *     live institutional_regime), orthogonal signal.
 *   - weekly-drift-halt-service.ts       → 2σ z-score of LIVE-vs-backtest daily
 *     returns → GLOBAL kill-switch HALT, not a per-strategy lifecycle demotion.
 *   - strategy-revalidation-service.ts   → strategy AGE (frozen_policy_set_at),
 *     not performance.
 * So we build it in-process, keeping the authoritative logic in source control
 * and bypassing the HTTP HMAC gate (direct LifecycleService call).
 *
 * ── The rolling-Sharpe source ────────────────────────────────────────────────
 * We read the REAL, already-persisted `strategies.rolling_sharpe_30d` column,
 * refreshed every 4h by the `rolling-sharpe` cron via metrics-aggregator.ts
 * (annualised trade-level proxy = (mean/std)×sqrt(252)). This is the exact field
 * the dead n8n node read. Unlike the n8n node we FAIL-SAFE on a null/absent value
 * (skip + info audit, NEVER demote) — the n8n's `|| 0` default is a production bug
 * we deliberately do not reproduce.
 *
 * ── Fail-safe rollout (default-OFF) ──────────────────────────────────────────
 * rolling_sharpe_30d is metrics-aggregator's OWN docstring-flagged "not used for
 * promotion decisions" proxy — noisy for low-trade-count strategies. Auto-demoting
 * live DEPLOYED strategies on a noisy proxy is high-impact, so this service ships
 * DEFAULT-OFF: with PORTFOLIO_DRIFT_DEMOTION_ENABLED unset/false it runs in
 * effective dry-run (detect + telemetry + advisory Discord, NO lifecycle mutation)
 * so the operator can review real-scale detection telemetry before flipping it to
 * live demotion. Mirrors the "ship strict, flip with data" institutional pattern.
 *
 * ── Zombie-DECLINING recovery ────────────────────────────────────────────────
 * Two-step demotion DEPLOYED → DECLINING → TESTING (VALID_TRANSITIONS). If step2
 * fails, the strategy is stranded in DECLINING. We do NOT duplicate a zombie sweep
 * — regime-drift-detector-service.ts's existing zombie-DECLINING compensating
 * sweep (runs each detector invocation, retries DECLINING → TESTING for any row
 * stuck > ZOMBIE_DECLINING_THRESHOLD_MS regardless of who demoted it) recovers it.
 *
 * Audit actions:
 *   portfolio_drift_demotion.no_sharpe_data_skipped  (info — rolling_sharpe_30d NULL)
 *   portfolio_drift_demotion.dry_run                 (info — drift found, demotion suppressed)
 *   strategy.portfolio_drift_detected                (warn — rolling Sharpe < floor)
 *   lifecycle.portfolio_drift_demotion               (warn — DEPLOYED → DECLINING → TESTING)
 *   lifecycle.portfolio_drift_zombie_declining       (error — step2 failed, zombie sweep will retry)
 *   portfolio_drift_demotion.completed               (info — per-tick summary)
 *
 * Import notes: logger from ./logger.js leaf module (feedback_helper_logger_import.md).
 */

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { strategies } from "../db/schema.js";
import { logger } from "../lib/logger.js";
import { insertAuditRowSafe } from "../lib/audit-log-helper.js";
import { portfolioDriftDemotionsTotal } from "../lib/metrics-registry.js";
import { appendFamilyGradePostscript } from "../lib/notification-helpers.js";
import { notifyCritical, notifyWarning } from "./notification-service.js";
import { LifecycleService } from "./lifecycle-service.js";
import { broadcastSSE, LIFECYCLE_GATE_EVENTS } from "../routes/sse.js";

// ─── Constants ──────────────────────────────────────────────────────────────

/** Absolute rolling-30d Sharpe floor below which a DEPLOYED strategy is demoted. */
export const PORTFOLIO_DRIFT_SHARPE_FLOOR = Number(
  process.env["PORTFOLIO_DRIFT_SHARPE_FLOOR"] ?? "1.0",
);

/**
 * Master enable flag. DEFAULT FALSE. When false the service still runs (detect +
 * telemetry + advisory Discord + audit) but performs NO lifecycle mutation — an
 * effective dry-run so the operator can validate the rolling-Sharpe scale against
 * real DEPLOYED strategies before enabling live demotions. Flip to "true" to
 * activate real DEPLOYED → DECLINING → TESTING demotion.
 */
export function isPortfolioDriftDemotionEnabled(): boolean {
  return String(process.env["PORTFOLIO_DRIFT_DEMOTION_ENABLED"] ?? "false").toLowerCase() === "true";
}

// ─── Public types ─────────────────────────────────────────────────────────────

export interface PortfolioDriftStrategyResult {
  strategyId: string;
  strategyName: string;
  rollingSharpe30d: number | null;
  driftDetected: boolean;
  demoted: boolean;
  skippedReason?: "no_sharpe_data" | "dry_run";
}

export interface PortfolioDriftDemotionResult {
  status: "completed";
  correlationId: string;
  durationMs: number;
  strategiesChecked: number;
  driftDetected: number;
  demoted: number;
  skipped: number;
  dryRun: boolean;
  strategyResults?: PortfolioDriftStrategyResult[];
}

// ─── Core sweep ────────────────────────────────────────────────────────────────

/**
 * runPortfolioDriftDemotion — main entry point (called by the daily scheduler cron).
 *
 * @param opts.now     Override "now" for tests (not currently used for gating;
 *                     the scheduler owns the ET-hour guard). Reserved for parity
 *                     with sibling drift services.
 * @param opts.dryRun  Explicit dry-run override. When omitted, dry-run is derived
 *                     from !isPortfolioDriftDemotionEnabled() (default-OFF).
 */
export async function runPortfolioDriftDemotion(opts?: {
  now?: number;
  dryRun?: boolean;
}): Promise<PortfolioDriftDemotionResult> {
  const correlationId = randomUUID();
  const startMs = Date.now();
  // Explicit opts.dryRun wins; otherwise dry-run whenever the master flag is OFF.
  const dryRun = opts?.dryRun ?? !isPortfolioDriftDemotionEnabled();

  // Query DEPLOYED strategies that HAVE a rolling Sharpe. Rows with NULL
  // rolling_sharpe_30d are excluded here AND re-surfaced as an explicit info-skip
  // below (defensive: metrics-aggregator has not yet computed one for them).
  const deployed = await db
    .select({
      id: strategies.id,
      name: strategies.name,
      rollingSharpe30d: strategies.rollingSharpe30d,
    })
    .from(strategies)
    .where(eq(strategies.lifecycleState, "DEPLOYED"));

  logger.info(
    { correlationId, strategyCount: deployed.length, dryRun, floor: PORTFOLIO_DRIFT_SHARPE_FLOOR },
    "portfolio-drift-demotion: starting daily sweep",
  );

  const lifecycleService = new LifecycleService();
  const strategyResults: PortfolioDriftStrategyResult[] = [];
  let driftDetectedCount = 0;
  let demotedCount = 0;
  let skippedCount = 0;

  for (const s of deployed) {
    let result: PortfolioDriftStrategyResult;
    try {
      result = await _evaluateStrategy(s, dryRun, correlationId, lifecycleService);
    } catch (err) {
      logger.error({ correlationId, strategyId: s.id, err }, "portfolio-drift-demotion: per-strategy eval threw — skipping");
      await insertAuditRowSafe({
        action: "portfolio_drift_demotion.strategy_eval_failed",
        entityType: "strategy",
        entityId: s.id,
        result: { correlationId, error_message: String(err) },
        status: "warning",
        decisionAuthority: "system",
        correlationId,
      });
      skippedCount++;
      continue;
    }

    strategyResults.push(result);
    if (result.skippedReason === "no_sharpe_data") {
      skippedCount++;
    } else if (result.driftDetected) {
      driftDetectedCount++;
      if (result.demoted) demotedCount++;
    }
  }

  const durationMs = Date.now() - startMs;
  logger.info(
    { correlationId, strategiesChecked: deployed.length, driftDetected: driftDetectedCount, demoted: demotedCount, skipped: skippedCount, durationMs, dryRun },
    "portfolio-drift-demotion: sweep completed",
  );

  await insertAuditRowSafe({
    action: "portfolio_drift_demotion.completed",
    entityType: "scheduler_job",
    entityId: "portfolio-drift-demotion",
    result: {
      correlationId,
      strategiesChecked: deployed.length,
      driftDetected: driftDetectedCount,
      demoted: demotedCount,
      skipped: skippedCount,
      durationMs,
      dryRun,
      floor: PORTFOLIO_DRIFT_SHARPE_FLOOR,
    },
    status: "success",
    decisionAuthority: "system",
    correlationId,
  });

  return {
    status: "completed",
    correlationId,
    durationMs,
    strategiesChecked: deployed.length,
    driftDetected: driftDetectedCount,
    demoted: demotedCount,
    skipped: skippedCount,
    dryRun,
    strategyResults,
  };
}

// ─── Per-strategy evaluation ────────────────────────────────────────────────

async function _evaluateStrategy(
  s: { id: string; name: string; rollingSharpe30d: string | null },
  dryRun: boolean,
  correlationId: string,
  lifecycleService: LifecycleService,
): Promise<PortfolioDriftStrategyResult> {
  const { id: strategyId, name: strategyName } = s;

  // Fail-SAFE: no rolling Sharpe computed yet → skip, NEVER demote.
  // (The dead n8n node defaulted this to 0 and would have demoted everything.)
  const raw = s.rollingSharpe30d;
  const sharpe = raw == null ? null : Number(raw);
  if (sharpe == null || !Number.isFinite(sharpe)) {
    await insertAuditRowSafe({
      action: "portfolio_drift_demotion.no_sharpe_data_skipped",
      entityType: "strategy",
      entityId: strategyId,
      result: { correlationId, strategyId, strategyName, rolling_sharpe_30d: raw },
      status: "info",
      decisionAuthority: "system",
      correlationId,
    });
    return { strategyId, strategyName, rollingSharpe30d: null, driftDetected: false, demoted: false, skippedReason: "no_sharpe_data" };
  }

  // No drift — rolling Sharpe at or above the floor.
  if (sharpe >= PORTFOLIO_DRIFT_SHARPE_FLOOR) {
    return { strategyId, strategyName, rollingSharpe30d: sharpe, driftDetected: false, demoted: false };
  }

  // ── Drift detected ──────────────────────────────────────────────────────────
  logger.warn(
    { correlationId, strategyId, strategyName, rollingSharpe30d: sharpe, floor: PORTFOLIO_DRIFT_SHARPE_FLOOR },
    "portfolio-drift-demotion: rolling Sharpe below floor",
  );

  await insertAuditRowSafe({
    action: "strategy.portfolio_drift_detected",
    entityType: "strategy",
    entityId: strategyId,
    result: {
      correlationId,
      strategyId,
      strategyName,
      rolling_sharpe_30d: sharpe,
      floor: PORTFOLIO_DRIFT_SHARPE_FLOOR,
    },
    status: "warning",
    decisionAuthority: "system",
    correlationId,
  });

  try {
    portfolioDriftDemotionsTotal.labels({ outcome: dryRun ? "detected_dry_run" : "demoted" }).inc();
  } catch (_promErr) { /* non-blocking */ }

  // Dry-run (explicit OR master flag OFF): detect but suppress Discord + lifecycle change.
  if (dryRun) {
    logger.info(
      { correlationId, strategyId, strategyName },
      "portfolio-drift-demotion: dry_run (flag off or explicit) — skipping demotion",
    );
    await insertAuditRowSafe({
      action: "portfolio_drift_demotion.dry_run",
      entityType: "strategy",
      entityId: strategyId,
      result: {
        correlationId,
        strategyId,
        strategyName,
        rolling_sharpe_30d: sharpe,
        floor: PORTFOLIO_DRIFT_SHARPE_FLOOR,
        dry_run: true,
      },
      status: "info",
      decisionAuthority: "system",
      correlationId,
    });
    return { strategyId, strategyName, rollingSharpe30d: sharpe, driftDetected: true, demoted: false, skippedReason: "dry_run" };
  }

  // ── Live demotion path (master flag ON) ──────────────────────────────────────
  // HIGH fix (critic-replay-lifecycle-misc, 2026-07-17): the operator notifyWarning
  // announcing "demoted to TESTING" previously fired HERE — unconditionally, BEFORE
  // lifecycleService.promoteStrategy() was even called. If step1 threw, returned
  // success:false, or step2 failed (zombie DECLINING), the operator still received
  // a Discord message claiming the strategy had been demoted DEPLOYED → DECLINING →
  // TESTING when it had NOT been — a false-positive safety notification (worse: on
  // a step1 failure the strategy is silently still DEPLOYED and live-trading, with
  // no signal at all that the intended demotion never took effect, since the only
  // record was a log line). Moved to fire ONLY on genuine completion (the `demoted
  // = true` branch below) and paired with a distinct notifyWarning on outright
  // step1 failure so that failure case — previously silent apart from a log line —
  // is now visible to the operator too, matching the step2/zombie case which
  // already notified via notifyCritical.
  let demoted = false;
  try {
    const step1 = await lifecycleService.promoteStrategy(strategyId, "DEPLOYED", "DECLINING", {
      correlationId,
      actor: "system",
      reason: `portfolio_drift: rolling_sharpe_30d=${sharpe.toFixed(3)} < floor=${PORTFOLIO_DRIFT_SHARPE_FLOOR}`,
    });

    if (!step1.success) {
      logger.error({ correlationId, strategyId, error: step1.error }, "portfolio-drift-demotion: DEPLOYED → DECLINING failed");
      notifyWarning(
        `[DS16W3] Portfolio Drift — Strategy ${strategyName} demotion FAILED — still DEPLOYED`,
        appendFamilyGradePostscript(
          `[WARN] Portfolio Drift Demotion FAILED — Strategy: ${strategyName} (${strategyId})\n` +
          `Rolling 30d Sharpe: ${sharpe.toFixed(3)} (floor: ${PORTFOLIO_DRIFT_SHARPE_FLOOR})\n` +
          `Action: Demotion DEPLOYED → DECLINING was ATTEMPTED but FAILED: ${step1.error ?? "unknown error"}\n` +
          `The strategy remains DEPLOYED and will be re-evaluated on the next sweep.\n` +
          `Correlation ID: ${correlationId}`,
          "One of the strategies has been underperforming, and the bot's automatic pause attempt failed.",
          "The strategy is still trading live. Tell Tony to check on it — this needs a human look.",
        ),
        { strategyId, strategyName, rollingSharpe30d: sharpe, floor: PORTFOLIO_DRIFT_SHARPE_FLOOR, correlationId, step1_error: step1.error },
      );
    } else {
      const step2 = await lifecycleService.promoteStrategy(strategyId, "DECLINING", "TESTING", {
        correlationId,
        actor: "system",
        reason: "portfolio_drift_demotion: fresh CPCV required",
      });

      if (!step2.success) {
        logger.error(
          { correlationId, strategyId, error: step2.error },
          "portfolio-drift-demotion: DECLINING → TESTING failed — strategy in zombie DECLINING state (regime-drift zombie sweep will retry)",
        );
        notifyCritical(
          `[portfolio-drift] Strategy ${strategyName} stuck in zombie DECLINING — step2 failed`,
          appendFamilyGradePostscript(
            `Strategy "${strategyName}" (${strategyId}) was moved DEPLOYED → DECLINING but the second step ` +
            `(DECLINING → TESTING) failed: ${step2.error ?? "unknown error"}. The strategy is now in zombie ` +
            `DECLINING state. The regime-drift-detector's compensating sweep will retry within ~25h.`,
            "A strategy got stuck part-way through being paused and the bot could not auto-fix it.",
            "No trades are at risk — the strategy is halted. Tell Tony to reset its status when convenient.",
          ),
          { strategyId, strategyName, correlationId, step2_error: step2.error },
        );
        await insertAuditRowSafe({
          action: "lifecycle.portfolio_drift_zombie_declining",
          entityType: "strategy",
          entityId: strategyId,
          result: {
            correlationId,
            strategyId,
            strategyName,
            step2_error: step2.error,
            note: "regime-drift-detector zombie_declining_sweep will retry DECLINING→TESTING on next run",
          },
          status: "error",
          decisionAuthority: "system",
          correlationId,
        });
      } else {
        demoted = true;
        logger.warn({ correlationId, strategyId, strategyName }, "portfolio-drift-demotion: strategy demoted DEPLOYED → DECLINING → TESTING");

        notifyWarning(
          `[DS16W3] Portfolio Drift — Strategy ${strategyName} demoted to TESTING`,
          appendFamilyGradePostscript(
            `[WARN] Portfolio Drift Demotion — Strategy: ${strategyName} (${strategyId})\n` +
            `Rolling 30d Sharpe: ${sharpe.toFixed(3)} (floor: ${PORTFOLIO_DRIFT_SHARPE_FLOOR})\n` +
            `Action: Strategy demoted DEPLOYED → DECLINING → TESTING for re-validation.\n` +
            `Strategy must complete fresh CPCV + PBO + WFE before re-promotion.\n` +
            `Correlation ID: ${correlationId}`,
            "One of the strategies has been underperforming (its rolling risk-adjusted return fell below the safe floor).",
            "The bot automatically paused it for re-testing. No action needed — it re-qualifies before trading again.",
          ),
          { strategyId, strategyName, rollingSharpe30d: sharpe, floor: PORTFOLIO_DRIFT_SHARPE_FLOOR, correlationId },
        );

        try {
          broadcastSSE(LIFECYCLE_GATE_EVENTS.PORTFOLIO_DRIFT_DEMOTED, {
            strategyId,
            strategyName,
            rollingSharpe30d: sharpe,
            floor: PORTFOLIO_DRIFT_SHARPE_FLOOR,
            from: "DEPLOYED",
            to: "TESTING",
            correlationId,
          });
        } catch (_sseErr) { /* non-blocking */ }

        await insertAuditRowSafe({
          action: "lifecycle.portfolio_drift_demotion",
          entityType: "strategy",
          entityId: strategyId,
          result: {
            correlationId,
            strategyId,
            strategyName,
            rolling_sharpe_30d: sharpe,
            floor: PORTFOLIO_DRIFT_SHARPE_FLOOR,
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
    logger.error({ err, correlationId, strategyId }, "portfolio-drift-demotion: demotion threw — strategy may still be DEPLOYED");
    notifyWarning(
      `[DS16W3] Portfolio Drift — Strategy ${strategyName} demotion attempt threw — still DEPLOYED`,
      appendFamilyGradePostscript(
        `[WARN] Portfolio Drift Demotion threw an exception — Strategy: ${strategyName} (${strategyId})\n` +
        `Rolling 30d Sharpe: ${sharpe.toFixed(3)} (floor: ${PORTFOLIO_DRIFT_SHARPE_FLOOR})\n` +
        `Error: ${err instanceof Error ? err.message : String(err)}\n` +
        `The strategy's lifecycle state is unconfirmed and will be re-evaluated on the next sweep.\n` +
        `Correlation ID: ${correlationId}`,
        "One of the strategies has been underperforming, and the bot hit an unexpected error trying to pause it.",
        "The strategy may still be trading live. Tell Tony to check on it — this needs a human look.",
      ),
      { strategyId, strategyName, rollingSharpe30d: sharpe, floor: PORTFOLIO_DRIFT_SHARPE_FLOOR, correlationId, error: err instanceof Error ? err.message : String(err) },
    );
  }

  return { strategyId, strategyName, rollingSharpe30d: sharpe, driftDetected: true, demoted };
}
