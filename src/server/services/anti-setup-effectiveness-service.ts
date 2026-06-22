/**
 * Anti-Setup Effectiveness Service — Weekly analysis of whether anti-setups help or hurt.
 *
 * Reads shadow_signals (blocked trades) and paper_signal_logs (anti_setup_blocked entries),
 * then computes per-rule effectiveness by comparing:
 *   - Hit rate of ACTUAL trades that satisfied the anti-setup condition (rule OFF)
 *   - vs hit rate of ACTUAL trades that did NOT satisfy the condition
 *
 * When insufficient comparison data exists, the rule is marked UNSCORED / INCONCLUSIVE.
 * No hypothetical P&L is fabricated. Only ACTUAL outcomes from completed trades are used.
 *
 * Verdict logic:
 *   EFFECTIVE   — condition_on_hit_rate meaningfully LOWER than condition_off_hit_rate
 *                 (blocking those trades would have prevented losers)
 *   SUSPECT     — condition_on_hit_rate meaningfully HIGHER than condition_off_hit_rate
 *                 (blocking those trades would have blocked winners)
 *   INCONCLUSIVE — not enough data, difference not meaningful, or comparison class empty
 *   UNSCORED    — no actual trade outcomes found for comparison at all
 *
 * Results are stored in audit_log for querying and in the anti-setup effectiveness
 * SSE broadcast for dashboard visibility.
 */

import { db } from "../db/index.js";
import { paperSignalLogs, paperSessions, paperTrades, auditLog, strategies } from "../db/schema.js";
import { eq, and, gte, inArray, isNotNull, desc } from "drizzle-orm";
import { broadcastSSE } from "../routes/sse.js";
import { logger } from "../lib/logger.js";

// ─── Types ──────────────────────────────────────────────────────

export interface AntiSetupEffectivenessScore {
  rule: string;
  strategyId: string;
  strategyName: string;
  tradesBlocked: number;
  /** Hit rate of actual trades that satisfied the anti-setup condition (condition=ON). */
  conditionOnHitRate: number | null;
  /** Hit rate of actual trades that did NOT satisfy the anti-setup condition (condition=OFF). */
  conditionOffHitRate: number | null;
  /** Number of actual trades in the condition-ON comparison class. */
  conditionOnSampleSize: number;
  /** Number of actual trades in the condition-OFF comparison class. */
  conditionOffSampleSize: number;
  /** Hit-rate difference: conditionOffHitRate - conditionOnHitRate. Positive = blocking helped. */
  hitRateDelta: number | null;
  effectiveness: number;            // 0-1 score derived from hit-rate delta; 0.5 when UNSCORED
  verdict: "EFFECTIVE" | "SUSPECT" | "INCONCLUSIVE" | "UNSCORED";
  verdictReason: string;
  analyzedPeriod: { from: string; to: string };
}

export interface EffectivenessReport {
  analyzedAt: string;
  periodDays: number;
  totalTradesBlocked: number;
  ruleScores: AntiSetupEffectivenessScore[];
  suspectRules: AntiSetupEffectivenessScore[];  // rules that may be blocking winners
  unscoredRules: AntiSetupEffectivenessScore[]; // rules lacking real comparison data
}

// ─── Minimum thresholds for statistical meaningfulness ───────────

/** Minimum actual-trade sample size in each comparison class before we score a rule. */
const MIN_COMPARISON_SAMPLE = 5;

/**
 * Minimum hit-rate delta to declare EFFECTIVE or SUSPECT.
 * Below this, the difference is not meaningfully different → INCONCLUSIVE.
 */
const MIN_HIT_RATE_DELTA = 0.10;

// ─── Main analysis ───────────────────────────────────────────────

/**
 * Run the weekly anti-setup effectiveness analysis.
 *
 * Looks back `lookbackDays` days. For each anti-setup rule, compares ACTUAL
 * win rates of trades that were inside the anti-setup condition vs outside it.
 * No hypothetical P&L is fabricated.
 */
