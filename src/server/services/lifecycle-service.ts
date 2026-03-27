/**
 * Strategy Lifecycle Service — state machine for strategy pipeline.
 *
 * Valid transitions:
 * CANDIDATE → TESTING → PAPER → DEPLOYED → DECLINING → RETIRED
 * DECLINING → TESTING (retry)
 */

import { eq, and, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { strategies, strategyNames, strategyGraveyard, backtests, auditLog } from "../db/schema.js";
import { logger } from "../index.js";
import { evolveStrategy } from "./evolution-service.js";
import { AlertFactory } from "./alert-service.js";

const VALID_STATES = [
  "CANDIDATE",
  "TESTING",
  "PAPER",
  "DEPLOYED",
  "DECLINING",
  "RETIRED",
] as const;

type LifecycleState = (typeof VALID_STATES)[number];

const VALID_TRANSITIONS: Record<LifecycleState, LifecycleState[]> = {
  CANDIDATE: ["TESTING"],
  TESTING: ["PAPER"],
  PAPER: ["DEPLOYED"],
  DEPLOYED: ["DECLINING"],
  DECLINING: ["TESTING", "RETIRED"],
  RETIRED: [],
};

export class LifecycleService {
  /**
   * Promote or demote a strategy to a new lifecycle state.
   * Validates the transition is allowed, logs to audit_log.
   */
  async promoteStrategy(
    id: string,
    fromState: LifecycleState,
    toState: LifecycleState,
  ): Promise<{ success: boolean; error?: string }> {
    // Validate transition
    const allowed = VALID_TRANSITIONS[fromState];
    if (!allowed || !allowed.includes(toState)) {
      const error = `Invalid transition: ${fromState} → ${toState}. Allowed: ${allowed?.join(", ") || "none"}`;
      logger.warn({ id, fromState, toState }, error);
      return { success: false, error };
    }

    // Verify current state matches
    const [strategy] = await db
      .select()
      .from(strategies)
      .where(eq(strategies.id, id));

    if (!strategy) {
      return { success: false, error: "Strategy not found" };
    }

    if (strategy.lifecycleState !== fromState) {
      return {
        success: false,
        error: `Strategy is in state '${strategy.lifecycleState}', not '${fromState}'`,
      };
    }

    // Update
    await db
      .update(strategies)
      .set({
        lifecycleState: toState,
        lifecycleChangedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(strategies.id, id));

    // Retire Forge name + bury in graveyard when strategy transitions to RETIRED
    if (toState === "RETIRED") {
      // 1. Retire the Forge name
      try {
        const [retiredName] = await db
          .update(strategyNames)
          .set({ retired: true, retiredAt: new Date() })
          .where(eq(strategyNames.strategyId, id))
          .returning();
        if (retiredName) {
          logger.info({ strategyId: id, codename: retiredName.codename }, "Forge name retired with strategy");
        }
      } catch (retireErr) {
        logger.warn(retireErr, "Failed to retire Forge name (non-blocking)");
      }

      // 2. Auto-bury in graveyard (fire-and-forget)
      this.buryInGraveyard(id, strategy).catch((buryErr) => {
        logger.warn({ strategyId: id, err: buryErr }, "Failed to auto-bury strategy in graveyard (non-blocking)");
      });
    }

    // Audit log
    await db.insert(auditLog).values({
      action: "strategy.lifecycle",
      entityType: "strategy",
      entityId: id,
      input: { fromState, toState },
      result: { success: true },
      status: "success",
    });

    logger.info({ id, fromState, toState }, "Strategy lifecycle transition");
    return { success: true };
  }

  /**
   * Bury a retired strategy in the graveyard for duplicate-checking.
   * Loads the latest backtest, extracts failure modes, inserts graveyard row.
   */
  private async buryInGraveyard(
    strategyId: string,
    strategy: { name: string; config: unknown },
  ): Promise<void> {
    // Check if already buried (idempotent)
    const [existing] = await db
      .select({ id: strategyGraveyard.id })
      .from(strategyGraveyard)
      .where(eq(strategyGraveyard.strategyId, strategyId))
      .limit(1);
    if (existing) return;

    // Fetch latest completed backtest for failure analysis
    const [latestBt] = await db
      .select()
      .from(backtests)
      .where(
        and(
          eq(backtests.strategyId, strategyId),
          eq(backtests.status, "completed"),
        ),
      )
      .orderBy(desc(backtests.createdAt))
      .limit(1);

    // Derive failure modes from metrics
    const failureModes: string[] = [];
    if (latestBt) {
      const sharpe = Number(latestBt.sharpeRatio ?? 0);
      const pf = Number(latestBt.profitFactor ?? 0);
      const wr = Number(latestBt.winRate ?? 0);
      const dd = Number(latestBt.maxDrawdown ?? 0);
      const avgDaily = Number(latestBt.avgDailyPnl ?? 0);

      if (sharpe < 0.8) failureModes.push("low_sharpe");
      if (pf < 1.0) failureModes.push("unprofitable");
      if (wr < 0.4) failureModes.push("low_win_rate");
      if (dd > 3000) failureModes.push("excessive_drawdown");
      if (avgDaily < 250) failureModes.push("below_minimum_daily_pnl");
      if (latestBt.tier === "REJECTED") failureModes.push("rejected_by_gate");
    }
    if (failureModes.length === 0) failureModes.push("alpha_decay");

    const backtestSummary = latestBt
      ? {
          sharpe: latestBt.sharpeRatio,
          profitFactor: latestBt.profitFactor,
          winRate: latestBt.winRate,
          maxDrawdown: latestBt.maxDrawdown,
          avgDailyPnl: latestBt.avgDailyPnl,
          tier: latestBt.tier,
          totalTrades: latestBt.totalTrades,
        }
      : null;

    await db.insert(strategyGraveyard).values({
      strategyId,
      name: strategy.name,
      dslSnapshot: strategy.config ?? {},
      failureModes,
      failureDetails: { backtestId: latestBt?.id ?? null, autoAnalysis: true },
      backtestSummary,
      deathReason: `Auto-retired: ${failureModes.join(", ")}`,
      deathDate: new Date(),
      source: "auto",
    });

    // Fire alert for visibility
    AlertFactory.decayAlert(strategyId, "retire").catch(() => {});

    logger.info(
      { strategyId, failureModes, name: strategy.name },
      "Strategy auto-buried in graveyard",
    );
  }

  /**
   * Check for auto-promotions: PAPER → DEPLOYED after 30 profitable days.
   */
  async checkAutoPromotions(): Promise<string[]> {
    const promoted: string[] = [];

    const paperStrategies = await db
      .select()
      .from(strategies)
      .where(eq(strategies.lifecycleState, "PAPER"));

    for (const s of paperStrategies) {
      if (!s.lifecycleChangedAt) continue;

      const daysSincePaper = Math.floor(
        (Date.now() - s.lifecycleChangedAt.getTime()) / (1000 * 60 * 60 * 24),
      );

      // Auto-promote after 30 days in PAPER — only if rolling Sharpe >= 1.5
      const rollingSharpe = s.rollingSharpe30d ? parseFloat(String(s.rollingSharpe30d)) : 0;
      if (daysSincePaper >= 30 && rollingSharpe >= 1.5) {
        const result = await this.promoteStrategy(s.id, "PAPER", "DEPLOYED");
        if (result.success) {
          promoted.push(s.id);
          logger.info({ id: s.id, rollingSharpe, daysSincePaper }, "Auto-promoted: PAPER → DEPLOYED");
        }
      } else if (daysSincePaper >= 30 && rollingSharpe < 1.5) {
        logger.warn({ id: s.id, rollingSharpe, daysSincePaper }, "Auto-promotion blocked: rolling Sharpe < 1.5");
      }
    }

    return promoted;
  }

  /**
   * Check for auto-demotions: DEPLOYED → DECLINING if rolling Sharpe < 1.0.
   */
  async checkAutoDemotions(): Promise<string[]> {
    const demoted: string[] = [];

    const deployedStrategies = await db
      .select()
      .from(strategies)
      .where(eq(strategies.lifecycleState, "DEPLOYED"));

    for (const s of deployedStrategies) {
      const sharpe = s.rollingSharpe30d ? parseFloat(s.rollingSharpe30d) : null;

      if (sharpe !== null && sharpe < 1.0) {
        const result = await this.promoteStrategy(s.id, "DEPLOYED", "DECLINING");
        if (result.success) {
          demoted.push(s.id);

          // Fire-and-forget: trigger self-evolution for declining strategy
          evolveStrategy(s.id).then((evoResult) => {
            logger.info({ strategyId: s.id, ...evoResult }, "Auto-evolution completed for declining strategy");
          }).catch((evoErr) => {
            logger.error({ strategyId: s.id, err: evoErr }, "Auto-evolution failed (non-blocking)");
          });
        }
      }
    }

    return demoted;
  }

  /**
   * Get pipeline health — count of strategies per lifecycle state.
   */
  async getPipelineHealth(): Promise<{
    counts: Record<string, number>;
    alerts: string[];
  }> {
    const allStrategies = await db.select().from(strategies);

    const counts: Record<string, number> = {};
    for (const state of VALID_STATES) {
      counts[state] = 0;
    }
    for (const s of allStrategies) {
      const state = s.lifecycleState;
      counts[state] = (counts[state] || 0) + 1;
    }

    const alerts: string[] = [];

    // Alert if no DEPLOYED strategies
    if (counts.DEPLOYED === 0) {
      alerts.push("No deployed strategies — pipeline is empty");
    }

    // Alert if no CANDIDATE/TESTING strategies (pipeline drying up)
    if (counts.CANDIDATE === 0 && counts.TESTING === 0) {
      alerts.push("No strategies in development — pipeline will dry up");
    }

    // Alert if too many DECLINING
    if (counts.DECLINING > counts.DEPLOYED) {
      alerts.push("More declining than deployed strategies — investigate");
    }

    return { counts, alerts };
  }
}
