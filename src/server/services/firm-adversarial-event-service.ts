/**
 * Firm Adversarial Event Service — B14 / W20 Pass 2B
 *
 * CRUD over `firm_adversarial_priors`. Provides:
 *   - getCurrentPriors(firmId) — primary read path for Pass 2A survival math
 *   - upsertPrior(input) — insert or update a prior row with conflict resolution
 *   - loadSeedPriorsIfEmpty() — idempotent seed loader for first-run bootstrap
 *   - listAllPriors(firmId?) — diagnostic read for routes + tests
 *
 * AUTHORITY BOUNDARY:
 *   This service manages the persistence layer for adversarial priors. It does
 *   NOT compute survival probabilities (that is prop-firm-survival-service.ts
 *   responsibility). Reads (getCurrentPriors, listAllPriors) bypass the pipeline
 *   pause gate and must serve route reads regardless of trading state.
 *
 * Observability:
 *   - Structured pino logs on every public function entry/exit + error path
 *   - logger.warn when a firm has zero priors (signals a config gap)
 *   - logger.error on DB errors with {firmId, eventType, err}
 *   - Audit log row written ONLY on upsertPrior when base_rate actually changed
 *
 * Supported firms: MFFU + Topstep ONLY. Legacy firms removed 2026-05-10 (migration 0097).
 * automation_friendly fallback:
 *   When compliance_rulesets.parsedRules.allowsAutomation is absent for a firm,
 *   default is 0.5. The monthly recalibration cron (firm-priors-fitter.ts) does not
 *   update automation_friendly — that field auto-refreshes when compliance-refresh-service
 *   updates parsedRules.
 */

import { eq, and, count } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  firmAdversarialPriors,
  auditLog,
  complianceRulesets,
  type FirmAdversarialPriorRow,
} from "../db/schema.js";
import { logger } from "../lib/logger.js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { join, dirname } from "path";

// ─── AdversarialPriors type (canonical, re-exported from Pass 2A) ────────────
// prop-firm-survival-service.ts owns the canonical shape and time-semantic
// conventions for AdversarialPriors. We re-export here so existing importers of
// `firm-adversarial-event-service.AdversarialPriors` continue to type-check.
export type { AdversarialPriors } from "./prop-firm-survival-service.js";
import type { AdversarialPriors } from "./prop-firm-survival-service.js";

// ─── Time-semantic compounding ───────────────────────────────────────────────
// Seed JSON stores ALL base_rate values as 30-day-window probabilities.
// Pass 2A's AdversarialPriors interface uses mixed time semantics:
//   - P_suspension_30d, P_vpn_detection      → 30-day rate (passes through)
//   - P_payout_denial                         → per-payout-request (≈ 30-day at
//                                                monthly cadence — passes through;
//                                                survival math handles frequency)
//   - P_fund_freeze_year                      → ANNUAL (compound 30d → year)
//   - P_profitable_trader_ban_year            → ANNUAL (compound 30d → year)
//
// Compounding formula matches the test fixture in
// `prop-firm-survival-service.test.ts:buildPriorsFromSeed`:
//   annualFromMonthly(p30) = 1 - (1 - p30)^12
function annualFromMonthly(p30: number): number {
  if (!Number.isFinite(p30) || p30 <= 0) return 0;
  if (p30 >= 1) return 1;
  return Math.max(0, Math.min(1, 1 - Math.pow(1 - p30, 12)));
}

// ─── Event type → (AdversarialPriors field, time conversion) mapping ─────────
type PriorsField = keyof Omit<AdversarialPriors, "automation_friendly" | "evidence_weight">;
const EVENT_TYPE_TO_FIELD: Record<
  string,
  { field: PriorsField; convert: (p30: number) => number }
> = {
  account_suspension: { field: "P_suspension_30d", convert: (p) => p },
  payout_denial: { field: "P_payout_denial", convert: (p) => p },
  fund_freeze: { field: "P_fund_freeze_year", convert: annualFromMonthly },
  profitable_trader_ban: { field: "P_profitable_trader_ban_year", convert: annualFromMonthly },
  vpn_detection: { field: "P_vpn_detection", convert: (p) => p },
};