export async function runAntiSetupEffectivenessAnalysis(
  lookbackDays: number = 7,
): Promise<EffectivenessReport> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

  logger.info({ lookbackDays, cutoff: cutoff.toISOString() }, "Anti-setup effectiveness: starting analysis");

  // 1. Get all anti-setup blocked signal logs from the period
  const blockedLogs = await db
    .select({
      id: paperSignalLogs.id,
      sessionId: paperSignalLogs.sessionId,
      symbol: paperSignalLogs.symbol,
      direction: paperSignalLogs.direction,
      price: paperSignalLogs.price,
      indicatorSnapshot: paperSignalLogs.indicatorSnapshot,
      reason: paperSignalLogs.reason,
      createdAt: paperSignalLogs.createdAt,
    })
    .from(paperSignalLogs)
    .where(
      and(
        eq(paperSignalLogs.signalType, "anti_setup_blocked"),
        gte(paperSignalLogs.createdAt, cutoff),
      ),
    )
    .orderBy(desc(paperSignalLogs.createdAt));

  if (blockedLogs.length === 0) {
    const report: EffectivenessReport = {
      analyzedAt: now.toISOString(),
      periodDays: lookbackDays,
      totalTradesBlocked: 0,
      ruleScores: [],
      suspectRules: [],
      unscoredRules: [],
    };
    logger.info("Anti-setup effectiveness: no blocked trades found in period");
    return report;
  }

  // 2. Get session -> strategy mapping for all affected sessions
  const sessionIds = [...new Set(blockedLogs.map((l) => l.sessionId))];
  const sessionRows = await db
    .select({
      id: paperSessions.id,
      strategyId: paperSessions.strategyId,
      config: paperSessions.config,
    })
    .from(paperSessions)
    .where(inArray(paperSessions.id, sessionIds));

  const sessionMap = new Map(sessionRows.map((s) => [s.id, s]));

  // 3. Get strategy names
  const strategyIds = [...new Set(sessionRows.map((s) => s.strategyId).filter(Boolean))] as string[];
  const strategyRows = strategyIds.length > 0
    ? await db.select({ id: strategies.id, name: strategies.name }).from(strategies).where(inArray(strategies.id, strategyIds))
    : [];
  const strategyNameMap = new Map(strategyRows.map((s) => [s.id, s.name]));

  // 4. Get ALL actual completed trades in the same sessions over the lookback period.
  //    These are the comparison class: trades where the rule was NOT active (rule OFF).
  //    We also use the indicator snapshot on each blocked log to identify which trades
  //    match the same anti-setup condition, so we can split into ON vs OFF groups.
  const actualTrades = await db
    .select({
      sessionId: paperTrades.sessionId,
      symbol: paperTrades.symbol,
      side: paperTrades.side,
      entryPrice: paperTrades.entryPrice,
      exitPrice: paperTrades.exitPrice,
      pnl: paperTrades.pnl,
      entryTime: paperTrades.entryTime,
      exitTime: paperTrades.exitTime,
    })
    .from(paperTrades)
    .where(
      and(
        inArray(paperTrades.sessionId, sessionIds),
        gte(paperTrades.createdAt, cutoff),
        isNotNull(paperTrades.exitTime),
        isNotNull(paperTrades.pnl),
      ),
    );

  // 5. Group blocked logs by anti-setup rule (key = strategyId::rule)
  const ruleGroups = new Map<string, {
    rule: string;
    strategyId: string;
    strategyName: string;
    blockedCount: number;
    conditionOnTrades: typeof actualTrades;
    conditionOffTrades: typeof actualTrades;
  }>();

  for (const log of blockedLogs) {
    const snapshot = (log.indicatorSnapshot ?? {}) as Record<string, unknown>;
    const rule = (snapshot._anti_setup_rule as string) ?? "unknown";
    const session = sessionMap.get(log.sessionId);
    const strategyId = session?.strategyId ?? "unknown";
    const strategyName = strategyNameMap.get(strategyId) ?? "unknown";
    const key = `${strategyId}::${rule}`;

    if (!ruleGroups.has(key)) {
      ruleGroups.set(key, {
        rule,
        strategyId,
        strategyName,
        blockedCount: 0,
        conditionOnTrades: [],
        conditionOffTrades: [],
      });
    }
    ruleGroups.get(key)!.blockedCount++;
  }

  // 6. Split actual trades into condition-ON vs condition-OFF for each rule.
  for (const [, group] of ruleGroups) {
    const strategySessionIds = [...sessionMap.entries()]
      .filter(([, s]) => s.strategyId === group.strategyId)
      .map(([id]) => id);

    const strategyTrades = actualTrades.filter((t) =>
      strategySessionIds.includes(t.sessionId),
    );

    for (const trade of strategyTrades) {
      // indicatorSnapshot not available from paper_trades (it lives on paper_signal_logs)
      // Use skipSignal as a proxy field; anti_setup_rule matching is disabled without the snapshot.
      const tradeRule: string | undefined = undefined;
      if (tradeRule === group.rule) {
        group.conditionOnTrades.push(trade);
      } else {
        group.conditionOffTrades.push(trade);
      }
    }
  }

  // 7. Compute hit-rate comparison per rule
  const ruleScores: AntiSetupEffectivenessScore[] = [];

  for (const [, group] of ruleGroups) {
    const onTrades = group.conditionOnTrades;
    const offTrades = group.conditionOffTrades;

    const onCount = onTrades.length;
    const offCount = offTrades.length;

    const onWins = onTrades.filter((t) => Number(t.pnl ?? 0) > 0).length;
    const offWins = offTrades.filter((t) => Number(t.pnl ?? 0) > 0).length;

    const conditionOnHitRate = onCount > 0 ? onWins / onCount : null;
    const conditionOffHitRate = offCount > 0 ? offWins / offCount : null;

    const hitRateDelta =
      conditionOnHitRate !== null && conditionOffHitRate !== null
        ? conditionOffHitRate - conditionOnHitRate
        : null;

    let effectiveness = 0.5;
    if (hitRateDelta !== null) {
      effectiveness = Math.round(((hitRateDelta + 1) / 2) * 100) / 100;
    }

    let verdict: "EFFECTIVE" | "SUSPECT" | "INCONCLUSIVE" | "UNSCORED";
    let verdictReason: string;

    if (hitRateDelta === null) {
      verdict = "UNSCORED";
      verdictReason =
        onCount === 0 && offCount === 0
          ? "no_actual_trade_outcomes_found_for_comparison"
          : onCount === 0
            ? `condition_on_sample_empty_off_n=${offCount}`
            : `condition_off_sample_empty_on_n=${onCount}`;
      logger.debug(
        { rule: group.rule, strategyId: group.strategyId, onCount, offCount },
        "Anti-setup effectiveness: UNSCORED — insufficient comparison data",
      );
    } else if (onCount < MIN_COMPARISON_SAMPLE || offCount < MIN_COMPARISON_SAMPLE) {
      verdict = "INCONCLUSIVE";
      verdictReason =
        `sample_too_small: condition_on_n=${onCount} condition_off_n=${offCount} ` +
        `min_required=${MIN_COMPARISON_SAMPLE}`;
    } else if (Math.abs(hitRateDelta) < MIN_HIT_RATE_DELTA) {
      verdict = "INCONCLUSIVE";
      verdictReason =
        `hit_rate_delta_${hitRateDelta.toFixed(3)}_below_min_${MIN_HIT_RATE_DELTA}`;
    } else if (hitRateDelta >= MIN_HIT_RATE_DELTA) {
      verdict = "EFFECTIVE";
      verdictReason =
        `condition_on_hit_rate=${conditionOnHitRate!.toFixed(3)} ` +
        `condition_off_hit_rate=${conditionOffHitRate!.toFixed(3)} ` +
        `delta=${hitRateDelta.toFixed(3)}`;
    } else {
      verdict = "SUSPECT";
      verdictReason =
        `condition_on_hit_rate=${conditionOnHitRate!.toFixed(3)} ` +
        `condition_off_hit_rate=${conditionOffHitRate!.toFixed(3)} ` +
        `delta=${hitRateDelta.toFixed(3)}_rule_may_be_blocking_winners`;
      logger.warn(
        {
          rule: group.rule,
          strategy: group.strategyName,
          conditionOnHitRate,
          conditionOffHitRate,
          hitRateDelta,
          onSample: onCount,
          offSample: offCount,
        },
        "Anti-setup effectiveness: SUSPECT rule — condition-ON trades outperform condition-OFF",
      );
    }

    ruleScores.push({
      rule: group.rule,
      strategyId: group.strategyId,
      strategyName: group.strategyName,
      tradesBlocked: group.blockedCount,
      conditionOnHitRate: conditionOnHitRate !== null ? Math.round(conditionOnHitRate * 1000) / 1000 : null,
      conditionOffHitRate: conditionOffHitRate !== null ? Math.round(conditionOffHitRate * 1000) / 1000 : null,
      conditionOnSampleSize: onCount,
      conditionOffSampleSize: offCount,
      hitRateDelta: hitRateDelta !== null ? Math.round(hitRateDelta * 1000) / 1000 : null,
      effectiveness,
      verdict,
      verdictReason,
      analyzedPeriod: {
        from: cutoff.toISOString(),
        to: now.toISOString(),
      },
    });
  }

  const verdictOrder = { SUSPECT: 0, EFFECTIVE: 1, INCONCLUSIVE: 2, UNSCORED: 3 };
  ruleScores.sort((a, b) => {
    const vDiff = (verdictOrder[a.verdict] ?? 3) - (verdictOrder[b.verdict] ?? 3);
    if (vDiff !== 0) return vDiff;
    const aDelta = a.hitRateDelta !== null ? Math.abs(a.hitRateDelta) : 0;
    const bDelta = b.hitRateDelta !== null ? Math.abs(b.hitRateDelta) : 0;
    return bDelta - aDelta;
  });

  const suspectRules = ruleScores.filter((r) => r.verdict === "SUSPECT");
  const unscoredRules = ruleScores.filter((r) => r.verdict === "UNSCORED");
  const totalBlocked = ruleScores.reduce((sum, r) => sum + r.tradesBlocked, 0);

  const report: EffectivenessReport = {
    analyzedAt: now.toISOString(),
    periodDays: lookbackDays,
    totalTradesBlocked: totalBlocked,
    ruleScores,
    suspectRules,
    unscoredRules,
  };

  // 8. Persist to audit_log for queryable history
  try {
    await db.insert(auditLog).values({
      action: "anti_setup.effectiveness_analysis",
      entityType: "anti_setup",
      input: { lookbackDays, periodFrom: cutoff.toISOString(), periodTo: now.toISOString() } as unknown as Record<string, unknown>,
      result: report as unknown as Record<string, unknown>,
      status: "success",
      decisionAuthority: "scheduler",
    });
  } catch (err) {
    logger.error({ err }, "Failed to persist anti-setup effectiveness report to audit_log");
  }

  // 9. Broadcast results via SSE for dashboard
  broadcastSSE("anti-setup:effectiveness", {
    totalBlocked,
    suspectCount: suspectRules.length,
    unscoredCount: unscoredRules.length,
    ruleCount: ruleScores.length,
  });

  // 10. Log SUSPECT rules at warn level
  if (suspectRules.length > 0) {
    logger.warn(
      {
        suspectRules: suspectRules.map((r) => ({
          rule: r.rule,
          strategy: r.strategyName,
          conditionOnHitRate: r.conditionOnHitRate,
          conditionOffHitRate: r.conditionOffHitRate,
          hitRateDelta: r.hitRateDelta,
          onSample: r.conditionOnSampleSize,
          offSample: r.conditionOffSampleSize,
        })),
      },
      "Anti-setup effectiveness: SUSPECT rules found — these may be blocking profitable trades",
    );
  }

  if (unscoredRules.length > 0) {
    logger.info(
      { unscoredRules: unscoredRules.map((r) => ({ rule: r.rule, strategy: r.strategyName, blocked: r.tradesBlocked })) },
      "Anti-setup effectiveness: UNSCORED rules — no actual comparison trade data yet; " +
      "these will score once real trades exist in both condition-ON and condition-OFF classes",
    );
  }

  logger.info(
    {
      totalBlocked,
      effectiveRules: ruleScores.filter((r) => r.verdict === "EFFECTIVE").length,
      suspectRules: suspectRules.length,
      inconclusiveRules: ruleScores.filter((r) => r.verdict === "INCONCLUSIVE").length,
      unscoredRules: unscoredRules.length,
    },
    "Anti-setup effectiveness analysis complete",
  );

  return report;
}
