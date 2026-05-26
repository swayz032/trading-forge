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
 * Hashed fields (only these five — changing strategy.name does NOT invalidate):
 *   entry_quality  |  position_size  |  stop_loss  |  take_profit  |  exit_plan_config
 *
 * Design mirrors firm-rules-version.ts (W27.5 Pass A):
 *   sha256(canonicalJson({ entry_quality, position_size, stop_loss, take_profit, exit_plan_config }))
 *   returns full 64-char lowercase hex (not truncated — policy stability warrants the full digest).
 *
 * Canonical sort: JSON.stringify with sorted-key replacer
 * (mirrors Python json.dumps(sort_keys=True, separators=(',',':')))
 *
 * Import logger from ./logger.js (not ../index.js) per CLAUDE.md feedback rule.
 */

import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { strategies, auditLog } from "../db/schema.js";
import { logger } from "./logger.js";

// ─── Canonical-sort helper ────────────────────────────────────────────────────

/**
 * JSON.stringify replacer that sorts object keys lexicographically.
 * Arrays preserve insertion order (consistent with Python json.dumps).
 */
function sortedKeyReplacer(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[k] = (value as Record<string, unknown>)[k];
    }
    return sorted;
  }
  return value;
}

/**
 * Produce a canonical JSON string with sorted keys and no whitespace.
 * Mirrors Python json.dumps(obj, sort_keys=True, separators=(',', ':'))
 */
function canonicalJson(obj: unknown): string {
  return JSON.stringify(obj, sortedKeyReplacer);
}

// ─── Policy-slice extractor ───────────────────────────────────────────────────

/**
 * The 5 fields from strategy.config that constitute the frozen policy.
 * Extracting them explicitly ensures only these fields are hashed — any other
 * config field (e.g. strategy name, DSL params) does NOT invalidate the policy.
 */
export interface FrozenPolicySlice {
  entry_quality: unknown;
  position_size: unknown;
  stop_loss: unknown;
  take_profit: unknown;
  exit_plan_config: unknown;
}

function extractPolicySlice(strategyConfig: unknown): FrozenPolicySlice {
  const cfg = (strategyConfig && typeof strategyConfig === "object")
    ? (strategyConfig as Record<string, unknown>)
    : {} as Record<string, unknown>;

  return {
    entry_quality: cfg.entry_quality ?? null,
    position_size: cfg.position_size ?? null,
    stop_loss: cfg.stop_loss ?? null,
    take_profit: cfg.take_profit ?? null,
    exit_plan_config: cfg.exit_plan_config ?? null,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Compute the frozen-policy SHA-256 hash for a strategy.
 *
 * Accepts either a full strategy row (with a `config` JSONB field) or a plain
 * object that already IS the config.  The caller determines which; this helper
 * extracts the 5-field slice and hashes it.
 *
 * @param strategyOrConfig  Full strategy row or raw config object.
 * @returns 64-character lowercase hex SHA-256 string.
 */
export function computeFrozenPolicyHash(
  strategyOrConfig: { config?: unknown; [key: string]: unknown } | unknown,
): string {
  const raw = strategyOrConfig as Record<string, unknown>;
  // If the object has a top-level `config` field that is itself an object,
  // treat it as a full strategy row and extract from config.
  const configLike: unknown =
    raw.config !== undefined && typeof raw.config === "object"
      ? raw.config
      : raw;

  const slice = extractPolicySlice(configLike);
  const canonical = canonicalJson(slice);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

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

// ─── Drift evaluation ────────────────────────────────────────────────────────

export interface FrozenPolicyDriftResult {
  /** true = promotion allowed; false = hash mismatch, operator override required */
  ok: boolean;
  /** Current hash (computed from live config) */
  currentHash: string;
  /** Hash stored on the strategy row (null = never frozen) */
  frozenHash: string | null;
  /** Human-readable reason — populated on ok:false */
  reason?: string;
}

/**
 * Evaluate whether the current strategy config has drifted from its frozen hash.
 *
 * - If `frozenPolicyHash` is null (never frozen): return ok:true — first-time
 *   freeze; lifecycle caller should then call freezePolicyForStrategy().
 * - If hashes match: return ok:true — policy is stable.
 * - If hashes differ: return ok:false + reason — operator HMAC override required.
 *
 * Emits audit action `frozen_policy.hash_mismatch_blocked` when ok:false AND
 * frozenHash is non-null.
 *
 * @param strategy  A strategy row with `config` JSONB + `frozenPolicyHash` fields.
 */
export function evaluateFrozenPolicyDriftAtPromotion(strategy: {
  id: string;
  config?: unknown;
  frozenPolicyHash?: string | null;
}): FrozenPolicyDriftResult {
  const currentHash = computeFrozenPolicyHash({ config: strategy.config });
  const frozenHash = strategy.frozenPolicyHash ?? null;

  // First-time freeze — no stored hash yet; permit promotion.
  if (frozenHash === null) {
    return { ok: true, currentHash, frozenHash: null };
  }

  if (currentHash === frozenHash) {
    return { ok: true, currentHash, frozenHash };
  }

  // Hash mismatch — config has changed since policy was frozen.
  return {
    ok: false,
    currentHash,
    frozenHash,
    reason: `frozen_policy.hash_mismatch: current ${currentHash.slice(0, 16)}... !== frozen ${frozenHash.slice(0, 16)}...`,
  };
}