// ─── Zero-value defaults ──────────────────────────────────────────────────────
function zeroPriors(): AdversarialPriors {
  return {
    P_suspension_30d: 0,
    P_payout_denial: 0,
    P_fund_freeze_year: 0,
    P_profitable_trader_ban_year: 0,
    P_vpn_detection: 0,
    automation_friendly: 0.5,
    evidence_weight: 0,
  };
}

// ─── Seed file path ───────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SEED_PATH = join(__dirname, "../db/seeds/firm_adversarial_priors_seed.json");

// ─── Evidence sources type ────────────────────────────────────────────────────
interface EvidenceSource {
  source: string;
  url: string;
  observedAt: string;
  severity: string;
}

// ─── Upsert input type ────────────────────────────────────────────────────────
export interface UpsertPriorInput {
  firmId: string;
  eventType: string;
  baseRate: number;
  evidenceWeight?: number;
  evidenceSources?: EvidenceSource[];
  fitMethod?: "manual_seed" | "health_check_history" | "dashboard_anomaly";
}

// ─── getCurrentPriors ─────────────────────────────────────────────────────────
/**
 * Reads all rows for the given firm and assembles an AdversarialPriors object.
 * Maps event_type → P_* field. Sums evidence_weight across all event_types.
 * Reads automation_friendly from compliance_rulesets.parsedRules.allowsAutomation.
 *
 * Returns zero-value priors without throwing when the firm has no rows (logs a warn).
 * Reads bypass the pipeline pause gate — must serve route reads regardless of state.
 */
export async function getCurrentPriors(firmId: string): Promise<AdversarialPriors> {
  logger.debug({ firmId }, "firm-adversarial-event-service: getCurrentPriors entry");

  const result = zeroPriors();

  try {
    const rows = await db
      .select()
      .from(firmAdversarialPriors)
      .where(eq(firmAdversarialPriors.firmId, firmId));

    if (rows.length === 0) {
      logger.warn(
        { firmId },
        "firm-adversarial-event-service: no priors found for firm — config gap; survival math will use zero base rates",
      );
      // Still set a sensible automation_friendly default via the rulesets path below
    }

    let totalEvidenceWeight = 0;
    for (const row of rows) {
      const mapping = EVENT_TYPE_TO_FIELD[row.eventType];
      if (mapping) {
        const raw = parseFloat(row.baseRate as string);
        result[mapping.field] = mapping.convert(Number.isFinite(raw) ? raw : 0);
      }
      totalEvidenceWeight += row.evidenceWeight ?? 0;
    }
    result.evidence_weight = totalEvidenceWeight;

    // Read automation_friendly from compliance_rulesets.parsedRules
    result.automation_friendly = await resolveAutomationFriendly(firmId);

    logger.debug(
      { firmId, eventCount: rows.length, evidenceWeight: totalEvidenceWeight },
      "firm-adversarial-event-service: getCurrentPriors exit",
    );
  } catch (err) {
    logger.error(
      { firmId, err },
      "firm-adversarial-event-service: getCurrentPriors DB error — returning zero priors",
    );
    // Return zero priors on DB error — never crash the survival math path
    result.automation_friendly = apexFallbackOrDefault(firmId);
  }

  return result;
}

/**
 * Resolves automation_friendly for a firm from compliance_rulesets.parsedRules.
 * Priority:
 *   1. parsedRules.allowsAutomation (truthy → 1.0, falsy → explicit 0.0)
 *   2. Apex-specific fallback: 0.3 (documented automation-hostile behavior)
 *   3. Global default: 0.5
 */
async function resolveAutomationFriendly(firmId: string): Promise<number> {
  try {
    // Normalize firmId to match compliance_rulesets.firm column (mixed case like "Topstep", "Apex")
    const firmDisplayName = toDisplayName(firmId);
    const [ruleset] = await db
      .select({ parsedRules: complianceRulesets.parsedRules })
      .from(complianceRulesets)
      .where(eq(complianceRulesets.firm, firmDisplayName))
      .limit(1);

    if (ruleset?.parsedRules) {
      const parsed = ruleset.parsedRules as Record<string, unknown>;
      if ("allowsAutomation" in parsed) {
        return parsed.allowsAutomation ? 1.0 : 0.0;
      }
    }
  } catch {
    // Non-blocking — fall through to defaults
  }
  return apexFallbackOrDefault(firmId);
}

/**
 * Default automation_friendly: 0.5 (neutral / unknown) when no parsedRules signal found.
 * Only MFFU and Topstep are supported; both default to 0.5 when no parsedRules present.
 */
