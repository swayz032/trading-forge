/**
 * Strategy Pre-Validator — gate that runs BEFORE backtest queue insert.
 *
 * Three checks:
 *   1. Graveyard hash    — has this concept (market+tf+conceptName) been
 *                          journaled by openclaw in the last 90 days?
 *   2. Correlation guard — is there already a DEPLOYED strategy on the same
 *                          (market, timeframe, conceptName)?  ρ proxy.
 *   3. Regime fit        — does the strategy's preferredRegime align with the
 *                          current/intended regime?
 *
 * Returns { passed, reasons }.  Soft-blocks (warnings) bubble through reasons
 * but do not flip passed=false unless explicitly hard.  Caller decides.
 */

import { createHash } from "crypto";
import { db } from "../db/index.js";
import { systemJournal, strategies } from "../db/schema.js";
import { sql, and, eq } from "drizzle-orm";
import { logger } from "../index.js";

export interface CandidateInput {
  conceptName: string;       // e.g. "trend_follow_breakout", "mean_revert_vwap"
  market: string;            // ES | NQ | CL | etc.
  timeframe: string;         // 5m | 15m | 1h
  preferredRegime?: string;  // TRENDING_UP | RANGE_BOUND | etc.
  intendedRegime?: string;   // current regime the candidate would deploy into
  entryRules?: string;       // textual rules (used for fingerprinting)
  exitRules?: string;
}

export interface PrevalidationResult {
  passed: boolean;
  fingerprint: string;
  reasons: string[];
  checks: {
    graveyard: { passed: boolean; existingCount: number };
    correlation: { passed: boolean; deployedCount: number };
    regime: { passed: boolean; reason?: string };
  };
}

const GRAVEYARD_LOOKBACK_DAYS = 90;

const REGIME_COMPAT: Record<string, string[]> = {
  TRENDING_UP: ["TRENDING_UP", "HIGH_VOL"],
  TRENDING_DOWN: ["TRENDING_DOWN", "HIGH_VOL"],
  RANGE_BOUND: ["RANGE_BOUND", "LOW_VOL"],
  HIGH_VOL: ["HIGH_VOL", "TRENDING_UP", "TRENDING_DOWN"],
  LOW_VOL: ["LOW_VOL", "RANGE_BOUND"],
};

function fingerprintCandidate(c: CandidateInput): string {
  const canonical = [
    c.market.toUpperCase().trim(),
    c.timeframe.toLowerCase().trim(),
    c.conceptName.toLowerCase().trim(),
    (c.entryRules ?? "").toLowerCase().replace(/\s+/g, " ").trim(),
    (c.exitRules ?? "").toLowerCase().replace(/\s+/g, " ").trim(),
  ].join("::");
  return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

async function checkGraveyard(c: CandidateInput, fingerprint: string): Promise<{ passed: boolean; existingCount: number }> {
  try {
    const rows = await db.execute(sql`
      SELECT count(*)::int AS c FROM ${systemJournal}
      WHERE source = 'openclaw'
        AND created_at > now() - (${GRAVEYARD_LOOKBACK_DAYS} || ' days')::interval
        AND (
          (strategy_params->>'fingerprint') = ${fingerprint}
          OR (
            (strategy_params->>'market') = ${c.market}
            AND (strategy_params->>'timeframe') = ${c.timeframe}
            AND (strategy_params->>'conceptName') = ${c.conceptName}
          )
        )
    `);
    const count = Number((rows as any[])[0]?.c ?? 0);
    return { passed: count === 0, existingCount: count };
  } catch (err) {
    logger.warn({ err }, "strategy-prevalidator: graveyard query failed (table missing?)");
    return { passed: true, existingCount: 0 };
  }
}

async function checkCorrelation(c: CandidateInput): Promise<{ passed: boolean; deployedCount: number }> {
  try {
    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(strategies)
      .where(
        and(
          eq(strategies.symbol, c.market),
          eq(strategies.timeframe, c.timeframe),
          eq(strategies.lifecycleState, "DEPLOYED"),
        ),
      );
    const count = Number(rows[0]?.count ?? 0);
    return { passed: count === 0, deployedCount: count };
  } catch (err) {
    logger.warn({ err }, "strategy-prevalidator: correlation check failed");
    return { passed: true, deployedCount: 0 };
  }
}

function checkRegime(c: CandidateInput): { passed: boolean; reason?: string } {
  if (!c.preferredRegime || !c.intendedRegime) return { passed: true };
  const compat = REGIME_COMPAT[c.preferredRegime] ?? [];
  if (compat.includes(c.intendedRegime)) return { passed: true };
  return {
    passed: false,
    reason: `Strategy prefers ${c.preferredRegime} but intended deploy regime is ${c.intendedRegime}`,
  };
}

export async function prevalidateCandidate(c: CandidateInput): Promise<PrevalidationResult> {
  const fingerprint = fingerprintCandidate(c);
  const reasons: string[] = [];

  const graveyard = await checkGraveyard(c, fingerprint);
  if (!graveyard.passed) {
    reasons.push(
      `graveyard-match: ${graveyard.existingCount} prior journal entries match this concept fingerprint within ${GRAVEYARD_LOOKBACK_DAYS}d`,
    );
  }

  const correlation = await checkCorrelation(c);
  if (!correlation.passed) {
    reasons.push(
      `correlation-risk: ${correlation.deployedCount} DEPLOYED strategies on same (${c.market}, ${c.timeframe})`,
    );
  }

  const regime = checkRegime(c);
  if (!regime.passed && regime.reason) {
    reasons.push(`regime-mismatch: ${regime.reason}`);
  }

  // Hard block on graveyard or regime mismatch; correlation is a soft warn (still passes).
  const passed = graveyard.passed && regime.passed;

  logger.info(
    {
      fingerprint,
      passed,
      market: c.market,
      timeframe: c.timeframe,
      conceptName: c.conceptName,
      reasons,
    },
    "strategy-prevalidator: candidate evaluated",
  );

  return {
    passed,
    fingerprint,
    reasons,
    checks: { graveyard, correlation, regime },
  };
}
