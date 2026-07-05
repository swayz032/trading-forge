/**
 * strategy-source-resolver.ts
 *
 * Returns the original YouTube (or other scout) source URL(s) for any strategy
 * in the library, handling fan-out variant inheritance.
 *
 * Resolution order per strategy:
 *   (a) Direct: strategies.id → strategy_pending_buckets.graduated_strategy_id
 *               → strategy_pending_mentions.source_url
 *   (b) Variant concept-strip: strip _{mes|mnq|mcl}_{timeframe} suffix from
 *       strategy.name → find bucket with matching concept_name → mentions → URLs
 *   (c) Audit-log market_variant_created: query graduation.market_variant_created
 *       rows where result.variant_name = strategyName → result.leader_strategy_id
 *       → repeat (a) on leader
 *   (d) Audit-log scout.operator_ingested: query scout.operator_ingested rows
 *       matching the stripped concept_name in result → input.url
 *
 * Design constraints:
 *   - Never throws — returns null on missing
 *   - No new DB columns, no migrations
 *   - TS strict mode, no any leaks
 *   - Uses Drizzle ORM (db from ../db/index.js)
 *
 * Evidence source: strategy_pending_buckets.graduated_strategy_id (leader only),
 * strategy_pending_mentions.source_url, audit_log rows.
 */

import { eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  strategies,
  strategyPendingBuckets,
  strategyPendingMentions,
  auditLog,
} from "../db/schema.js";
import { logger } from "./logger.js";
import { insertAuditRowSafe } from "./audit-log-helper.js";
import { strategySourceResolutionTotal } from "./metrics-registry.js";

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Strip the market-variant suffix from a strategy name to recover the concept name.
 *
 * Strategy names follow the pattern `{concept}_{market}_{timeframe}` where
 * market is one of mes / mnq / mcl and timeframe is e.g. 15m / 5m / 1h.
 *
 * Examples:
 *   orb_mes_15m          → orb_15m   (concept includes timeframe already)
 *   vwap_fade_mnq_15m    → vwap_fade
 *   ema_9_21_pullback_mcl_5m → ema_9_21_pullback
 *   orb_failure_reversal_mes_15m → orb_failure_reversal
 *
 * The strategy name may also encode the timeframe *before* the market suffix
 * when the concept itself ends with a timeframe token (e.g. orb_15m_mes, though
 * deriveStrategyName places market before timeframe in the general case).
 *
 * We strip the *last* occurrence of _{mes|mnq|mcl} and any trailing _{timeframe}
 * token that follows it.
 */
export function stripMarketSuffix(name: string): string {
  // Remove the last _{market}_{timeframe} tail.
  // Pattern: _(mes|mnq|mcl)(_\d+[mhd])?  at the end of the string.
  const stripped = name
    .replace(/_(mes|mnq|mcl)(_\d+[mhd])?$/i, "")
    .replace(/_+$/, "");
  return stripped.length > 0 ? stripped : name;
}

/**
 * Deduplicate an array of strings preserving insertion order.
 */
function dedup(urls: string[]): string[] {
  return [...new Set(urls)];
}

// ─── Audit-log result shape helpers ──────────────────────────────────────────

interface MarketVariantAuditResult {
  variant_name?: string;
  leader_strategy_id?: string;
  [key: string]: unknown;
}

interface ScoutIngestionAuditInput {
  url?: string;
  video_id?: string;
  [key: string]: unknown;
}

interface ScoutIngestionAuditResult {
  ideas?: Array<{ idea_name?: string; entry_indicator?: string; [k: string]: unknown }>;
  [key: string]: unknown;
}

// ─── Path (a): direct bucket join ────────────────────────────────────────────

async function resolveViaDirectBucket(strategyId: string): Promise<string[]> {
  try {
    const rows = await db
      .select({ sourceUrl: strategyPendingMentions.sourceUrl })
      .from(strategyPendingBuckets)
      .innerJoin(
        strategyPendingMentions,
        eq(strategyPendingMentions.bucketId, strategyPendingBuckets.id),
      )
      .where(eq(strategyPendingBuckets.graduatedStrategyId, strategyId));

    return dedup(rows.map(r => r.sourceUrl));
  } catch (err: unknown) {
    logger.warn({ err, strategyId }, "strategy-source-resolver: path-a direct-bucket join failed");
    return [];
  }
}

// ─── Path (b): concept-strip variant inheritance ──────────────────────────────

async function resolveViaConceptStrip(strategyName: string): Promise<string[]> {
  try {
    const leaderConcept = stripMarketSuffix(strategyName);
    if (leaderConcept === strategyName) {
      // Name had no recognized market suffix — nothing to strip
      return [];
    }

    const rows = await db
      .select({ sourceUrl: strategyPendingMentions.sourceUrl })
      .from(strategyPendingBuckets)
      .innerJoin(
        strategyPendingMentions,
        eq(strategyPendingMentions.bucketId, strategyPendingBuckets.id),
      )
      .where(eq(strategyPendingBuckets.conceptName, leaderConcept));

    return dedup(rows.map(r => r.sourceUrl));
  } catch (err: unknown) {
    logger.warn({ err, strategyName }, "strategy-source-resolver: path-b concept-strip join failed");
    return [];
  }
}

