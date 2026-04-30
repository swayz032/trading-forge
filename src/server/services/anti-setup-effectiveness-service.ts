/**
 * Anti-Setup Effectiveness Service — Weekly analysis of whether anti-setups help or hurt.
 *
 * Reads shadow_signals (blocked trades) and paper_signal_logs (anti_setup_blocked entries),
 * computes hypothetical P&L for each blocked trade using actual market data,
 * and produces effectiveness scores per anti-setup rule.
 *
 * Key questions answered:
 *   - For each anti-setup rule: how many trades were blocked?
 *   - What was the hypothetical P&L of those blocked trades?
 *   - If hypothetical P&L > 0 (blocked would-be winners), the rule is suspect.
 *   - If hypothetical P&L < 0 (blocked losers), the rule is working.
 *
 * Results are stored in audit_log for querying and in the anti-setup effectiveness
 * SSE broadcast for dashboard visibility.
 */

import { db } from "../db/index.js";
import { paperSignalLogs, paperSessions, paperTrades, auditLog, strategies } from "../db/schema.js";
import { eq, and, gte, inArray, isNotNull, desc } from "drizzle-orm";
import { broadcastSSE } from "../routes/sse.js";
import { logger } from "../lib/logger.js";

// ─── Types ──────────────────────────────────────────────────

export interface AntiSetupEffectivenessScore {
  rule: string;
  strategyId: string;
  strategyName: string;
  tradesBlocked: number;
  hypotheticalPnlSum: number;      // negative = anti-setup saved money, positive = blocked winners
  hypotheticalPnlAvg: number;
  wouldHaveWonCount: number;        // trades that would have been profitable
  wouldHaveLostCount: number;       // trades that would have been losers
  effectiveness: number;            // 0-1 score: higher = better (more losers blocked)
  verdict: "EFFECTIVE" | "SUSPECT" | "INCONCLUSIVE";
  analyzedPeriod: { from: string; to: string };
}

export interface EffectivenessReport {
  analyzedAt: string;
  periodDays: number;
  totalTradesBlocked: number;
  totalHypotheticalPnl: number;
  ruleScores: AntiSetupEffectivenessScore[];
  suspectRules: AntiSetupEffectivenessScore[];  // rules that may be blocking winners
}

// ─── Hypothetical P&L computation ───────────────────────────
// For each blocked signal, look at what the market did during the next N bars
// after the blocked entry. Use actual paper trades from the same session
// to estimate typical hold duration and direction-appropriate P&L.

