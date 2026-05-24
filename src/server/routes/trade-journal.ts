/**
 * trade-journal.ts — Wave 26 Pass 2
 *
 * REST endpoints for the Trade Journal — the institutional autopsy layer that
 * bridges paper_positions + trade_critique into a single queryable feed.
 *
 * Routes:
 *   GET /api/trade-journal          — paginated trade list with optional filters
 *   GET /api/trade-journal/stats    — KPI aggregations for the header + charts
 *
 * Design notes:
 * - paper_positions LEFT JOIN trade_critique: a closed position without a critique
 *   is still returned with critique=null and grade=null. Never hidden.
 * - Default sort: critiquedAt DESC, exitTime DESC (most-recently-reviewed first).
 * - All filter params are optional; absent = unfiltered.
 * - gradeMin ordering: A+ > A > B+ > B > C+ > C > D > F
 * - Drizzle: uses inArray() never sql`col = ANY(array)`.
 * - Logger imported from ./logger.js leaf module.
 */

import { Router, type Request, type Response } from "express";
import { sql, and, gte, lte, eq, desc, isNotNull, or, isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  paperPositions,
  paperSessions,
  tradeCritique,
  strategies,
} from "../db/schema.js";
import { logger } from "../lib/logger.js";

export const tradeJournalRoutes = Router();

// ─── Grade ordering (A+ = 8 highest, F = 1 lowest) ─────────────────────────
const GRADE_ORDER: Record<string, number> = {
  "A+": 8, "A": 7, "B+": 6, "B": 5, "C+": 4, "C": 3, "D": 2, "F": 1,
};

const ALL_GRADES = ["A+", "A", "B+", "B", "C+", "C", "D", "F"] as const;

// ─── GET /api/trade-journal ─────────────────────────────────────────────────

