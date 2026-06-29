/**
 * frozen-policy-hash.ts — Wave 29 Pass B.2 pure core (deep-scan #5, 2026-06-29)
 *
 * The DB-FREE half of the frozen-policy contract. Extracted from
 * frozen-policy-contract.ts so the pure hash + drift-evaluation functions can be
 * imported by tests (e.g. the gate-chain pglite integration suite) WITHOUT pulling
 * `../db/index.js` — which throws at import when DATABASE_URL is unset and would
 * crash the whole gate-chain test file at collection.
 *
 * frozen-policy-contract.ts re-exports everything here, so existing import sites
 * are unchanged. Only the db-coupled `freezePolicyForStrategy` stays in that file.
 *
 * Hashed fields (only these five — changing strategy.name does NOT invalidate):
 *   entry_quality  |  position_size  |  stop_loss  |  take_profit  |  exit_plan_config
 *
 * Canonical sort: JSON.stringify with sorted-key replacer
 * (mirrors Python json.dumps(sort_keys=True, separators=(',',':')))
 */

import { createHash } from "node:crypto";

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
 * Pure: no DB access, no audit write (the lifecycle caller writes the audit row).
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