// ─── Path (c): audit_log graduation.market_variant_created ───────────────────

async function resolveViaVariantAudit(strategyName: string): Promise<string[]> {
  try {
    // Find audit rows where result.variant_name = strategyName
    const auditRows = await db
      .select({ result: auditLog.result })
      .from(auditLog)
      .where(
        sql`${auditLog.action} = 'graduation.market_variant_created'
            AND ${auditLog.result}->>'variant_name' = ${strategyName}`,
      );

    if (auditRows.length === 0) return [];

    // Extract leader_strategy_id values
    const leaderIds = auditRows
      .map(r => {
        const res = r.result as MarketVariantAuditResult | null;
        return res?.leader_strategy_id ?? null;
      })
      .filter((id): id is string => id !== null);

    if (leaderIds.length === 0) return [];

    // Run path (a) on each leader
    const urlSets = await Promise.all(leaderIds.map(id => resolveViaDirectBucket(id)));
    return dedup(urlSets.flat());
  } catch (err: unknown) {
    logger.warn({ err, strategyName }, "strategy-source-resolver: path-c variant-audit failed");
    return [];
  }
}

// ─── Path (d): audit_log scout.operator_ingested ─────────────────────────────

async function resolveViaScoutAudit(strategyName: string): Promise<string[]> {
  try {
    const leaderConcept = stripMarketSuffix(strategyName);

    // scout.operator_ingested rows carry:
    //   input.url, input.video_id, input.title
    //   result.ideas[].idea_name (may match concept name)
    //
    // We match on result containing an idea whose idea_name or entry_indicator
    // contains the concept name as a substring (case-insensitive).
    const auditRows = await db
      .select({
        input: auditLog.input,
        result: auditLog.result,
      })
      .from(auditLog)
      .where(
        sql`${auditLog.action} = 'scout.operator_ingested'
            AND (
              ${auditLog.result}::text ILIKE ${"%" + leaderConcept + "%"}
              OR ${auditLog.input}::text ILIKE ${"%" + leaderConcept + "%"}
            )`,
      );

    const urls: string[] = [];
    for (const row of auditRows) {
      const inp = row.input as ScoutIngestionAuditInput | null;
      if (inp?.url && typeof inp.url === "string") {
        urls.push(inp.url);
      }
    }

    return dedup(urls);
  } catch (err: unknown) {
    logger.warn({ err, strategyName }, "strategy-source-resolver: path-d scout-audit failed");
    return [];
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Emit audit + Prometheus signal for a successful URL resolution.
 * Fire-and-forget — never blocks caller.
 */
function emitResolvedAudit(
  strategyName: string,
  resolutionPath: "config_metadata" | "direct" | "variant_inheritance" | "audit_fallback" | "multi_source",
  urlCount: number,
): void {
  // Prometheus counter — synchronous, never throws
  try {
    strategySourceResolutionTotal.labels({ path: resolutionPath }).inc();
  } catch { /* counter unavailable — ignore */ }

  // Audit row — fire-and-forget
  insertAuditRowSafe({
    action: "strategy.source_url_resolved",
    entityType: "strategy",
    entityId: null,
    input: { strategy_name: strategyName } as Record<string, unknown>,
    result: {
      resolution_path: resolutionPath,
      url_count: urlCount,
    } as Record<string, unknown>,
    status: "info",
    decisionAuthority: "system",
    correlationId: null,
  }).catch((err: unknown) =>
    logger.warn({ err, strategyName }, "strategy-source-resolver: strategy.source_url_resolved audit write failed (non-blocking)")
  );
}

/**
 * Emit audit + Prometheus signal for an unresolved strategy URL lookup.
 * WARN status — orphan strategies are rare and actionable.
 * Fire-and-forget — never blocks caller.
 */
function emitUnresolvedAudit(strategyName: string): void {
  // Prometheus counter — synchronous, never throws
  try {
    strategySourceResolutionTotal.labels({ path: "unresolved" }).inc();
  } catch { /* counter unavailable — ignore */ }

  logger.warn(
    { strategyName },
    "strategy-source-resolver: strategy.source_url_unresolved — no URL found for strategy (orphan?)",
  );

  insertAuditRowSafe({
    action: "strategy.source_url_unresolved",
    entityType: "strategy",
    entityId: null,
    input: { strategy_name: strategyName } as Record<string, unknown>,
    result: { reason: "no_url_found_across_all_paths" } as Record<string, unknown>,
    status: "warn",
    decisionAuthority: "system",
    correlationId: null,
  }).catch((err: unknown) =>
    logger.warn({ err, strategyName }, "strategy-source-resolver: strategy.source_url_unresolved audit write failed (non-blocking)")
  );
}

/**
 * Returns all source URLs for a single strategy, trying each resolution path
 * in order and stopping at the first non-empty result.
 *
 * Returns null when no path yields a URL (truly orphan strategy).
 * Never throws.
 *
 * Wave 26 Pass G (2026-05-26): emits structured audit events on every call:
 *   strategy.source_url_resolved (INFO, resolution_path, url_count) on success
 *   strategy.source_url_unresolved (WARN, strategy_name) on null result
 * and increments tf_strategy_source_resolution_total{path} Prometheus counter.
 */
export async function getStrategySourceUrl(
  strategyName: string,
): Promise<string[] | null> {
  try {
    // Look up the strategy id + config first (needed for path 0 and paths a, c on leader)
    const strategyRows = await db
      .select({ id: strategies.id, config: strategies.config })
      .from(strategies)
      .where(eq(strategies.name, strategyName))
      .limit(1);

    const strategyId = strategyRows[0]?.id ?? null;

    // Path (0) — deepscan17 H-1: spec_onboarding rows (the entire live library) store the
    // canonical YouTube URL in config.metadata.source_url and NEVER write a strategy_pending_bucket
    // or scout audit row — so paths (a)-(d) below all miss them, making every spec-onboarded
    // strategy resolve as an orphan (null URL + a spurious source_url_unresolved WARN per strategy).
    // Read the authoritative field first; paths (a)-(d) remain the fallback for legacy graduated_bucket rows.
    const cfg = strategyRows[0]?.config as { metadata?: { source_url?: unknown } } | null | undefined;
    const metaUrl = cfg?.metadata?.source_url;
    if (typeof metaUrl === "string" && metaUrl.trim().length > 0) {
      emitResolvedAudit(strategyName, "config_metadata", 1);
      return [metaUrl.trim()];
    }
    if (Array.isArray(metaUrl)) {
      const urls = dedup(metaUrl.filter((u): u is string => typeof u === "string" && u.trim().length > 0).map(u => u.trim()));
      if (urls.length > 0) {
        emitResolvedAudit(strategyName, "config_metadata", urls.length);
        return urls;
      }
    }

    // Path (a) — direct bucket join (works when this strategy IS the leader)
    if (strategyId !== null) {
      const direct = await resolveViaDirectBucket(strategyId);
      if (direct.length > 0) {
        emitResolvedAudit(strategyName, "direct", direct.length);
        return direct;
      }
    }

    // Path (b) — concept-strip for fan-out variants
    const conceptStrip = await resolveViaConceptStrip(strategyName);
    if (conceptStrip.length > 0) {
      emitResolvedAudit(strategyName, "variant_inheritance", conceptStrip.length);
      return conceptStrip;
    }

    // Path (c) — audit_log graduation.market_variant_created
    const variantAudit = await resolveViaVariantAudit(strategyName);
    if (variantAudit.length > 0) {
      emitResolvedAudit(strategyName, "audit_fallback", variantAudit.length);
      return variantAudit;
    }

    // Path (d) — audit_log scout.operator_ingested
    const scoutAudit = await resolveViaScoutAudit(strategyName);
    if (scoutAudit.length > 0) {
      // Path (d) may return URLs from multiple independent scout ingest sources —
      // treat as multi_source path for dashboard segmentation.
      const resPath = scoutAudit.length > 1 ? "multi_source" : "audit_fallback";
      emitResolvedAudit(strategyName, resPath, scoutAudit.length);
      return scoutAudit;
    }

    // All paths exhausted — orphan strategy
    emitUnresolvedAudit(strategyName);
    return null;
  } catch (err: unknown) {
    logger.warn({ err, strategyName }, "strategy-source-resolver: getStrategySourceUrl failed");
    return null;
  }
}

/**
 * Batch resolver. Returns a map of strategyName → string[] (or empty array
 * when unresolved). Never throws.
 */
export async function getStrategySourceUrls(
  strategyNames: string[],
): Promise<Record<string, string[]>> {
  if (strategyNames.length === 0) return {};

  const result: Record<string, string[]> = {};
  // Run in parallel — each strategy resolves independently
  await Promise.all(
    strategyNames.map(async name => {
      const urls = await getStrategySourceUrl(name);
      result[name] = urls ?? [];
    }),
  );
  return result;
}

/**
 * Fetch all active strategies and resolve source URLs for each.
 * Returns an array sorted by strategy name.
 * Never throws.
 */
export async function getAllStrategiesWithUrls(): Promise<
  Array<{ name: string; urls: string[] }>
> {
  try {
    const allStrategies = await db
      .select({ name: strategies.name })
      .from(strategies)
      .where(
        inArray(strategies.lifecycleState, [
          "CANDIDATE",
          "NEEDS_ARCHETYPE", // deepscan17 H-2: 3 live spec-onboarded parked strategies were excluded
          "TESTING",
          "SHADOW", // deepscan17 H-2: Wave-29 shadow stage was excluded from library/provenance surfaces
          "PAPER",
          "DEPLOY_READY",
          "PILOT",
          "DEPLOYED",
          "DECLINING",
        ]),
      )
      .orderBy(strategies.name);

    const names = allStrategies.map(s => s.name);
    const urlMap = await getStrategySourceUrls(names);

    return names.map(name => ({ name, urls: urlMap[name] ?? [] }));
  } catch (err: unknown) {
    logger.warn({ err }, "strategy-source-resolver: getAllStrategiesWithUrls failed");
    return [];
  }
}