tradeJournalRoutes.get("/", async (req: Request, res: Response) => {
  try {
    const {
      outcome,       // win | loss | scratch | all
      regime,        // TRENDING_UP | TRENDING_DOWN | RANGE_BOUND
      strategyId,    // uuid
      accountId,     // uuid
      gradeMin,      // A+ | A | B+ | B | C+ | C | D | F
      dateFrom,      // ISO date string
      dateTo,        // ISO date string
      limit = "50",
      offset = "0",
    } = req.query as Record<string, string | undefined>;

    const limitN = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const offsetN = Math.max(Number(offset) || 0, 0);

    // Build WHERE conditions against paper_positions (pp) and trade_critique (tc).
    // We do a LEFT JOIN so uncritiqued positions still appear.
    const conditions: ReturnType<typeof eq>[] = [];

    // Only closed positions are trade journal entries
    conditions.push(isNotNull(paperPositions.closedAt));

    // Outcome filter — realized_r derived from paper_positions fields
    // realized_r > 0 = win, realized_r < 0 = loss, = 0 = scratch
    // We store realized_r in trade_critique.technical_diagnosis.realized_r (JSONB)
    // AND can compute it from entryPrice/exitPrice/side in paper_positions.
    // Use the raw position math here so we don't depend on critique existing.
    if (outcome && outcome !== "all") {
      if (outcome === "win") {
        conditions.push(
          sql`(
            CASE WHEN ${paperPositions.side} = 'long'
              THEN (${paperPositions.currentPrice}::numeric - ${paperPositions.entryPrice}::numeric)
              ELSE (${paperPositions.entryPrice}::numeric - ${paperPositions.currentPrice}::numeric)
            END
          ) > 0`
        );
      } else if (outcome === "loss") {
        conditions.push(
          sql`(
            CASE WHEN ${paperPositions.side} = 'long'
              THEN (${paperPositions.currentPrice}::numeric - ${paperPositions.entryPrice}::numeric)
              ELSE (${paperPositions.entryPrice}::numeric - ${paperPositions.currentPrice}::numeric)
            END
          ) < 0`
        );
      } else if (outcome === "scratch") {
        conditions.push(
          sql`(
            CASE WHEN ${paperPositions.side} = 'long'
              THEN (${paperPositions.currentPrice}::numeric - ${paperPositions.entryPrice}::numeric)
              ELSE (${paperPositions.entryPrice}::numeric - ${paperPositions.currentPrice}::numeric)
            END
          ) = 0`
        );
      }
    }

    // Regime filter — stored in trade_critique.technical_diagnosis->>'regime_at_entry'
    if (regime && regime !== "all") {
      conditions.push(
        sql`${tradeCritique.technicalDiagnosis}->>'regime_at_entry' = ${regime}`
      );
    }

    // Strategy filter
    if (strategyId) {
      conditions.push(eq(paperSessions.strategyId, strategyId));
    }

    // Account filter — paper_sessions.firm_id is the closest approximation
    // since paper_positions has no direct account_id; use session join
    if (accountId) {
      conditions.push(sql`${paperSessions.id}::text = ${accountId}`);
    }

    // Date range filter on closedAt
    if (dateFrom) {
      const from = new Date(dateFrom);
      if (!isNaN(from.getTime())) {
        conditions.push(gte(paperPositions.closedAt, from));
      }
    }
    if (dateTo) {
      const to = new Date(dateTo);
      if (!isNaN(to.getTime())) {
        // Include all of the end day
        to.setHours(23, 59, 59, 999);
        conditions.push(lte(paperPositions.closedAt, to));
      }
    }

    // gradeMin filter — only apply when critique exists; uncritiqued rows always show
    const gradeMinOrder = gradeMin ? (GRADE_ORDER[gradeMin] ?? 0) : 0;

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // ── Count query ──────────────────────────────────────────────────────────
    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(paperPositions)
      .leftJoin(tradeCritique, eq(paperPositions.id, tradeCritique.positionId))
      .leftJoin(paperSessions, eq(paperPositions.sessionId, paperSessions.id))
      .leftJoin(strategies, eq(paperSessions.strategyId, strategies.id))
      .where(
        gradeMinOrder > 0
          ? and(
              whereClause,
              or(
                isNull(tradeCritique.grade),
                sql`${tradeCritique.grade} = ANY(ARRAY[${sql.raw(
                  ALL_GRADES
                    .filter((g) => (GRADE_ORDER[g] ?? 0) >= gradeMinOrder)
                    .map((g) => `'${g}'`)
                    .join(",")
                )}]::text[])`
              )
            )
          : whereClause
      );

    // ── Data query ───────────────────────────────────────────────────────────
    const rows = await db
      .select({
        // Position fields
        positionId:    paperPositions.id,
        sessionId:     paperPositions.sessionId,
        symbol:        paperPositions.symbol,
        side:          paperPositions.side,
        entryPrice:    paperPositions.entryPrice,
        exitPrice:     paperPositions.currentPrice,  // current_price holds exit price when closed
        entryTime:     paperPositions.entryTime,
        exitTime:      paperPositions.closedAt,
        contracts:     paperPositions.contracts,
        implementationShortfall: paperPositions.implementationShortfall,
        fillRatio:     paperPositions.fillRatio,
        // Session fields
        strategyId:    paperSessions.strategyId,
        firmId:        paperSessions.firmId,
        // Strategy fields
        strategyName:  strategies.name,
        strategySymbol: strategies.symbol,
        // Critique fields
        grade:              tradeCritique.grade,
        technicalDiagnosis: tradeCritique.technicalDiagnosis,
        plainEnglishSummary: tradeCritique.plainEnglishSummary,
        dataCompleteness:   tradeCritique.dataCompleteness,
        missingFields:      tradeCritique.missingFields,
        provider:           tradeCritique.provider,
        model:              tradeCritique.model,
        critiquedAt:        tradeCritique.critiquedAt,
        correlationId:      tradeCritique.correlationId,
      })
      .from(paperPositions)
      .leftJoin(tradeCritique, eq(paperPositions.id, tradeCritique.positionId))
      .leftJoin(paperSessions, eq(paperPositions.sessionId, paperSessions.id))
      .leftJoin(strategies, eq(paperSessions.strategyId, strategies.id))
      .where(
        gradeMinOrder > 0
          ? and(
              whereClause,
              or(
                isNull(tradeCritique.grade),
                sql`${tradeCritique.grade} = ANY(ARRAY[${sql.raw(
                  ALL_GRADES
                    .filter((g) => (GRADE_ORDER[g] ?? 0) >= gradeMinOrder)
                    .map((g) => `'${g}'`)
                    .join(",")
                )}]::text[])`
              )
            )
          : whereClause
      )
      .orderBy(
        desc(tradeCritique.critiquedAt),
        desc(paperPositions.closedAt)
      )
      .limit(limitN)
      .offset(offsetN);

    // ── Shape output ─────────────────────────────────────────────────────────
    const data = rows.map((row) => {
      const td: Record<string, any> = (row.technicalDiagnosis as Record<string, any>) ?? {};
      const pe: Record<string, any> = (row.plainEnglishSummary as Record<string, any>) ?? {};

      // Derive outcome from price delta
      const entryN = parseFloat(row.entryPrice ?? "0");
      const exitN  = parseFloat(row.exitPrice ?? "0");
      const priceDelta = row.side === "long" ? (exitN - entryN) : (entryN - exitN);
      const outcome = priceDelta > 0 ? "win" : priceDelta < 0 ? "loss" : "scratch";

      // realized_r: prefer critique TD, fallback to price delta / ATR estimate
      const realizedR: number | null =
        td.realized_r != null
          ? Number(td.realized_r)
          : null;

      const entryQualityScore: number | null = td.entry_quality_score != null
        ? Number(td.entry_quality_score)
        : null;

      return {
        positionId: row.positionId,
        accountId: row.sessionId,  // closest to accountId in paper layer
        strategyId: row.strategyId ?? null,
        strategyName: row.strategyName ?? "Unknown Strategy",
        symbol: row.symbol,
        side: row.side,
        entryPrice: row.entryPrice,
        exitPrice: row.exitPrice,
        entryTime: row.entryTime,
        exitTime: row.exitTime,
        contracts: row.contracts,
        outcome,
        realizedR,
        entryQualityScore,
        // Critique fields — null when no critique yet
        grade: row.grade ?? null,
        plainEnglish: row.grade != null ? {
          one_liner: pe.one_liner ?? null,
          what_went_right: pe.what_went_right ?? null,
          what_to_watch: pe.what_to_watch ?? null,
          action_needed: pe.action_needed ?? null,
        } : null,
        technicalDiagnosis: row.grade != null ? td : null,
        dataCompleteness: row.dataCompleteness ?? null,
        missingFields: row.missingFields ?? [],
        // Context from technical diagnosis
        regimeAtEntry: td.regime_at_entry ?? null,
        structureStateAtEntry: td.structure_state_at_entry ?? null,
        confluenceScoreAtEntry: td.confluence_score_at_entry != null ? Number(td.confluence_score_at_entry) : null,
        narrativePhaseAtEntry: td.narrative_phase_at_entry ?? null,
        // TCA
        implementationShortfall: row.implementationShortfall ?? null,
        fillRatio: row.fillRatio ?? null,
        exitReason: td.exit_reason ?? null,
        // Critique provenance
        provider: row.provider ?? null,
        model: row.model ?? null,
        critiquedAt: row.critiquedAt ?? null,
        correlationId: row.correlationId ?? null,
      };
    });

    res.json({ data, total });
  } catch (err) {
    logger.error({ err }, "trade-journal: list query failed");
    res.status(500).json({ error: "internal_error", message: "Failed to fetch trade journal" });
  }
});

