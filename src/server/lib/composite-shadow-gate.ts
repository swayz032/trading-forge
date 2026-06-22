/**
 * composite-shadow-gate.ts — Wave 28 Pass B.1 (paper-parity)
 *
 * Pure-function composite health shadow gate.
 *
 * OBSERVABILITY ONLY — Pass B shadow mode. Wave 27.5 hard gates remain
 * authoritative. See Wave 28 plan.
 *
 * This helper reads the latest `strategy_health_scores` row written by
 * the Wave 28 Pass A aggregator and derives what the composite score
 * WOULD decide at a PAPER → DEPLOY_READY promotion.  It never blocks
 * promotion.  The lifecycle-service caller logs the result as an audit
 * row so 14 days of shadow evidence can accumulate before Pass C
 * activation.
 *
 * Verdict ↔ shadow_decision mapping:
 *   HEALTHY   (≥ 0.75)  → WOULD_PROMOTE
 *   MARGINAL  (0.50–0.75) → WOULD_WARN
 *   UNHEALTHY (0.25–0.50) → WOULD_BLOCK
 *   CRITICAL  (< 0.25)   → WOULD_BLOCK
 *
 * Availability states:
 *   missing           — no row exists yet (aggregator hasn't run)
 *   stale             — row.evaluated_at older than COMPOSITE_MAX_AGE_HOURS
 *   below_threshold   — composite_score is null (< MIN_COMPOSITE_SUBSYSTEMS)
 *   available         — usable composite row
 *
 * Environment:
 *   COMPOSITE_MAX_AGE_HOURS (default "48") — staleness ceiling for consumers.
 *
 * Logger: imported from ./logger.js leaf module per project convention.
 */

