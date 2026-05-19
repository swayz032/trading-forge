/**
 * Compliance Gate Service — per-instance firm scope helper.
 *
 * Track 4 addition: exposes `getInstanceEnabledFirms()` so any compliance-checking
 * service can scope its checks to this instance's configured firms rather than
 * the global FIRMS constant.
 *
 * Design contract:
 *   - Returns a subset of ['mffu', 'topstep'] only (validates at runtime)
 *   - Falls back to all configured firms if instance_config table is empty
 *     (backwards-compatible — existing deployments without an instance_config
 *     row see no change in behavior)
 *   - Fail-open on DB error: returns all FIRMS keys so compliance checks
 *     proceed rather than blocking the pipeline
 *   - Pipeline pause guard: bypassed (read-only compliance scope query must
 *     always be accessible for operator review during pause)
 */

import { db } from "../db/index.js";
import { instanceConfig } from "../db/schema.js";
import { logger } from "../lib/logger.js";
import { FIRMS } from "../../shared/firm-config.js";

// ─── Allowed firm IDs (runtime validation) ────────────────────────────────────

const VALID_FIRM_IDS = new Set(["mffu", "topstep"]);

// ─── Cache ────────────────────────────────────────────────────────────────────
// Cache the enabled firms for 60 seconds to avoid per-request DB reads.
// Invalidated by `clearInstanceConfigCache()` when instance_config changes.

let _cachedFirms: string[] | null = null;
let _cacheTimestamp = 0;
const CACHE_TTL_MS = 60_000;

export function clearInstanceConfigCache(): void {
  _cachedFirms = null;
  _cacheTimestamp = 0;
}

// ─── Primary export ───────────────────────────────────────────────────────────

/**
 * Get the list of firm IDs enabled for this Trading Forge instance.
 *
 * If instance_config has a row with enabled_firms = ['mffu'], only MFFU
 * compliance checks are run for this instance. If enabled_firms = [] or
 * the row doesn't exist, all configured firms are used (fallback).
 *
 * Runtime validation: any entry in enabled_firms that is NOT in
 * ['mffu', 'topstep'] is silently filtered out and a warning is logged.
 * This prevents a misconfigured instance from trying to check a firm that
 * was removed in migration 0097.
 */
export async function getInstanceEnabledFirms(): Promise<string[]> {
  // Return cached value if fresh
  if (_cachedFirms !== null && Date.now() - _cacheTimestamp < CACHE_TTL_MS) {
    return _cachedFirms;
  }

  try {
    const rows = await db
      .select({ enabledFirms: instanceConfig.enabledFirms })
      .from(instanceConfig)
      .limit(1);

    if (rows.length === 0 || !rows[0].enabledFirms) {
      // No config row — use all globally configured firms
      const fallback = Object.keys(FIRMS);
      _cachedFirms = fallback;
      _cacheTimestamp = Date.now();
      return fallback;
    }

    const rawFirms = rows[0].enabledFirms;

    // Validate: must be an array of strings
    if (!Array.isArray(rawFirms)) {
      logger.warn(
        { rawFirms },
        "compliance-gate-service: instance_config.enabled_firms is not an array — falling back to all firms",
      );
      const fallback = Object.keys(FIRMS);
      _cachedFirms = fallback;
      _cacheTimestamp = Date.now();
      return fallback;
    }

    // Filter to valid firm IDs only — reject any legacy/unknown entries
    const validFirms = (rawFirms as unknown[])
      .filter((f): f is string => typeof f === "string" && VALID_FIRM_IDS.has(f));

    if (validFirms.length === 0) {
      logger.warn(
        { rawFirms },
        "compliance-gate-service: enabled_firms contained no valid entries — falling back to all firms",
      );
      const fallback = Object.keys(FIRMS);
      _cachedFirms = fallback;
      _cacheTimestamp = Date.now();
      return fallback;
    }

    const filteredOut = (rawFirms as unknown[]).filter(
      (f) => typeof f !== "string" || !VALID_FIRM_IDS.has(f as string),
    );
    if (filteredOut.length > 0) {
      logger.warn(
        { filteredOut },
        "compliance-gate-service: filtered out invalid firm IDs from enabled_firms (legacy firms removed in 0097)",
      );
    }

    _cachedFirms = validFirms;
    _cacheTimestamp = Date.now();
    return validFirms;
  } catch (err) {
    logger.error(
      { err },
      "compliance-gate-service: failed to read instance_config — falling back to all firms (fail-open)",
    );
    // Fail-open: return all configured firms so compliance checks proceed
    return Object.keys(FIRMS);
  }
}

/**
 * Validate that an enabled_firms array contains only valid firm IDs.
 * Used by the instance config upsert endpoint to reject bad inputs before
 * they reach the DB. Returns null on success, error string on failure.
 */
export function validateEnabledFirms(firms: unknown): string | null {
  if (!Array.isArray(firms)) {
    return "enabled_firms must be a JSON array";
  }
  for (const f of firms) {
    if (typeof f !== "string" || !VALID_FIRM_IDS.has(f)) {
      return `enabled_firms contains invalid firm_id '${String(f)}'. Must be subset of ['mffu', 'topstep']`;
    }
  }
  return null;
}
