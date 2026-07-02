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

import { eq } from "drizzle-orm";
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
 * @param strategyId      Numeric strategy PK (from strategies.id — UUID string).
 * @param regimeAtFreeze  Institutional regime value (e.g. "TRENDING").
 * @returns               The hash written and the wall-clock freeze timestamp.
 */
export async function freezePolicyForStrategy(
  strategyId: string,
  regimeAtFreeze: string,
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

  await db
    .update(strategies)
    .set({
      frozenPolicyHash: hash,
      frozenPolicySetAt: frozenAt,
      regimeTrainedOn: regimeAtFreeze,
      updatedAt: frozenAt,
    })
    .where(eq(strategies.id, strategyId));

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