function apexFallbackOrDefault(_firmId: string): number {
  return 0.5;
}

/** Maps firmId lowercase keys to display names used in compliance_rulesets.firm column */
function toDisplayName(firmId: string): string {
  // Only MFFU + Topstep are supported. Legacy firms removed 2026-05-10 (migration 0097).
  const map: Record<string, string> = {
    topstep: "Topstep",
    mffu: "MFFU",
  };
  return map[firmId.toLowerCase()] ?? firmId;
}

// ─── upsertPrior ──────────────────────────────────────────────────────────────
/**
 * Insert or update a prior row using ON CONFLICT (firm_id, event_type) DO UPDATE.
 * Updates last_fitted_at to NOW().
 * Writes an audit_log row ONLY when base_rate actually changed (old !== new).
 *
 * Audit log shape matches lifecycle-service.ts Phase 0 advisory pattern:
 *   action: "b14_prior_updated"
 *   decisionAuthority: "gate"
 *   category: "compliance"
 */
export async function upsertPrior(input: UpsertPriorInput): Promise<FirmAdversarialPriorRow> {
  const {
    firmId,
    eventType,
    baseRate,
    evidenceWeight = 0,
    evidenceSources,
    fitMethod = "manual_seed",
  } = input;

  logger.info(
    { firmId, eventType, baseRate, fitMethod },
    "firm-adversarial-event-service: upsertPrior entry",
  );

  // Read current value to detect change (for audit log gate)
  let oldBaseRate: number | null = null;
  try {
    const [existing] = await db
      .select({ baseRate: firmAdversarialPriors.baseRate })
      .from(firmAdversarialPriors)
      .where(
        and(
          eq(firmAdversarialPriors.firmId, firmId),
          eq(firmAdversarialPriors.eventType, eventType),
        ),
      )
      .limit(1);
    if (existing) {
      oldBaseRate = parseFloat(existing.baseRate as string);
    }
  } catch (err) {
    logger.warn(
      { firmId, eventType, err },
      "firm-adversarial-event-service: failed to read existing prior for change detection — will skip audit log",
    );
  }

  let upsertedRow: FirmAdversarialPriorRow;
  try {
    const now = new Date();
    const [row] = await db
      .insert(firmAdversarialPriors)
      .values({
        firmId,
        eventType,
        baseRate: String(baseRate),
        evidenceWeight,
        evidenceSources: evidenceSources ?? null,
        fitMethod,
        lastFittedAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [firmAdversarialPriors.firmId, firmAdversarialPriors.eventType],
        set: {
          baseRate: String(baseRate),
          evidenceWeight,
          evidenceSources: evidenceSources ?? null,
          fitMethod,
          lastFittedAt: now,
          updatedAt: now,
        },
      })
      .returning();

    upsertedRow = row;
  } catch (err) {
    logger.error(
      { firmId, eventType, baseRate, err },
      "firm-adversarial-event-service: upsertPrior DB error",
    );
    throw err;
  }

  // Write audit log ONLY when base_rate actually changed
  const newBaseRate = parseFloat(upsertedRow.baseRate as string);
  const baseRateChanged = oldBaseRate === null || Math.abs(oldBaseRate - newBaseRate) > 0.00001;

  if (baseRateChanged) {
    db.insert(auditLog)
      .values({
        action: "b14_prior_updated",
        entityType: "firm_adversarial_priors",
        entityId: upsertedRow.id,
        status: "success",
        decisionAuthority: "gate",
        input: {
          firmId,
          eventType,
          oldBaseRate,
          fitMethod,
        },
        result: {
          firmId,
          eventType,
          oldBaseRate,
          newBaseRate,
          fitMethod,
          evidenceWeight,
        },
      })
      .catch((auditErr: unknown) => {
        logger.warn(
          { firmId, eventType, err: auditErr },
          "firm-adversarial-event-service: audit log insert failed (non-blocking)",
        );
      });

    logger.info(
      { firmId, eventType, oldBaseRate, newBaseRate, fitMethod },
      "firm-adversarial-event-service: prior updated — audit log written",
    );
  } else {
    logger.debug(
      { firmId, eventType, baseRate },
      "firm-adversarial-event-service: upsertPrior — base_rate unchanged, no audit log written",
    );
  }

  return upsertedRow;
}