/**
 * Run the weekly anti-setup effectiveness analysis.
 *
 * Looks back `lookbackDays` days, finds all anti-setup blocked signals,
 * computes hypothetical P&L for each, and stores results.
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
      totalHypotheticalPnl: 0,
      ruleScores: [],
      suspectRules: [],
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

  // 4. Get actual trades from the same sessions during the same period to estimate
  //    typical trade duration and outcome patterns for hypothetical P&L
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
      ),
    );

  // Compute average hold duration per session (in ms)
  const sessionHoldDurations = new Map<string, number>();
  const sessionTradesBySession = new Map<string, typeof actualTrades>();
  for (const trade of actualTrades) {
    if (!sessionTradesBySession.has(trade.sessionId)) {
      sessionTradesBySession.set(trade.sessionId, []);
    }
    sessionTradesBySession.get(trade.sessionId)!.push(trade);
    if (trade.entryTime && trade.exitTime) {
      const dur = new Date(trade.exitTime).getTime() - new Date(trade.entryTime).getTime();
      const existing = sessionHoldDurations.get(trade.sessionId);
      if (existing) {
        sessionHoldDurations.set(trade.sessionId, (existing + dur) / 2);
      } else {
        sessionHoldDurations.set(trade.sessionId, dur);
      }
    }
  }

  // 5. For each blocked signal, compute hypothetical P&L
  //    We look at the shadow_signals table which stores the expectedEntry.
  //    Since we can't know the exact exit price, we use the average trade P&L
  //    from the same session as a proxy for what a typical trade would have done.
  //    Better: if we have subsequent bar data, we simulate what would have happened.
  //
  //    For now, use a simpler approach: look at actual trades that occurred
  //    within a similar time window and compute the average P&L per trade
  //    in that session as the hypothetical.

  // Group blocked logs by anti-setup rule
  const ruleGroups = new Map<string, {
    rule: string;
    strategyId: string;
    strategyName: string;
    entries: Array<{
      price: number;
      direction: string;
      sessionId: string;
      timestamp: Date;
      indicators: Record<string, unknown>;
    }>;
  }>();

  for (const log of blockedLogs) {
    const snapshot = (log.indicatorSnapshot ?? {}) as Record<string, unknown>;
    const rule = (snapshot._anti_setup_rule as string) ?? "unknown";
    const session = sessionMap.get(log.sessionId);
    const strategyId = session?.strategyId ?? "unknown";
    const strategyName = strategyNameMap.get(strategyId) ?? "unknown";
    const key = `${strategyId}::${rule}`;

    if (!ruleGroups.has(key)) {
      ruleGroups.set(key, { rule, strategyId, strategyName, entries: [] });
    }
    ruleGroups.get(key)!.entries.push({
      price: parseFloat(log.price ?? "0"),
      direction: log.direction,
      sessionId: log.sessionId,
      timestamp: log.createdAt,
      indicators: snapshot,
    });
  }

  // 6. Compute hypothetical P&L per rule
  //    Strategy: For each blocked trade, look at what actual trades in the same
  //    session close to that time did. If there are no actual trades nearby,
  //    use the session's average trade P&L as a proxy.
  const ruleScores: AntiSetupEffectivenessScore[] = [];

  for (const [, group] of ruleGroups) {
    let hypotheticalPnlSum = 0;
    let wouldHaveWonCount = 0;
    let wouldHaveLostCount = 0;

    for (const entry of group.entries) {
      // Find actual trades in the same session within +/- 2 hours of the blocked signal
      const sessionTrades = sessionTradesBySession.get(entry.sessionId) ?? [];
      const windowMs = 2 * 60 * 60 * 1000; // 2 hours
      const nearbyTrades = sessionTrades.filter((t) => {
        if (!t.entryTime) return false;
        const diff = Math.abs(new Date(t.entryTime).getTime() - entry.timestamp.getTime());
        return diff < windowMs;
      });

      let estimatedPnl: number;
      if (nearbyTrades.length > 0) {
        // Use the average P&L of nearby trades as the hypothetical
        const totalPnl = nearbyTrades.reduce((sum, t) => sum + Number(t.pnl ?? 0), 0);
        estimatedPnl = totalPnl / nearbyTrades.length;
      } else if (sessionTrades.length > 0) {
        // Fallback: use the session's average trade P&L
        const totalPnl = sessionTrades.reduce((sum, t) => sum + Number(t.pnl ?? 0), 0);
        estimatedPnl = totalPnl / sessionTrades.length;
      } else {
        // No trade data at all — mark as inconclusive
        estimatedPnl = 0;
      }

      hypotheticalPnlSum += estimatedPnl;
      if (estimatedPnl > 0) wouldHaveWonCount++;
      else if (estimatedPnl < 0) wouldHaveLostCount++;
    }

    const tradesBlocked = group.entries.length;
    const hypotheticalPnlAvg = tradesBlocked > 0 ? hypotheticalPnlSum / tradesBlocked : 0;

    // Effectiveness: proportion of blocked trades that would have lost money
    const totalWithOutcome = wouldHaveWonCount + wouldHaveLostCount;
    const effectiveness = totalWithOutcome > 0 ? wouldHaveLostCount / totalWithOutcome : 0.5;

    // Verdict: EFFECTIVE if blocking mostly losers, SUSPECT if blocking mostly winners
    let verdict: "EFFECTIVE" | "SUSPECT" | "INCONCLUSIVE";
    if (tradesBlocked < 3 || totalWithOutcome === 0) {
      verdict = "INCONCLUSIVE";
    } else if (effectiveness >= 0.6) {
      verdict = "EFFECTIVE";
    } else if (wouldHaveWonCount > wouldHaveLostCount) {
      verdict = "SUSPECT";
    } else {
      verdict = "INCONCLUSIVE";
    }

    ruleScores.push({
      rule: group.rule,
      strategyId: group.strategyId,
      strategyName: group.strategyName,
      tradesBlocked,
      hypotheticalPnlSum: Math.round(hypotheticalPnlSum * 100) / 100,
      hypotheticalPnlAvg: Math.round(hypotheticalPnlAvg * 100) / 100,
      wouldHaveWonCount,
      wouldHaveLostCount,
      effectiveness: Math.round(effectiveness * 100) / 100,
      verdict,
      analyzedPeriod: {
        from: cutoff.toISOString(),
        to: now.toISOString(),
      },
    });
  }

  // Sort: suspect rules first so they're immediately visible
  ruleScores.sort((a, b) => {
    if (a.verdict === "SUSPECT" && b.verdict !== "SUSPECT") return -1;
    if (b.verdict === "SUSPECT" && a.verdict !== "SUSPECT") return 1;
    return b.hypotheticalPnlSum - a.hypotheticalPnlSum; // highest blocked P&L first
  });

  const suspectRules = ruleScores.filter((r) => r.verdict === "SUSPECT");
  const totalBlocked = ruleScores.reduce((sum, r) => sum + r.tradesBlocked, 0);
  const totalHypotheticalPnl = ruleScores.reduce((sum, r) => sum + r.hypotheticalPnlSum, 0);

  const report: EffectivenessReport = {
    analyzedAt: now.toISOString(),
    periodDays: lookbackDays,
    totalTradesBlocked: totalBlocked,
    totalHypotheticalPnl: Math.round(totalHypotheticalPnl * 100) / 100,
    ruleScores,
    suspectRules,
  };

  // 7. Persist to audit_log for queryable history
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

  // 8. Broadcast results via SSE for dashboard
  broadcastSSE("anti-setup:effectiveness", {
    totalBlocked,
    totalHypotheticalPnl: report.totalHypotheticalPnl,
    suspectCount: suspectRules.length,
    ruleCount: ruleScores.length,
  });

  // 9. Log suspect rules at warn level so they're visible in logs
  if (suspectRules.length > 0) {
    logger.warn(
      {
        suspectRules: suspectRules.map((r) => ({
          rule: r.rule,
          strategy: r.strategyName,
          blockedWinners: r.wouldHaveWonCount,
          hypotheticalPnl: r.hypotheticalPnlSum,
        })),
      },
      "Anti-setup effectiveness: SUSPECT rules found — these may be blocking profitable trades",
    );
  }

  logger.info(
    {
      totalBlocked,
      totalHypotheticalPnl: report.totalHypotheticalPnl,
      effectiveRules: ruleScores.filter((r) => r.verdict === "EFFECTIVE").length,
      suspectRules: suspectRules.length,
      inconclusiveRules: ruleScores.filter((r) => r.verdict === "INCONCLUSIVE").length,
    },
    "Anti-setup effectiveness analysis complete",
  );

  return report;
}
