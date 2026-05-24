/**
 * Regime Coverage Monitor Service — Wave 25 (Gap 9)
 *
 * Schema has strategies.preferredRegimes array (schema.ts:68). bias-state-service.ts
 * reads it to pick today's strategy. But nothing checks "for each of the deployed
 * regimes, do I have ≥1 deployed strategy covering it?"
 *
 * Without this check, a regime shift can silently zero-out trades if no deployed
 * strategy covers the active regime.
 *
 * Design:
 *   - Single source of truth for regime list: DEPLOYED_REGIME_LIST constant here,
 *     mirroring bias_engine.py enum. When W25.10 adds 4 more regimes, update
 *     DEPLOYED_REGIME_LIST in one place — this cron auto-expands.
 *   - Current regimes (W23H.A): TRENDING_UP, TRENDING_DOWN, RANGE_BOUND.
 *   - W25.10 will add: EXPANSION, COMPRESSION, HIGH_VOL_MACRO, LOW_LIQ_CHOP.
 *   - Strategies with NULL preferredRegimes are eligible in ALL regimes (wildcard).
 *     A wildcard PILOT/DEPLOYED strategy covers all regimes.
 *
 * Failure posture: fails open on DB error.
 */

import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { auditLog } from "../db/schema.js";
import { logger } from "../lib/logger.js";
import { broadcastSSE } from "../routes/sse.js";
import { notifyWarning } from "./notification-service.js";

// ─── Regime list — single source of truth ─────────────────────────────────────
// Mirrors src/engine/context/bias_engine.py MacroRegime enum.
// W25.10 will extend this list — update here and the cron auto-expands.
export const DEPLOYED_REGIME_LIST = [
  "TRENDING_UP",
  "TRENDING_DOWN",
  "RANGE_BOUND",
  // W25.10 additions (uncomment when wave ships):
  // "EXPANSION",
  // "COMPRESSION",
  // "HIGH_VOL_MACRO",
  // "LOW_LIQ_CHOP",
] as const;

export type RegimeName = (typeof DEPLOYED_REGIME_LIST)[number];

// ─── Result types (exported for tests) ───────────────────────────────────────
export interface RegimeCoverageEntry {
  deployedCount: number;
  strategyIds: string[];
}

export type RegimeCoverageMap = Record<string, RegimeCoverageEntry>;

