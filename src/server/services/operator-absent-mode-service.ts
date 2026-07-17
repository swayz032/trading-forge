/**
 * Operator-Absent Mode Service (Track 7)
 *
 * When active, auto-promotes DEPLOY_READY → PILOT for Tier 1 strategies
 * (Sharpe ≥ 2.0, all standard gates passed). Tier 2/3 remain human-only.
 *
 * Activation: OPERATOR_ABSENT_AUTOPROMOTE=true env var OR
 *             system_state.operator_absent_since IS NOT NULL.
 *
 * Every auto-promotion writes an audit_log row and a Discord alert.
 * Fail-CLOSED: any error in gate evaluation blocks promotion.
 */

import { eq, isNull, and, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { strategies, backtests, auditLog, frankensteinTestRuns, strategySignalVectors } from "../db/schema.js";
import { logger } from "../lib/logger.js";
import { insertAuditRow } from "../lib/audit-log-helper.js";
import { AlertFactory } from "./alert-service.js";
import { broadcastSSE } from "../routes/sse.js";
import { isActive as isPipelineActive } from "./pipeline-control-service.js";

const TIER1_SHARPE_FLOOR = 2.0;
const TIER1_CODE = "TIER_1";

// ─── Mode check ──────────────────────────────────────────────────────────────

/**
 * Returns true when operator-absent auto-promote is active.
 * Env var is the primary signal; DB column is the secondary (set via API).
 * Both are checked so the operator can toggle without a restart.
 */
export async function operatorAbsentModeActive(): Promise<boolean> {
  if (process.env["OPERATOR_ABSENT_AUTOPROMOTE"] === "true") return true;

  try {
    // Check system_state.operator_absent_since IS NOT NULL
    const { systemState } = await import("../db/schema.js");
    const [row] = await db
      .select({ operatorAbsentSince: systemState.operatorAbsentSince })
      .from(systemState)
      .where(eq(systemState.id, 1))
      .limit(1);

    return row?.operatorAbsentSince != null;
  } catch (err) {
    logger.warn({ err }, "operator-absent-mode: DB check failed — defaulting to env-only");
    return false;
  }
}

// ─── Gate check ──────────────────────────────────────────────────────────────

interface GateResult {
  passed: boolean;
  reasons: string[];
}

/**
 * Verifies all hard gates before an operator-absent auto-promotion:
 *   - Latest backtest is Tier 1
 *   - Rolling Sharpe ≥ 2.0
 *   - Frankenstein gate passed (no randomization detected)
 *   - A7 signal vector exists (required before DEPLOY_READY → PILOT)
 * Returns fail-CLOSED on any error.
 */
export async function checkAutopilotGates(strategyId: string): Promise<GateResult> {
  const reasons: string[] = [];

  try {
    // Latest completed backtest
    const [latestBt] = await db
      .select({
        id: backtests.id,
        tier: backtests.tier,
        sharpeRatio: backtests.sharpeRatio,
      })
      .from(backtests)
      .where(and(
        eq(backtests.strategyId, strategyId),
        eq(backtests.status, "completed"),
      ))
      .orderBy(desc(backtests.createdAt))
      .limit(1);

    if (!latestBt) {
      reasons.push("no_completed_backtest");
      return { passed: false, reasons };
    }

    if (latestBt.tier !== TIER1_CODE) {
      reasons.push(`not_tier1:${latestBt.tier ?? "null"}`);
      return { passed: false, reasons };
    }

    const sharpe = latestBt.sharpeRatio ? parseFloat(String(latestBt.sharpeRatio)) : 0;
    if (sharpe < TIER1_SHARPE_FLOOR) {
      reasons.push(`sharpe_below_floor:${sharpe.toFixed(2)}`);
      return { passed: false, reasons };
    }

    // Frankenstein gate: must have a passing run
    const [frankRun] = await db
      .select({ passed: frankensteinTestRuns.passed, status: frankensteinTestRuns.status })
      .from(frankensteinTestRuns)
      .where(and(
        eq(frankensteinTestRuns.backtestId, latestBt.id),
        eq(frankensteinTestRuns.status, "completed"),
      ))
      .orderBy(desc(frankensteinTestRuns.createdAt))
      .limit(1);

    if (!frankRun) {
      reasons.push("frankenstein_run_missing");
      return { passed: false, reasons };
    }
    if (!frankRun.passed) {
      reasons.push("frankenstein_gate_failed");
      return { passed: false, reasons };
    }

    // A7 signal vector existence check
    const [sigVec] = await db
      .select({ id: strategySignalVectors.id })
      .from(strategySignalVectors)
      .where(and(
        eq(strategySignalVectors.strategyId, strategyId),
        eq(strategySignalVectors.backtestId, latestBt.id),
      ))
      .limit(1);

    if (!sigVec) {
      reasons.push("a7_signal_vector_missing");
      return { passed: false, reasons };
    }

    return { passed: true, reasons: [] };
  } catch (err) {
    logger.error({ err, strategyId }, "operator-absent-mode: gate check error — fail-CLOSED");
    return { passed: false, reasons: ["gate_check_error"] };
  }
}

// ─── Auto-promotion sweep ─────────────────────────────────────────────────────

export interface AutoPromoteResult {
  promoted: string[];
  skipped: string[];
  errors: Array<{ strategyId: string; reason: string }>;
}

/**
 * Sweeps all DEPLOY_READY strategies. For each Tier 1 strategy with Sharpe ≥ 2.0
 * and all gates passed, auto-promotes to PILOT with actor="operator_absent_mode".
 *
 * Idempotent: already-PILOT strategies are excluded by the DEPLOY_READY filter.
 * Pipeline-pause guard applies (promotion is not a safety signal).
 *
 * @param correlationId - Optional trace ID from the calling cron/sweep context
 *   (P12: thread the lifecycle sweep correlationId so operator-absent auto-promotion
 *   audit rows are attributable back to the originating cron tick).
 */
export async function runOperatorAbsentAutoPromote(correlationId?: string): Promise<AutoPromoteResult> {
  const result: AutoPromoteResult = { promoted: [], skipped: [], errors: [] };

  const active = await operatorAbsentModeActive();
  if (!active) {
    logger.debug("operator-absent-mode: mode inactive — skipping sweep");
    return result;
  }

  const pipelineActive = await isPipelineActive();
  if (!pipelineActive) {
    logger.info("operator-absent-mode: pipeline paused — skipping auto-promote sweep");
    return result;
  }

  // Load DEPLOY_READY strategies
  const deployReady = await db
    .select({
      id: strategies.id,
      name: strategies.name,
      rollingSharpe30d: strategies.rollingSharpe30d,
    })
    .from(strategies)
    .where(eq(strategies.lifecycleState, "DEPLOY_READY"));

  logger.info(
    { count: deployReady.length },
    "operator-absent-mode: checking DEPLOY_READY strategies for auto-promotion",
  );

  for (const strategy of deployReady) {
    try {
      const rollingSharpeSince = strategy.rollingSharpe30d
        ? parseFloat(String(strategy.rollingSharpe30d))
        : 0;

      if (rollingSharpeSince < TIER1_SHARPE_FLOOR) {
        result.skipped.push(strategy.id);
        logger.debug(
          { strategyId: strategy.id, rollingSharpeSince },
          "operator-absent-mode: Sharpe below floor — skipping",
        );
        continue;
      }

      const gates = await checkAutopilotGates(strategy.id);
      if (!gates.passed) {
        result.skipped.push(strategy.id);
        logger.info(
          { strategyId: strategy.id, reasons: gates.reasons },
          "operator-absent-mode: gates failed — skipping",
        );
        continue;
      }

      // Import lifecycle service lazily to avoid circular dep
      const { LifecycleService } = await import("./lifecycle-service.js");
      const lifecycle = new LifecycleService();
      const promoteResult = await lifecycle.promoteStrategy(strategy.id, "DEPLOY_READY", "PILOT", {
        // Deep-scan 2026-06-28 (C-1): was actor:"system", which the B8 gate in
        // lifecycle-service.ts blocked — so this whole sweep was dead code. The
        // dedicated "operator_absent_mode" actor is the one authorized vacation
        // exception to the human-release requirement for DEPLOY_READY -> PILOT.
        actor: "operator_absent_mode",
        reason: `Operator-absent auto-promotion: Tier 1, rolling_sharpe=${rollingSharpeSince.toFixed(2)}`,
      });

      if (!promoteResult.success) {
        result.errors.push({ strategyId: strategy.id, reason: promoteResult.error ?? "unknown" });
        continue;
      }

      result.promoted.push(strategy.id);

      // Audit log — use insertAuditRow so missing correlationId is surfaced at runtime
      await insertAuditRow({
        action: "lifecycle.tier1_auto_promoted",
        entityType: "strategy",
        entityId: strategy.id,
        decisionAuthority: "system",
        input: { rollingSharpeSince } as Record<string, unknown>,
        result: {
          from: "DEPLOY_READY",
          to: "PILOT",
          actor: "operator_absent_mode",
          sharpe: rollingSharpeSince,
          tier: TIER1_CODE,
          gates_passed: true,
        } as Record<string, unknown>,
        status: "success",
        correlationId: correlationId ?? null,
      });

      // SSE
      broadcastSSE("lifecycle:operator_absent_autopromoted", {
        strategyId: strategy.id,
        // deep-scan Obs re-verify #3: vacation-mode Tier-1 autopromote is the unattended path where
        // SSE→audit_log correlation reconstruction matters MOST; carry the same correlationId the audit row does.
        correlationId: correlationId ?? null,
        name: strategy.name,
        from: "DEPLOY_READY",
        to: "PILOT",
        sharpe: rollingSharpeSince,
      });

      // Discord
      await AlertFactory.deployReady(strategy.id, `Operator-absent Tier 1 auto-promoted DEPLOY_READY → PILOT (rolling_sharpe=${rollingSharpeSince.toFixed(2)})`);

      logger.info(
        { strategyId: strategy.id, name: strategy.name, sharpe: rollingSharpeSince },
        "operator-absent-mode: Tier 1 auto-promoted DEPLOY_READY → PILOT",
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push({ strategyId: strategy.id, reason: msg });
      logger.error({ err, strategyId: strategy.id }, "operator-absent-mode: promotion error");
    }
  }

  return result;
}

// ─── Absence period management ───────────────────────────────────────────────

/**
 * Record the start of an operator-absent period in the DB.
 * Call when OPERATOR_ABSENT_AUTOPROMOTE is set (boot-time or API trigger).
 */
export async function recordAbsenceStart(reason?: string): Promise<void> {
  try {
    const { operatorAbsentPeriods } = await import("../db/schema.js");
    // Only insert if there's no currently-open period.
    // HIGH fix (critic-replay-lifecycle-misc, 2026-07-17): this previously checked
    // isNotNull(startedAt) — but startedAt is `.notNull().defaultNow()`, so that
    // condition is trivially true for EVERY row ever inserted (open or already
    // closed). The schema comment on endedAt is explicit: "NULL = currently
    // absent". So after the very first absence period in the table's history,
    // `existing` was always truthy and every subsequent recordAbsenceStart()
    // call became a permanent silent no-op — no new operator_absent_periods row
    // was ever written again, for any future vacation, regardless of whether the
    // prior period had already been closed by recordAbsenceEnd().
    const [existing] = await db
      .select({ id: operatorAbsentPeriods.id })
      .from(operatorAbsentPeriods)
      .where(isNull(operatorAbsentPeriods.endedAt))
      .limit(1);

    if (!existing) {
      await db.insert(operatorAbsentPeriods).values({ reason: reason ?? null, endedAt: null });
      logger.info({ reason }, "operator-absent-mode: absence period started");
    }
  } catch (err) {
    logger.warn({ err }, "operator-absent-mode: failed to record absence start (non-blocking)");
  }
}

/**
 * Close the current absence period.
 * Call when OPERATOR_ABSENT_AUTOPROMOTE is unset or operator returns.
 */
export async function recordAbsenceEnd(endedBy: string): Promise<void> {
  try {
    const { operatorAbsentPeriods } = await import("../db/schema.js");
    // HIGH fix (critic-replay-lifecycle-misc, 2026-07-17): this previously matched
    // isNotNull(startedAt) — again trivially true for every row ever inserted —
    // so every call to recordAbsenceEnd() overwrote endedAt/endedBy on EVERY
    // historical absence period (open or already closed), wiping the real
    // close timestamp on prior periods and recording a nonsensical endedBy on
    // rows that had nothing to do with this close event. Scoped to the
    // genuinely-open row (endedAt IS NULL) per the schema's own contract.
    await db
      .update(operatorAbsentPeriods)
      .set({ endedAt: new Date(), endedBy })
      .where(isNull(operatorAbsentPeriods.endedAt));
    logger.info({ endedBy }, "operator-absent-mode: absence period closed");
  } catch (err) {
    logger.warn({ err }, "operator-absent-mode: failed to record absence end (non-blocking)");
  }
}