// ─── loadSeedPriorsIfEmpty ────────────────────────────────────────────────────
/**
 * Reads firm_adversarial_priors_seed.json and inserts all rows if the table is
 * currently empty (count = 0). Re-running on a populated table is a no-op.
 * Returns { loaded, skipped } counts.
 *
 * Idempotent: safe to call on every startup or repeated invocation.
 * Uses fit_method: 'manual_seed' for all inserted rows.
 */
export async function loadSeedPriorsIfEmpty(): Promise<{
  loaded: number;
  skipped: number;
}> {
  logger.info("firm-adversarial-event-service: loadSeedPriorsIfEmpty entry");

  // Count existing rows
  let existingCount = 0;
  try {
    const [result] = await db
      .select({ value: count() })
      .from(firmAdversarialPriors);
    existingCount = result?.value ?? 0;
  } catch (err) {
    logger.error({ err }, "firm-adversarial-event-service: loadSeedPriorsIfEmpty count query failed");
    throw err;
  }

  if (existingCount > 0) {
    logger.info(
      { existingCount },
      "firm-adversarial-event-service: loadSeedPriorsIfEmpty — table not empty, skipping seed load",
    );
    const seedData = loadSeedFile();
    return { loaded: 0, skipped: seedData.rows.length };
  }

  // Load seed file
  const seedData = loadSeedFile();
  const rows = seedData.rows;

  logger.info(
    { rowCount: rows.length },
    "firm-adversarial-event-service: loadSeedPriorsIfEmpty — inserting seed rows",
  );

  let loaded = 0;
  for (const row of rows) {
    try {
      await db.insert(firmAdversarialPriors).values({
        firmId: row.firmId,
        eventType: row.eventType,
        baseRate: String(row.baseRate),
        evidenceWeight: row.evidenceWeight ?? 0,
        evidenceSources: row.evidenceSources ?? null,
        lastObservedAt: row.lastObservedAt ? new Date(row.lastObservedAt) : null,
        fitMethod: "manual_seed",
      });
      loaded++;
    } catch (err) {
      logger.error(
        { firmId: row.firmId, eventType: row.eventType, err },
        "firm-adversarial-event-service: loadSeedPriorsIfEmpty insert failed for row",
      );
      // Continue loading other rows — one failure does not abort the rest
    }
  }

  logger.info(
    { loaded, total: rows.length },
    "firm-adversarial-event-service: loadSeedPriorsIfEmpty exit",
  );

  return { loaded, skipped: rows.length - loaded };
}

// ─── listAllPriors ────────────────────────────────────────────────────────────
/**
 * Simple read with optional firmId filter. Used by route layer + tests.
 * Bypasses the pipeline pause gate — diagnostic reads must be available always.
 */
export async function listAllPriors(firmId?: string): Promise<FirmAdversarialPriorRow[]> {
  logger.debug(
    { firmId },
    "firm-adversarial-event-service: listAllPriors entry",
  );

  try {
    if (firmId) {
      const rows = await db
        .select()
        .from(firmAdversarialPriors)
        .where(eq(firmAdversarialPriors.firmId, firmId));
      logger.debug({ firmId, count: rows.length }, "firm-adversarial-event-service: listAllPriors exit");
      return rows;
    }

    const rows = await db.select().from(firmAdversarialPriors);
    logger.debug({ count: rows.length }, "firm-adversarial-event-service: listAllPriors exit");
    return rows;
  } catch (err) {
    logger.error(
      { firmId, err },
      "firm-adversarial-event-service: listAllPriors DB error",
    );
    throw err;
  }
}

// ─── Seed file loader (internal) ─────────────────────────────────────────────
interface SeedRow {
  firmId: string;
  eventType: string;
  baseRate: number;
  evidenceWeight?: number;
  evidenceSources?: EvidenceSource[];
  lastObservedAt?: string;
  fitMethod?: string;
}

interface SeedFile {
  _metadata: Record<string, unknown>;
  rows: SeedRow[];
}

function loadSeedFile(): SeedFile {
  try {
    const raw = readFileSync(SEED_PATH, "utf-8");
    return JSON.parse(raw) as SeedFile;
  } catch (err) {
    logger.error({ seedPath: SEED_PATH, err }, "firm-adversarial-event-service: failed to load seed file");
    throw new Error(`Failed to load seed file at ${SEED_PATH}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