import { eq, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { strategyHealthScores } from "../db/schema.js";
import { logger } from "./logger.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ShadowAvailability =
  | "available"
  | "stale"
  | "missing"
  | "below_threshold";

export type ShadowDecision =
  | "WOULD_PROMOTE"
  | "WOULD_BLOCK"
  | "WOULD_WARN"
  | "NO_OPINION";

export interface ShadowResult {
  availability: ShadowAvailability;
  composite_score: number | null;
  verdict: "HEALTHY" | "MARGINAL" | "UNHEALTHY" | "CRITICAL" | null;
  weights_version_id: string | null;
  evaluated_at: Date | null;
  staleness_age_hours: number | null;
  computed_from_n_subsystems: number | null;
  shadow_decision: ShadowDecision;
  reason: string;
}

// ─── Env helper ──────────────────────────────────────────────────────────────

/** Read COMPOSITE_MAX_AGE_HOURS, defaulting to 48. */
export function getCompositeMaxAgeHours(): number {
  const raw = process.env.COMPOSITE_MAX_AGE_HOURS;
  if (raw === undefined || raw === "") return 48;
  const parsed = parseFloat(raw);
  if (isNaN(parsed) || parsed <= 0) {
    logger.warn(
      { raw, defaulted: 48 },
      "COMPOSITE_MAX_AGE_HOURS is invalid — using default 48",
    );
    return 48;
  }
  return parsed;
}

// ─── Shadow decision derivation ──────────────────────────────────────────────

/**
 * Derive the shadow_decision from a composite score + verdict string.
 * Pure function, no I/O.
 */
export function deriveShadowDecision(
  compositeScore: number,
  verdict: string | null,
): ShadowDecision {
  // Prefer the explicit verdict from the aggregator; fall back to score bands.
  const v = verdict ?? verdictFromScore(compositeScore);
  switch (v) {
    case "HEALTHY":
      return "WOULD_PROMOTE";
    case "MARGINAL":
      return "WOULD_WARN";
    case "UNHEALTHY":
    case "CRITICAL":
      return "WOULD_BLOCK";
    default:
      // Unrecognised verdict string — use score bands defensively.
      return compositeScore >= 0.75
        ? "WOULD_PROMOTE"
        : compositeScore >= 0.50
        ? "WOULD_WARN"
        : "WOULD_BLOCK";
  }
}

/** Reproduce the verdict band thresholds used by score-normalization.ts. */
function verdictFromScore(score: number): string {
  if (score >= 0.75) return "HEALTHY";
  if (score >= 0.50) return "MARGINAL";
  if (score >= 0.25) return "UNHEALTHY";
  return "CRITICAL";
}

// ─── Main query function ──────────────────────────────────────────────────────

/**
 * Evaluate the composite shadow gate for a given strategy.
 *
 * Pure lookup: queries `strategy_health_scores` for the latest row by
 * evaluated_at and returns a fully-typed ShadowResult.  No writes, no
 * side effects beyond the single SELECT.
 *
 * @param strategyId  Strategy ID — accepts string (UUID from lifecycle-service.ts
 *                    strategies loop) or number (from route handlers).  Mirrors the
 *                    same `strategyId as unknown as number` cast used by the
 *                    strategy-health-aggregator when writing rows (schema design:
 *                    strategy_health_scores.strategy_id is INTEGER per migration
 *                    0149 but the caller holds the UUID string from strategies.id).
 *
 * Fail-OPEN contract: any unexpected throw propagates to the caller, who
 * MUST wrap this in try/catch and emit `composite.shadow_evaluation_error`
 * rather than propagating the error to the lifecycle gate chain.
 */
export async function evaluateCompositeShadow(
  strategyId: string,
): Promise<ShadowResult> {
  const maxAgeHours = getCompositeMaxAgeHours();

  // Wave hardening 2026-06-22 (Defect G4): strategy_health_scores.strategy_id is now
  // UUID (fixed from INTEGER in schema.ts + migration 0149). Pass the UUID string directly —
  // no cast needed or safe. The old `as unknown as number` cast was a runtime bug: a UUID
  // string passed into a Postgres INTEGER column produces a type error on insert and 0-row
  // selects on read, leaving the gate permanently NO_OPINION.
  const rows = await db
    .select({
      compositeScore: strategyHealthScores.compositeScore,
      verdict: strategyHealthScores.verdict,
      weightsVersionId: strategyHealthScores.weightsVersionId,
      evaluatedAt: strategyHealthScores.evaluatedAt,
      stalenessAgeHours: strategyHealthScores.stalenessAgeHours,
      computedFromNSubsystems: strategyHealthScores.computedFromNSubsystems,
    })
    .from(strategyHealthScores)
    .where(eq(strategyHealthScores.strategyId, strategyId))
    .orderBy(desc(strategyHealthScores.evaluatedAt))
    .limit(1);

  // 1. Missing row ─────────────────────────────────────────────────────────────
  if (rows.length === 0) {
    logger.info(
      { strategyId },
      "composite-shadow-gate: no health score row — NO_OPINION",
    );
    return {
      availability: "missing",
      composite_score: null,
      verdict: null,
      weights_version_id: null,
      evaluated_at: null,
      staleness_age_hours: null,
      computed_from_n_subsystems: null,
      shadow_decision: "NO_OPINION",
      reason: "composite.no_row_found",
    };
  }

  const row = rows[0]!;
  const evaluatedAt = row.evaluatedAt;

  // 2. Stale row ────────────────────────────────────────────────────────────────
  const ageHours = (Date.now() - evaluatedAt.getTime()) / (1000 * 60 * 60);
  if (ageHours > maxAgeHours) {
    logger.info(
      { strategyId, ageHours: ageHours.toFixed(1), maxAgeHours },
      "composite-shadow-gate: stale health score — NO_OPINION",
    );
    return {
      availability: "stale",
      composite_score: row.compositeScore ?? null,
      verdict: null,
      weights_version_id: row.weightsVersionId,
      evaluated_at: evaluatedAt,
      staleness_age_hours: ageHours,
      computed_from_n_subsystems: row.computedFromNSubsystems,
      shadow_decision: "NO_OPINION",
      reason: `composite.stale_age_${ageHours.toFixed(1)}h_exceeds_max_${maxAgeHours}h`,
    };
  }

  // 3. Null composite score (below subsystem threshold) ─────────────────────────
  if (row.compositeScore == null) {
    logger.info(
      { strategyId, computedFromNSubsystems: row.computedFromNSubsystems },
      "composite-shadow-gate: null composite_score (below subsystem threshold) — NO_OPINION",
    );
    return {
      availability: "below_threshold",
      composite_score: null,
      verdict: null,
      weights_version_id: row.weightsVersionId,
      evaluated_at: evaluatedAt,
      staleness_age_hours: ageHours,
      computed_from_n_subsystems: row.computedFromNSubsystems,
      shadow_decision: "NO_OPINION",
      reason: "composite.below_subsystem_threshold",
    };
  }

  // 4. Available — derive shadow decision ────────────────────────────────────────
  const compositeScore = Number(row.compositeScore);
  const verdictStr = row.verdict as "HEALTHY" | "MARGINAL" | "UNHEALTHY" | "CRITICAL" | null;
  const shadowDecision = deriveShadowDecision(compositeScore, verdictStr);

  logger.info(
    {
      strategyId,
      compositeScore,
      verdict: verdictStr,
      shadowDecision,
      ageHours: ageHours.toFixed(1),
    },
    "composite-shadow-gate: evaluated",
  );

  return {
    availability: "available",
    composite_score: compositeScore,
    verdict: verdictStr,
    weights_version_id: row.weightsVersionId,
    evaluated_at: evaluatedAt,
    staleness_age_hours: ageHours,
    computed_from_n_subsystems: row.computedFromNSubsystems,
    shadow_decision: shadowDecision,
    reason: `composite.${shadowDecision.toLowerCase()}_score_${compositeScore.toFixed(3)}`,
  };
}
