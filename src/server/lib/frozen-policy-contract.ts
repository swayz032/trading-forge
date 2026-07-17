/**
 * frozen-policy-contract.ts — Wave 29 Pass B.2 (backtest-core)
 *
 * Frozen-policy SHA-256 contract for Wave 29 Pass B.
 *
 * When CPCV + PBO + WFE all clear on a backtest, the 5-field policy slice is
 * hashed and stamped on the strategy.  Any subsequent re-optimisation that
 * would mutate those fields requires an operator HMAC override
 * (POST /api/admin/frozen-policy-override) with a rationale string ≥50 chars.
 *
 * Deep-scan #5 (2026-06-29): the PURE hash + drift-evaluation functions were
 * extracted to `./frozen-policy-hash.js` (DB-free) so tests can import them
 * without pulling `../db/index.js` (which throws when DATABASE_URL is unset).
 * They are RE-EXPORTED below so existing import sites are unchanged. Only the
 * DB-coupled `freezePolicyForStrategy` remains in this file.
 *
 * Import logger from ./logger.js (not ../index.js) per CLAUDE.md feedback rule.
 */

import { eq, and } from "drizzle-orm";
import { db } from "../db/index.js";
import { strategies, auditLog } from "../db/schema.js";
import { logger } from "./logger.js";
import {
  computeFrozenPolicyHash,
  evaluateFrozenPolicyDriftAtPromotion,
  type FrozenPolicySlice,
  type FrozenPolicyDriftResult,
} from "./frozen-policy-hash.js";

// Re-export the pure API so existing import sites (lifecycle-service, the HMAC
// override route, tests) continue to import from frozen-policy-contract.js.
export {
  computeFrozenPolicyHash,
  evaluateFrozenPolicyDriftAtPromotion,
};
export type { FrozenPolicySlice, FrozenPolicyDriftResult };

// ─── DB write ────────────────────────────────────────────────────────────────

/**
 * Atomically stamp all 4 frozen-policy columns when CPCV + PBO + WFE gates pass.
 *
 * Writes:
 *   frozen_policy_hash    — 64-char SHA-256 hex
 *   frozen_policy_set_at  — current UTC timestamp
 *   regime_trained_on     — institutional_regime value at time of freeze
 *   frozen_policy_override_count is NOT reset — the count is monotonically
 *                          increasing and reflects the total number of past
 *                          operator overrides.
 *
 * Emits audit action: frozen_policy.set
 *
 * post-m3-paper-execution-lifecycle wave (2026-07-17) CRIT fix: this write used to run as a
 * bare `UPDATE ... WHERE id = ?` with NO relationship to the promotion's own CAS-protected
 * transaction. Every one of this function's 5 call sites (all in lifecycle-service.ts) calls it
 * BEFORE the promotion's own `writeBlock` — a `db.transaction()` whose lifecycle-state UPDATE is
 * guarded by `WHERE id = ? AND lifecycleState = fromState` and rolls back (`lifecycle.race_blocked`)
 * the instant a concurrent promotion has already moved the strategy out of `fromState`. Because the
 * freeze write was unconditional, a promotion attempt that ultimately LOST that race (or was rolled
 * back for any other reason) could still leave its frozen_policy_hash/frozen_policy_set_at/
 * regime_trained_on stamped on the row — silently corrupting the very contract this subsystem exists
 * to enforce (per CLAUDE.md: "closes the silent-retraining-drift failure mode"), because the stamped
 * hash would no longer necessarily correspond to the config version the strategy was ACTUALLY
 * promoted under. Fix: add the identical CAS guard `WHERE id = ? AND lifecycleState = expectedFromState`
 * to THIS write — a concurrent promotion that has already changed the strategy's lifecycle state
 * before this freeze write executes now causes this function to throw
 * (frozen_policy_freeze_race_blocked) instead of silently overwriting. Every call site already wraps
 * this call in a fail-CLOSED try/catch that blocks the promotion on ANY thrown error, so this
 * integrates without further call-site changes beyond supplying the expected state.
 *
 * @param strategyId        Numeric strategy PK (from strategies.id — UUID string).
 * @param regimeAtFreeze    Institutional regime value (e.g. "TRENDING").
 * @param expectedFromState The lifecycle state the strategy MUST still be in for this freeze to
 *                          apply (the promotion's own `fromState`, e.g. "PAPER" for PAPER→DEPLOY_READY).
 *                          Required — every real caller has this value on hand at the point it
 *                          calls freezePolicyForStrategy, immediately before its own promotion attempt.
 * @returns                 The hash written and the wall-clock freeze timestamp.
 * @throws                  frozen_policy_freeze_race_blocked when a concurrent promotion has
 *                          already moved the strategy out of expectedFromState.
 */
export async function freezePolicyForStrategy(
  strategyId: string,
  regimeAtFreeze: string,
  expectedFromState: string,
): Promise<{ hash: string; frozen_at: Date }> {
  // Fetch current strategy config to compute the hash from the live config.
  const [strategy] = await db
    .select({ id: strategies.id, config: strategies.config })
    .from(strategies)
    .where(eq(strategies.id, strategyId));

  if (!strategy) {
    throw new Error(`freezePolicyForStrategy: strategy ${strategyId} not found`);
  }

  const hash = computeFrozenPolicyHash({ config: strategy.config });
  const frozenAt = new Date();

  // CAS guard: only stamp the freeze if the strategy is STILL in expectedFromState. Mirrors
  // lifecycle-service.ts's writeBlock CAS pattern exactly (WHERE id AND lifecycleState = fromState).
  const updatedRows = await db
    .update(strategies)
    .set({
      frozenPolicyHash: hash,
      frozenPolicySetAt: frozenAt,
      regimeTrainedOn: regimeAtFreeze,
      updatedAt: frozenAt,
    })
    .where(and(eq(strategies.id, strategyId), eq(strategies.lifecycleState, expectedFromState)))
    .returning({ id: strategies.id });

  if (!updatedRows || updatedRows.length === 0) {
    throw new Error(
      `frozen_policy_freeze_race_blocked: strategy ${strategyId} was no longer in ` +
      `'${expectedFromState}' when the freeze write executed — a concurrent promotion changed ` +
      `its lifecycle state first. Refusing to stamp a hash that would not correspond to the ` +
      `config version actually being promoted.`,
    );
  }

  // Emit frozen_policy.set audit (non-blocking — DB write is the atomic contract).
  await db
    .insert(auditLog)
    .values({
      action: "frozen_policy.set",
      entityId: strategyId,
      entityType: "strategy",
      status: "success",
      decisionAuthority: "gate",
      result: {
        hash,
        regime_trained_on: regimeAtFreeze,
        frozen_at: frozenAt.toISOString(),
      },
    })
    .catch((auditErr) => {
      logger.warn({ strategyId, err: auditErr }, "frozen_policy.set audit insert failed (non-blocking)");
    });

  logger.info({ strategyId, hash: hash.slice(0, 16) + "...", regimeAtFreeze }, "frozen_policy.set: policy frozen");

  return { hash, frozen_at: frozenAt };
}