export interface RegimeCoverageResult {
  coverage: RegimeCoverageMap;
  gapRegimes: string[];
  anyGap: boolean;
  alertFired: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const DEDUPE_HOURS = 24; // daily cron — suppress repeat within 24h

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function recentAlarmExists(action: string, hours: number): Promise<boolean> {
  try {
    const rows = await db.execute(sql`
      SELECT 1
      FROM audit_log
      WHERE action = ${action}
        AND created_at > NOW() - (${hours}::int * INTERVAL '1 hour')
      LIMIT 1
    `);
    return ((rows as unknown) as Array<unknown>).length > 0;
  } catch (err) {
    logger.warn(
      { err, action },
      "regime-coverage-monitor: recentAlarmExists query failed — assuming no recent alarm",
    );
    return false;
  }
}

// ─── Coverage computation ─────────────────────────────────────────────────────

/**
 * computeRegimeCoverage
 *
 * Returns a map of regime → { deployedCount, strategyIds } for all PILOT/DEPLOYED
 * strategies. Strategies with NULL preferredRegimes cover all regimes (wildcard).
 */
export async function computeRegimeCoverage(): Promise<RegimeCoverageMap> {
  // Initialize all regimes with zero coverage
  const coverage: RegimeCoverageMap = {};
  for (const regime of DEPLOYED_REGIME_LIST) {
    coverage[regime] = { deployedCount: 0, strategyIds: [] };
  }

  let strategyRows: Array<{
    id: string;
    preferred_regimes: string[] | null;
  }> = [];

  try {
    const rows = await db.execute(sql`
      SELECT id::text, preferred_regimes
      FROM strategies
      WHERE lifecycle_state IN ('PILOT', 'DEPLOYED')
      ORDER BY created_at ASC
    `);
    strategyRows = (rows as unknown) as Array<{
      id: string;
      preferred_regimes: string[] | null;
    }>;
  } catch (err) {
    logger.warn({ err }, "regime-coverage-monitor: strategies query failed — fail-open");
    return coverage;
  }

  for (const row of strategyRows) {
    const regimes = row.preferred_regimes;

    if (!regimes || regimes.length === 0) {
      // NULL/empty preferredRegimes = wildcard — covers ALL regimes
      for (const regime of DEPLOYED_REGIME_LIST) {
        coverage[regime].deployedCount++;
        coverage[regime].strategyIds.push(row.id);
      }
    } else {
      // Only covers specified regimes
      for (const regime of regimes) {
        if (regime in coverage) {
          coverage[regime].deployedCount++;
          coverage[regime].strategyIds.push(row.id);
        }
        // Regimes not in DEPLOYED_REGIME_LIST are silently ignored —
        // they may be future W25.10 regimes not yet added to this list.
      }
    }
  }

  return coverage;
}

/**
 * evaluateCoverageGaps
 *
 * Returns regimes with deployedCount === 0.
 */
export function evaluateCoverageGaps(coverage: RegimeCoverageMap): string[] {
  return Object.entries(coverage)
    .filter(([, entry]) => entry.deployedCount === 0)
    .map(([regime]) => regime);
}

// ─── Main check (called by cron daily at 6 AM ET) ─────────────────────────────

export async function runRegimeCoverageCheck(): Promise<RegimeCoverageResult> {
  let coverage: RegimeCoverageMap;
  try {
    coverage = await computeRegimeCoverage();
  } catch (err) {
    logger.warn({ err }, "regime-coverage-monitor: computeRegimeCoverage failed — fail-open");
    return {
      coverage: {},
      gapRegimes: [],
      anyGap: false,
      alertFired: false,
    };
  }

  const gapRegimes = evaluateCoverageGaps(coverage);
  const anyGap = gapRegimes.length > 0;

  if (!anyGap) {
    logger.info(
      { regimesChecked: DEPLOYED_REGIME_LIST.length },
      "regime-coverage-monitor: all regimes covered — no gaps",
    );
    return { coverage, gapRegimes, anyGap, alertFired: false };
  }

  // Dedupe: daily cron — one alarm per 24h
  if (await recentAlarmExists("portfolio.regime_coverage_gap", DEDUPE_HOURS)) {
    logger.info(
      { gapRegimes },
      "regime-coverage-monitor: gaps found but alarm already fired within dedupe window",
    );
    return { coverage, gapRegimes, anyGap, alertFired: false };
  }

  const payload = {
    gapRegimes,
    coverage: Object.fromEntries(
      Object.entries(coverage).map(([k, v]) => [k, v.deployedCount]),
    ),
    allRegimesChecked: DEPLOYED_REGIME_LIST as readonly string[],
    timestamp: new Date().toISOString(),
  };

  await db
    .insert(auditLog)
    .values({
      action: "portfolio.regime_coverage_gap",
      entityType: "portfolio",
      entityId: null,
      input: { regimesChecked: DEPLOYED_REGIME_LIST.length },
      result: payload as Record<string, unknown>,
      status: "warning",
      decisionAuthority: "system",
    })
    .catch((err) =>
      logger.error({ err }, "portfolio.regime_coverage_gap audit insert failed"),
    );

  notifyWarning(
    "Regime coverage gap detected",
    `No PILOT/DEPLOYED strategy covers the following regime(s): ${gapRegimes.join(", ")}. A regime shift to an uncovered regime will produce zero trades. Add at least one strategy tagged for each missing regime.`,
    { job: "regime-coverage-check", ...payload },
  );

  try {
    broadcastSSE("alert:regime_coverage_gap", payload);
  } catch (err) {
    logger.warn({ err }, "regime-coverage-monitor: SSE broadcast failed — non-fatal");
  }

  logger.warn(
    { gapRegimes, coverageSummary: payload.coverage },
    "regime-coverage-monitor: regime coverage gap detected",
  );

  return { coverage, gapRegimes, anyGap, alertFired: true };
}

// ─── Status query (for API/dashboard) ────────────────────────────────────────

export interface RegimeCoverageStatus {
  checkedAt: string;
  regimes: Array<{
    regime: string;
    deployedCount: number;
    covered: boolean;
    strategyIds: string[];
  }>;
  gapRegimes: string[];
}

export async function getRegimeCoverageStatus(): Promise<RegimeCoverageStatus> {
  const coverage = await computeRegimeCoverage();
  const gapRegimes = evaluateCoverageGaps(coverage);

  return {
    checkedAt: new Date().toISOString(),
    regimes: DEPLOYED_REGIME_LIST.map((regime) => ({
      regime,
      deployedCount: coverage[regime].deployedCount,
      covered: coverage[regime].deployedCount > 0,
      strategyIds: coverage[regime].strategyIds,
    })),
    gapRegimes,
  };
}

// Re-exported for tests
export const __test__ = {
  DEPLOYED_REGIME_LIST,
  DEDUPE_HOURS,
  evaluateCoverageGaps,
};