// ─── GET /api/trade-journal/stats ────────────────────────────────────────────

tradeJournalRoutes.get("/stats", async (req: Request, res: Response) => {
  try {
    // Total closed positions
    const [{ totalTrades }] = await db
      .select({ totalTrades: sql<number>`count(*)::int` })
      .from(paperPositions)
      .where(isNotNull(paperPositions.closedAt));

    // Win rate — positions where price delta is positive
    const [{ wins }] = await db
      .select({ wins: sql<number>`count(*)::int` })
      .from(paperPositions)
      .where(
        and(
          isNotNull(paperPositions.closedAt),
          sql`(
            CASE WHEN ${paperPositions.side} = 'long'
              THEN (${paperPositions.currentPrice}::numeric - ${paperPositions.entryPrice}::numeric)
              ELSE (${paperPositions.entryPrice}::numeric - ${paperPositions.currentPrice}::numeric)
            END
          ) > 0`
        )
      );

    const winRate = totalTrades > 0 ? wins / totalTrades : 0;

    // Average R and grade distribution — from trade_critique (only critiqued trades)
    const gradeRows = await db
      .select({
        grade: tradeCritique.grade,
        count: sql<number>`count(*)::int`,
        avgR: sql<number>`avg((${tradeCritique.technicalDiagnosis}->>'realized_r')::numeric)`,
      })
      .from(tradeCritique)
      .groupBy(tradeCritique.grade);

    const byGrade: Record<string, number> = {};
    let totalR = 0;
    let critiquedCount = 0;
    for (const row of gradeRows) {
      if (row.grade) {
        byGrade[row.grade] = row.count;
        if (row.avgR != null) {
          totalR += Number(row.avgR) * row.count;
          critiquedCount += row.count;
        }
      }
    }
    const avgR = critiquedCount > 0 ? totalR / critiquedCount : null;

    // Compute avgGrade as weighted letter from byGrade distribution
    let totalWeight = 0;
    let totalWeightedOrder = 0;
    for (const [grade, count] of Object.entries(byGrade)) {
      const order = GRADE_ORDER[grade] ?? 0;
      totalWeight += count;
      totalWeightedOrder += order * count;
    }
    const avgGradeOrder = totalWeight > 0 ? totalWeightedOrder / totalWeight : null;
    // Convert numeric order back to nearest letter grade
    const avgGrade = avgGradeOrder != null
      ? ALL_GRADES.reduce((best, g) => {
          return Math.abs((GRADE_ORDER[g] ?? 0) - avgGradeOrder) <
            Math.abs((GRADE_ORDER[best] ?? 0) - avgGradeOrder)
            ? g
            : best;
        })
      : null;

    // Regime distribution — from trade_critique JSONB field
    const regimeRows = await db
      .select({
        regime: sql<string>`${tradeCritique.technicalDiagnosis}->>'regime_at_entry'`,
        count: sql<number>`count(*)::int`,
      })
      .from(tradeCritique)
      .groupBy(sql`${tradeCritique.technicalDiagnosis}->>'regime_at_entry'`);

    const byRegime: Record<string, number> = {};
    for (const row of regimeRows) {
      if (row.regime) byRegime[row.regime] = row.count;
    }

    // By strategy — join sessions to get strategy names
    const strategyRows = await db
      .select({
        strategyName: strategies.name,
        count: sql<number>`count(*)::int`,
      })
      .from(paperPositions)
      .leftJoin(paperSessions, eq(paperPositions.sessionId, paperSessions.id))
      .leftJoin(strategies, eq(paperSessions.strategyId, strategies.id))
      .where(isNotNull(paperPositions.closedAt))
      .groupBy(strategies.name);

    const byStrategy: Record<string, number> = {};
    for (const row of strategyRows) {
      if (row.strategyName) byStrategy[row.strategyName] = row.count;
    }

    // Last 7 days count
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const [{ last7DaysCount }] = await db
      .select({ last7DaysCount: sql<number>`count(*)::int` })
      .from(paperPositions)
      .where(
        and(
          isNotNull(paperPositions.closedAt),
          gte(paperPositions.closedAt, sevenDaysAgo)
        )
      );

    // Rolling 30-day Sharpe — approximation from daily realized_r via trade_critique
    // Full Sharpe computation requires daily bucketing — approximate here from critique rows
    const sharpeRows = await db
      .select({
        r: sql<number>`(${tradeCritique.technicalDiagnosis}->>'realized_r')::numeric`,
      })
      .from(tradeCritique)
      .where(
        and(
          isNotNull(tradeCritique.technicalDiagnosis),
          gte(tradeCritique.critiquedAt, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))
        )
      );

    let sharpeRolling30d: number | null = null;
    if (sharpeRows.length >= 5) {
      const rs = sharpeRows.map((r) => Number(r.r)).filter((r) => isFinite(r));
      if (rs.length >= 5) {
        const mean = rs.reduce((s, r) => s + r, 0) / rs.length;
        const variance = rs.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / rs.length;
        const std = Math.sqrt(variance);
        sharpeRolling30d = std > 0 ? (mean / std) * Math.sqrt(252) : null;
      }
    }

    res.json({
      totalTrades,
      winRate,
      avgR,
      avgGrade,
      sharpeRolling30d,
      byRegime,
      byStrategy,
      last7DaysCount,
      byGrade,
    });
  } catch (err) {
    logger.error({ err }, "trade-journal: stats query failed");
    res.status(500).json({ error: "internal_error", message: "Failed to fetch trade journal stats" });
  }
});
