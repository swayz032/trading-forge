/**
 * strategy-revalidation-service.ts — deepscan6 R2 (strategy-age re-validation gate)
 *
 * Institutional-standard gap (2025-2026 research): AI has compressed strategy alpha
 * half-lives to ~18 months, yet a DEPLOYED strategy stays live indefinitely with no
 * scheduled re-validation. This daily cron flags DEPLOYED strategies by the age of their
 * last validation (the `frozen_policy_set_at` stamp, set when CPCV + PBO + WFE last passed):
 *   - age > STRATEGY_REVALIDATION_WARN_DAYS  (default 365) → WARN (re-validation due)
 *   - age > STRATEGY_REVALIDATION_FORCE_DAYS (default 548 ≈ 18mo) → force re-validation:
 *       two-step demotion DEPLOYED → DECLINING → TESTING (re-runs the gate chain), mirroring
 *       the regime-drift-detector demotion so the transition stays observable.
 *
 * Reuses existing infra — NO new table/migration (frozen_policy_set_at already exists),
 * the LifecycleService demotion path, and the audit/Discord helpers. Legacy strategies with
 * frozen_policy_set_at = NULL skip (never frozen → nothing to age out; regime-drift/other
 * gates cover them).
 *
 * Audit actions:
 *   strategy.revalidation_due            (warn — age > WARN_DAYS)
 *   strategy.revalidation_forced         (warn — age > FORCE_DAYS, demotion attempted)
 *   strategy_revalidation.completed      (info — per-tick summary)
 *   strategy_revalidation.legacy_skipped (info — frozen_policy_set_at NULL)
 */
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { strategies } from "../db/schema.js";
import { logger } from "../lib/logger.js";
import { insertAuditRowSafe } from "../lib/audit-log-helper.js";
import { notifyWarning } from "./notification-service.js";
import { appendFamilyGradePostscript } from "../lib/notification-helpers.js";
import { LifecycleService } from "./lifecycle-service.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RevalidationResult {
  scanned: number;
  due: number;
  forced: number;
  demotionFailures: number;
}

export async function runStrategyAgeRevalidation(opts?: {
  now?: number;
  dryRun?: boolean;
}): Promise<RevalidationResult> {
  const now = opts?.now ?? Date.now();
  const dryRun = opts?.dryRun ?? false;
  const warnDays = Number(process.env["STRATEGY_REVALIDATION_WARN_DAYS"] ?? "365");
  const forceDays = Number(process.env["STRATEGY_REVALIDATION_FORCE_DAYS"] ?? "548");

  const rows = await db
    .select({
      id: strategies.id,
      name: strategies.name,
      frozenPolicySetAt: strategies.frozenPolicySetAt,
    })
    .from(strategies)
    .where(and(eq(strategies.lifecycleState, "DEPLOYED"), isNotNull(strategies.frozenPolicySetAt)));

  const result: RevalidationResult = { scanned: rows.length, due: 0, forced: 0, demotionFailures: 0 };

  for (const s of rows) {
    if (!s.frozenPolicySetAt) continue; // guarded by isNotNull, defensive
    const setAtMs = (s.frozenPolicySetAt instanceof Date ? s.frozenPolicySetAt : new Date(s.frozenPolicySetAt)).getTime();
    const ageDays = (now - setAtMs) / DAY_MS;

    if (ageDays > forceDays) {
      result.forced++;
      await insertAuditRowSafe({
        action: "strategy.revalidation_forced",
        entityType: "strategy",
        entityId: s.id,
        decisionAuthority: "gate",
        status: "warning",
        input: { ageDays: Math.round(ageDays), forceDays } as Record<string, unknown>,
        result: { note: "age exceeded mandatory re-validation window; demoting for re-CPCV", dryRun } as Record<string, unknown>,
        correlationId: null,
      }).catch(() => {});
      if (!dryRun) {
        try {
          const lifecycle = new LifecycleService();
          // Two-step demotion (DEPLOYED → DECLINING → TESTING) so a fresh CPCV+PBO+WFE pass
          // re-freezes the hash + re-stamps frozen_policy_set_at, resetting the age clock.
          const step1 = await lifecycle.promoteStrategy(s.id, "DEPLOYED", "DECLINING");
          if (step1.success) {
            const step2 = await lifecycle.promoteStrategy(s.id, "DECLINING", "TESTING");
            if (!step2.success) {
              result.demotionFailures++;
              logger.warn({ strategyId: s.id, reason: step2.error }, "R2 revalidation: step2 DECLINING→TESTING failed");
            }
          } else {
            result.demotionFailures++;
            logger.warn({ strategyId: s.id, reason: step1.error }, "R2 revalidation: step1 DEPLOYED→DECLINING failed");
          }
        } catch (demoteErr) {
          result.demotionFailures++;
          logger.warn({ strategyId: s.id, err: String(demoteErr) }, "R2 revalidation: demotion threw (non-blocking)");
        }
      }
      notifyWarning(
        `Strategy overdue for re-validation: ${s.name}`,
        appendFamilyGradePostscript(
          `${s.name} was last validated ${Math.round(ageDays)} days ago (> ${forceDays}d mandatory window). Demoting for a fresh CPCV + PBO + WFE pass.`,
          "This bot hasn't been re-tested in over 18 months — its edge may be stale.",
          "It's being paused for automatic re-testing. You don't need to act; it re-deploys if it passes.",
        ),
      );
    } else if (ageDays > warnDays) {
      result.due++;
      await insertAuditRowSafe({
        action: "strategy.revalidation_due",
        entityType: "strategy",
        entityId: s.id,
        decisionAuthority: "gate",
        status: "warning",
        input: { ageDays: Math.round(ageDays), warnDays } as Record<string, unknown>,
        result: { note: "re-validation recommended (age > warn window; not yet forced)" } as Record<string, unknown>,
        correlationId: null,
      }).catch(() => {});
    }
  }

  await insertAuditRowSafe({
    action: "strategy_revalidation.completed",
    entityType: "system",
    entityId: null,
    decisionAuthority: "gate",
    status: "success",
    input: { warnDays, forceDays, dryRun } as Record<string, unknown>,
    result: result as unknown as Record<string, unknown>,
    correlationId: null,
  }).catch(() => {});

  logger.info(result, "R2 strategy-age re-validation sweep complete");
  return result;
}
